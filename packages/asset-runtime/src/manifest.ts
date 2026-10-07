import { z } from 'zod';

const licensing = {
  id: z.string().min(1),
  author: z.string().min(1),
  source: z.string().min(1),
  license: z.string().min(1),
  licenseUrl: z.url(),
  allowedUse: z.array(z.enum(['commercial', 'redistribution', 'modification'])).min(1),
  modified: z.boolean(),
};
export const assetManifestEntrySchema = z
  .discriminatedUnion('kind', [
    z
      .object({ ...licensing, kind: z.literal('procedural'), templateId: z.string().min(1) })
      .strict(),
    z
      .object({
        ...licensing,
        kind: z.literal('glb'),
        url: z.url(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
        compression: z.enum(['meshopt', 'draco', 'none']),
        textureEncoding: z.enum(['ktx2', 'none']),
        lod: z.number().int().min(0).max(2),
      })
      .strict(),
  ])
  .refine(
    (entry) =>
      entry.allowedUse.includes('commercial') && entry.allowedUse.includes('redistribution'),
    'Runtime assets require commercial and redistribution permission',
  );
export const assetManifestSchema = z
  .array(assetManifestEntrySchema)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
    'Duplicate asset ID',
  );
export type AssetManifestEntry = z.infer<typeof assetManifestEntrySchema>;
