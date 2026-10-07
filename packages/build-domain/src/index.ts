import { z } from 'zod';
import type { Motherboard, Part } from '@cortex/part-schema';
import { checkInstallation, summarizeCompatibility } from '@cortex/compatibility-engine';

export const slotIds = [
  'motherboard.cpuSocket',
  'motherboard.dimm.a1',
  'motherboard.dimm.a2',
  'motherboard.dimm.b1',
  'motherboard.dimm.b2',
  'motherboard.m2.slot1',
  'motherboard.m2.slot2',
] as const;
export type SlotId = (typeof slotIds)[number];
export type InstallablePart = Extract<Part, { category: 'cpu' | 'ram' | 'storage' }>;
export const buildSchema = z
  .object({
    schemaVersion: z.literal(1),
    motherboardId: z.string().min(1).max(100),
    installations: z
      .array(
        z
          .object({
            slotId: z.enum(slotIds),
            partId: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(7),
  })
  .strict();
export type Build = z.infer<typeof buildSchema>;
export function emptyBuild(motherboardId: string): Build {
  return { schemaVersion: 1, motherboardId, installations: [] };
}
export function isInstallable(part: Part): part is InstallablePart {
  return part.category === 'cpu' || part.category === 'ram' || part.category === 'storage';
}
export function buildBoard(build: Build, catalog: readonly Part[]): Motherboard {
  const board = catalog.find((p) => p.id === build.motherboardId);
  if (board?.category !== 'motherboard') throw new Error('Selected motherboard is unavailable.');
  return board;
}
export function installedPart(partId: string, catalog: readonly Part[]): InstallablePart {
  const part = catalog.find((p) => p.id === partId);
  if (!part || !isInstallable(part))
    throw new Error('Installed part is unavailable or unsupported.');
  return part;
}
export function slotsForBuild(build: Build, catalog: readonly Part[]) {
  const board = buildBoard(build, catalog);
  return slotIds.map((id) => {
    const installation = build.installations.find((i) => i.slotId === id);
    const type = id === slotIds[0] ? 'cpu' : id.includes('.dimm.') ? 'ram' : 'storage';
    const m2 = board.specs.m2Slots.find((s) => s.id === id);
    return {
      id,
      type,
      occupied: Boolean(installation),
      installedPartId: installation?.partId ?? null,
      requirements:
        type === 'cpu'
          ? { socket: board.specs.socket }
          : type === 'ram'
            ? { generation: board.specs.memoryGeneration }
            : {
                key: m2?.key ?? null,
                interfaces: m2?.interfaces ?? null,
                lengthsMm: m2?.lengthsMm ?? null,
              },
    };
  });
}
export function destinations(build: Build, part: Part, catalog: readonly Part[]) {
  const board = buildBoard(build, catalog);
  const memory = build.installations
    .map((i) => installedPart(i.partId, catalog))
    .filter((p) => p.category === 'ram');
  const memoryGb = memory.some((p) => p.specs.capacityGb === null)
    ? null
    : memory.reduce((sum, p) => sum + (p.specs.capacityGb ?? 0), 0);
  return slotsForBuild(build, catalog)
    .filter((s) => s.type === part.category)
    .map((slot) => {
      const checks = checkInstallation(board, part, {
        slotId: slot.id,
        occupied: slot.occupied,
        memoryGb,
      });
      const status = summarizeCompatibility(checks);
      return {
        ...slot,
        checks,
        status,
        installable: status === 'compatible' || status === 'warning',
      };
    });
}
export function install(
  build: Build,
  partId: string,
  slotId: string,
  catalog: readonly Part[],
): Build {
  const part = installedPart(partId, catalog);
  const target = destinations(build, part, catalog).find((s) => s.id === slotId);
  if (!target?.installable)
    throw new Error(
      target?.checks.find((c) => c.status === 'incompatible' || c.status === 'unknown')
        ?.explanation ?? 'Invalid installation destination.',
    );
  return { ...build, installations: [...build.installations, { partId, slotId: target.id }] };
}
export function remove(build: Build, slotId: string): Build {
  if (!build.installations.some((i) => i.slotId === slotId)) throw new Error('Slot is empty.');
  return { ...build, installations: build.installations.filter((i) => i.slotId !== slotId) };
}
export function replace(
  build: Build,
  partId: string,
  slotId: string,
  catalog: readonly Part[],
): Build {
  return install(remove(build, slotId), partId, slotId, catalog);
}
/** Validate structure, references, uniqueness and compatibility before accepting any persisted state. */
export function parseBuild(value: unknown, catalog: readonly Part[]): Build {
  const parsed = buildSchema.parse(value);
  let validated = emptyBuild(parsed.motherboardId);
  buildBoard(validated, catalog);
  for (const item of parsed.installations)
    validated = install(validated, item.partId, item.slotId, catalog);
  return validated;
}
export function buildSummary(build: Build, catalog: readonly Part[]) {
  const board = buildBoard(build, catalog);
  const components = build.installations.map((i) => ({
    ...i,
    part: installedPart(i.partId, catalog),
  }));
  const memory = components.filter((i) => i.part.category === 'ram');
  const storage = components.filter((i) => i.part.category === 'storage');
  const total = (items: typeof components) =>
    items.some((i) => 'capacityGb' in i.part.specs && i.part.specs.capacityGb === null)
      ? null
      : items.reduce(
          (sum, i) => sum + ('capacityGb' in i.part.specs ? (i.part.specs.capacityGb ?? 0) : 0),
          0,
        );
  const checks = components.flatMap((i) =>
    checkInstallation(board, i.part, {
      slotId: i.slotId,
      occupied: false,
      memoryGb:
        i.part.category === 'ram' && total(memory) !== null
          ? total(memory)! - (i.part.specs.capacityGb ?? 0)
          : total(memory),
    }),
  );
  return {
    cpu: components.find((i) => i.part.category === 'cpu')?.part ?? null,
    memoryGb: total(memory),
    memoryUsed: memory.length,
    memorySlots: Math.min(board.specs.dimmSlots ?? 0, 4),
    storageGb: total(storage),
    storageUsed: storage.length,
    storageSlots: board.specs.m2Slots.filter((s) => slotIds.some((id) => id === s.id)).length,
    checks,
    compatibility: checks.length ? summarizeCompatibility(checks) : null,
  };
}
