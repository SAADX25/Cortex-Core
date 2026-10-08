import { afterEach, expect, it, vi } from 'vitest';
import {
  resolveStorageVisual,
  storagePlacement,
  originalManifest,
  type StorageFamily,
} from '@cortex/asset-runtime';
import { Vector3 } from 'three';
import { deviceModel } from '../../packages/3d-engine/src/detected-models';
import { createStorageMarking } from '../../packages/3d-engine/src/storage-marking';
import { assembledPosition } from '../../packages/3d-engine/src/motion/layout';

afterEach(() => vi.unstubAllGlobals());
it('wraps manufacturer/model at word boundaries without splitting the model suffix', () => {
  const drawn: string[] = [];
  const context = {
    fillRect: vi.fn(),
    fillText: (text: string) => drawn.push(text),
    measureText: (text: string) => ({ width: text.length * 30 }),
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  const texture = createStorageMarking('KINGSTON SNVS500', 'nvme')!;
  expect(drawn.slice(0, -1)).toEqual(['KINGSTON ', 'SNVS500']);
  texture.dispose();
});
it.each<[Record<string, string>, StorageFamily]>([
  [{ 'Media type': 'HDD', 'Bus type': 'SATA' }, 'hdd'],
  [{ 'Media type': 'Rotating media', 'Bus type': 'USB' }, 'hdd'],
  [{ 'Rotation rate (RPM)': '7200' }, 'hdd'],
  [{ 'Media type': 'SSD', 'Bus type': 'SATA' }, 'sata-ssd'],
  [{ 'Media type': 'SSD', 'Reported interface': 'SATA' }, 'sata-ssd'],
  [{ 'Bus type': 'NVMe' }, 'nvme'],
  [{ 'Bus type': ' nvme ', 'Media type': ' unknown ' }, 'nvme'],
  [{ 'Form factor': 'M.2', 'Bus type': 'SATA', 'Media type': 'SSD' }, 'nvme'],
  [{ 'Media type': 'Unknown', 'Bus type': 'SCSI' }, 'unknown'],
  [{ 'Media type': 'SSD', 'Bus type': 'USB' }, 'unknown'],
  [{ 'Media type': 'Unknown', 'Bus type': 'SATA' }, 'unknown'],
  [{ 'Media type': 'HDD', 'Bus type': 'NVMe' }, 'unknown'],
  [{ 'Media type': 'SSD', 'Spindle speed (RPM)': '5400' }, 'unknown'],
  [{}, 'unknown'],
])('resolves storage only from consistent reported evidence: %j', (properties, family) => {
  const result = resolveStorageVisual({ name: 'NVMe SSD HDD marketing name', properties });
  expect(result.family).toBe(family);
  expect(result.fidelity).toBe('generic');
  expect(originalManifest.find((asset) => asset.id === result.assetId)?.kind).toBe('procedural');
});
it('does not label a reported SATA M.2 module as NVMe protocol', () => {
  expect(
    resolveStorageVisual({
      name: 'M.2 SATA drive',
      properties: { 'Form factor': 'M.2', 'Bus type': 'SATA' },
    }).note,
  ).toBe('Generic M.2 visualization');
});
it('keeps contradictory form/media evidence in inventory', () => {
  expect(
    storagePlacement({
      name: 'Conflicting physical disk',
      properties: { 'Form factor': 'M.2', 'Media type': 'HDD', 'Bus type': 'NVMe' },
    }),
  ).toBe('inventory');
});
it('creates distinct storage silhouettes, bounded geometry and nonoverlapping inventory', () => {
  const families: StorageFamily[] = ['hdd', 'sata-ssd', 'nvme', 'unknown'];
  const peers = families.map((storageFamily, index) => ({
    category: 'storage' as const,
    name: storageFamily,
    storageFamily,
    index,
    placement: 'inventory' as const,
  }));
  const bounds = peers.map((device) => {
    const model = deviceModel(device, 2);
    const size = model.bounds.getSize(new Vector3());
    expect(
      model.meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute('position').count, 0),
    ).toBeLessThan(10000);
    const world = model.bounds
      .clone()
      .translate(new Vector3(...assembledPosition(device, 'oem', peers)));
    for (const mesh of model.meshes) mesh.geometry.dispose();
    return { size, world };
  });
  expect(bounds[0]!.size.y).toBeGreaterThan(bounds[1]!.size.y * 2);
  expect(bounds[0]!.size.z).toBeGreaterThan(bounds[1]!.size.z);
  expect(bounds[2]!.size.x / bounds[2]!.size.z).toBeGreaterThan(3);
  for (let i = 0; i < bounds.length; i++)
    for (let j = i + 1; j < bounds.length; j++)
      expect(bounds[i]!.world.intersectsBox(bounds[j]!.world)).toBe(false);
});
it.each(['KINGSTON SNVS500', 'Long detected physical disk model '.repeat(8)])(
  'draws and releases the detected model decal: %s',
  (name) => {
    const drawn: string[] = [];
    const context = {
      fillRect: vi.fn(),
      fillText: (text: string) => drawn.push(text),
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const texture = createStorageMarking(name, 'nvme')!;
    expect(drawn.slice(0, -1).join('')).toBe(name);
    expect(texture.userData.storageLabel).toBe(name);
    const disposed = vi.fn();
    texture.addEventListener('dispose', disposed);
    texture.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  },
);
