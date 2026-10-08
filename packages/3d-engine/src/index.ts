// Lightweight policy/semantic entry point. Rendering is a separate lazy import.
export * from './quality';
export * from './semantics';
export * from './cpu-identity';
export { visualId } from './motion/types';
export type { MotionRequest } from './motion/types';
export type { DetectedScene, DetectedVisual } from './DetectedComponents';
