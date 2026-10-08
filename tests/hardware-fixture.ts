import type { HardwareScan } from '../packages/application-ui/src/hardware';
// Synthetic provider-shaped data for UI tests only. Never imported by the application.
export const hardwareFixture: HardwareScan = {
  schemaVersion: 1,
  scannedAt: 1791442800000,
  cpu: [
    {
      name: 'Test 8-core processor',
      properties: {
        Manufacturer: 'Test vendor',
        'Physical cores': '8',
        'Logical processors': '16',
        'Max clock (MHz)': '4200',
        Architecture: 'x64',
      },
    },
  ],
  gpu: [
    {
      name: 'Integrated test adapter',
      properties: {
        Vendor: 'Test vendor',
        'Driver version': '1.0',
        'Dedicated VRAM (bytes)': 'Unknown',
      },
    },
    {
      name: 'Discrete test adapter',
      properties: {
        Vendor: 'Test vendor',
        'Driver version': '2.0',
        'Dedicated VRAM (bytes)': '17179869184',
      },
    },
  ],
  memory: Array.from({ length: 2 }, () => ({
    name: 'Test DIMM',
    properties: {
      Manufacturer: 'Test memory vendor',
      'Part number': 'TEST-16',
      'Capacity (bytes)': '17179869184',
      'Configured speed (MT/s)': '6000',
      'Memory type': 'DDR5',
    },
  })),
  totalMemoryBytes: 34359738368,
  motherboard: [
    {
      name: 'Test motherboard',
      properties: { Manufacturer: 'Test board vendor', Model: 'Test motherboard', Version: '1.0' },
    },
  ],
  storage: [
    {
      name: 'Test SSD',
      properties: { 'Size (bytes)': '2000000000000', 'Media type': 'SSD', 'Bus type': 'NVMe' },
    },
    {
      name: 'Test disk',
      properties: {
        'Size (bytes)': '500000000000',
        'Media type': 'Unknown',
        'Bus type': 'Unknown',
      },
    },
  ],
  bios: [
    {
      name: '1.2',
      properties: {
        Manufacturer: 'Test firmware vendor',
        Version: '1.2',
        'Release date': '2026-01-01',
      },
    },
  ],
  os: [
    {
      name: 'Windows test edition',
      properties: {
        Edition: 'Windows test edition',
        Version: '10.0',
        Build: '12345',
        Architecture: '64-bit',
      },
    },
  ],
  unavailable: [],
};
