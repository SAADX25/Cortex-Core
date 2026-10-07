import type { Motherboard } from '@cortex/part-schema';

export const componentIds = [
  'motherboard.pcb',
  'motherboard.cpuSocket',
  'motherboard.dimm.a1',
  'motherboard.dimm.a2',
  'motherboard.dimm.b1',
  'motherboard.dimm.b2',
  'motherboard.pcie.x16_1',
  'motherboard.pcie.x4_1',
  'motherboard.pcie.x1_1',
  'motherboard.m2.slot1',
  'motherboard.m2.slot2',
  'motherboard.vrm',
  'motherboard.chipset',
  'motherboard.power.atx',
  'motherboard.power.cpu',
  'motherboard.sata',
  'motherboard.rearIo',
] as const;
export type ComponentId = (typeof componentIds)[number];
export type Vector3Tuple = [number, number, number];
export type CameraAction = 'reset' | 'fit' | 'focus' | 'zoom-in' | 'zoom-out';
export interface ComponentDescriptor {
  id: ComponentId;
  label: string;
  kind: 'board' | 'socket' | 'dimm' | 'pcie' | 'm2' | 'heatsink' | 'power' | 'io';
  position: Vector3Tuple;
  size: Vector3Tuple;
  explode: number;
  description: string;
}
/** Coordinates in millimetres in template space; metadata remains in the domain record. */
export const motherboardComponents: readonly ComponentDescriptor[] = [
  {
    id: 'motherboard.pcb',
    label: 'Printed circuit board',
    kind: 'board',
    position: [0, 0, 0],
    size: [244, 2, 305],
    explode: 0,
    description: 'The substrate carries electrical connections between all motherboard regions.',
  },
  {
    id: 'motherboard.cpuSocket',
    label: 'CPU socket',
    kind: 'socket',
    position: [-22, 6, -66],
    size: [54, 9, 54],
    explode: 32,
    description: 'The processor connects here. Socket and BIOS support must both match your CPU.',
  },
  ...(['a1', 'a2', 'b1', 'b2'] as const).map((slot, i): ComponentDescriptor => ({
    id: `motherboard.dimm.${slot}`,
    label: `DIMM ${slot.toUpperCase()}`,
    kind: 'dimm',
    position: [47 + i * 14, 6, -58],
    size: [7, 10, 135],
    explode: 42 + i * 6,
    description:
      'A memory module seats vertically into this slot. Consult the board manual for population order.',
  })),
  {
    id: 'motherboard.pcie.x16_1',
    label: 'Primary PCIe x16',
    kind: 'pcie',
    position: [-6, 5, 31],
    size: [105, 8, 9],
    explode: 32,
    description: 'The full-length primary expansion slot commonly hosts a graphics card.',
  },
  {
    id: 'motherboard.pcie.x4_1',
    label: 'Secondary PCIe slot',
    kind: 'pcie',
    position: [-6, 5, 105],
    size: [105, 8, 9],
    explode: 32,
    description:
      'A secondary full-length connector. Its electrical link may differ from its physical length.',
  },
  {
    id: 'motherboard.pcie.x1_1',
    label: 'PCIe x1 slot',
    kind: 'pcie',
    position: [-39, 5, 68],
    size: [35, 8, 9],
    explode: 32,
    description: 'A compact connector for smaller expansion cards.',
  },
  {
    id: 'motherboard.m2.slot1',
    label: 'M.2 slot 01',
    kind: 'm2',
    position: [-9, 4, 4],
    size: [83, 5, 22],
    explode: 54,
    description: 'A compact storage location. Key, interface and device length must all fit.',
  },
  {
    id: 'motherboard.m2.slot2',
    label: 'M.2 slot 02',
    kind: 'm2',
    position: [-9, 4, 132],
    size: [83, 5, 22],
    explode: 58,
    description: 'A second independent M.2 storage location with its own interface support.',
  },
  {
    id: 'motherboard.vrm',
    label: 'VRM & heatsinks',
    kind: 'heatsink',
    position: [-72, 13, -74],
    size: [24, 24, 97],
    explode: 68,
    description: 'Voltage regulation conditions power for the CPU. The heatsink dissipates heat.',
  },
  {
    id: 'motherboard.chipset',
    label: 'Chipset heatsink',
    kind: 'heatsink',
    position: [67, 8, 78],
    size: [43, 15, 46],
    explode: 66,
    description: 'The chipset connects additional storage, peripheral and expansion interfaces.',
  },
  {
    id: 'motherboard.power.atx',
    label: '24-pin ATX power',
    kind: 'power',
    position: [112, 9, -53],
    size: [12, 16, 52],
    explode: 32,
    description: 'The main motherboard power connector. Use the correct PSU cable.',
  },
  {
    id: 'motherboard.power.cpu',
    label: 'CPU power connector',
    kind: 'power',
    position: [-66, 7, -139],
    size: [23, 12, 12],
    explode: 32,
    description: 'Dedicated CPU power input. CPU and GPU power cables are not interchangeable.',
  },
  {
    id: 'motherboard.sata',
    label: 'SATA connectors',
    kind: 'io',
    position: [110, 7, 84],
    size: [20, 12, 38],
    explode: 34,
    description: 'Data connections for SATA storage. Drives also need separate PSU power.',
  },
  {
    id: 'motherboard.rearIo',
    label: 'Rear I/O',
    kind: 'io',
    position: [-110, 16, -77],
    size: [22, 30, 138],
    explode: 76,
    description: 'External ports connect peripherals, networking, display and audio.',
  },
];
export function isComponentId(value: string): value is ComponentId {
  return componentIds.some((id) => id === value);
}
export function componentInfo(
  board: Motherboard,
  id: ComponentId,
): { label: string; value: string }[] {
  const s = board.specs;
  const text = (v: unknown) => (v === null || v === undefined ? 'Unknown' : String(v));
  if (id === 'motherboard.cpuSocket')
    return [
      { label: 'Socket', value: text(s.socket) },
      { label: 'Type', value: text(s.socketType) },
      { label: 'CPU families', value: s.cpuFamilies?.join(', ') ?? 'Unknown' },
      { label: 'CPU support', value: 'Exact BIOS support not verified' },
    ];
  if (id.startsWith('motherboard.dimm.'))
    return [
      { label: 'Memory', value: text(s.memoryGeneration) },
      { label: 'Total slots', value: text(s.dimmSlots) },
      { label: 'Board limit', value: s.maxMemoryGb === null ? 'Unknown' : `${s.maxMemoryGb} GB` },
      { label: 'Slot', value: id.split('.').at(-1)?.toUpperCase() ?? '' },
    ];
  if (id.startsWith('motherboard.pcie.'))
    return [
      { label: 'Interface', value: 'PCI Express' },
      {
        label: 'Generation',
        value: id === 'motherboard.pcie.x16_1' ? text(s.pcieGeneration) : 'Unknown',
      },
      {
        label: 'Electrical lanes',
        value: id === 'motherboard.pcie.x16_1' ? text(s.pcieLanes) : 'Unknown',
      },
    ];
  if (id.startsWith('motherboard.m2.')) {
    const slot = s.m2Slots.find((item) => item.id === id);
    return [
      { label: 'Key', value: text(slot?.key) },
      {
        label: 'Interfaces',
        value: slot?.interfaces?.map((i) => i.toUpperCase()).join(' / ') ?? 'Unknown',
      },
      {
        label: 'Device length',
        value: slot?.lengthsMm?.map((n) => `${n} mm`).join(' / ') ?? 'Unknown',
      },
    ];
  }
  if (id === 'motherboard.pcb')
    return [
      { label: 'Form factor', value: text(s.formFactor) },
      {
        label: 'Dimensions',
        value: `${board.visual.dimensions.width} × ${board.visual.dimensions.depth} mm`,
      },
      { label: 'Template', value: board.visual.templateId },
    ];
  if (id === 'motherboard.chipset') return [{ label: 'Chipset', value: text(s.chipset) }];
  if (id === 'motherboard.sata') return [{ label: 'Port count', value: text(s.sataPorts) }];
  return [
    { label: 'Region', value: motherboardComponents.find((c) => c.id === id)?.label ?? id },
    { label: 'Detailed specifications', value: 'Not supplied by this fixture' },
  ];
}
