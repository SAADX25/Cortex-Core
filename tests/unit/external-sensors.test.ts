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
    const bridge = {
      open: vi.fn(async () => 1),
      configure: vi.fn(async () => 2),
      read: vi.fn(async () => snapshot),
    };
    const publish = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, publish);
    await vi.advanceTimersByTimeAsync(30000);
    expect(bridge.open).not.toHaveBeenCalled();
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(bridge.read).not.toHaveBeenCalled();
    await poller.start();
    expect(bridge.configure).toHaveBeenCalledWith(true, 1, 1);
    expect(bridge.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(bridge.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.read).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(bridge.configure).toHaveBeenLastCalledWith(false, 1, 2);
  });
  it('never overlaps a hung read and discards completion after navigation/hidden/disconnect', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const bridge = {
      open: vi.fn(async () => 1),
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
      open: vi.fn(async () => 1),
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
      open: vi.fn(async () => 1),
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
    await Promise.resolve();
    poller.stop();
    resolve(1);
    await pending;
    expect(bridge.read).not.toHaveBeenCalled();
    expect(bridge.configure).toHaveBeenLastCalledWith(false, 1, 2);
  });
  it('stop during inert owner creation never sends an enable', async () => {
    let finish!: (owner: number) => void;
    const bridge = {
      open: () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
      configure: vi.fn(async () => 2),
      read: vi.fn(),
    };
    const poller = new SensorPoller(bridge, scheduler, vi.fn());
    const pending = poller.start();
    poller.stop();
    finish(1);
    await pending;
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(bridge.read).not.toHaveBeenCalled();
  });
  it('rapid reconnect ignores late old setup completion and old cleanup', async () => {
    vi.useFakeTimers();
    let finish!: (session: number) => void;
    const bridge = {
      open: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3),
      configure: vi.fn().mockImplementation((consent, owner) =>
        consent && owner === 1
          ? new Promise<number>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(4),
      ),
      read: vi.fn(async () => snapshot),
    };
    const publish = vi.fn();
    const phase = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, publish, phase);
    const first = poller.start();
    await Promise.resolve();
    poller.stop();
    await poller.start();
    finish(2);
    await first;
    expect(bridge.read).toHaveBeenCalledExactlyOnceWith(4);
    expect(phase).toHaveBeenLastCalledWith('monitoring');
    expect(publish).toHaveBeenLastCalledWith(snapshot);
    poller.stop();
    expect(bridge.configure).toHaveBeenLastCalledWith(false, 3, 2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a pending old read does not overlap a new session or overwrite its data', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const bridge = {
      open: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3),
      configure: vi.fn(async () => 4),
      read: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue(snapshot),
    };
    const publish = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, publish);
    const old = poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await poller.start();
    await vi.advanceTimersByTimeAsync(20000);
    expect(bridge.read).toHaveBeenCalledTimes(1);
    finish({ ...snapshot, status: 'old error' });
    await old;
    expect(publish).toHaveBeenLastCalledWith(unavailableSensors('waiting'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(snapshot);
    poller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('terminal refusal revokes consent, removes polling and permits an explicit retry', async () => {
    vi.useFakeTimers();
    const bridge = {
      open: vi.fn(async () => 1),
      configure: vi.fn(async () => 2),
      read: vi
        .fn()
        .mockResolvedValueOnce(unavailableSensors('Binding refused'))
        .mockResolvedValue(snapshot),
    };
    const phase = vi.fn();
    const poller = new SensorPoller(bridge, scheduler, vi.fn(), phase);
    expect(await poller.start()).toBe(false);
    expect(phase).toHaveBeenLastCalledWith('error');
    expect(bridge.configure).toHaveBeenLastCalledWith(false, 1, 2);
    expect(vi.getTimerCount()).toBe(0);
    expect(await poller.start()).toBe(true);
    poller.stop();
  });
});
