import { CanvasTexture, SRGBColorSpace } from 'three';
import type { StorageFamily } from '@cortex/asset-runtime';

// Small generated labels remain independent of quality/LOD geometry replacement.
export const storageMarkingPlanes: Record<StorageFamily, { size: [number, number]; y: number }> = {
  hdd: { size: [35, 44], y: 16.02 },
  'sata-ssd': { size: [32, 43], y: 4.92 },
  nvme: { size: [32, 13], y: 2.82 },
  unknown: { size: [35, 24], y: 8.52 },
};
export function createStorageMarking(name: string, family: StorageFamily) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  const [width, depth] = storageMarkingPlanes[family].size;
  canvas.height = Math.round((512 * depth) / width);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#d5d9cc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#20292c';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let lines: string[] = [];
  let size = family === 'nvme' ? 48 : 64;
  for (; size >= 10; size -= 2) {
    context.font = `600 ${size}px sans-serif`;
    lines = [''];
    for (const character of name) {
      const last = lines.length - 1;
      const candidate = lines[last] + character;
      if (context.measureText(candidate).width > 460) {
        const boundary = candidate.lastIndexOf(' ');
        if (boundary > 0) {
          lines[last] = candidate.slice(0, boundary + 1);
          lines.push(candidate.slice(boundary + 1));
        } else lines.push(character);
      } else lines[last] = candidate;
    }
    if (lines.length * size * 1.25 <= canvas.height * 0.62) break;
  }
  lines.forEach((line, index) =>
    context.fillText(
      line,
      256,
      canvas.height * 0.43 + (index - (lines.length - 1) / 2) * size * 1.25,
    ),
  );
  context.font = '400 16px sans-serif';
  context.fillStyle = '#596462';
  context.fillText('GENERIC VISUALIZATION', 256, canvas.height * 0.88);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.userData = { storageLabel: name, storageFamily: family };
  return texture;
}
