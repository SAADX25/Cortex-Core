import { motherboardComponents, type Vector3Tuple } from './semantics';
import type { SlotId } from '@cortex/build-domain';

export type InstallationPhase = 'idle' | 'preview' | 'installing' | 'installed' | 'removing';
export const installationDurationMs = 1200;
export interface InstallationPose {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  opacity: number;
  done: boolean;
}
/** Millimetre template poses. The M.2 pivot is its connector end, so seating rotates around it. */
export function installationPose(
  slotId: SlotId,
  phase: InstallationPhase,
  elapsedMs: number,
  reducedMotion = false,
  exploded = false,
): InstallationPose {
  const anchor = motherboardComponents.find((c) => c.id === slotId);
  if (!anchor) throw new Error('Unknown semantic installation anchor');
  const isCpu = anchor.kind === 'socket';
  const isRam = anchor.kind === 'dimm';
  const m2 = anchor.kind === 'm2';
  const progress = reducedMotion ? 1 : Math.max(0, Math.min(1, elapsedMs / installationDurationMs));
  const t = phase === 'removing' ? 1 - progress : phase === 'installing' ? progress : 1;
  const ease = (v: number) => v * v * (3 - 2 * v);
  const lift = m2 ? 14 * (1 - ease(Math.min(t / 0.45, 1))) : 70 * (1 - ease(t));
  const rotation = m2 ? 0.42 * (1 - ease(Math.max(0, (t - 0.4) / 0.6))) : 0;
  const position: Vector3Tuple = [
    anchor.position[0] + (m2 ? -40 - 8 * (1 - ease(Math.min(t / 0.45, 1))) : 0),
    anchor.position[1] + (isCpu ? 10 : isRam ? 22.5 : 4.5) + lift + (exploded ? anchor.explode : 0),
    anchor.position[2],
  ];
  return {
    position,
    rotation: [0, 0, rotation],
    opacity: phase === 'preview' ? 0.28 : phase === 'removing' ? Math.max(0, 1 - progress) : 1,
    done: progress === 1 || phase === 'installed' || phase === 'preview' || phase === 'idle',
  };
}
