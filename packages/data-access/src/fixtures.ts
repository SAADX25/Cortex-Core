import { catalogSchema, type Part } from '@cortex/part-schema';

const timestamp = '2026-10-07T00:00:00Z';
const common = {
  manufacturer: 'Cortex Lab',
  releaseDate: null,
  status: 'development',
  isFixture: true,
  createdAt: timestamp,
  updatedAt: timestamp,
  provenance: {
    fixture: {
      organization: 'Cortex Core development fixtures',
      verifiedAt: timestamp,
      status: 'fixture',
      confidence: 0,
    },
  },
};
const visual = (
  templateId: string,
  width: number,
  depth: number,
  height: number,
  label: string,
) => ({
  templateId,
  dimensions: { width, depth, height, unit: 'mm' },
  materials: { pcb: '#263a35', metal: '#9aa7ac', plastic: '#20282d' },
  textureSet: null,
  branding: { label },
  connectors: [],
  lod: [
    { level: 0, distance: 0 },
    { level: 1, distance: 0.6 },
    { level: 2, distance: 1.2 },
  ],
  premiumAssetId: null,
});
export const fixtureCatalog: Part[] = catalogSchema.parse([
  {
    ...common,
    id: 'fixture-board-atx',
    slug: 'cortex-atx-reference',
    model: 'ATX Reference / 01',
    category: 'motherboard',
    visual: visual('motherboard.atx.v1', 244, 305, 32, 'CORTEX / ATX'),
    specs: {
      socket: 'AM5',
      socketType: 'LGA',
      cpuFamilies: ['Fixture Zen family'],
      formFactor: 'ATX',
      chipset: 'Cortex reference chipset',
      memoryGeneration: 'DDR5',
      dimmSlots: 4,
      maxMemoryGb: 128,
      pcieGeneration: 4,
      pcieLanes: 16,
      sataPorts: 4,
      m2Slots: [
        { id: 'motherboard.m2.slot1', key: 'M', interfaces: ['nvme'], lengthsMm: [60, 80] },
        { id: 'motherboard.m2.slot2', key: 'M', interfaces: ['nvme', 'sata'], lengthsMm: [80] },
      ],
    },
  },
  {
    ...common,
    id: 'fixture-cpu',
    slug: 'sample-eight-core',
    model: 'Sample 8-core CPU',
    category: 'cpu',
    visual: visual('cpu.lga.v1', 40, 40, 5, 'SAMPLE CPU'),
    specs: { socket: 'AM5', family: 'Fixture Zen family', cores: 8, tdpWatts: 65 },
  },
  {
    ...common,
    id: 'fixture-ram',
    slug: 'sample-ddr5-kit',
    model: 'Sample DDR5 kit',
    category: 'ram',
    visual: visual('ram.dimm.v1', 133, 8, 35, 'SAMPLE DIMM'),
    specs: { generation: 'DDR5', capacityGb: 16, moduleCount: 2, speedMt: 5600 },
  },
  {
    ...common,
    id: 'fixture-gpu',
    slug: 'sample-pcie-gpu',
    model: 'Sample PCIe GPU',
    category: 'gpu',
    visual: visual('gpu.dual-fan.v1', 260, 45, 120, 'SAMPLE GPU'),
    specs: { pcieGeneration: 4, pcieLanes: 16, powerWatts: 180, powerConnectors: ['8-pin'] },
  },
  {
    ...common,
    id: 'fixture-storage',
    slug: 'sample-nvme-ssd',
    model: 'Sample NVMe SSD',
    category: 'storage',
    visual: visual('storage.m2.v1', 22, 80, 3, 'SAMPLE SSD'),
    specs: { interface: 'nvme', formFactor: 'M.2', key: 'M', lengthMm: 80, capacityGb: 1000 },
  },
]);
