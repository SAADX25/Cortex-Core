import { z } from 'zod';

export const categorySchema = z.enum(['motherboard', 'cpu', 'gpu', 'ram', 'storage']);
export const futureCategories = [
  'psu',
  'cooler',
  'case',
  'fan',
  'network-adapter',
  'sound-card',
  'expansion-card',
] as const;
const positive = z.number().finite().positive();
const count = z.number().int().positive();
const knownText = z.string().min(1).nullable();
export const dimensionsSchema = z
  .object({ width: positive, height: positive, depth: positive, unit: z.literal('mm') })
  .strict();
export const sourceSchema = z
  .object({
    url: z.url().optional(),
    organization: z.string().min(1),
    verifiedAt: z.iso.datetime(),
    status: z.enum(['verified', 'unverified', 'fixture']),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (source) => source.status === 'fixture' || Boolean(source.url),
    'Real sources require a URL',
  );
export const visualSchema = z
  .object({
    templateId: z.string().min(1),
    dimensions: dimensionsSchema,
    materials: z
      .object({
        pcb: z.string().regex(/^#[\da-f]{6}$/i),
        metal: z.string().regex(/^#[\da-f]{6}$/i),
        plastic: z.string().regex(/^#[\da-f]{6}$/i),
      })
      .strict(),
    textureSet: z.string().nullable(),
    branding: z.object({ label: z.string().max(80) }).strict(),
    connectors: z.array(z.string()),
    lod: z
      .array(
        z
          .object({ level: z.number().int().min(0).max(2), distance: z.number().nonnegative() })
          .strict(),
      )
      .min(1),
    premiumAssetId: z.string().nullable(),
  })
  .strict();
const common = {
  id: z.string().min(1),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  releaseDate: z.iso.date().nullable(),
  status: z.enum(['active', 'discontinued', 'development']),
  isFixture: z.boolean(),
  provenance: z.record(z.string(), sourceSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  visual: visualSchema,
};
export const m2SlotSchema = z
  .object({
    id: z.string().min(1),
    key: knownText,
    interfaces: z.array(z.enum(['nvme', 'sata'])).nullable(),
    lengthsMm: z.array(positive).nullable(),
  })
  .strict();
export const motherboardSpecsSchema = z
  .object({
    socket: knownText,
    socketType: knownText,
    cpuFamilies: z.array(z.string()).nullable(),
    formFactor: knownText,
    chipset: knownText,
    memoryGeneration: knownText,
    dimmSlots: count.nullable(),
    maxMemoryGb: positive.nullable(),
    pcieGeneration: count.nullable(),
    pcieLanes: count.nullable(),
    m2Slots: z.array(m2SlotSchema),
    sataPorts: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const cpuSpecsSchema = z
  .object({
    socket: knownText,
    family: knownText,
    cores: count.nullable(),
    tdpWatts: positive.nullable(),
  })
  .strict();
export const gpuSpecsSchema = z
  .object({
    pcieGeneration: count.nullable(),
    pcieLanes: count.nullable(),
    powerWatts: positive.nullable(),
    powerConnectors: z.array(z.string()).nullable(),
  })
  .strict();
export const ramSpecsSchema = z
  .object({
    generation: knownText,
    capacityGb: positive.nullable(),
    moduleCount: count.nullable(),
    speedMt: positive.nullable(),
  })
  .strict();
export const storageSpecsSchema = z
  .object({
    interface: z.enum(['nvme', 'sata']).nullable(),
    formFactor: knownText,
    key: knownText,
    lengthMm: positive.nullable(),
    capacityGb: positive.nullable(),
  })
  .strict();
const union = z.discriminatedUnion('category', [
  z
    .object({ ...common, category: z.literal('motherboard'), specs: motherboardSpecsSchema })
    .strict(),
  z.object({ ...common, category: z.literal('cpu'), specs: cpuSpecsSchema }).strict(),
  z.object({ ...common, category: z.literal('gpu'), specs: gpuSpecsSchema }).strict(),
  z.object({ ...common, category: z.literal('ram'), specs: ramSpecsSchema }).strict(),
  z.object({ ...common, category: z.literal('storage'), specs: storageSpecsSchema }).strict(),
]);

function specificationPaths(value: unknown, prefix: string): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value))
    return value.flatMap((item, i) => specificationPaths(item, `${prefix}.${i}`));
  if (typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) =>
      specificationPaths(item, `${prefix}.${key}`),
    );
  return [prefix];
}
export const partSchema = union.superRefine((part, ctx) => {
  if (part.isFixture) {
    if (part.status !== 'development')
      ctx.addIssue({ code: 'custom', message: 'Fixtures must have development status' });
    return;
  }
  for (const path of specificationPaths(part.specs, 'specs')) {
    const source = part.provenance[path];
    if (!source || source.status === 'fixture')
      ctx.addIssue({
        code: 'custom',
        message: `Real specification requires non-fixture provenance: ${path}`,
        path: ['provenance', path],
      });
  }
});
export const catalogSchema = z.array(partSchema).superRefine((parts, ctx) => {
  for (const key of ['id', 'slug'] as const) {
    if (new Set(parts.map((part) => part[key])).size !== parts.length)
      ctx.addIssue({ code: 'custom', message: `Duplicate part ${key}` });
  }
});
export type Part = z.infer<typeof partSchema>;
export type Motherboard = Extract<Part, { category: 'motherboard' }>;
export type VisualConfiguration = z.infer<typeof visualSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type M2Slot = z.infer<typeof m2SlotSchema>;
export function mmToMeters(mm: number): number {
  if (!Number.isFinite(mm) || mm < 0)
    throw new RangeError('Dimension must be finite and nonnegative');
  return mm / 1000;
}
