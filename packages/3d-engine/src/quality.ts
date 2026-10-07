export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityMode = QualityLevel | 'auto';
export interface QualityProfile {
  dpr: number;
  shadows: boolean;
  shadowMap: number;
  textureSize: number;
  lodBias: number;
  postProcessing: boolean;
  reflections: boolean;
  antialias: boolean;
  effects: boolean;
}
export const qualityProfiles: Record<QualityLevel, QualityProfile> = {
  low: {
    dpr: 1,
    shadows: false,
    shadowMap: 0,
    textureSize: 512,
    lodBias: 2,
    postProcessing: false,
    reflections: false,
    antialias: false,
    effects: false,
  },
  medium: {
    dpr: 1.25,
    shadows: false,
    shadowMap: 0,
    textureSize: 1024,
    lodBias: 1,
    postProcessing: false,
    reflections: false,
    antialias: true,
    effects: false,
  },
  high: {
    dpr: 1.5,
    shadows: true,
    shadowMap: 1024,
    textureSize: 2048,
    lodBias: 0,
    postProcessing: false,
    reflections: false,
    antialias: true,
    effects: true,
  },
  ultra: {
    dpr: 2,
    shadows: true,
    shadowMap: 2048,
    textureSize: 2048,
    lodBias: 0,
    postProcessing: false,
    reflections: false,
    antialias: true,
    effects: true,
  },
};
const levels: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
/** Samples only consecutive active frames. Long demand-render gaps are not slow frames. */
export class AdaptiveQualityManager {
  level: QualityLevel = 'medium';
  private samples: number[] = [];
  private goodWindows = 0;
  private lastChange = -Infinity;
  sample(frameMs: number, nowMs: number): QualityLevel {
    if (!Number.isFinite(frameMs) || frameMs < 1 || frameMs > 100) return this.level;
    this.samples.push(frameMs);
    if (this.samples.length < 90) return this.level;
    const sorted = this.samples.sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 16;
    this.samples = [];
    if (nowMs - this.lastChange < 15000) return this.level;
    const index = levels.indexOf(this.level);
    if (p75 > 28 && index > 0) {
      this.level = levels[index - 1] ?? 'low';
      this.goodWindows = 0;
      this.lastChange = nowMs;
    } else if (p75 < 18) {
      this.goodWindows += 1;
      // Auto stops at high. Ultra is an explicit user choice.
      if (this.goodWindows >= 4 && index < 2) {
        this.level = levels[index + 1] ?? 'high';
        this.goodWindows = 0;
        this.lastChange = nowMs;
      }
    } else this.goodWindows = 0;
    return this.level;
  }
}
export function chooseLod(distance: number, thresholds: readonly number[], bias = 0): number {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Invalid LOD distance');
  let level = 0;
  thresholds.forEach((threshold, i) => {
    if (distance >= threshold) level = i;
  });
  return Math.min(Math.max(0, thresholds.length - 1), level + bias);
}
