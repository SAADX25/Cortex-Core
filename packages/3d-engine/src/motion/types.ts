export type Vec3 = [number, number, number];
export type MotionCategory = 'motherboard' | 'cpu' | 'memory' | 'gpu' | 'storage';
export type MotionState = 'idle' | 'transitioning' | 'exploded' | 'focusing' | 'returning';
export interface Pose {
  position: Vec3;
  rotation: Vec3;
}
export interface Bounds {
  min: Vec3;
  max: Vec3;
}
export interface VisualDefinition {
  id: string;
  category: MotionCategory;
  index: number;
  ordinal: number;
  assembled: Pose;
  bounds: Bounds;
  sceneBounds: Bounds;
  placement?: 'm2' | 'inventory';
}
export interface MotionRequest {
  amount: number;
  revision: number;
  mode: 'sequence' | 'scrub';
  focusId?: string;
  entrance: boolean;
}
export interface CameraPose {
  position: Vec3;
  target: Vec3;
}
export interface RenderedVisual extends Pose {
  amount: number;
  intensity: number;
  settle: number;
}
export const visualId = (category: string, index: number, name: string) =>
  `${category}:${index}:${name}`;
