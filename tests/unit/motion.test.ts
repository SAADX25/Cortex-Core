import { describe, expect, it } from 'vitest';
import { MotionController, frameBounds } from '../../packages/3d-engine/src/motion/controller';
import { resolveExplodedPose } from '../../packages/3d-engine/src/motion/poses';
import { MotionBindings } from '../../packages/3d-engine/src/motion/bindings';
import { assembledPosition } from '../../packages/3d-engine/src/motion/layout';
import type { MotionCategory, VisualDefinition } from '../../packages/3d-engine/src/motion/types';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
const definition = (category: MotionCategory, ordinal = 0): VisualDefinition => ({
  id: `${category}:${ordinal}`,
  category,
  ordinal,
  index: ordinal,
  assembled: { position: [ordinal * 13, 7, 0], rotation: [0, 0, 0] },
  bounds: { min: [-2, 0, -60], max: [2, 31, 60] },
  sceneBounds: { min: [-122, -1, -150], max: [122, 20, 150] },
  placement: category === 'storage' ? 'inventory' : undefined,
});
const definitions = ['motherboard', 'cpu', 'memory', 'gpu', 'storage'].map((category) =>
  definition(category as MotionCategory),
);
const setup = () => {
  const engine = new MotionController();
  engine.sync(definitions, 0);
  engine.configure({ amount: 0, revision: 0, mode: 'scrub', entrance: false }, false, 0);
  return engine;
};
describe('authoritative reversible scene motion', () => {
  it('releases the finished camera pose after its single final application', () => {
    const engine = setup();
    const from = {
      position: [0, 1, 0] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
    };
    const to = { ...from, position: [0.1, 1, 0] as [number, number, number] };
    engine.startCamera(from, to, 0, true);
    expect(engine.consumeCamera()).toEqual(to);
    expect(engine.consumeCamera()).toBeUndefined();
    expect(engine.activeHandles).toBe(0);
  });
  it('frames asymmetric inventories at OrbitControls near-vertical polar limit without losing azimuth', () => {
    const bounds = {
      min: [-0.16, 0, -0.14] as [number, number, number],
      max: [0.274, 0.07, 0.14] as [number, number, number],
    };
    const pose = frameBounds([bounds], { position: [1e-6, 1, 0], target: [0, 0, 0] }, 42, 2.42);
    const camera = new PerspectiveCamera(42, 2.42, 0.001, 10);
    camera.position.fromArray(pose.position);
    camera.lookAt(new Vector3(...pose.target));
    camera.updateMatrixWorld();
    for (const x of [bounds.min[0], bounds.max[0]])
      for (const y of [bounds.min[1], bounds.max[1]])
        for (const z of [bounds.min[2], bounds.max[2]]) {
          const projected = new Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(1);
          expect(Math.abs(projected.y)).toBeLessThan(1);
        }
  });
  it('resolves 0%, 100% and continuous intermediate transforms without moving the anchor', () => {
    const engine = setup();
    for (const amount of [0, 0.5, 1]) {
      engine.configure({ amount, revision: amount + 1, mode: 'scrub', entrance: false }, false, 0);
      for (const v of definitions) {
        const target = resolveExplodedPose(v).position;
        expect(engine.visual(v.id)!.position).toEqual(
          v.assembled.position.map((n, i) => n + (target[i]! - n) * amount),
        );
      }
      expect(engine.visual('motherboard:0')!.amount).toBe(0);
    }
  });
  it('staggers CPU, RAM, GPU, storage and reverses their order on return', () => {
    const engine = setup();
    engine.configure({ amount: 1, revision: 1, mode: 'sequence', entrance: false }, false, 0);
    engine.tick(80);
    expect(engine.visual('cpu:0')!.amount).toBeGreaterThan(engine.visual('memory:0')!.amount);
    expect(engine.visual('gpu:0')!.amount).toBe(0);
    engine.tick(1000);
    engine.configure({ amount: 0, revision: 2, mode: 'sequence', entrance: false }, false, 1000);
    engine.tick(1080);
    expect(engine.visual('storage:0')!.amount).toBeLessThan(engine.visual('gpu:0')!.amount);
    expect(engine.visual('cpu:0')!.amount).toBe(1);
  });
  it('rapid reversal rebases from current transforms and never creates duplicate tracks', () => {
    const engine = setup();
    for (let revision = 1; revision <= 20; revision++) {
      const now = revision * 33;
      engine.tick(now);
      const previous = engine.visual('cpu:0')!.position;
      engine.configure(
        { amount: revision % 2, revision, mode: 'sequence', entrance: false },
        false,
        now,
      );
      expect(engine.visual('cpu:0')!.position).toEqual(previous);
      expect(engine.activeHandles).toBeLessThanOrEqual(4);
    }
    engine.tick(2000);
    expect(engine.activeHandles).toBe(0);
    expect(engine.visual('cpu:0')!.position).toEqual(definitions[1]!.assembled.position);
  });
  it('retains reduced-motion explosion and focus while eliminating travel', () => {
    const engine = setup();
    engine.configure(
      { amount: 1, revision: 1, mode: 'sequence', entrance: true, focusId: 'cpu:0' },
      true,
      0,
    );
    expect(engine.visual('cpu:0')!.position).toEqual(resolveExplodedPose(definitions[1]!).position);
    expect(engine.visual('cpu:0')!.intensity).toBe(1);
    expect(engine.visual('gpu:0')!.intensity).toBe(0.38);
    expect(engine.activeHandles).toBe(0);
    engine.configure({ amount: 0, revision: 2, mode: 'sequence', entrance: false }, true, 1);
    expect(engine.visual('gpu:0')!.intensity).toBe(1);
  });
  it('preserves motion through model replacement and prunes rescanned identities', () => {
    const engine = setup();
    engine.configure({ amount: 1, revision: 1, mode: 'sequence', entrance: false }, false, 0);
    engine.tick(200);
    const before = engine.visual('cpu:0');
    engine.sync(
      definitions.map((v) => ({ ...v, bounds: { ...v.bounds } })),
      200,
    );
    expect(engine.visual('cpu:0')).toEqual(before);
    engine.sync([definitions[0]!, { ...definition('cpu'), id: 'replacement-cpu' }], 250);
    expect(engine.visual('cpu:0')).toBeUndefined();
    expect(engine.visual('replacement-cpu')!.amount).toBe(1);
    engine.tick(2000);
    expect(engine.activeHandles).toBe(0);
  });
  it('finishes exactly and has no transform drift or material allocations after 25 cycles', () => {
    const engine = setup(),
      bindings = new MotionBindings(),
      geometry = new BoxGeometry(),
      material = new MeshStandardMaterial({ color: '#abcdef' }),
      group = new Group();
    group.add(new Mesh(geometry, material));
    bindings.attach('cpu:0', group);
    const uuid = material.uuid,
      color = material.color.clone();
    for (let cycle = 0; cycle < 25; cycle++)
      for (const amount of [1, 0]) {
        const now = (cycle * 2 + 1 - amount) * 1000;
        engine.configure(
          { amount, revision: cycle * 2 + 2 - amount, mode: 'sequence', entrance: false },
          false,
          now,
        );
        engine.tick(now + 900);
        bindings.apply(engine);
        expect(engine.activeHandles).toBe(0);
        expect(material.uuid).toBe(uuid);
        expect(material.color.equals(color)).toBe(true);
      }
    expect(group.position.toArray()).toEqual(definitions[1]!.assembled.position);
    expect(engine.visual('cpu:0')!.rotation).toEqual([0, 0, 0]);
    bindings.clear();
    engine.dispose();
    expect(engine.activeHandles).toBe(0);
    expect(bindings.size).toBe(0);
    material.dispose();
    geometry.dispose();
  });
  it('cancels camera ownership immediately on orbit and safely disposes mid-animation', () => {
    const engine = setup();
    engine.startCamera(
      { position: [1, 1, 1], target: [0, 0, 0] },
      { position: [2, 3, 4], target: [1, 1, 1] },
      0,
      false,
    );
    engine.tick(200);
    expect(engine.camera!.position[0]).toBeGreaterThan(1);
    engine.cancelCamera();
    expect(engine.camera).toBeUndefined();
    expect(engine.diagnostics.cameraInterruptions).toBe(1);
    engine.configure({ amount: 1, revision: 1, mode: 'sequence', entrance: false }, false, 200);
    engine.dispose();
    expect(engine.tick(300)).toBe(false);
    expect(engine.activeHandles).toBe(0);
    expect(engine.diagnostics.visuals).toEqual([]);
  });
  it('plays a finite settle and preserves focus while interrupting an explosion', () => {
    const engine = new MotionController();
    engine.sync(definitions, 0);
    engine.configure({ amount: 0, revision: 0, mode: 'sequence', entrance: true }, false, 0);
    expect(engine.visual('cpu:0')!.settle).toBe(1);
    engine.tick(1000);
    expect(engine.visual('cpu:0')!.settle).toBe(0);
    engine.configure({ amount: 1, revision: 1, mode: 'sequence', entrance: false }, false, 1000);
    engine.tick(1200);
    const before = engine.visual('cpu:0')!.position;
    engine.configure(
      { amount: 1, revision: 2, mode: 'sequence', entrance: false, focusId: 'cpu:0' },
      false,
      1200,
    );
    expect(engine.visual('cpu:0')!.position).toEqual(before);
    engine.tick(2100);
    expect(engine.visual('gpu:0')!.intensity).toBe(0.38);
  });
});
describe('semantic separation and camera framing', () => {
  it('separates many RAM modules and storage inventory devices', () => {
    for (const category of ['memory', 'storage'] as const) {
      const targets = Array.from(
        { length: 16 },
        (_, i) => resolveExplodedPose(definition(category, i)).position,
      );
      expect(new Set(targets.map((p) => p.join(','))).size).toBe(16);
      for (let i = 1; i < targets.length; i++)
        expect(Math.hypot(...targets[i]!.map((n, j) => n - targets[i - 1]![j]!))).toBeGreaterThan(
          20,
        );
    }
  });
  it('keeps one discrete card anchored to the illustrative PCIe area before exploding outward', () => {
    const device = { category: 'gpu' as const, index: 1, name: 'Discrete card' };
    const position = assembledPosition(device, 'oem', [device]);
    const v = {
      ...definition('gpu'),
      assembled: { position, rotation: [0, 0, 0] as [number, number, number] },
    };
    const target = resolveExplodedPose(v).position;
    expect(target[2]).toBeGreaterThan(position[2]);
    expect(target[1]).toBeGreaterThan(position[1]);
    expect(position[0]).toBe(-22);
  });
  it('frames tall exploded bounds in portrait, preserves orientation and handles a top-down camera', () => {
    const engine = setup();
    engine.configure({ amount: 1, revision: 1, mode: 'scrub', entrance: false }, true, 0);
    const from = {
      position: [0.3, 0.5, 0.4] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
    };
    const landscape = frameBounds(engine.bounds(), from, 42, 1.8),
      portrait = frameBounds(engine.bounds(), from, 42, 0.5);
    const distance = (pose: typeof from) =>
      Math.hypot(...pose.position.map((n, i) => n - pose.target[i]!));
    expect(distance(portrait)).toBeGreaterThan(distance(landscape));
    expect(
      frameBounds(
        engine.bounds(),
        { position: [0, 1, 0], target: [0, 0, 0] },
        42,
        1,
      ).position.every(Number.isFinite),
    ).toBe(true);
  });
});
