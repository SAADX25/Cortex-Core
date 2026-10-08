import { describe, expect, it, vi } from 'vitest';
import { hardwareFixture } from '../hardware-fixture';
import {
  parseHardwareScan,
  specifications,
  cardSummary,
} from '../../packages/application-ui/src/hardware';
import {
  createHardwareStore,
  sameHardware,
} from '../../packages/application-ui/src/hardware-store';
describe('detected hardware boundary', () => {
  it('validates multiple modules, physical disks and integrated/discrete adapters', () => {
    const scan = parseHardwareScan(hardwareFixture);
    expect(scan.memory).toHaveLength(2);
    expect(scan.storage).toHaveLength(2);
    expect(scan.gpu).toHaveLength(2);
    expect(cardSummary(scan, 'memory').name).toBe('32 GiB DDR5');
    expect(specifications(scan)).toContain('Discrete test adapter');
    expect(specifications(scan)).toContain('BIOS');
  });
  it('rejects malformed envelopes, numbers and unexpected identifying fields', () => {
    for (const change of [
      { schemaVersion: 2 },
      { scannedAt: 'bad' },
      { totalMemoryBytes: -1 },
      { cpu: null },
      { serialNumber: 'sensitive' },
      { unavailable: [{}] },
    ])
      expect(() => parseHardwareScan({ ...hardwareFixture, ...change })).toThrow();
    expect(() =>
      parseHardwareScan({
        ...hardwareFixture,
        cpu: [{ name: 'Test', properties: { SerialNumber: 'sensitive' } }],
      }),
    ).toThrow();
  });
  it('handles missing categories and unknown fields honestly', () => {
    const scan = parseHardwareScan({
      ...hardwareFixture,
      motherboard: [],
      gpu: [{ name: 'Unknown', properties: { 'Dedicated VRAM (bytes)': 'Unknown' } }],
      unavailable: ['Motherboard'],
    });
    expect(cardSummary(scan, 'motherboard').name).toBe('Information unavailable');
    expect(cardSummary(scan, 'gpu').lines[0]).toBe('VRAM not reported by system');
  });
  it('has no sensitive data in copied specifications', () => {
    const output = specifications(hardwareFixture);
    for (const key of ['SerialNumber', 'MACAddress', 'ProductKey', 'DeviceId'])
      expect(output).not.toContain(key);
  });
});
describe('scan startup and replacement', () => {
  it('restores cache before a background scan finishes and deduplicates startup', async () => {
    let finish!: (value: unknown) => void;
    const fresh = new Promise((resolve) => {
      finish = resolve;
    });
    const bridge = { restore: vi.fn(async () => hardwareFixture), scan: vi.fn(() => fresh) };
    const store = createHardwareStore(bridge);
    const startup = store.getState().start();
    await store.getState().start();
    await Promise.resolve();
    expect(store.getState().scan?.cpu[0]?.name).toBe(hardwareFixture.cpu[0]?.name);
    expect(store.getState().scanning).toBe(true);
    expect(bridge.scan).toHaveBeenCalledTimes(1);
    finish({ ...hardwareFixture, scannedAt: hardwareFixture.scannedAt + 1000 });
    await startup;
    expect(store.getState().scanning).toBe(false);
  });
  it('replaces changed hardware and keeps arrays for unchanged hardware', async () => {
    let fresh = structuredClone(hardwareFixture);
    const store = createHardwareStore({
      restore: async () => hardwareFixture,
      scan: async () => fresh,
    });
    await store.getState().start();
    const devices = store.getState().scan!.cpu;
    fresh = { ...fresh, scannedAt: fresh.scannedAt + 1000 };
    await store.getState().rescan();
    expect(store.getState().scan!.cpu).toBe(devices);
    expect(sameHardware(hardwareFixture, fresh)).toBe(true);
    fresh = { ...fresh, cpu: [{ name: 'Replacement CPU', properties: {} }] };
    await store.getState().rescan();
    expect(store.getState().scan!.cpu[0]!.name).toBe('Replacement CPU');
  });
  it('retains cache on rescan failure, ignores corrupted cache and supports partial results', async () => {
    const store = createHardwareStore({
      restore: async () => hardwareFixture,
      scan: async () => {
        throw new Error('provider failure');
      },
    });
    await store.getState().start();
    expect(store.getState().scan).toEqual(hardwareFixture);
    expect(store.getState().error).toBeTruthy();
    const partial = { ...hardwareFixture, motherboard: [], unavailable: ['Motherboard'] };
    const recovered = createHardwareStore({
      restore: async () => ({ invalid: true }),
      scan: async () => partial,
    });
    await recovered.getState().start();
    expect(recovered.getState().scan).toEqual(partial);
  });
  it('prevents concurrent rescans', async () => {
    let finish!: (v: unknown) => void;
    const scan = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const store = createHardwareStore({ restore: async () => null, scan });
    const first = store.getState().rescan();
    await store.getState().rescan();
    expect(scan).toHaveBeenCalledTimes(1);
    finish(hardwareFixture);
    await first;
  });
});
