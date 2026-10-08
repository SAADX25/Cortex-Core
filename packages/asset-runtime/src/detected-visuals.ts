import { resolveStorageVisual } from './storage-visuals';
/** Hardware identity is deliberately independent of visual identity. No product-name guessing. */
export interface VisualDevice {
  name: string;
  properties: Record<string, string>;
}
export type BoardFamily = 'atx' | 'matx' | 'itx' | 'oem';
export type AdapterClass = 'discrete' | 'integrated' | 'virtual' | 'software' | 'unknown';
export const boardFamilies = {
  atx: { width: 244, depth: 305, sockets: 4, label: 'Generic ATX template' },
  matx: { width: 244, depth: 244, sockets: 4, label: 'Generic micro-ATX template' },
  itx: { width: 170, depth: 170, sockets: 2, label: 'Generic Mini-ITX template' },
  oem: { width: 244, depth: 280, sockets: 4, label: 'Generic OEM / unknown layout' },
} as const;
export interface VisualResolution {
  assetId: string;
  fidelity: 'exact' | 'family' | 'generic';
  source: 'verified-asset' | 'reported-family' | 'safe-default';
}
// Empty until an asset has reviewed provenance AND an explicit verified hardware match.
// Adding marketing-name heuristics here would turn an illustration into a false claim.
export const verifiedDetectedAssets: Readonly<Record<string, string>> = {};
export function resolveDetectedVisual(
  kind: 'motherboard' | 'cpu' | 'memory' | 'gpu' | 'storage',
  verifiedKey?: string,
  family?: string,
): VisualResolution {
  const exact = verifiedKey ? verifiedDetectedAssets[`${kind}:${verifiedKey}`] : undefined;
  if (exact) return { assetId: exact, fidelity: 'exact', source: 'verified-asset' };
  if (kind === 'motherboard' && family && family !== 'oem' && Object.hasOwn(boardFamilies, family))
    return {
      assetId: `detected.board.${family}.v2`,
      fidelity: 'family',
      source: 'reported-family',
    };
  return {
    assetId: kind === 'motherboard' ? 'detected.board.oem.v2' : `detected.${kind}.v2`,
    fidelity: 'generic',
    source: 'safe-default',
  };
}
export function adapterClass(device: VisualDevice): AdapterClass {
  const value = device.properties['Adapter class']?.toLowerCase();
  return ['discrete', 'integrated', 'virtual', 'software'].includes(value ?? '')
    ? (value as AdapterClass)
    : 'unknown';
}
export function storagePlacement(device: VisualDevice): 'm2' | 'inventory' {
  // NVMe is a protocol, not a physical form factor. The current scanner does not
  // report a reliable form factor, so its NVMe disks correctly stay in inventory.
  return resolveStorageVisual(device).family === 'nvme' &&
    device.properties['Form factor'] === 'M.2' &&
    device.properties['Bus type'] === 'NVMe'
    ? 'm2'
    : 'inventory';
}
