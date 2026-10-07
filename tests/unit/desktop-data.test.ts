import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from '@cortex/data-access';
import { createSnapshotRepository } from '@cortex/data-access/snapshot';
const snapshot = () => ({
  schemaVersion: 1,
  catalogVersion: '2026.10.07.1',
  assetManifestVersion: 1,
  origin: 'development-fixtures',
  publishedAt: '2026-10-07T00:00:00Z',
  parts: structuredClone(fixtureCatalog),
});
describe('host-independent desktop snapshot boundary', () => {
  it('validates domain records and unsupported envelopes', () => {
    expect(() => createSnapshotRepository({ ...snapshot(), schemaVersion: 2 })).toThrow(
      'Unsupported',
    );
    const invalid = snapshot();
    invalid.parts[0]!.specs = {} as (typeof invalid.parts)[0]['specs'];
    expect(() => createSnapshotRepository(invalid)).toThrow();
    expect(() =>
      createSnapshotRepository({ ...snapshot(), origin: 'remote-unverified' }),
    ).toThrow();
  });
  it('pages the persisted records, honors cancellation and isolates caller mutations', async () => {
    const repository = createSnapshotRepository(snapshot());
    const first = await repository.list(undefined, { limit: 2 });
    const second = await repository.list(undefined, { afterId: first[1]!.id, limit: 2 });
    expect(second.every((part) => part.id > first[1]!.id)).toBe(true);
    const cpu = await repository.list(undefined, { category: 'cpu' });
    expect(cpu).toHaveLength(1);
    cpu[0]!.model = 'changed';
    expect((await repository.get(cpu[0]!.id)).model).not.toBe('changed');
    const controller = new AbortController();
    controller.abort();
    await expect(repository.list(controller.signal)).rejects.toThrow();
    await expect(repository.list(undefined, { limit: 101 })).rejects.toThrow('Page size');
  });
});
