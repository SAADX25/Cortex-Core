import type { Part } from '@cortex/part-schema';
import { assetManifestSchema } from './manifest';
export * from './manifest';
export * from './resource-cache';
export * from './detected-visuals';

export const templateRegistry = {
  'motherboard.atx.v1': { category: 'motherboard', revision: 1 },
  'cpu.lga.v1': { category: 'cpu', revision: 1 },
  'ram.dimm.v1': { category: 'ram', revision: 1 },
  'gpu.dual-fan.v1': { category: 'gpu', revision: 1 },
  'storage.m2.v1': { category: 'storage', revision: 1 },
  'detected.board.atx.v2': { category: 'motherboard', revision: 2 },
  'detected.board.matx.v2': { category: 'motherboard', revision: 2 },
  'detected.board.itx.v2': { category: 'motherboard', revision: 2 },
  'detected.board.oem.v2': { category: 'motherboard', revision: 2 },
  'detected.cpu.v2': { category: 'cpu', revision: 2 },
  'detected.memory.v2': { category: 'ram', revision: 2 },
  'detected.gpu.v2': { category: 'gpu', revision: 2 },
  'detected.storage.v2': { category: 'storage', revision: 2 },
} as const;
export function resolveVisualTemplate(part: Part) {
  const id = part.visual.templateId;
  if (!(id in templateRegistry)) throw new Error(`Unknown visual template: ${id}`);
  const template = templateRegistry[id as keyof typeof templateRegistry];
  if (template.category !== part.category)
    throw new Error('Visual template category does not match hardware');
  return { id, ...template, configuration: part.visual };
}
export const originalManifest = assetManifestSchema.parse(
  Object.keys(templateRegistry).map((templateId) => ({
    id: templateId,
    kind: 'procedural',
    templateId,
    author: 'Cortex Core contributors',
    source: 'Original procedural source in packages/3d-engine',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    allowedUse: ['commercial', 'redistribution', 'modification'],
    modified: false,
  })),
);
