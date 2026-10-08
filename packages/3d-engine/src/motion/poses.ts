import type { Bounds, Pose, Vec3, VisualDefinition } from './types';
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  a.map((v, i) => mix(v, b[i]!, t)) as Vec3;
export const clonePose = (pose: Pose): Pose => ({
  position: [...pose.position],
  rotation: [...pose.rotation],
});
/** Millimetres, +Y up. Inventory is deliberately separate from installation poses. */
export function resolveExplodedPose(v: VisualDefinition): Pose {
  const p = [...v.assembled.position] as Vec3;
  const width = v.bounds.max[0] - v.bounds.min[0];
  const depth = v.bounds.max[2] - v.bounds.min[2];
  switch (v.category) {
    case 'motherboard':
      break;
    case 'cpu':
      p[1] += 90 + v.ordinal * 16;
      break;
    case 'memory':
      p[0] = 70 + v.ordinal * Math.max(26, width + 18);
      p[1] += 112 + (v.ordinal % 2) * 12;
      break;
    case 'gpu':
      p[0] -= 65;
      p[1] += 48 + v.ordinal * 24;
      p[2] += 110 + v.ordinal * Math.max(85, depth + 28);
      break;
    case 'storage':
      p[0] = v.sceneBounds.max[0] + 90 + (v.ordinal % 2) * Math.max(82, width + 22);
      p[1] = 42;
      p[2] = -55 + Math.floor(v.ordinal / 2) * Math.max(68, depth + 20);
      break;
  }
  return { position: p, rotation: [...v.assembled.rotation] };
}
export function boundsAt(v: VisualDefinition, pose: Pose, scale = 1): Bounds {
  // Current templates keep their assembled orientation; bounds are already model-space AABBs.
  return {
    min: v.bounds.min.map((n, i) => (n + pose.position[i]!) * scale) as Vec3,
    max: v.bounds.max.map((n, i) => (n + pose.position[i]!) * scale) as Vec3,
  };
}
