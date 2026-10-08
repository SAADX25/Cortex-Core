export interface DetectedDevice {
  name: string;
  properties: Record<string, string>;
}
export const hardwareCategories = ['cpu', 'gpu', 'memory', 'motherboard', 'storage', 'os'] as const;
export type HardwareCategory = (typeof hardwareCategories)[number];
export interface HardwareScan {
  schemaVersion: 1;
  scannedAt: number;
  cpu: DetectedDevice[];
  gpu: DetectedDevice[];
  memory: DetectedDevice[];
  motherboard: DetectedDevice[];
  storage: DetectedDevice[];
  bios: DetectedDevice[];
  os: DetectedDevice[];
  totalMemoryBytes: number | null;
  unavailable: string[];
}
const fields: Record<HardwareCategory | 'bios', string[]> = {
  cpu: ['Manufacturer', 'Physical cores', 'Logical processors', 'Max clock (MHz)', 'Architecture'],
  gpu: ['Vendor', 'Driver version', 'Dedicated VRAM (bytes)'],
  memory: [
    'Manufacturer',
    'Part number',
    'Capacity (bytes)',
    'Configured speed (MT/s)',
    'Memory type',
  ],
  motherboard: ['Manufacturer', 'Model', 'Version'],
  storage: ['Size (bytes)', 'Media type', 'Bus type', 'Reported interface'],
  bios: ['Manufacturer', 'Version', 'Release date'],
  os: ['Edition', 'Version', 'Build', 'Architecture'],
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid hardware response');
  return value as Record<string, unknown>;
}
export function parseHardwareScan(value: unknown): HardwareScan {
  const r = record(value);
  if (r.schemaVersion !== 1 || !Number.isSafeInteger(r.scannedAt) || (r.scannedAt as number) <= 0)
    throw new Error('Unsupported hardware scan');
  const keys = [
    'schemaVersion',
    'scannedAt',
    ...Object.keys(fields),
    'totalMemoryBytes',
    'unavailable',
  ];
  if (Object.keys(r).some((k) => !keys.includes(k))) throw new Error('Unexpected hardware field');
  for (const [category, allowed] of Object.entries(fields)) {
    const devices = r[category];
    if (!Array.isArray(devices) || devices.length > 256) throw new Error('Invalid device list');
    for (const item of devices) {
      const d = record(item);
      if (
        Object.keys(d).some((k) => !['name', 'properties'].includes(k)) ||
        typeof d.name !== 'string' ||
        d.name.length > 256
      )
        throw new Error('Invalid device');
      for (const [key, val] of Object.entries(record(d.properties))) {
        if (!allowed.includes(key) || typeof val !== 'string' || val.length > 256)
          throw new Error('Invalid device property');
      }
    }
  }
  if (
    r.totalMemoryBytes !== null &&
    (!Number.isSafeInteger(r.totalMemoryBytes) || (r.totalMemoryBytes as number) <= 0)
  )
    throw new Error('Invalid memory total');
  if (
    !Array.isArray(r.unavailable) ||
    r.unavailable.length > 16 ||
    r.unavailable.some((v) => typeof v !== 'string' || v.length > 80)
  )
    throw new Error('Invalid scan diagnostics');
  return structuredClone(r) as unknown as HardwareScan;
}
export const categoryNames: Record<HardwareCategory, string> = {
  cpu: 'CPU',
  gpu: 'GPU',
  memory: 'Memory',
  motherboard: 'Motherboard',
  storage: 'Storage',
  os: 'Operating System',
};
export const property = (d: DetectedDevice | undefined, key: string) =>
  d?.properties[key] ?? 'Unknown';
export function bytes(value: string | number | null | undefined, decimal = false): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Not reported by system';
  const base = decimal ? 1000 : 1024;
  const unit = n >= base ** 4 ? 4 : n >= base ** 3 ? 3 : n >= base ** 2 ? 2 : 1;
  return `${Number((n / base ** unit).toFixed(1))} ${decimal ? ['', 'KB', 'MB', 'GB', 'TB'][unit] : ['', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
export function cardSummary(
  scan: HardwareScan,
  key: HardwareCategory,
): { name: string; lines: string[] } {
  const devices = scan[key];
  const first = devices[0];
  if (key === 'memory' && scan.totalMemoryBytes) {
    const types = [
      ...new Set(devices.map((d) => property(d, 'Memory type')).filter((v) => v !== 'Unknown')),
    ];
    const speeds = [
      ...new Set(
        devices.map((d) => property(d, 'Configured speed (MT/s)')).filter((v) => v !== 'Unknown'),
      ),
    ];
    const capacities = [...new Set(devices.map((d) => property(d, 'Capacity (bytes)')))];
    return {
      name: `${bytes(scan.totalMemoryBytes)}${types.length === 1 ? ' ' + types[0] : ''}`,
      lines: [
        devices.length
          ? capacities.length === 1 && capacities[0] !== 'Unknown'
            ? `${devices.length} × ${bytes(capacities[0])} · ${devices.length === 1 ? '1 module' : `${devices.length} modules`}`
            : `${devices.length} modules · See individual capacities in details`
          : 'Module information unavailable',
        speeds.length ? `${speeds.join(' / ')} MT/s configured` : 'Speed not reported by system',
      ],
    };
  }
  if (!first) return { name: 'Information unavailable', lines: ['Rescan to try again'] };
  if (key === 'cpu')
    return {
      name: first.name,
      lines: [
        `${property(first, 'Physical cores')} cores / ${property(first, 'Logical processors')} threads`,
        property(first, 'Manufacturer'),
        ...(devices.length > 1 ? [`${devices.length} processors`] : []),
      ],
    };
  if (key === 'gpu')
    return {
      name: first.name,
      lines: [
        property(first, 'Dedicated VRAM (bytes)') === 'Unknown'
          ? 'VRAM not reported by system'
          : `${bytes(property(first, 'Dedicated VRAM (bytes)'))} dedicated VRAM`,
        ...(devices.length > 1
          ? [`+ ${devices.length - 1} additional adapter${devices.length > 2 ? 's' : ''}`]
          : [property(first, 'Vendor')]),
      ],
    };
  if (key === 'storage')
    return {
      name: first.name,
      lines: [
        `${bytes(property(first, 'Size (bytes)'), true)} · ${property(first, 'Bus type') !== 'Unknown' ? property(first, 'Bus type') : property(first, 'Reported interface') !== 'Unknown' ? property(first, 'Reported interface') + ' interface' : 'Bus not reported'}`,
        `${devices.length} physical ${devices.length === 1 ? 'device' : 'devices'}`,
      ],
    };
  if (key === 'os')
    return {
      name: first.name,
      lines: [property(first, 'Architecture'), `Build ${property(first, 'Build')}`],
    };
  return {
    name: first.name,
    lines: [property(first, 'Manufacturer'), 'System-reported specifications'],
  };
}
export function specifications(scan: HardwareScan): string {
  return [
    'Cortex Core — My PC',
    `Last scanned: ${new Date(scan.scannedAt).toLocaleString()}`,
    '',
    ...[...hardwareCategories, 'bios' as const].flatMap((key) => [
      key === 'bios' ? 'BIOS' : categoryNames[key],
      ...(scan[key].length
        ? scan[key].flatMap((d) => [
            d.name,
            ...Object.entries(d.properties).map(([k, v]) => `  ${k}: ${v}`),
          ])
        : ['Information unavailable']),
      ...(key === 'memory' ? [`Total installed: ${bytes(scan.totalMemoryBytes)}`] : []),
      '',
    ]),
  ].join('\n');
}
