import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from '@cortex/data-access';
import {
  emptyBuild,
  install,
  remove,
  replace,
  destinations,
  slotsForBuild,
  parseBuild,
  buildSummary,
} from '../../packages/build-domain/src';
import {
  installationPose,
  installationDurationMs,
} from '../../packages/3d-engine/src/installation';
import type { Part } from '@cortex/part-schema';

const catalog = fixtureCatalog;
const empty = () => emptyBuild('fixture-board-atx');
const cpu = 'motherboard.cpuSocket';
const a2 = 'motherboard.dimm.a2';
const b2 = 'motherboard.dimm.b2';
const m2 = 'motherboard.m2.slot2';
describe('independent assembly domain', () => {
  it('installs/removes CPU immutably and frees socket', () => {
    const before = empty();
    const built = install(before, 'fixture-cpu', cpu, catalog);
    expect(before.installations).toEqual([]);
    expect(slotsForBuild(built, catalog)[0]).toMatchObject({
      occupied: true,
      installedPartId: 'fixture-cpu',
      requirements: { socket: 'AM5' },
    });
    expect(remove(built, cpu)).toEqual(before);
  });
  it('rejects duplicate CPU and duplicate RAM slots', () => {
    expect(() =>
      install(install(empty(), 'fixture-cpu', cpu, catalog), 'fixture-cpu', cpu, catalog),
    ).toThrow(/occupied/);
    expect(() =>
      install(install(empty(), 'fixture-ram', a2, catalog), 'fixture-ram', a2, catalog),
    ).toThrow(/occupied/);
  });
  it('installs two individual 16GB DIMMs and tracks exact occupancy', () => {
    const built = install(install(empty(), 'fixture-ram', a2, catalog), 'fixture-ram', b2, catalog);
    expect(buildSummary(built, catalog)).toMatchObject({
      memoryGb: 32,
      memoryUsed: 2,
      memorySlots: 4,
    });
    expect(
      slotsForBuild(built, catalog)
        .filter((s) => s.occupied)
        .map((s) => s.id),
    ).toEqual([a2, b2]);
    expect(buildSummary(remove(built, a2), catalog).memoryGb).toBe(16);
  });
  it('installs M.2 into selected slot and filters occupied destinations', () => {
    const built = install(empty(), 'fixture-storage', m2, catalog);
    expect(built.installations[0]?.slotId).toBe(m2);
    expect(
      destinations(
        built,
        catalog.find((p) => p.id === 'fixture-storage')!,
        catalog,
      )
        .filter((s) => s.installable)
        .map((s) => s.id),
    ).toEqual(['motherboard.m2.slot1']);
  });
  it('rejects invalid, incorrect-category and unsupported GPU destinations', () => {
    expect(() => install(empty(), 'fixture-cpu', a2, catalog)).toThrow(/Invalid/);
    expect(() => install(empty(), 'fixture-ram', 'motherboard.pcb', catalog)).toThrow(/Invalid/);
    expect(() => install(empty(), 'fixture-gpu', cpu, catalog)).toThrow(/unsupported/);
  });
  it('allows CPU warning but retains BIOS verification reason', () => {
    const built = install(empty(), 'fixture-cpu', cpu, catalog);
    expect(buildSummary(built, catalog).compatibility).toBe('warning');
    expect(
      buildSummary(built, catalog).checks.some((c) => c.reason === 'bios-verification-required'),
    ).toBe(true);
  });
  it('filters incompatible socket, DDR and unknown specifications', () => {
    for (const id of ['fixture-cpu', 'fixture-ram']) {
      const altered = structuredClone(catalog);
      const part = altered.find((p) => p.id === id)!;
      if (part.category === 'cpu') part.specs.socket = 'OTHER';
      if (part.category === 'ram') part.specs.generation = 'DDR4';
      expect(destinations(empty(), part, altered).every((s) => !s.installable)).toBe(true);
      if (part.category === 'cpu') part.specs.socket = null;
      if (part.category === 'ram') part.specs.generation = null;
      expect(
        destinations(empty(), part, altered).every((s) => s.status === 'unknown' && !s.installable),
      ).toBe(true);
    }
  });
  it('evaluates each M.2 slot interface, key and length separately', () => {
    const altered = structuredClone(catalog);
    const board = altered[0]!;
    if (board.category !== 'motherboard') throw Error('Fixture');
    board.specs.m2Slots[0]!.interfaces = ['sata'];
    expect(
      destinations(
        empty(),
        altered.find((p) => p.id === 'fixture-storage')!,
        altered,
      ).map((s) => s.installable),
    ).toEqual([false, true]);
    board.specs.m2Slots[1]!.lengthsMm = [60];
    expect(() => install(empty(), 'fixture-storage', m2, altered)).toThrow(/length/);
    board.specs.m2Slots[1]!.lengthsMm = null;
    expect(
      destinations(
        empty(),
        altered.find((p) => p.id === 'fixture-storage')!,
        altered,
      )[1]?.status,
    ).toBe('unknown');
  });
  it('rejects unimplemented storage form factor and interface', () => {
    for (const specs of [{ interface: 'sata' }, { formFactor: '2.5-inch' }, { lengthMm: 60 }]) {
      const altered = structuredClone(catalog);
      const part = altered.find((p) => p.id === 'fixture-storage')!;
      Object.assign(part.specs, specs);
      expect(() => install(empty(), part.id, m2, altered)).toThrow(/2280/);
    }
  });
  it('checks total installed capacity rather than multiplying the kit twice', () => {
    const altered = structuredClone(catalog);
    const board = altered[0]!;
    if (board.category === 'motherboard') board.specs.maxMemoryGb = 16;
    const built = install(empty(), 'fixture-ram', a2, altered);
    expect(() => install(built, 'fixture-ram', b2, altered)).toThrow(/total installed/);
  });
  it('replaces explicitly and preserves the previous build on rejection', () => {
    const alternate: Part = { ...catalog.find((p) => p.id === 'fixture-cpu')!, id: 'second-cpu' };
    const records = [...catalog, alternate];
    const built = install(empty(), 'fixture-cpu', cpu, records);
    expect(replace(built, 'second-cpu', cpu, records).installations).toEqual([
      { slotId: cpu, partId: 'second-cpu' },
    ]);
    expect(() => replace(built, 'fixture-ram', cpu, records)).toThrow();
    expect(built.installations[0]?.partId).toBe('fixture-cpu');
    expect(() => replace(empty(), 'fixture-cpu', cpu, catalog)).toThrow(/empty/);
  });
  it('derives storage totals, empty compatibility and reset state', () => {
    const built = install(
      install(empty(), 'fixture-storage', m2, catalog),
      'fixture-storage',
      'motherboard.m2.slot1',
      catalog,
    );
    expect(buildSummary(built, catalog)).toMatchObject({
      storageGb: 2000,
      storageUsed: 2,
      storageSlots: 2,
      compatibility: 'compatible',
    });
    expect(buildSummary(empty(), catalog)).toMatchObject({
      cpu: null,
      memoryGb: 0,
      storageGb: 0,
      compatibility: null,
    });
  });
  it('validates persisted schema and round trips without derived mesh state', () => {
    const built = install(empty(), 'fixture-ram', a2, catalog);
    expect(parseBuild(JSON.parse(JSON.stringify(built)), catalog)).toEqual(built);
    expect(() => parseBuild({ ...built, meshes: [] }, catalog)).toThrow();
    expect(() =>
      parseBuild(
        { ...built, installations: [...built.installations, ...built.installations] },
        catalog,
      ),
    ).toThrow(/occupied/);
    expect(() => parseBuild({ ...built, motherboardId: 'missing' }, catalog)).toThrow();
    expect(() =>
      parseBuild({ ...built, installations: [{ slotId: a2, partId: 'missing' }] }, catalog),
    ).toThrow();
  });
  it('refuses newer and older schema versions', () => {
    for (const version of [0, 2, 999])
      expect(() => parseBuild({ ...empty(), schemaVersion: version }, catalog)).toThrow();
  });
  it('validates compatibility again during restoration', () => {
    const built = install(empty(), 'fixture-cpu', cpu, catalog);
    const altered = structuredClone(catalog);
    const part = altered.find((p) => p.id === 'fixture-cpu')!;
    if (part.category === 'cpu') part.specs.socket = null;
    expect(() => parseBuild(built, altered)).toThrow(/unavailable/);
  });
});
describe('reusable semantic installation poses', () => {
  it('seats CPU above socket surface', () =>
    expect(installationPose(cpu, 'installed', 0).position).toEqual([-22, 16, -66]));
  it('orients vertical RAM over its own DIMM anchor', () => {
    expect(installationPose(a2, 'installed', 0)).toMatchObject({
      position: [61, 28.5, -58],
      rotation: [0, 0, 0],
    });
    expect(installationPose(b2, 'installed', 0).position[0]).toBe(89);
  });
  it('inserts M.2 then rotates about the connector end', () => {
    const start = installationPose(m2, 'installing', 0),
      inserted = installationPose(m2, 'installing', 500),
      end = installationPose(m2, 'installing', installationDurationMs);
    expect(start.rotation[2]).toBeGreaterThan(0.4);
    expect(inserted.position[1]).toBeLessThan(start.position[1]);
    expect(end).toMatchObject({ position: [-49, 8.5, 132], rotation: [0, 0, 0], done: true });
  });
  it('supports preview, reverse removal and reduced motion immediately', () => {
    expect(installationPose(a2, 'preview', 0).opacity).toBe(0.28);
    expect(installationPose(cpu, 'removing', 0).position).toEqual(
      installationPose(cpu, 'installed', 0).position,
    );
    expect(installationPose(cpu, 'removing', 1200).opacity).toBe(0);
    expect(installationPose(cpu, 'installing', 0, true).position).toEqual(
      installationPose(cpu, 'installed', 0).position,
    );
  });
  it('adds explosion offset without changing domain anchors and repeats without state accumulation', () => {
    for (let i = 0; i < 100; i++) {
      expect(installationPose(a2, 'installing', 1200)).toEqual(
        installationPose(a2, 'installed', 0),
      );
      expect(installationPose(a2, 'installed', 0, false, true).position[1]).toBe(76.5);
      expect(installationPose(a2, 'removing', 1200).done).toBe(true);
    }
  });
});
