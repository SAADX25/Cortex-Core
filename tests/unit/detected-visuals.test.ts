import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import {
  adapterClass,
  boardFamilies,
  resolveDetectedVisual,
  storagePlacement,
  originalManifest,
} from '@cortex/asset-runtime';
import { boardModel, deviceModel } from '../../packages/3d-engine/src/detected-models';
describe('honest detected visual resolution', () => {
  const device = (properties: Record<string, string>) => ({
    name: 'Arbitrary marketing name',
    properties,
  });
  it('never turns vendor, name or dedicated memory into proof of a discrete adapter', () => {
    expect(
      adapterClass(device({ Vendor: 'NVIDIA', 'Dedicated VRAM (bytes)': '17179869184' })),
    ).toBe('unknown');
    for (const value of ['Integrated', 'Virtual', 'Software', 'Unknown'])
      expect(adapterClass(device({ 'Adapter class': value }))).not.toBe('discrete');
    expect(adapterClass(device({ 'Adapter class': 'Discrete' }))).toBe('discrete');
  });
  it('does not confuse NVMe transport with M.2 physical form', () => {
    expect(storagePlacement(device({ 'Bus type': 'NVMe' }))).toBe('inventory');
    expect(storagePlacement(device({ 'Bus type': 'SATA', 'Form factor': 'M.2' }))).toBe(
      'inventory',
    );
    expect(storagePlacement(device({ 'Bus type': 'NVMe', 'Form factor': 'M.2' }))).toBe('m2');
  });
  it('defaults arbitrary OEM models to a generic asset, with no fabricated exact match', () => {
    expect(resolveDetectedVisual('motherboard', 'Dell:09PV3R')).toEqual({
      assetId: 'detected.board.oem.v2',
      fidelity: 'generic',
      source: 'safe-default',
    });
    for (const family of Object.keys(boardFamilies))
      expect(resolveDetectedVisual('motherboard', undefined, family).fidelity).toBe(
        family === 'oem' ? 'generic' : 'family',
      );
    expect(resolveDetectedVisual('motherboard', undefined, 'invented').fidelity).toBe('generic');
    expect(resolveDetectedVisual('motherboard', undefined, 'constructor').fidelity).toBe('generic');
    expect(resolveDetectedVisual('motherboard', undefined, 'toString').fidelity).toBe('generic');
    expect(
      originalManifest.some((a) => a.id === 'detected.gpu.v2' && a.kind === 'procedural'),
    ).toBe(true);
  });
});
describe('original reconstruction geometry budgets and lifetime', () => {
  const triangleCount = (model: ReturnType<typeof boardModel>) =>
    model.meshes.reduce((sum, m) => sum + m.geometry.getAttribute('position').count / 3, 0);
  it.each(Object.keys(boardFamilies) as (keyof typeof boardFamilies)[])(
    'builds %s with finite bounded geometry and mounting holes',
    (family) => {
      const model = boardModel(family, 2);
      expect(model.bounds.isEmpty()).toBe(false);
      expect(triangleCount(model)).toBeGreaterThan(1000);
      expect(triangleCount(model)).toBeLessThan(20000);
      const pcb = model.meshes.find((m) => m.finish === 'pcb')!;
      expect(pcb.geometry.boundingBox!.getSize(new Vector3()).x).toBeCloseTo(
        boardFamilies[family].width,
        0,
      );
      const material = new MeshBasicMaterial(),
        mesh = new Mesh(pcb.geometry, material);
      const ray = new Raycaster(
        new Vector3(-boardFamilies[family].width / 2 + 9, 10, -boardFamilies[family].depth / 2 + 9),
        new Vector3(0, -1, 0),
      );
      expect(ray.intersectObject(mesh)).toHaveLength(0);
      ray.set(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
      material.dispose();
      for (const m of model.meshes) {
        expect([...m.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
        m.geometry.dispose();
      }
      expect(model.instances.some((batch) => batch.cylinder)).toBe(true);
    },
  );
  it('retains major hardware while higher tiers increase fine detail', () => {
    const low = boardModel('oem', 0),
      high = boardModel('oem', 2);
    expect(low.bounds.equals(high.bounds)).toBe(true);
    expect(high.instances.reduce((n, batch) => n + batch.positions.length, 0)).toBeGreaterThan(
      low.instances.reduce((n, batch) => n + batch.positions.length, 0),
    );
    for (const model of [low, high]) for (const mesh of model.meshes) mesh.geometry.dispose();
    const gpu = deviceModel({ category: 'gpu' }, 2);
    expect(triangleCount(gpu)).toBeLessThan(20000);
    expect(gpu.bounds.max.y).toBeGreaterThan(110);
    expect(gpu.instances.some((batch) => batch.finish === 'gold')).toBe(true);
    for (const mesh of gpu.meshes) mesh.geometry.dispose();
  });
});
