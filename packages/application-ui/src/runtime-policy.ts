import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './platform';
import type { HardwareBridge } from './hardware-store';
import type { SensorBridge } from './external-sensors';

export interface RuntimePolicy {
  readonly schemaVersion: 1;
  readonly mode: 'safe' | 'normal';
  readonly hardwareDiscovery: boolean;
  readonly thermalSensors: boolean;
}
export class HardwareAccessDisabled extends Error {}
export function parseRuntimePolicy(value: unknown): Readonly<RuntimePolicy> {
  if (!value || typeof value !== 'object') throw new Error('Invalid runtime policy');
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).sort().join(',') !== 'hardwareDiscovery,mode,schemaVersion,thermalSensors' ||
    p.schemaVersion !== 1 ||
    !['safe', 'normal'].includes(p.mode as string) ||
    typeof p.hardwareDiscovery !== 'boolean' ||
    typeof p.thermalSensors !== 'boolean' ||
    p.hardwareDiscovery !== (p.mode === 'normal') ||
    p.thermalSensors !== (p.mode === 'normal')
  )
    throw new Error('Invalid runtime policy');
  return Object.freeze({ ...p } as unknown as RuntimePolicy);
}
export function createRuntimePolicy(resolve: () => Promise<unknown>) {
  let current: Readonly<RuntimePolicy> | null = null;
  let pending: Promise<Readonly<RuntimePolicy> | null> | undefined;
  const listeners = new Set<() => void>();
  const load = () =>
    (pending ??= (async () => {
      try {
        current = parseRuntimePolicy(await resolve());
      } catch {
        current = null;
      }
      for (const listener of listeners) listener();
      return current;
    })());
  return {
    load,
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async require(source: 'hardwareDiscovery' | 'thermalSensors') {
      const policy = await load();
      if (!policy?.[source])
        throw new HardwareAccessDisabled(
          policy?.mode === 'safe'
            ? 'Safe Mode: hardware discovery and temperature sources are disabled'
            : 'Native safety policy unavailable. Hardware access is disabled.',
        );
    },
  };
}
type PolicyGate = ReturnType<typeof createRuntimePolicy>;
export function guardHardwareBridge(bridge: HardwareBridge, policy: PolicyGate): HardwareBridge {
  return {
    async restore() {
      await policy.require('hardwareDiscovery');
      return bridge.restore();
    },
    async scan() {
      await policy.require('hardwareDiscovery');
      return bridge.scan();
    },
  };
}
export function guardSensorBridge(bridge: SensorBridge, policy: PolicyGate): SensorBridge {
  return {
    async open() {
      await policy.require('thermalSensors');
      return bridge.open();
    },
    async configure(consent, owner, revision) {
      // No sensor IPC at all in Safe Mode, including cleanup calls.
      await policy.require('thermalSensors');
      return bridge.configure(consent, owner, revision);
    },
    async read(session) {
      await policy.require('thermalSensors');
      return bridge.read(session);
    },
  };
}
export const runtimePolicy = createRuntimePolicy(() =>
  isDesktop ? invoke<unknown>('get_runtime_policy') : Promise.reject(new Error('Desktop required')),
);
export function useRuntimePolicy() {
  const policy = useSyncExternalStore(
    runtimePolicy.subscribe,
    runtimePolicy.getSnapshot,
    runtimePolicy.getSnapshot,
  );
  useEffect(() => {
    void runtimePolicy.load();
  }, []);
  return policy;
}
