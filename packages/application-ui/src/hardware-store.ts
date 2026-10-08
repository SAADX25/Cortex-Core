import { createStore } from 'zustand/vanilla';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './platform';
import { parseHardwareScan, type HardwareScan } from './hardware';
export interface HardwareBridge {
  restore(): Promise<unknown>;
  scan(): Promise<unknown>;
}
export interface HardwareState {
  scan: HardwareScan | null;
  scanning: boolean;
  started: boolean;
  error: string | null;
  start(): Promise<void>;
  rescan(): Promise<void>;
}
export function sameHardware(a: HardwareScan | null, b: HardwareScan): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, scannedAt: 0 }) === JSON.stringify({ ...b, scannedAt: 0 });
}
export function createHardwareStore(bridge: HardwareBridge) {
  return createStore<HardwareState>((set, get) => ({
    scan: null,
    scanning: false,
    started: false,
    error: null,
    async start() {
      if (get().started) return;
      set({ started: true });
      try {
        const cached = await bridge.restore();
        if (cached) set({ scan: parseHardwareScan(cached) });
      } catch {
        /* A broken cache must not prevent a fresh scan. */
      }
      await get().rescan();
    },
    async rescan() {
      if (get().scanning) return;
      set({ scanning: true, error: null });
      try {
        const fresh = parseHardwareScan(await bridge.scan());
        const previous = get().scan;
        // Preserve device array identities on unchanged scans; update only the last-scanned time.
        set({
          scan: sameHardware(previous, fresh)
            ? { ...previous!, scannedAt: fresh.scannedAt }
            : fresh,
          scanning: false,
        });
      } catch {
        set({
          scanning: false,
          error: isDesktop
            ? 'Hardware scanning is unavailable. Your last successful scan is kept. Rescan to try again.'
            : 'Local hardware scanning is available in the Windows desktop app.',
        });
      }
    },
  }));
}
export const hardwareStore = createHardwareStore({
  restore: () => (isDesktop ? invoke('load_hardware_scan') : Promise.resolve(null)),
  scan: () =>
    isDesktop ? invoke('scan_hardware') : Promise.reject(new Error('Windows desktop required')),
});
