import { afterEach, expect, it, vi } from 'vitest';
import { cpuIdentity } from '../../packages/3d-engine/src/cpu-identity';
import { createCpuMarking } from '../../packages/3d-engine/src/cpu-marking';
import { deviceModel } from '../../packages/3d-engine/src/detected-models';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

afterEach(() => vi.unstubAllGlobals());
it.each([
  ['Intel Core i7-8700', 'GenuineIntel', 'intel'],
  ['AMD Ryzen 7 7800X3D', 'AuthenticAMD', 'amd'],
  ['Ryzen 9 9950X', '', 'amd'],
  ['System CPU', 'Advanced Micro Devices, Inc.', 'amd'],
  ['Unidentified processor', '', 'unknown'],
])('uses detected identity %s only to select a generic family', (name, manufacturer, family) => {
  expect(cpuIdentity(name, manufacturer)).toMatchObject({
    name,
    family,
    template: `generic-${family}-desktop-cpu`,
  });
});
it('produces distinct Intel and Ryzen-inspired heat spreader geometry', () => {
  const intel = deviceModel({ category: 'cpu', name: 'Intel Core i7-8700' }, 2);
  const amd = deviceModel({ category: 'cpu', name: 'AMD Ryzen 7 7800X3D' }, 2);
  const vertices = (model: typeof intel) =>
    model.meshes.find((mesh) => mesh.finish === 'metal')!.geometry.getAttribute('position').count;
  expect(vertices(amd)).toBeGreaterThan(vertices(intel));
  const material = new MeshBasicMaterial();
  const ray = new Raycaster(new Vector3(15, 10, 12.5), new Vector3(0, -1, 0));
  const top = (model: typeof intel) =>
    ray.intersectObject(
      new Mesh(model.meshes.find((mesh) => mesh.finish === 'metal')!.geometry, material),
    )[0]!.point.y;
  // A point near the edge meets Intel's continuous cap but AMD's recessed cutout.
  expect(top(intel)).toBeCloseTo(3.4);
  expect(top(amd)).toBeCloseTo(2.4);
  material.dispose();
  for (const model of [intel, amd]) for (const mesh of model.meshes) mesh.geometry.dispose();
});
it.each(['Intel Core i7-8700', 'AMD Ryzen 7 7800X3D', 'A'.repeat(256)])(
  'draws the complete detected name and disposes its small decal: %s',
  (name) => {
    const drawn: string[] = [];
    const context = {
      fillText: (text: string) => drawn.push(text),
      fillRect: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 18 }),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const texture = createCpuMarking(name)!;
    expect(drawn.slice(1, -1).join('')).toBe(name);
    expect(texture.userData.cpuLabel).toBe(name);
    expect(texture.image.width).toBe(512);
    expect(texture.image.height).toBe(512);
    const disposed = vi.fn();
    texture.addEventListener('dispose', disposed);
    texture.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  },
);
