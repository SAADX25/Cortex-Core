import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fixtureCatalog } from '@cortex/data-access';
import {
  assetManifestSchema,
  originalManifest,
  resolveVisualTemplate,
  ResourceCache,
} from '@cortex/asset-runtime';
import {
  AdaptiveQualityManager,
  chooseLod,
  componentIds,
  componentInfo,
  motherboardComponents,
  qualityProfiles,
} from '@cortex/3d-engine';
import { useViewerStore } from '../../apps/web/src/viewer/store';

describe('asset manifests and templates', () => {
  it('validates all original templates', () =>
    expect(assetManifestSchema.parse(originalManifest)).toHaveLength(5));
  it('rejects unclear permissions', () =>
    expect(
      assetManifestSchema.safeParse([{ ...originalManifest[0], allowedUse: ['modification'] }])
        .success,
    ).toBe(false));
  it('rejects duplicate asset identifiers', () =>
    expect(assetManifestSchema.safeParse([originalManifest[0], originalManifest[0]]).success).toBe(
      false,
    ));
  it('requires integrity and size metadata on GLB content', () =>
    expect(
      assetManifestSchema.safeParse([
        { ...originalManifest[0], kind: 'glb', url: 'https://example.org/model.glb' },
      ]).success,
    ).toBe(false));
  it('resolves fixture visual configurations without changing specifications', () => {
    const board = fixtureCatalog[0]!;
    const before = JSON.stringify(board.specs);
    expect(resolveVisualTemplate(board).id).toBe(board.visual.templateId);
    expect(JSON.stringify(board.specs)).toBe(before);
  });
  it('rejects an unknown template', () => {
    const board = structuredClone(fixtureCatalog[0]!);
    board.visual.templateId = 'unknown';
    expect(() => resolveVisualTemplate(board)).toThrow();
  });
  it('rejects a template/category mismatch', () => {
    const board = structuredClone(fixtureCatalog[0]!);
    board.visual.templateId = 'ram.dimm.v1';
    expect(() => resolveVisualTemplate(board)).toThrow();
  });
});
describe('resource lifecycle', () => {
  it('shares parallel loads and disposes only after the last owner releases', async () => {
    const load = vi.fn(async () => ({ geometry: 'shared' }));
    const dispose = vi.fn();
    const cache = new ResourceCache(load, dispose);
    const [a, b] = await Promise.all([cache.acquire('model'), cache.acquire('model')]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.value).toBe(b.value);
    a.release();
    expect(dispose).not.toHaveBeenCalled();
    b.release();
    b.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.activeResourceCount).toBe(0);
  });
  it('failed loads leave no poisoned cache entry and can retry', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');
    const dispose = vi.fn();
    const cache = new ResourceCache<string>(load, dispose);
    await expect(cache.acquire('model')).rejects.toThrow('network');
    expect(cache.activeResourceCount).toBe(0);
    const lease = await cache.acquire('model');
    expect(lease.value).toBe('ok');
    lease.release();
  });
  it('repeated swaps release resources', async () => {
    const dispose = vi.fn();
    const cache = new ResourceCache(async (key) => key, dispose);
    for (let i = 0; i < 30; i++) (await cache.acquire(`model-${i % 3}`)).release();
    expect(dispose).toHaveBeenCalledTimes(30);
    expect(cache.activeResourceCount).toBe(0);
  });
});
describe('adaptive quality and generic LOD', () => {
  const feed = (manager: AdaptiveQualityManager, ms: number, count: number, start = 20000) => {
    for (let i = 0; i < count; i++) manager.sample(ms, start + i * ms);
  };
  it('starts conservatively without user-agent classification', () =>
    expect(new AdaptiveQualityManager().level).toBe('medium'));
  it('downshifts after a sustained slow window', () => {
    const manager = new AdaptiveQualityManager();
    feed(manager, 35, 90);
    expect(manager.level).toBe('low');
  });
  it('ignores idle demand-frame gaps', () => {
    const manager = new AdaptiveQualityManager();
    feed(manager, 2000, 1000);
    expect(manager.level).toBe('medium');
  });
  it('requires four good windows before increasing quality', () => {
    const manager = new AdaptiveQualityManager();
    feed(manager, 16, 270);
    expect(manager.level).toBe('medium');
    feed(manager, 16, 90, 30000);
    expect(manager.level).toBe('high');
  });
  it('does not oscillate during the cooldown', () => {
    const manager = new AdaptiveQualityManager();
    feed(manager, 16, 360);
    feed(manager, 35, 90, 26000);
    expect(manager.level).toBe('high');
  });
  it('caps automatic increases at high', () => {
    const manager = new AdaptiveQualityManager();
    feed(manager, 16, 2000);
    expect(manager.level).toBe('high');
  });
  it('keeps profile pixel and texture budgets bounded', () => {
    expect(qualityProfiles.low.dpr).toBe(1);
    expect(qualityProfiles.ultra.textureSize).toBeLessThanOrEqual(2048);
  });
  it.each([
    [0.2, 0, 0],
    [0.8, 0, 1],
    [2, 0, 2],
    [0.2, 2, 2],
  ])('uses distance %s and bias %s to choose LOD %s', (distance, bias, expected) =>
    expect(chooseLod(distance, [0, 0.6, 1.2], bias)).toBe(expected),
  );
});
describe('semantic selection state', () => {
  beforeEach(() => useViewerStore.getState().clear());
  it('maps every descriptor to a unique stable identifier', () => {
    expect(motherboardComponents.map((c) => c.id)).toEqual(componentIds);
    expect(new Set(componentIds).size).toBe(componentIds.length);
  });
  it('moves selection and rejects arbitrary mesh names', () => {
    const state = useViewerStore.getState();
    state.select('motherboard.cpuSocket');
    state.select('motherboard.dimm.a2');
    expect(useViewerStore.getState().selected).toBe('motherboard.dimm.a2');
    state.select('Cube.023');
    expect(useViewerStore.getState().selected).toBe('motherboard.dimm.a2');
  });
  it('clears transient state on scene departure', () => {
    useViewerStore.getState().toggleExploded();
    useViewerStore.getState().select('motherboard.cpuSocket');
    useViewerStore.getState().clear();
    expect(useViewerStore.getState().selected).toBeNull();
    expect(useViewerStore.getState().exploded).toBe(false);
  });
  it('does not store server hardware records', () =>
    expect(Object.keys(useViewerStore.getState())).not.toContain('board'));
  it('does not fabricate secondary PCIe lane counts', () => {
    const board = fixtureCatalog[0]!;
    if (board.category !== 'motherboard') throw new Error('Fixture category');
    expect(
      componentInfo(board, 'motherboard.pcie.x4_1').find((row) => row.label === 'Electrical lanes')
        ?.value,
    ).toBe('Unknown');
  });
});
