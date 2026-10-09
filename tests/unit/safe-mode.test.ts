import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimePolicy,
  guardHardwareBridge,
  guardSensorBridge,
  parseRuntimePolicy,
} from '../../packages/application-ui/src/runtime-policy';
import { createHardwareStore } from '../../packages/application-ui/src/hardware-store';
import { SensorPoller } from '../../packages/application-ui/src/external-sensors';
const safe = { schemaVersion: 1, mode: 'safe', hardwareDiscovery: false, thermalSensors: false };
const normal = { ...safe, mode: 'normal', hardwareDiscovery: true, thermalSensors: true };
function bridges() {
  return {
    hardware: { restore: vi.fn(async () => null), scan: vi.fn(async () => null) },
    sensors: {
      open: vi.fn(async () => 1),
      configure: vi.fn(async () => 1),
      read: vi.fn(async () => null),
    },
  };
}
describe('hardware-free Safe Mode isolation', () => {
  it.each([
    safe,
    null,
    {},
    { ...safe, thermalSensors: true },
    { ...normal, schemaVersion: 2 },
    { ...normal, override: true },
  ])('refuses every source for blocked or malformed policy %j', async (value) => {
    const policy = createRuntimePolicy(async () => value);
    const b = bridges();
    const hardware = guardHardwareBridge(b.hardware, policy);
    const sensors = guardSensorBridge(b.sensors, policy);
    await expect(hardware.restore()).rejects.toThrow();
    await expect(hardware.scan()).rejects.toThrow();
    await expect(sensors.open()).rejects.toThrow();
    await expect(sensors.configure(true, 1, 1)).rejects.toThrow();
    await expect(sensors.configure(false, 1, 2)).rejects.toThrow();
    await expect(sensors.read(1)).rejects.toThrow();
    for (const spy of [...Object.values(b.hardware), ...Object.values(b.sensors)])
      expect(spy).not.toHaveBeenCalled();
  });
  it('fails closed on native policy failure, without retrying or invoking sources', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('IPC unavailable');
    });
    const policy = createRuntimePolicy(resolve);
    const b = bridges();
    const store = createHardwareStore(guardHardwareBridge(b.hardware, policy));
    await store.getState().start();
    await store.getState().rescan();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(b.hardware.restore).not.toHaveBeenCalled();
    expect(b.hardware.scan).not.toHaveBeenCalled();
    expect(store.getState().scan).toBeNull();
    expect(store.getState().scanning).toBe(false);
    expect(store.getState().error).toBe(
      'Native safety policy unavailable. Hardware access is disabled.',
    );
  });
  it('awaits policy before automatic startup or manual rescan, then denies both in Safe Mode', async () => {
    let finish!: (value: unknown) => void;
    const policy = createRuntimePolicy(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const b = bridges();
    const store = createHardwareStore(guardHardwareBridge(b.hardware, policy));
    const startup = store.getState().start();
    const rescan = store.getState().rescan();
    expect(b.hardware.restore).not.toHaveBeenCalled();
    expect(b.hardware.scan).not.toHaveBeenCalled();
    finish(safe);
    await startup;
    await rescan;
    await store.getState().start();
    await store.getState().rescan();
    expect(b.hardware.restore).not.toHaveBeenCalled();
    expect(b.hardware.scan).not.toHaveBeenCalled();
    expect(store.getState().scan).toBeNull();
    expect(store.getState().error).toBe(
      'Safe Mode: hardware discovery and temperature sources are disabled',
    );
  });
  it('forced polling with consent never opens a source or schedules a request in Safe Mode', async () => {
    const b = bridges();
    const scheduler = { after: vi.fn(), cancel: vi.fn() };
    const poller = new SensorPoller(
      guardSensorBridge(
        b.sensors,
        createRuntimePolicy(async () => safe),
      ),
      scheduler,
      vi.fn(),
    );
    expect(await poller.start()).toBe(false);
    poller.stop();
    for (const spy of Object.values(b.sensors)) expect(spy).not.toHaveBeenCalled();
    expect(scheduler.after).not.toHaveBeenCalled();
  });
  it('memoizes and freezes the native policy; normal policy permits only the injected mock bridges', async () => {
    const resolve = vi.fn(async () => normal);
    const policy = createRuntimePolicy(resolve);
    const b = bridges();
    await guardHardwareBridge(b.hardware, policy).restore();
    await guardHardwareBridge(b.hardware, policy).scan();
    await guardSensorBridge(b.sensors, policy).open();
    await guardSensorBridge(b.sensors, policy).configure(true, 1, 1);
    await guardSensorBridge(b.sensors, policy).read(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(policy.getSnapshot())).toBe(true);
    for (const spy of [...Object.values(b.hardware), ...Object.values(b.sensors)])
      expect(spy).toHaveBeenCalledTimes(1);
    expect(() => parseRuntimePolicy({ ...safe, mode: 'unknown' })).toThrow();
  });
});
