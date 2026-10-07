import { describe, expect, it } from 'vitest';
import { catalogSchema, mmToMeters, partSchema } from '@cortex/part-schema';
import { fixtureCatalog, fixtureRepository, DataError } from '@cortex/data-access';
import { checkCompatibility, summarizeCompatibility } from '@cortex/compatibility-engine';
import type { Motherboard, Part } from '@cortex/part-schema';

const get = (category: Part['category']) =>
  structuredClone(fixtureCatalog.find((part) => part.category === category)!);
const board = () => get('motherboard') as Motherboard;
describe('hardware schemas and provenance', () => {
  it('validates all five category-specific fixtures', () =>
    expect(catalogSchema.parse(fixtureCatalog)).toHaveLength(5));
  it('rejects duplicate IDs and slugs', () =>
    expect(catalogSchema.safeParse([...fixtureCatalog, fixtureCatalog[0]]).success).toBe(false));
  it('rejects invalid category specs instead of accepting a generic record', () => {
    const cpu = get('cpu');
    expect(partSchema.safeParse({ ...cpu, specs: { socket: 'AM5' } }).success).toBe(false);
  });
  it('rejects negative dimensions and non-finite data', () => {
    const part = board();
    part.visual.dimensions.width = -1;
    expect(partSchema.safeParse(part).success).toBe(false);
    part.visual.dimensions.width = Infinity;
    expect(partSchema.safeParse(part).success).toBe(false);
  });
  it('requires development labels on fixtures', () =>
    expect(partSchema.safeParse({ ...board(), status: 'active' }).success).toBe(false));
  it('requires per-specification provenance on real hardware', () =>
    expect(partSchema.safeParse({ ...board(), isFixture: false, status: 'active' }).success).toBe(
      false,
    ));
  it('permits explicit unknown specs without inventing provenance', () => {
    const cpu = get('cpu');
    if (cpu.category !== 'cpu') throw new Error('Fixture category');
    cpu.isFixture = false;
    cpu.status = 'active';
    cpu.provenance = {};
    cpu.specs = { socket: null, family: null, cores: null, tdpWatts: null };
    expect(partSchema.safeParse(cpu).success).toBe(true);
  });
  it('accepts traceable real specification and rejects fixture provenance on it', () => {
    const cpu = get('cpu');
    if (cpu.category !== 'cpu') throw new Error('Fixture category');
    cpu.isFixture = false;
    cpu.status = 'active';
    cpu.specs = { socket: 'Documented socket', family: null, cores: null, tdpWatts: null };
    cpu.provenance = {
      'specs.socket': {
        url: 'https://example.org/documentation',
        organization: 'Test manufacturer',
        verifiedAt: '2026-10-07T00:00:00Z',
        status: 'verified',
        confidence: 1,
      },
    };
    expect(partSchema.safeParse(cpu).success).toBe(true);
    cpu.provenance['specs.socket']!.status = 'fixture';
    expect(partSchema.safeParse(cpu).success).toBe(false);
  });
  it('rejects unknown imported properties', () =>
    expect(partSchema.safeParse({ ...get('cpu'), unsafe: '<script>' }).success).toBe(false));
});
describe('dimensions', () => {
  it.each([
    [244, 0.244],
    [305, 0.305],
    [0, 0],
  ])('converts %s mm to metres', (mm, meters) => expect(mmToMeters(mm)).toBe(meters));
  it.each([-1, Infinity, NaN])('rejects invalid dimension %s', (mm) =>
    expect(() => mmToMeters(mm)).toThrow(RangeError),
  );
});
describe('portable fixture repository', () => {
  it('returns validated isolated records', async () => {
    const parts = await fixtureRepository.list();
    parts[0]!.model = 'mutated';
    expect((await fixtureRepository.list())[0]!.model).not.toBe('mutated');
  });
  it('classifies missing records', async () => {
    await expect(fixtureRepository.get('absent')).rejects.toBeInstanceOf(DataError);
  });
  it('supports cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fixtureRepository.list(controller.signal)).rejects.toThrow();
  });
  it('supports bounded stable cursor pages and category filters', async () => {
    const first = await fixtureRepository.list(undefined, { limit: 2 });
    const second = await fixtureRepository.list(undefined, { limit: 2, afterId: first.at(-1)?.id });
    expect(new Set([...first, ...second].map((part) => part.id)).size).toBe(4);
    expect(
      (await fixtureRepository.list(undefined, { category: 'motherboard' })).every(
        (part) => part.category === 'motherboard',
      ),
    ).toBe(true);
  });
  it('rejects unbounded page requests', async () => {
    await expect(fixtureRepository.list(undefined, { limit: 10000 })).rejects.toThrow('Page size');
  });
});
describe('structured compatibility rules', () => {
  it('matches sockets but warns that exact BIOS support is unverified', () => {
    const results = checkCompatibility(board(), get('cpu'));
    expect(results[0]?.status).toBe('compatible');
    expect(results[1]?.reason).toBe('bios-verification-required');
  });
  it('rejects a mismatched socket', () => {
    const cpu = get('cpu');
    if (cpu.category === 'cpu') cpu.specs.socket = 'AM4';
    expect(checkCompatibility(board(), cpu)[0]?.status).toBe('incompatible');
  });
  it('returns unknown for a missing socket', () => {
    const b = board();
    b.specs.socket = null;
    expect(checkCompatibility(b, get('cpu'))[0]?.status).toBe('unknown');
  });
  it('rejects unsupported CPU families', () => {
    const b = board();
    b.specs.cpuFamilies = [];
    expect(checkCompatibility(b, get('cpu'))[1]?.status).toBe('incompatible');
  });
  it('checks RAM generation', () => {
    const ram = get('ram');
    if (ram.category === 'ram') ram.specs.generation = 'DDR4';
    expect(checkCompatibility(board(), ram)[0]?.status).toBe('incompatible');
  });
  it('checks kit capacity rather than just one module', () => {
    const ram = get('ram');
    if (ram.category === 'ram') {
      ram.specs.capacityGb = 64;
      ram.specs.moduleCount = 4;
    }
    expect(checkCompatibility(board(), ram)[1]?.status).toBe('incompatible');
  });
  it('checks available DIMM slots', () => {
    const b = board();
    b.specs.dimmSlots = 1;
    expect(checkCompatibility(b, get('ram'))[1]?.status).toBe('incompatible');
  });
  it('returns unknown for unknown RAM module counts', () => {
    const ram = get('ram');
    if (ram.category === 'ram') ram.specs.moduleCount = null;
    expect(checkCompatibility(board(), ram)[1]?.status).toBe('unknown');
  });
  it('PCIe generations negotiate lower bandwidth', () => {
    const gpu = get('gpu');
    if (gpu.category === 'gpu') gpu.specs.pcieGeneration = 5;
    expect(checkCompatibility(board(), gpu)[0]?.status).toBe('warning');
  });
  it('does not claim to check GPU case and PSU compatibility', () =>
    expect(checkCompatibility(board(), get('gpu'))[1]?.status).toBe('unknown'));
  it('checks M.2 key, interface and physical length across candidate slots', () => {
    const results = checkCompatibility(board(), get('storage'));
    expect(results[0]?.status).toBe('compatible');
    expect(results[0]?.reason).toBe('m2-slot-available');
  });
  it.each(['key', 'lengthMm'] as const)('rejects M.2 %s mismatches', (field) => {
    const storage = get('storage');
    if (storage.category !== 'storage') throw new Error('Fixture category');
    if (field === 'key') storage.specs.key = 'B';
    if (field === 'lengthMm') storage.specs.lengthMm = 110;
    expect(checkCompatibility(board(), storage)[0]?.status).toBe('incompatible');
  });
  it('accepts a SATA M.2 device when one of the two slots fits', () => {
    const storage = get('storage');
    if (storage.category === 'storage') storage.specs.interface = 'sata';
    expect(checkCompatibility(board(), storage)[0]?.status).toBe('compatible');
  });
  it('returns unknown for missing M.2 lengths when no other slot has a known fit', () => {
    const b = board();
    b.specs.m2Slots.forEach((slot) => {
      slot.lengthsMm = null;
    });
    expect(checkCompatibility(b, get('storage'))[0]?.status).toBe('unknown');
  });
  it('checks SATA interface with a cable warning', () => {
    const storage = get('storage');
    if (storage.category === 'storage') {
      storage.specs.interface = 'sata';
      storage.specs.formFactor = '2.5-inch';
    }
    expect(checkCompatibility(board(), storage)[0]?.reason).toBe('sata-cable-required');
  });
  it('does not silently approve unsupported form factors', () => {
    const storage = get('storage');
    if (storage.category === 'storage') storage.specs.formFactor = 'U.2';
    expect(checkCompatibility(board(), storage)[0]?.status).toBe('unknown');
  });
  it('keeps reason codes and involved parts machine-readable', () => {
    const result = checkCompatibility(board(), get('cpu'))[0]!;
    expect(result.partIds).toHaveLength(2);
    expect(result.explanation).not.toBe('');
    expect(result.rule).toBe('cpu.socket');
  });
  it('summarizes unknown before a compatibility warning', () =>
    expect(summarizeCompatibility(checkCompatibility(board(), get('gpu')))).toBe('unknown'));
  it('empty rules return unknown', () => expect(summarizeCompatibility([])).toBe('unknown'));
});
