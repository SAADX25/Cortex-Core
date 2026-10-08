import { boardFamilies, type BoardFamily } from '@cortex/asset-runtime';
import type { DetectedVisual } from '../DetectedComponents';
import type { Vec3 } from './types';
/** Illustrative assembly layout, independent of animation and hardware specifications. */
export function assembledPosition(
  device: DetectedVisual,
  family: BoardFamily,
  peers: DetectedVisual[],
): Vec3 {
  const layout = boardFamilies[family],
    i = device.index;
  const ordinal = peers
    .filter(
      (d) =>
        d.category === device.category &&
        (device.category !== 'storage' || d.placement === device.placement),
    )
    .findIndex((d) => d.index === i);
  const cpuZ = -layout.depth / 2 + 82,
    pcieZ = layout.depth / 2 - (layout.depth > 200 ? 104 : 27);
  switch (device.category) {
    case 'cpu':
      return [-20 + i * 55, 7, cpuZ];
    case 'memory':
      return i < layout.sockets
        ? [48 + i * 13, 25, cpuZ]
        : [layout.width / 2 + 50 + (i - layout.sockets) * 12, 27, -layout.depth / 2 + 70];
    case 'gpu':
      return [-22, 0, pcieZ + ordinal * 42];
    case 'storage':
      return device.placement === 'm2'
        ? [-17, 5, pcieZ - 20]
        : [layout.width / 2 + 66 + (ordinal % 2) * 94, 0, -35 + Math.floor(ordinal / 2) * 100];
  }
}
