import { catalogSchema, partSchema, type Part } from '@cortex/part-schema';
import { fixtureCatalog } from './fixtures';
export { fixtureCatalog } from './fixtures';

export class DataError extends Error {
  constructor(
    public readonly code: 'network' | 'missing-part' | 'invalid-data',
    message: string,
  ) {
    super(message);
    this.name = 'DataError';
  }
}
export interface PartRepository {
  list(signal?: AbortSignal, options?: CatalogPageOptions): Promise<Part[]>;
  get(id: string, signal?: AbortSignal): Promise<Part>;
}
export interface CatalogPageOptions {
  limit?: number;
  afterId?: string;
  category?: Part['category'];
}
export function pageLimit(options?: CatalogPageOptions): number {
  const limit = options?.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new DataError('invalid-data', 'Page size must be between 1 and 100.');
  return limit;
}
export const fixtureRepository: PartRepository = {
  async list(signal, options) {
    signal?.throwIfAborted();
    const limit = pageLimit(options);
    const items = fixtureCatalog
      .filter(
        (part) =>
          (!options?.category || part.category === options.category) &&
          (!options?.afterId || part.id > options.afterId),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);
    return catalogSchema.parse(structuredClone(items));
  },
  async get(id, signal) {
    signal?.throwIfAborted();
    const part = fixtureCatalog.find((item) => item.id === id);
    if (!part) throw new DataError('missing-part', 'This hardware record is unavailable.');
    return partSchema.parse(structuredClone(part));
  },
};
export const partKeys = {
  catalog: ['parts', 'catalog'] as const,
  detail: (id: string) => ['parts', 'detail', id] as const,
};
