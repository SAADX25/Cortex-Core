import { clonePose, mix, mix3, resolveExplodedPose, boundsAt } from './poses';
import type {
  Bounds,
  CameraPose,
  MotionRequest,
  MotionState,
  RenderedVisual,
  Vec3,
  VisualDefinition,
} from './types';
interface Values {
  amount: number;
  intensity: number;
  settle: number;
}
interface Track<T> {
  from: T;
  to: T;
  start: number;
  duration: number;
}
interface RecordState {
  definition: VisualDefinition;
  exploded: ReturnType<typeof resolveExplodedPose>;
  current: Values;
  track?: Track<Values>;
}
const order = { motherboard: 0, cpu: 0, memory: 1, gpu: 2, storage: 3 };
const easing = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const progress = <T>(track: Track<T>, now: number) =>
  track.duration ? Math.max(0, Math.min(1, (now - track.start) / track.duration)) : 1;
/** Scheduler-free authoritative state. The render adapter alone calls tick and requests frames. */
export class MotionController {
  private records = new Map<string, RecordState>();
  private request: MotionRequest = { amount: 0, mode: 'scrub', revision: -1, entrance: false };
  private reduced = false;
  private cameraTrack?: Track<CameraPose>;
  private cameraValue?: CameraPose;
  private disposed = false;
  private interrupted = 0;
  prune(ids: Set<string>) {
    for (const id of this.records.keys()) if (!ids.has(id)) this.records.delete(id);
  }
  sync(definitions: VisualDefinition[], now: number) {
    this.prune(new Set(definitions.map((v) => v.id)));
    for (const definition of definitions) this.define(definition, now);
  }
  define(definition: VisualDefinition, now: number) {
    if (this.disposed) return;
    const existing = this.records.get(definition.id);
    if (existing) {
      existing.definition = definition;
      existing.exploded = resolveExplodedPose(definition);
      return;
    }
    const current = {
      amount: definition.category === 'motherboard' ? 0 : this.request.amount,
      intensity: this.request.focusId && this.request.focusId !== definition.id ? 0.38 : 1,
      settle: 0,
    };
    const record: RecordState = { definition, exploded: resolveExplodedPose(definition), current };
    this.records.set(definition.id, record);
    if (this.request.entrance && !this.reduced && definition.category !== 'motherboard') {
      record.current = { ...current, settle: 1, intensity: 0.65 };
      record.track = {
        from: { ...record.current },
        to: current,
        start: now + order[definition.category] * 55,
        duration: 520,
      };
    }
  }
  configure(request: MotionRequest, reduced: boolean, now: number) {
    if (this.disposed) return;
    if (request.revision === this.request.revision && reduced === this.reduced) return;
    this.tick(now);
    const initial = this.request.revision === -1;
    this.request = { ...request, amount: Math.max(0, Math.min(1, request.amount)) };
    this.reduced = reduced;
    for (const record of this.records.values()) {
      const { definition } = record;
      const to = {
        amount: definition.category === 'motherboard' ? 0 : this.request.amount,
        intensity: request.focusId && request.focusId !== definition.id ? 0.38 : 1,
        settle: 0,
      };
      if (initial && request.entrance && !reduced && definition.category !== 'motherboard')
        record.current = { ...record.current, settle: 1, intensity: 0.65 };
      const duration =
        reduced || request.mode === 'scrub' || (initial && !request.entrance)
          ? 0
          : initial
            ? 520
            : 560;
      const delay =
        reduced || request.mode === 'scrub'
          ? 0
          : (request.amount >= record.current.amount
              ? order[definition.category]
              : 3 - order[definition.category]) * 70;
      if (JSON.stringify(record.current) === JSON.stringify(to)) {
        record.track = undefined;
        continue;
      }
      record.track = { from: { ...record.current }, to, start: now + delay, duration };
    }
    if (reduced && this.cameraTrack) {
      this.cameraValue = this.cameraTrack.to;
      this.cameraTrack = undefined;
    }
    this.tick(now);
  }
  startCamera(from: CameraPose, to: CameraPose, now: number, reduced: boolean, duration = 620) {
    if (this.disposed) return;
    this.cameraValue = { position: [...from.position], target: [...from.target] };
    this.cameraTrack = {
      from: this.cameraValue,
      to: { position: [...to.position], target: [...to.target] },
      start: now,
      duration: reduced ? 0 : duration,
    };
    this.tick(now);
  }
  cancelCamera() {
    if (this.cameraTrack) this.interrupted++;
    this.cameraTrack = undefined;
    this.cameraValue = undefined;
  }
  tick(now: number) {
    if (this.disposed) return false;
    for (const record of this.records.values())
      if (record.track) {
        const t = progress(record.track, now),
          k = easing(t);
        record.current = {
          amount: mix(record.track.from.amount, record.track.to.amount, k),
          intensity: mix(record.track.from.intensity, record.track.to.intensity, k),
          settle: mix(record.track.from.settle, record.track.to.settle, k),
        };
        if (t === 1) {
          record.current = { ...record.track.to };
          record.track = undefined;
        }
      }
    if (this.cameraTrack) {
      const t = progress(this.cameraTrack, now),
        k = easing(t);
      this.cameraValue = {
        position: mix3(this.cameraTrack.from.position, this.cameraTrack.to.position, k),
        target: mix3(this.cameraTrack.from.target, this.cameraTrack.to.target, k),
      };
      if (t === 1) {
        this.cameraValue = this.cameraTrack.to;
        this.cameraTrack = undefined;
      }
    }
    return this.activeHandles > 0;
  }
  visual(id: string): RenderedVisual | undefined {
    const r = this.records.get(id);
    if (!r) return;
    const position = mix3(r.definition.assembled.position, r.exploded.position, r.current.amount);
    if (r.definition.category !== 'motherboard') position[1] += r.current.settle * 9;
    return {
      position,
      rotation: mix3(r.definition.assembled.rotation, r.exploded.rotation, r.current.amount),
      ...r.current,
    };
  }
  bounds(id?: string): Bounds[] {
    return [...this.records.values()]
      .filter((r) => !id || r.definition.id === id)
      .map((r) => {
        const pose = clonePose(r.definition.assembled);
        pose.position = mix3(
          pose.position,
          r.exploded.position,
          r.definition.category === 'motherboard' ? 0 : this.request.amount,
        );
        return boundsAt(r.definition, pose, 0.001);
      });
  }
  get camera() {
    return this.cameraValue;
  }
  /** Apply a completed endpoint once, then release camera ownership to OrbitControls. */
  consumeCamera() {
    const value = this.cameraValue;
    if (!this.cameraTrack) this.cameraValue = undefined;
    return value;
  }
  get cameraActive() {
    return !!this.cameraTrack;
  }
  get visualActive() {
    return [...this.records.values()].some((record) => !!record.track);
  }
  get visualRevision() {
    return this.request.revision;
  }
  get activeHandles() {
    return Number(!!this.cameraTrack) + [...this.records.values()].filter((r) => r.track).length;
  }
  get state(): MotionState {
    return this.request.focusId
      ? 'focusing'
      : this.activeHandles
        ? this.request.amount === 0
          ? 'returning'
          : 'transitioning'
        : this.request.amount > 0
          ? 'exploded'
          : 'idle';
  }
  get diagnostics() {
    return {
      state: this.state,
      activeHandles: this.activeHandles,
      cameraActive: this.cameraActive,
      cameraInterruptions: this.interrupted,
      targetAmount: this.request.amount,
      visuals: [...this.records.keys()].map((id) => ({ id, ...this.visual(id)! })),
    };
  }
  dispose() {
    this.cancelCamera();
    this.records.clear();
    this.disposed = true;
  }
}
/** Fit projected corners using the current orientation; outputs metres. */
export function frameBounds(
  bounds: Bounds[],
  from: CameraPose,
  fov: number,
  aspect: number,
  reset = false,
): CameraPose {
  if (!bounds.length) return from;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const b of bounds)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  const target = min.map((n, i) => (n + max[i]!) / 2) as Vec3;
  const normalize = (v: Vec3): Vec3 => {
    const length = Math.hypot(...v) || 1;
    return v.map((n) => n / length) as Vec3;
  };
  const direction = normalize(
    reset ? [0.28, 0.82, 0.42] : (from.position.map((n, i) => n - from.target[i]!) as Vec3),
  );
  const right =
    Math.hypot(direction[0], direction[2]) < 1e-12
      ? ([1, 0, 0] as Vec3)
      : normalize([direction[2], 0, -direction[0]]);
  const up: Vec3 = [
    direction[1] * right[2] - direction[2] * right[1],
    direction[2] * right[0] - direction[0] * right[2],
    direction[0] * right[1] - direction[1] * right[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a.reduce((sum, n, i) => sum + n * b[i]!, 0);
  const vertical = Math.tan((fov * Math.PI) / 360),
    horizontal = vertical * Math.max(0.1, aspect);
  let distance = 0.12;
  for (const b of bounds)
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) {
          const p: Vec3 = [x - target[0], y - target[1], z - target[2]];
          distance = Math.max(
            distance,
            Math.abs(dot(p, right)) / horizontal + dot(p, direction),
            Math.abs(dot(p, up)) / vertical + dot(p, direction),
          );
        }
  return { target, position: target.map((n, i) => n + direction[i]! * distance * 1.1) as Vec3 };
}
