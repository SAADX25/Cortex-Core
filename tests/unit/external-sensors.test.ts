import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseExternalSnapshot,
  SensorPoller,
  sensorValue,
  unavailableSensors,
  type ExternalSensor,
} from '../../packages/application-ui/src/external-sensors';
const sensor: ExternalSensor = {
  hardwareId: '/gpu-nvidia/0',
  hardwareName: 'Mock NVIDIA',
  category: 'gpu',
  sensorId: '/gpu-nvidia/0/temperature/0',
  sensorName: 'GPU Core',
  kind: 'temperature',
  unit: 'celsius',
  value: 48,
  observedAt: 100000,
  measuredAt: null,
  availability: 'available',
  deviceMatch: 'unmatched',
};
const snapshot = { ...unavailableSensors('connected'), observedAt: 100000, sensors: [sensor] };
const scheduler = {
  after: (callback: () => void, ms: number) => setTimeout(callback, ms),
  cancel: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
afterEach(() => vi.useRealTimers());
describe('normalized external sensor data', () => {
  it('shows unavailable for stale, missing, ambiguous, unsupported or future data', () => {
    expect(sensorValue(sensor, 100001)).toBe('48.0 °C');
    expect(sensorValue(sensor, 115001)).toBe('Not available');
    expect(sensorValue(sensor, 99999)).toBe('Not available');
    for (const availability of ['missing', 'ambiguous', 'unsupported', 'stale'] as const)
      expect(sensorValue({ ...sensor, value: null, availability }, 100001)).toBe('Not available');
  });
  it('rejects malformed normalized IPC data and guessed mappings', () => {
    expect(parseExternalSnapshot(snapshot)).toEqual(snapshot);
    for (const s of [
      { ...sensor, unit: 'fahrenheit' },
      { ...sensor, deviceMatch: 'exact' },
      { ...sensor, value: NaN },
      { ...sensor, measuredAt: 100000 },
      { ...sensor, availability: 'missing' },
      { ...sensor, observedAt: 99999 },
    ])
      expect(() => parseExternalSnapshot({ ...snapshot, sensors: [s] })).toThrow();
    expect(() => parseExternalSnapshot({ ...snapshot, url: 'http://example.com' })).toThrow();
  });
});
describe('session consent and bounded polling', () => {
  it('starts dormant, reads only after consent and schedules from completion', async () => {
    vi.useFakeTimers();
    const bridge = { configure: vi.fn(async () => 1), read: vi.fn(async () => snapshot) };
    const publish = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, publish);
    await vi.advanceTimersByTimeAsync(30000);
    expect(bridge.read).not.toHaveBeenCalled();
    await poller.start();
    expect(bridge.configure).toHaveBeenCalledWith(true);
    expect(bridge.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(bridge.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.read).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(bridge.configure).toHaveBeenLastCalledWith(false);
  });
  it('never overlaps a hung read and discards completion after navigation/hidden/disconnect', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const bridge = {
      configure: vi.fn(async () => 1),
      read: vi.fn(
        () =>
          new Promise<unknown>((r) => {
            resolve = r;
          }),
      ),
    };
    const publish = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, publish);
    const pending = poller.start();
    await vi.advanceTimersByTimeAsync(30000);
    await poller.start();
    expect(bridge.read).toHaveBeenCalledTimes(1);
    poller.stop();
    resolve(snapshot);
    await pending;
    await vi.advanceTimersByTimeAsync(30000);
    expect(bridge.read).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(unavailableSensors('disabled'));
  });
  it('clears data when server shuts down or JSON is rejected', async () => {
    vi.useFakeTimers();
    const bridge = {
      configure: vi.fn(async () => 1),
      read: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockRejectedValueOnce(new Error('Stopped'))
        .mockResolvedValueOnce({ malformed: true }),
    };
    const publish = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, publish);
    await poller.start();
    expect(publish).toHaveBeenLastCalledWith(snapshot);
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish.mock.lastCall?.[0].sensors).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish.mock.lastCall?.[0].sensors).toEqual([]);
    poller.stop();
  });
  it('revoke while setup is pending prevents any read', async () => {
    let resolve!: (value: number) => void;
    const bridge = {
      configure: vi.fn((consent: boolean) =>
        consent
          ? new Promise<number>((r) => {
              resolve = r;
            })
          : Promise.resolve(2),
      ),
      read: vi.fn(async () => snapshot),
    };
    const poller = new SensorPoller(bridge, scheduler, vi.fn());
    const pending = poller.start();
    poller.stop();
    resolve(1);
    await pending;
    expect(bridge.read).not.toHaveBeenCalled();
  });
});
