import type { VisualDevice } from './detected-visuals';

export type StorageFamily = 'hdd' | 'sata-ssd' | 'nvme' | 'unknown';
/** A representative silhouette, never proof of exact dimensions, mounting or product identity. */
export function resolveStorageVisual(device: VisualDevice) {
  const reported = (key: string) => device.properties[key]?.trim().toLowerCase() ?? '';
  const media = reported('Media type');
  const bus = reported('Bus type');
  const form = reported('Form factor');
  const rpm = Number(reported('Rotation rate (RPM)') || reported('Spindle speed (RPM)'));
  const rotating =
    /^(hdd|rotating|rotating media|mechanical|hard disk drive)$/.test(media) || rpm > 0;
  const solid = /^(ssd|solid state|solid state drive)$/.test(media);
  const nvme = bus === 'nvme' || reported('Reported interface') === 'nvme';
  const m2 = /^(m\.2|m2)(?:\s+2280)?$/.test(form);
  let family: StorageFamily = 'unknown';
  // Conflicting provider evidence is less trustworthy than a neutral fallback.
  if (!(rotating && (solid || nvme || m2))) {
    if (rotating) family = 'hdd';
    else if (nvme || m2) family = 'nvme';
    else if (solid && (bus === 'sata' || reported('Reported interface') === 'sata'))
      family = 'sata-ssd';
  }
  return {
    family,
    assetId: `detected.storage.${family}.v3`,
    fidelity: 'generic' as const,
    note:
      family === 'hdd'
        ? 'Generic HDD visualization'
        : family === 'sata-ssd'
          ? 'Generic SATA SSD visualization'
          : family === 'nvme'
            ? nvme
              ? 'Generic NVMe visualization'
              : 'Generic M.2 visualization'
            : 'Generic unknown storage visualization',
  };
}
