import {
  type ExternalSensor,
  type ExternalSnapshot,
  type SensorCategory,
} from './external-sensors';

export const HISTORY_WINDOW_MS = 60 * 60 * 1000;
export const MAX_HISTORY_SENSORS = 64;
export const MAX_SENSOR_POINTS = 721;
export const MAX_HISTORY_POINTS = 12000;
export const chartRanges = [1, 5, 15, 30, 60] as const;
export type HistoryPoint = readonly [time: number, value: number | null];
interface Series {
  hardwareId: string;
  hardwareName: string;
  sensorId: string;
  sensorName: string;
  points: HistoryPoint[];
}
export const sensorKey = (sensor: Pick<ExternalSensor, 'hardwareId' | 'sensorId'>) =>
  JSON.stringify([sensor.hardwareId, sensor.sensorId]);
export function freshTemperature(sensor: ExternalSensor, now: number): number | null {
  return sensor.availability === 'available' &&
    sensor.category !== 'unsupported' &&
    typeof sensor.value === 'number' &&
    Number.isFinite(sensor.value) &&
    sensor.value >= -100 &&
    sensor.value <= 200 &&
    sensor.observedAt <= now &&
    now - sensor.observedAt <= 15000
    ? sensor.value
    : null;
}

// Session-only, no persistence. All three cardinality limits apply simultaneously.
export class TemperatureHistory {
  private series = new Map<string, Series>();
  private lastObservation = 0;
  truncated = false;
  clear() {
    this.series.clear();
    this.lastObservation = 0;
    this.truncated = false;
  }
  entries(): readonly (readonly [string, Series])[] {
    return [...this.series.entries()];
  }
  get(key: string): readonly HistoryPoint[] {
    return this.series.get(key)?.points ?? [];
  }
  get pointCount() {
    let count = 0;
    for (const series of this.series.values()) count += series.points.length;
    return count;
  }
  observe(snapshot: ExternalSnapshot, now: number) {
    this.prune(now);
    if (
      snapshot.status !== 'connected' ||
      snapshot.observedAt === null ||
      snapshot.observedAt > now ||
      now - snapshot.observedAt > 15000
    ) {
      this.gap(now);
      return;
    }
    if (snapshot.observedAt <= this.lastObservation) return; // Native cache repeats are not new samples.
    this.lastObservation = snapshot.observedAt;
    const counts = new Map<string, number>();
    for (const sensor of snapshot.sensors) {
      const key = sensorKey(sensor);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = new Set<string>();
    for (const sensor of snapshot.sensors) {
      const key = sensorKey(sensor);
      seen.add(key);
      const value = counts.get(key) === 1 ? freshTemperature(sensor, now) : null;
      let series = this.series.get(key);
      if (!series && value !== null) {
        if (this.series.size >= MAX_HISTORY_SENSORS) {
          this.truncated = true;
          continue;
        }
        series = {
          hardwareId: sensor.hardwareId,
          hardwareName: sensor.hardwareName,
          sensorId: sensor.sensorId,
          sensorName: sensor.sensorName,
          points: [],
        };
        this.series.set(key, series);
      }
      if (series) this.append(series, snapshot.observedAt, value);
    }
    for (const [key, series] of this.series)
      if (!seen.has(key)) this.append(series, snapshot.observedAt, null);
    this.limitTotal();
  }
  private append(series: Series, at: number, value: number | null) {
    const last = series.points.at(-1);
    if (last && (at <= last[0] || (last[1] === null && value === null))) return;
    series.points.push([at, value]);
    if (series.points.length > MAX_SENSOR_POINTS) {
      series.points.shift();
      this.truncated = true;
    }
  }
  gap(now: number) {
    for (const series of this.series.values()) this.append(series, now, null);
    this.limitTotal();
  }
  prune(now: number) {
    for (const [key, series] of this.series) {
      const first = series.points.findIndex(([at]) => at >= now - HISTORY_WINDOW_MS);
      if (first < 0) this.series.delete(key);
      else if (first > 0) series.points.splice(0, first);
    }
  }
  private limitTotal() {
    let count = this.pointCount;
    // At most 64 heads compared per removal; no separate unbounded index/heap.
    while (count > MAX_HISTORY_POINTS) {
      let oldest: Series | undefined;
      for (const series of this.series.values())
        if (series.points.length && (!oldest || series.points[0]![0] < oldest.points[0]![0]))
          oldest = series;
      oldest?.points.shift();
      count--;
      this.truncated = true;
    }
  }
}
export function chartSegments(
  points: readonly HistoryPoint[],
  now: number,
  minutes: number,
): number[][][] {
  const segments: number[][][] = [];
  let previous = 0;
  let segment: number[][] | undefined;
  for (const [at, value] of points) {
    if (at < now - minutes * 60000 || at > now) continue;
    if (value === null) {
      segment = undefined;
      previous = at;
      continue;
    }
    if (!segment || at - previous > 15000) {
      segment = [];
      segments.push(segment);
    }
    segment.push([at, value]);
    previous = at;
  }
  return segments;
}
export type WarningThresholds = Record<Exclude<SensorCategory, 'unsupported'>, number>;
export const defaultThresholds: WarningThresholds = {
  cpu: 85,
  gpu: 85,
  motherboard: 70,
  storage: 60,
  memory: 70,
};
export function temperatureWarning(
  sensor: ExternalSensor,
  now: number,
  enabled: boolean,
  thresholds: WarningThresholds,
) {
  const value = freshTemperature(sensor, now);
  if (!enabled || value === null || sensor.category === 'unsupported') return false;
  const threshold = thresholds[sensor.category];
  return Number.isFinite(threshold) && threshold >= -100 && threshold <= 200 && value >= threshold;
}
