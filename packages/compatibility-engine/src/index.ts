import type { Motherboard, Part, M2Slot } from '@cortex/part-schema';

export type CompatibilityStatus = 'compatible' | 'warning' | 'incompatible' | 'unknown';
export interface CompatibilityResult {
  rule: string;
  status: CompatibilityStatus;
  reason: string;
  explanation: string;
  partIds: string[];
}
const result = (
  rule: string,
  status: CompatibilityStatus,
  reason: string,
  explanation: string,
  board: Motherboard,
  part: Part,
): CompatibilityResult => ({ rule, status, reason, explanation, partIds: [board.id, part.id] });
const missing = (rule: string, board: Motherboard, part: Part) =>
  result(
    rule,
    'unknown',
    'missing-specification',
    'Required specifications are unavailable. Verify the source documentation before installation.',
    board,
    part,
  );

function storageSlot(
  board: Motherboard,
  part: Extract<Part, { category: 'storage' }>,
  slot: M2Slot,
): CompatibilityResult {
  const rule = `storage.m2.${slot.id}`;
  const spec = part.specs;
  if (
    spec.interface === null ||
    spec.key === null ||
    spec.lengthMm === null ||
    slot.key === null ||
    slot.interfaces === null ||
    slot.lengthsMm === null
  )
    return missing(rule, board, part);
  const fits =
    slot.key === spec.key &&
    slot.interfaces.includes(spec.interface) &&
    slot.lengthsMm.includes(spec.lengthMm);
  return result(
    rule,
    fits ? 'compatible' : 'incompatible',
    fits ? 'm2-matches' : 'm2-mismatch',
    fits
      ? `Key, interface and length fit ${slot.id}.`
      : `Key, interface or length does not fit ${slot.id}.`,
    board,
    part,
  );
}
export function checkCompatibility(board: Motherboard, part: Part): CompatibilityResult[] {
  const spec = board.specs;
  switch (part.category) {
    case 'cpu': {
      const socket =
        spec.socket === null || part.specs.socket === null
          ? missing('cpu.socket', board, part)
          : result(
              'cpu.socket',
              spec.socket === part.specs.socket ? 'compatible' : 'incompatible',
              spec.socket === part.specs.socket ? 'socket-matches' : 'socket-mismatch',
              `CPU socket ${part.specs.socket}; motherboard socket ${spec.socket}.`,
              board,
              part,
            );
      const family =
        spec.cpuFamilies === null || part.specs.family === null
          ? missing('cpu.family', board, part)
          : result(
              'cpu.family',
              spec.cpuFamilies.includes(part.specs.family) ? 'warning' : 'incompatible',
              spec.cpuFamilies.includes(part.specs.family)
                ? 'bios-verification-required'
                : 'family-unsupported',
              spec.cpuFamilies.includes(part.specs.family)
                ? 'Family is listed, but an exact CPU/BIOS support matrix is still required.'
                : 'This CPU family is not listed as supported.',
              board,
              part,
            );
      return [socket, family];
    }
    case 'ram': {
      const generation =
        spec.memoryGeneration === null || part.specs.generation === null
          ? missing('ram.generation', board, part)
          : result(
              'ram.generation',
              spec.memoryGeneration === part.specs.generation ? 'compatible' : 'incompatible',
              spec.memoryGeneration === part.specs.generation
                ? 'generation-matches'
                : 'generation-mismatch',
              `Memory generation ${part.specs.generation}; motherboard ${spec.memoryGeneration}.`,
              board,
              part,
            );
      const capacity =
        spec.maxMemoryGb === null ||
        part.specs.capacityGb === null ||
        part.specs.moduleCount === null ||
        spec.dimmSlots === null
          ? missing('ram.capacity', board, part)
          : result(
              'ram.capacity',
              part.specs.capacityGb * part.specs.moduleCount <= spec.maxMemoryGb &&
                part.specs.moduleCount <= spec.dimmSlots
                ? 'compatible'
                : 'incompatible',
              'memory-capacity-and-slots',
              'Checks this kit’s total capacity and occupied slots; existing installed memory is not included.',
              board,
              part,
            );
      return [generation, capacity];
    }
    case 'gpu': {
      if (
        spec.pcieGeneration === null ||
        spec.pcieLanes === null ||
        part.specs.pcieGeneration === null ||
        part.specs.pcieLanes === null
      )
        return [missing('gpu.pcie', board, part)];
      const reduced =
        part.specs.pcieGeneration > spec.pcieGeneration || part.specs.pcieLanes > spec.pcieLanes;
      return [
        result(
          'gpu.pcie',
          reduced ? 'warning' : 'compatible',
          reduced ? 'pcie-bandwidth-reduced' : 'pcie-supported',
          reduced
            ? 'The device can negotiate a lower PCIe link. Bandwidth may be reduced.'
            : 'The fixture PCIe link meets the device requirements.',
          board,
          part,
        ),
        result(
          'gpu.power-clearance',
          'unknown',
          'psu-case-not-specified',
          'PSU connectors, power budget and case clearance have not been evaluated.',
          board,
          part,
        ),
      ];
    }
    case 'storage': {
      if (part.specs.interface === null || part.specs.formFactor === null)
        return [missing('storage.interface', board, part)];
      if (part.specs.formFactor === 'M.2') {
        if (spec.m2Slots.length === 0)
          return [
            result(
              'storage.m2',
              'incompatible',
              'no-m2-slots',
              'No M.2 slots are described by this board.',
              board,
              part,
            ),
          ];
        const slots = spec.m2Slots.map((slot) => storageSlot(board, part, slot));
        const fits = slots.some((slot) => slot.status === 'compatible');
        const unknown = slots.some((slot) => slot.status === 'unknown');
        return [
          result(
            'storage.m2',
            fits ? 'compatible' : unknown ? 'unknown' : 'incompatible',
            fits ? 'm2-slot-available' : unknown ? 'missing-specification' : 'no-fitting-m2-slot',
            fits
              ? `Fits ${slots
                  .filter((slot) => slot.status === 'compatible')
                  .map((slot) => slot.rule.replace('storage.m2.', ''))
                  .join(', ')}. Slot occupancy is not evaluated.`
              : unknown
                ? 'No verified fit; at least one slot has incomplete specifications.'
                : 'No listed M.2 slot matches the device key, interface and length.',
            board,
            part,
          ),
        ];
      }
      if (part.specs.interface === 'sata' && part.specs.formFactor === '2.5-inch') {
        if (spec.sataPorts === null) return [missing('storage.sata', board, part)];
        return [
          result(
            'storage.sata',
            spec.sataPorts > 0 ? 'warning' : 'incompatible',
            spec.sataPorts > 0 ? 'sata-cable-required' : 'no-sata-ports',
            spec.sataPorts > 0
              ? 'SATA interface available; data cable, power and mounting still need verification.'
              : 'No SATA ports available.',
            board,
            part,
          ),
        ];
      }
      return [
        result(
          'storage.interface',
          'unknown',
          'unsupported-form-factor',
          'No rule exists for this storage form factor yet.',
          board,
          part,
        ),
      ];
    }
    default:
      return [
        result(
          'category',
          'unknown',
          'unsupported-category',
          'No compatibility rule exists for this pairing.',
          board,
          part,
        ),
      ];
  }
}
export function summarizeCompatibility(results: CompatibilityResult[]): CompatibilityStatus {
  if (results.length === 0) return 'unknown';
  for (const status of ['incompatible', 'unknown', 'warning'] as const)
    if (results.some((r) => r.status === status)) return status;
  return 'compatible';
}
