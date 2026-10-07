import { catalogSchema, partSchema, type Part } from '@cortex/part-schema';
import { DataError, pageLimit, type PartRepository } from './index';

/** Host supplies bytes; this boundary stays independent of Tauri and SQLite. */
export function createSnapshotRepository(input: unknown): PartRepository {
  if (!input || typeof input !== 'object')
    throw new DataError('invalid-data', 'Invalid catalog snapshot.');
  const snapshot = input as Record<string, unknown>;
  if (
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.catalogVersion !== 'string' ||
    !snapshot.catalogVersion ||
    snapshot.assetManifestVersion !== 1 ||
    snapshot.origin !== 'development-fixtures'
  )
    throw new DataError('invalid-data', 'Unsupported catalog snapshot version or origin.');
  const records = catalogSchema.parse(snapshot.parts);
  if (
    records.length > 100 ||
    records.some((part) => !part.isFixture || part.status !== 'development')
  )
    throw new DataError(
      'invalid-data',
      'Only development fixtures are supported by this desktop slice.',
    );
  return {
    async list(signal, options) {
      signal?.throwIfAborted();
      return structuredClone(
        records
          .filter(
            (part) =>
              (!options?.category || part.category === options.category) &&
              (!options?.afterId || part.id > options.afterId),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, pageLimit(options)),
      );
    },
    async get(id, signal) {
      signal?.throwIfAborted();
      const part: Part | undefined = records.find((record) => record.id === id);
      if (!part) throw new DataError('missing-part', 'This hardware record is unavailable.');
      return partSchema.parse(structuredClone(part));
    },
  };
}
