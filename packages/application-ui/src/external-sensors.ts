export const sensorCategories = [
  'cpu',
  'gpu',
  'motherboard',
  'storage',
  'memory',
  'unsupported',
] as const;
export type SensorCategory = (typeof sensorCategories)[number];
export type Availability = 'available' | 'missing' | 'unsupported' | 'ambiguous' | 'stale';
export interface ExternalSensor {
  hardwareId: string;
  hardwareName: string;
  category: SensorCategory;
  sensorId: string;
  sensorName: string;
  kind: 'temperature';
  unit: 'celsius';
  value: number | null;
  observedAt: number;
  measuredAt: null;
  availability: Availability;
  deviceMatch: 'unmatched';
}
export interface ExternalSnapshot {
  schemaVersion: 1;
  source: 'librehardwaremonitor';
  status: string;
  observedAt: number | null;
  staleAfterMs: 15000;
  sensors: ExternalSensor[];
}
export const unavailableSensors = (status: string): ExternalSnapshot => ({
  schemaVersion: 1,
  source: 'librehardwaremonitor',
  status,
  observedAt: null,
  staleAfterMs: 15000,
  sensors: [],
});
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const bounded = (value: unknown, max = 256): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  !Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
export function parseExternalSnapshot(value: unknown): ExternalSnapshot {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'source',
      'status',
      'observedAt',
      'staleAfterMs',
      'sensors',
    ]) ||
    value.schemaVersion !== 1 ||
    value.source !== 'librehardwaremonitor' ||
    !bounded(value.status, 256) ||
    (value.observedAt !== null && !time(value.observedAt)) ||
    value.staleAfterMs !== 15000 ||
    !Array.isArray(value.sensors) ||
    value.sensors.length > 4096
  )
    throw new Error('Unsupported sensor response');
  for (const s of value.sensors) {
    if (
      !isObject(s) ||
      !exactKeys(s, [
        'hardwareId',
        'hardwareName',
        'category',
        'sensorId',
        'sensorName',
        'kind',
        'unit',
        'value',
        'observedAt',
        'measuredAt',
        'availability',
        'deviceMatch',
      ]) ||
      !bounded(s.hardwareId) ||
      !bounded(s.hardwareName) ||
      !bounded(s.sensorId) ||
      !bounded(s.sensorName) ||
      !sensorCategories.includes(s.category as SensorCategory) ||
      s.kind !== 'temperature' ||
      s.unit !== 'celsius' ||
      !time(s.observedAt) ||
      s.observedAt !== value.observedAt ||
      s.measuredAt !== null ||
      s.deviceMatch !== 'unmatched' ||
      !['available', 'missing', 'unsupported', 'ambiguous', 'stale'].includes(
        s.availability as string,
      ) ||
      (s.availability === 'available'
        ? typeof s.value !== 'number' ||
          !Number.isFinite(s.value) ||
          s.value < -100 ||
          s.value > 200
        : s.value !== null)
    )
      throw new Error('Invalid normalized sensor');
  }
  return structuredClone(value) as unknown as ExternalSnapshot;
}
export function sensorValue(sensor: ExternalSensor, now: number): string {
  if (
    sensor.availability !== 'available' ||
    sensor.value === null ||
    now < sensor.observedAt ||
    now - sensor.observedAt > 15000
  )
    return 'Not available';
  return `${sensor.value.toFixed(1)} °C`;
}

export interface SensorBridge {
  configure(consent: boolean): Promise<number>;
  read(session: number): Promise<unknown>;
}
export interface SensorScheduler {
  after(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
}
// Completion-based scheduling. No timer interval, catch-up burst or overlapping read.
export class SensorPoller {
  private generation = 0;
  private timer: unknown;
  private busy = false;
  private enabled = false;
  constructor(
    private bridge: SensorBridge,
    private scheduler: SensorScheduler,
    private publish: (snapshot: ExternalSnapshot) => void,
  ) {}
  async start() {
    if (this.enabled || this.busy) return false;
    this.enabled = true;
    const generation = ++this.generation;
    this.busy = true;
    try {
      const session = await this.bridge.configure(true);
      if (!this.enabled || this.generation !== generation) return false;
      this.busy = false;
      await this.poll(session, generation);
      return this.enabled && this.generation === generation;
    } catch {
      if (this.generation === generation)
        this.publish(unavailableSensors('Sensor connection unavailable'));
      this.enabled = false;
      return false;
    } finally {
      this.busy = false;
    }
  }
  private async poll(session: number, generation: number) {
    if (!this.enabled || generation !== this.generation || this.busy) return;
    this.busy = true;
    try {
      const snapshot = parseExternalSnapshot(await this.bridge.read(session));
      if (this.enabled && generation === this.generation) this.publish(snapshot);
    } catch {
      if (this.enabled && generation === this.generation)
        this.publish(unavailableSensors('Sensor server unavailable or response rejected'));
    } finally {
      this.busy = false;
      if (this.enabled && generation === this.generation)
        this.timer = this.scheduler.after(() => {
          void this.poll(session, generation);
        }, 5000);
    }
  }
  stop() {
    this.enabled = false;
    ++this.generation;
    if (this.timer !== undefined) this.scheduler.cancel(this.timer);
    this.publish(unavailableSensors('disabled'));
    // Revoke even if setup or a native read is in flight. Native generation rejects late data.
    void this.bridge.configure(false).catch(() => undefined);
  }
}
