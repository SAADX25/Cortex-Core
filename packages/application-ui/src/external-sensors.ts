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
  const snapshot = structuredClone(value) as unknown as ExternalSnapshot;
  const counts = new Map<string, number>();
  for (const sensor of snapshot.sensors) {
    const key = JSON.stringify([sensor.hardwareId, sensor.sensorId]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const sensor of snapshot.sensors) {
    if (counts.get(JSON.stringify([sensor.hardwareId, sensor.sensorId])) !== 1) {
      sensor.availability = 'ambiguous';
      sensor.value = null;
    }
  }
  return snapshot;
}
export function sensorValue(sensor: ExternalSensor, now: number): string {
  if (
    sensor.availability !== 'available' ||
    sensor.category === 'unsupported' ||
    sensor.value === null ||
    now < sensor.observedAt ||
    now - sensor.observedAt > 15000
  )
    return 'Not available';
  return `${sensor.value.toFixed(1)} °C`;
}

export interface SensorBridge {
  open(): Promise<number>;
  configure(consent: boolean, owner: number, revision: number): Promise<number>;
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
  private owner: number | undefined;
  private revision = 0;
  constructor(
    private bridge: SensorBridge,
    private scheduler: SensorScheduler,
    private publish: (snapshot: ExternalSnapshot) => void,
    private changed: (phase: 'disconnected' | 'connecting' | 'monitoring' | 'error') => void = () =>
      undefined,
  ) {}
  async start() {
    if (this.enabled) return false;
    this.enabled = true;
    const generation = ++this.generation;
    this.changed('connecting');
    this.publish(unavailableSensors('waiting'));
    try {
      const owner = await this.bridge.open();
      if (!this.enabled || this.generation !== generation) return false;
      this.owner = owner;
      this.revision = 1;
      const session = await this.bridge.configure(true, owner, this.revision);
      if (!this.enabled || this.generation !== generation) return false;
      await this.poll(session, generation);
      return this.enabled && this.generation === generation;
    } catch {
      this.fail(generation, 'Sensor session unavailable. Reconnect to try again.');
      return false;
    }
  }
  private schedule(session: number, generation: number) {
    if (!this.enabled || generation !== this.generation) return;
    if (this.timer !== undefined) this.scheduler.cancel(this.timer);
    this.timer = this.scheduler.after(() => {
      this.timer = undefined;
      void this.poll(session, generation);
    }, 5000);
  }
  private revoke() {
    const owner = this.owner;
    this.owner = undefined;
    if (owner !== undefined)
      void this.bridge.configure(false, owner, ++this.revision).catch(() => undefined);
  }
  private fail(generation: number, status: string) {
    if (generation !== this.generation) return;
    this.enabled = false;
    this.revoke();
    this.publish(unavailableSensors(status));
    this.changed('error');
  }
  private async poll(session: number, generation: number) {
    if (!this.enabled || generation !== this.generation) return;
    if (this.busy) {
      this.schedule(session, generation);
      return;
    }
    this.busy = true;
    try {
      const snapshot = parseExternalSnapshot(await this.bridge.read(session));
      if (!this.enabled || generation !== this.generation) return;
      if (!['connected', 'waiting', 'stale'].includes(snapshot.status)) {
        this.fail(
          generation,
          snapshot.status === 'disabled'
            ? 'Sensor session ended. Reconnect to try again.'
            : snapshot.status,
        );
        return;
      }
      this.publish(snapshot);
      this.changed(snapshot.status === 'waiting' ? 'connecting' : 'monitoring');
    } catch {
      this.fail(
        generation,
        'Sensor server unavailable or response rejected. Reconnect to try again.',
      );
    } finally {
      this.busy = false;
      this.schedule(session, generation);
    }
  }
  stop() {
    this.enabled = false;
    ++this.generation;
    if (this.timer !== undefined) this.scheduler.cancel(this.timer);
    this.timer = undefined;
    this.revoke();
    this.publish(unavailableSensors('disabled'));
    this.changed('disconnected');
  }
}
