import {
  Box3,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Path,
  Quaternion,
  Shape,
  TorusGeometry,
  CatmullRomCurve3,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boardFamilies, type BoardFamily } from '@cortex/asset-runtime';
import type { Vector3Tuple as V } from './semantics';
import type { DetectedVisual } from './DetectedComponents';
import { cpuIdentity } from './cpu-identity';
export const finishes = {
  pcb: ['#091b14', 0.86, 0.04],
  substrate: ['#173f2a', 0.8, 0.04],
  black: ['#101416', 0.63, 0.06],
  connector: ['#1d2426', 0.72, 0.02],
  chip: ['#090c0e', 0.91, 0.02],
  metal: ['#939ea2', 0.31, 0.92],
  aluminum: ['#4e595e', 0.44, 0.86],
  gold: ['#bc9851', 0.35, 0.85],
  copper: ['#946241', 0.4, 0.88],
  ink: ['#b2b9aa', 0.95, 0],
  trace: ['#395043', 0.92, 0.1],
  tray: ['#222a2e', 0.86, 0.1],
} as const;
export type Finish = keyof typeof finishes;
export interface Instances {
  size: V;
  finish: Finish;
  positions: V[];
  cylinder?: boolean;
  flat?: boolean;
}
export interface Model {
  meshes: { geometry: BufferGeometry; finish: Finish }[];
  instances: Instances[];
  bounds: Box3;
}
/** Original CAD-style assets: millimetres, +Y up, +Z front. Tiny details use instances. */
class Builder {
  items: { geometry: BufferGeometry; finish: Finish; position: V; rotation?: V }[] = [];
  instances: Instances[] = [];
  text(text: string, position: V, scale: number, finish: Finish = 'ink') {
    // Original 3×5 stencil glyphs; no font download, atlas or texture allocation.
    const glyphs: Record<string, string> = {
      C: '111100100100111',
      O: '111101101101111',
      R: '110101110101101',
      E: '111100110100111',
      T: '111010010010010',
      X: '101101010101101',
      G: '111100101101111',
      N: '101111111111101',
      I: '111010010010111',
      P: '110101110100100',
      U: '101101101101111',
      D: '110101101101110',
      M: '101111111101101',
      S: '111100111001111',
      '0': '111101101101111',
      '1': '010110010010111',
      '2': '111001111100111',
      '3': '111001111001111',
      '4': '101101111001001',
    };
    const pixels: V[] = [];
    [...text].forEach((letter, index) => {
      [...(glyphs[letter] ?? '000000000000000')].forEach((pixel, bit) => {
        if (pixel === '1')
          pixels.push([
            position[0] + (index * 4 + (bit % 3)) * scale,
            position[1],
            position[2] + Math.floor(bit / 3) * scale,
          ]);
      });
    });
    this.instances.push({
      size: [scale * 0.75, 0.025, scale * 0.75],
      positions: pixels,
      finish,
      flat: true,
    });
  }
  box([w, h, d]: V, position: V, finish: Finish, bevel = 0.35, rotation?: V) {
    const b = Math.min(bevel, w / 5, h / 5, d / 5),
      shape = new Shape();
    shape.moveTo(-w / 2 + b, -d / 2 + b);
    shape.lineTo(w / 2 - b, -d / 2 + b);
    shape.lineTo(w / 2 - b, d / 2 - b);
    shape.lineTo(-w / 2 + b, d / 2 - b);
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, {
      depth: h - b * 2,
      bevelEnabled: b > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -h / 2 + b, 0);
    this.items.push({ geometry, finish, position, rotation });
  }
  cylinder(r: number, h: number, position: V, finish: Finish, segments = 16, rotation?: V) {
    this.items.push({
      geometry: new CylinderGeometry(r, r, h, segments).toNonIndexed(),
      finish,
      position,
      rotation,
    });
  }
  ring(r: number, tube: number, position: V, finish: Finish, rotation?: V) {
    this.items.push({
      geometry: new TorusGeometry(r, tube, 4, 32).toNonIndexed(),
      finish,
      position,
      rotation,
    });
  }
  repeated(size: V, positions: V[], finish: Finish, cylinder = false) {
    if (positions.length) this.instances.push({ size, positions, finish, cylinder });
  }
  finish(): Model {
    const repeated = new Map<string, Instances>();
    for (const batch of this.instances) {
      const key = `${batch.finish}:${batch.size.join(',')}:${batch.cylinder}:${batch.flat}`;
      const prior = repeated.get(key);
      if (prior) prior.positions.push(...batch.positions);
      else repeated.set(key, batch);
    }
    const batches = new Map<Finish, BufferGeometry[]>(),
      matrix = new Matrix4();
    for (const item of this.items) {
      matrix.compose(
        new Vector3(...item.position),
        new Quaternion().setFromEuler(new Euler(...(item.rotation ?? [0, 0, 0]))),
        new Vector3(1, 1, 1),
      );
      item.geometry.applyMatrix4(matrix);
      item.geometry.clearGroups();
      const list = batches.get(item.finish) ?? [];
      list.push(item.geometry);
      batches.set(item.finish, list);
    }
    const meshes = [...batches].map(([finish, geometries]) => ({
      finish,
      geometry: mergeGeometries(geometries)!,
    }));
    for (const item of this.items) item.geometry.dispose();
    const bounds = new Box3();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      bounds.union(m.geometry.boundingBox!);
    }
    return { meshes, instances: [...repeated.values()], bounds };
  }
}
export function boardModel(family: BoardFamily, detail: number): Model {
  const { width: w, depth: d, sockets } = boardFamilies[family],
    b = new Builder(),
    cpuZ = -d / 2 + 82;
  const pcb = new Shape();
  pcb.moveTo(-w / 2 + 2, -d / 2);
  pcb.lineTo(w / 2 - 2, -d / 2);
  pcb.lineTo(w / 2, -d / 2 + 2);
  pcb.lineTo(w / 2, d / 2 - 2);
  pcb.lineTo(w / 2 - 2, d / 2);
  pcb.lineTo(-w / 2 + 2, d / 2);
  pcb.lineTo(-w / 2, d / 2 - 2);
  pcb.lineTo(-w / 2, -d / 2 + 2);
  pcb.closePath();
  const holes: V[] = [-w / 2 + 9, w / 2 - 9].flatMap((x) =>
    [-d / 2 + 9, ...(d > 200 ? [0] : []), d / 2 - 9].map((z) => [x, 1.05, z] as V),
  );
  for (const [x, , z] of holes) {
    const hole = new Path();
    hole.absarc(x, -z, 1.8, 0, Math.PI * 2, true);
    pcb.holes.push(hole);
    b.ring(2.6, 0.7, [x, 1.3, z], 'gold', [Math.PI / 2, 0, 0]);
  }
  const geometry = new ExtrudeGeometry(pcb, {
    depth: 1.5,
    bevelEnabled: true,
    bevelSize: 0.2,
    bevelThickness: 0.2,
    bevelSegments: 1,
    curveSegments: 12,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.8, 0);
  b.items.push({ geometry, finish: 'pcb', position: [0, 0, 0] });
  // Open socket retention frame, hinge and lever around the CPU substrate.
  b.box([55, 3.5, 55], [-20, 3, cpuZ], 'connector');
  for (const x of [-45, 5]) b.box([4, 2, 53], [x, 6, cpuZ], 'metal');
  for (const z of [cpuZ - 25, cpuZ + 25]) b.box([48, 2, 4], [-20, 6, z], 'metal');
  b.cylinder(1, 51, [9, 7, cpuZ], 'metal', 12, [Math.PI / 2, 0, 0]);
  b.box([9, 2, 3], [6, 7, cpuZ + 27], 'metal');
  const vrmZ = -d / 2 + 18;
  b.box([86, 7, 17], [-24, 6, vrmZ], 'aluminum', 1.2);
  b.box([18, 7, 72], [-69, 6, cpuZ], 'aluminum', 1.2);
  b.repeated(
    [1.2, 12, 16],
    Array.from({ length: 24 }, (_, i) => [-65 + i * 3.5, 13, vrmZ]),
    'aluminum',
  );
  b.repeated(
    [16, 12, 1.2],
    Array.from({ length: 21 }, (_, i) => [-69, 13, cpuZ - 32 + i * 3.2]),
    'aluminum',
  );
  b.repeated(
    [6.5, 5, 6.5],
    Array.from({ length: 8 }, (_, i) => [-49 + i * 10, 4.5, cpuZ - 36]),
    'connector',
  );
  b.repeated(
    [5, 1.3, 4],
    Array.from({ length: 8 }, (_, i) => [-49 + i * 10, 2, cpuZ - 44]),
    'chip',
  );
  const caps: V[] = Array.from({ length: 9 }, (_, i) => [-53 + i * 10, 5, cpuZ + 37]);
  b.repeated([4.2, 8, 4.2], caps, 'metal', true);
  b.repeated(
    [4.3, 1.8, 4.3],
    caps.map(([x, , z]) => [x, 1.8, z]),
    'black',
    true,
  );
  // DIMM channels, key and end clips. No claim about actual slot occupancy.
  for (let i = 0; i < sockets; i++) {
    const x = 48 + i * 13;
    b.box([7, 3, 139], [x, 3, cpuZ], i % 2 ? 'connector' : 'black');
    for (const sign of [-1, 1]) {
      b.box([2, 7, 132], [x + sign * 2.5, 7, cpuZ], 'connector', 0.25);
      b.box([8, 10, 6], [x, 8, cpuZ + sign * 69], 'connector', 0.6);
      b.box([4, 2, 4], [x, 13, cpuZ + sign * 70], 'metal', 0.2);
    }
    b.box([3, 4, 2], [x, 5, cpuZ + 11], 'black', 0.1);
  }
  const pcieZ = d / 2 - (d > 200 ? 104 : 27);
  for (let i = 0; i < (d > 200 ? 3 : 1); i++) {
    const z = pcieZ + i * 30,
      length = i === 1 ? 38 : 106;
    b.box([length, 3, 10], [-22, 3, z], 'black');
    for (const sign of [-1, 1])
      b.box([length, 7, 2.4], [-22, 7, z + sign * 3.5], i === 0 ? 'metal' : 'connector');
    b.box([8, 9, 9], [-22 + length / 2 + 3, 7, z], 'connector', 0.6);
    if (detail > 0)
      b.repeated(
        [0.5, 2, 0.6],
        Array.from({ length: Math.floor(length / 2) }, (_, n) => [
          -22 - length / 2 + n * 2 + 2,
          4.5,
          z - 1.4,
        ]),
        'gold',
      );
  }
  const mZ = pcieZ - 20;
  b.box([12, 4, 5], [-57, 3, mZ], 'connector', 0.25);
  for (const x of [-25, 3, 23]) {
    b.cylinder(2.5, 3, [x, 2.5, mZ], 'metal', 12);
    b.cylinder(1, 0.3, [x, 4.2, mZ], 'black', 8);
  }
  if (d > 200) {
    b.box([34, 6, 34], [63, 5, d / 2 - 57], 'aluminum', 1.2);
    b.repeated(
      [1.5, 3, 30],
      Array.from({ length: 10 }, (_, i) => [49 + i * 3, 9, d / 2 - 57]),
      'aluminum',
    );
  }
  function header(x: number, z: number, cols: number, rows: number, spacing: number, tall = false) {
    b.box(
      [cols * spacing + 3, tall ? 9 : 3, rows * spacing + 3],
      [x, tall ? 6 : 2.5, z],
      'black',
      0.5,
    );
    const pins: V[] = [];
    for (let col = 0; col < cols; col++)
      for (let row = 0; row < rows; row++) {
        const px = x + (col - (cols - 1) / 2) * spacing,
          pz = z + (row - (rows - 1) / 2) * spacing;
        if (tall) b.box([spacing - 0.9, 0.5, spacing - 0.9], [px, 10.7, pz], 'chip', 0);
        pins.push([px, tall ? 10.9 : 5, pz]);
      }
    b.repeated([0.7, tall ? 1 : 5, 0.7], pins, 'gold');
  }
  header(w / 2 - 15, cpuZ + 10, 2, 12, 4.2, true);
  header(-w / 2 + 28, -d / 2 + 11, 4, 2, 4.2, true);
  for (const [x, z] of [
    [w / 2 - 20, d / 2 - 15],
    [0, d / 2 - 12],
    [-40, d / 2 - 12],
    [30, -d / 2 + 14],
  ])
    header(x!, z!, 5, 2, 2.54);
  for (const [x, z] of [
    [w / 2 - 32, cpuZ + 62],
    [-43, cpuZ + 47],
  ])
    header(x!, z!, 4, 1, 2.54);
  if (d > 200)
    for (let i = 0; i < 4; i++) {
      b.box([14, 10, 11], [w / 2 - 10, 6, d / 2 - 94 + i * 14], 'connector', 0.5);
      b.box([0.3, 5, 8], [w / 2 - 2.8, 7, d / 2 - 94 + i * 14], 'chip', 0);
    }
  // Inset rear I/O apertures / USB tongues / audio jack bores.
  for (let i = 0; i < 5; i++) {
    const z = -d / 2 + 32 + i * 22;
    b.box([17, i === 3 ? 22 : 16, 19], [-w / 2 + 9, 10, z], 'metal', 0.8);
    for (const y of [6, 13]) {
      b.box([0.5, 5, 13], [-w / 2 + 0.1, y, z], 'chip', 0.1);
      b.box([1, 1.5, 10], [-w / 2 - 0.2, y, z], 'connector', 0.1);
    }
  }
  for (let i = 0; i < 3; i++) {
    const z = -d / 2 + 147 + i * 8;
    if (z < d / 2 - 10) {
      b.cylinder(3, 13, [-w / 2 + 8, 5, z], 'metal', 16, [0, 0, Math.PI / 2]);
      b.cylinder(1.7, 0.5, [-w / 2 + 1, 5, z], 'black', 12, [0, 0, Math.PI / 2]);
    }
  }
  b.cylinder(9.8, 3, [-72, 3, d / 2 - 33], 'metal', 24);
  b.ring(10.4, 0.8, [-72, 4, d / 2 - 33], 'connector', [Math.PI / 2, 0, 0]);
  const chips: V[] = [],
    tiny: V[] = [],
    pads: V[] = [];
  for (let i = 0; i < (detail === 2 ? 160 : detail === 1 ? 90 : 32); i++) {
    const x = -w / 2 + 28 + ((i % 10) * (w - 65)) / 10,
      z = cpuZ + 48 + Math.floor(i / 10) * 6;
    if (
      z > d / 2 - 12 ||
      Math.abs(z - pcieZ) < 8 ||
      Math.abs(z - (pcieZ + 30)) < 8 ||
      Math.abs(z - (pcieZ + 60)) < 8 ||
      (x > 38 && z < cpuZ + 72) ||
      (x > 40 && z > d / 2 - 78)
    )
      continue;
    tiny.push([x, 1.5, z]);
    pads.push([x - 1.4, 1.4, z], [x + 1.4, 1.4, z]);
    if (i % 9 === 0) chips.push([x + 4, 2, z + 2]);
  }
  b.repeated([2, 0.8, 1.1], tiny, 'connector');
  b.repeated([0.7, 0.3, 1.2], pads, 'metal');
  b.repeated([5, 1.8, 5], chips, 'chip');
  for (const [x, z] of [
    [-48, d / 2 - 22],
    [-94, pcieZ + 10],
    [23, d / 2 - 19],
  ]) {
    b.box([10, 1.8, 10], [x!, 2, z!], 'chip', 0.25);
    const leads: V[] = [];
    for (let n = 0; n < 8; n++)
      for (const side of [-1, 1]) leads.push([x! + side * 5.8, 1.3, z! - 3.5 + n]);
    b.repeated([2, 0.35, 0.45], leads, 'metal');
    b.box([3, 0.03, 0.4], [x!, 2.95, z!], 'ink', 0);
  }
  const audioCaps: V[] = Array.from({ length: 5 }, (_, i) => [
    -w / 2 + 18,
    4.5,
    pcieZ - 4 + i * 12,
  ]);
  b.repeated([4, 7, 4], audioCaps, 'metal', true);
  if (detail > 0) {
    const frontTraces: V[] = Array.from({ length: 28 }, (_, i) => [
      -50 + i * 2.3,
      1.05,
      d / 2 - 33,
    ]);
    b.repeated([0.3, 0.035, 18], frontTraces, 'trace');
    b.repeated(
      [13, 0.035, 0.3],
      frontTraces.map(([x, y, z]) => [x - 6, y, z - 9]),
      'trace',
    );
    b.text('CORTEX CORE', [-105, 1.16, d / 2 - 17], 0.7);
    b.text('GENERIC', [-33, 1.16, cpuZ + 33], 0.5);
    b.text('DIMM', [47, 1.16, cpuZ + 76], 0.5);
    b.repeated(
      [0.22, 0.04, 15],
      Array.from({ length: 24 }, (_, i) => [-10 + i * 1.1, 1.1, cpuZ + 38]),
      'trace',
    );
    b.repeated(
      [3, 0.06, 0.3],
      tiny.filter((_, i) => i % 3 === 0).map(([x, , z]) => [x, 1.15, z + 1.4]),
      'ink',
    );
    for (const x of [48, 61, 74, 87].slice(0, sockets))
      b.box([0.5, 0.06, 130], [x + 4.6, 1.1, cpuZ], 'ink', 0);
  }
  return b.finish();
}
export function deviceModel(
  device: Pick<DetectedVisual, 'category' | 'placement'> &
    Partial<Pick<DetectedVisual, 'name' | 'manufacturer' | 'storageFamily'>>,
  detail: number,
): Model {
  const b = new Builder();
  if (device.category === 'cpu') {
    const family = cpuIdentity(device.name ?? '', device.manufacturer).family;
    b.box([40, 1.3, 40], [0, 0, 0], 'substrate', 0.35);
    b.box([35, 1.8, 35], [0, 1.5, 0], 'metal', 0.9);
    if (family === 'amd') {
      // Ryzen-inspired scalloped heat spreader; illustrative, with no socket claim.
      b.box([27, 1.2, 35], [0, 2.8, 0], 'metal', 0.6);
      b.box([35, 1.2, 23], [0, 2.8, 0], 'metal', 0.6);
      for (const x of [-16, 16])
        for (const z of [-15.5, 15.5]) b.box([3, 1.2, 4], [x, 2.8, z], 'metal', 0.35);
    } else {
      // Intel-inspired continuous cap; unknown vendors retain the neutral template.
      b.box([31, 1.2, 31], [0, 2.8, 0], 'metal', 0.6);
      if (family === 'intel')
        for (const x of [-19, 19]) b.box([1.2, 0.8, 4], [x, 0.7, 0], 'gold', 0.15);
    }
    b.repeated(
      [1, 0.35, 1],
      Array.from({ length: 20 }, (_, i) => [((i % 10) - 4.5) * 3.2, 0.9, i < 10 ? -18 : 18]),
      'connector',
    );
  } else if (device.category === 'memory') {
    b.box([1.3, 31, 133], [0, 0, 0], 'substrate', 0.25);
    const chips: V[] = [];
    for (const side of [-1, 1])
      for (let i = 0; i < 8; i++) chips.push([side * 1.4, 2, -54 + i * 15.5]);
    b.repeated([1.7, 18, 12], chips, 'chip');
    b.box([2, 5, 5], [1.7, 10, 6], 'chip', 0.1);
    const contacts: V[] = [];
    for (const side of [-1, 1])
      for (let i = 0; i < (detail ? 62 : 31); i++) {
        const z = -61 + i * (detail ? 2 : 4);
        if (Math.abs(z - 11) > 2) contacts.push([side * 0.73, -12.5, z]);
      }
    b.repeated([0.15, 5, detail ? 1.3 : 2.3], contacts, 'gold');
    b.box([0.1, 6, 20], [2.32, 3, 0], 'ink', 0.01);
  } else if (device.category === 'gpu') {
    // Upright PCB, actual fan apertures, curved blades, fins and PCIe fingers.
    b.box([214, 91, 1.6], [0, 58, 0], 'pcb', 0.6);
    b.box([185, 84, 1.5], [4, 59, -3], 'aluminum', 0.6);
    b.box([88, 9, 1.3], [2, 11, 0], 'substrate', 0.1);
    b.repeated(
      [1.1, 7, 0.3],
      Array.from({ length: 48 }, (_, i) => [-40 + i * 1.8, 11, 1]),
      'gold',
    );
    b.repeated(
      [1.1, 72, 24],
      Array.from({ length: detail ? 48 : 24 }, (_, i) => [-93 + i * (detail ? 4 : 8), 58, 13]),
      'metal',
    );
    const shroud = new Shape();
    shroud.moveTo(-103, 16);
    shroud.lineTo(100, 16);
    shroud.lineTo(106, 23);
    shroud.lineTo(106, 96);
    shroud.lineTo(98, 102);
    shroud.lineTo(-103, 102);
    shroud.closePath();
    for (const x of [-53, 53]) {
      const hole = new Path();
      hole.absarc(x, 59, 35, 0, Math.PI * 2, true);
      shroud.holes.push(hole);
    }
    const geometry = new ExtrudeGeometry(shroud, {
      depth: 3,
      bevelEnabled: true,
      bevelSize: 0.7,
      bevelThickness: 0.6,
      bevelSegments: 1,
      curveSegments: detail === 2 ? 32 : 16,
    });
    b.items.push({ geometry, finish: 'black', position: [0, 0, 26] });
    for (const x of [-53, 53]) {
      b.ring(33.5, 1, [x, 59, 29], 'connector');
      for (let i = 0; i < 9; i++) {
        const blade = new Shape();
        blade.moveTo(7, -2);
        blade.quadraticCurveTo(18, -13, 30, -7);
        blade.lineTo(28, 3);
        blade.quadraticCurveTo(17, -1, 7, 3);
        blade.closePath();
        const g = new ExtrudeGeometry(blade, {
          depth: 1.3,
          bevelEnabled: false,
          curveSegments: detail ? 5 : 2,
        });
        b.items.push({
          geometry: g,
          finish: 'connector',
          position: [x, 59, 28],
          rotation: [0, 0, (i * Math.PI * 2) / 9],
        });
      }
      b.cylinder(8, 4, [x, 59, 31], 'black', 24, [Math.PI / 2, 0, 0]);
      b.cylinder(5, 0.5, [x, 59, 33.3], 'aluminum', 20, [Math.PI / 2, 0, 0]);
    }
    b.box([2, 111, 36], [-109, 55, 9], 'metal', 0.6);
    for (let i = 0; i < 3; i++) b.box([0.5, 9, 15], [-110.2, 26 + i * 24, 11], 'chip', 0.2);
    for (let i = 0; i < 6; i++) b.box([0.5, 2, 22], [-110.3, 91 + i * 3, 9], 'chip', 0.1);
    b.box([8, 2, 37], [-112, 112, 9], 'metal', 0.4);
    for (const y of [37, 78]) b.cylinder(2, 182, [0, y, 7], 'copper', 12, [0, 0, Math.PI / 2]);
    for (const x of [-40, 5, 48]) {
      const curve = new CatmullRomCurve3([
        new Vector3(x - 16, 20, 10),
        new Vector3(x - 16, 13, 14),
        new Vector3(x, 10, 18),
        new Vector3(x + 16, 13, 14),
        new Vector3(x + 16, 20, 10),
      ]);
      b.items.push({
        geometry: new TubeGeometry(curve, 16, 1.6, 6, false).toNonIndexed(),
        finish: 'copper',
        position: [0, 0, 0],
      });
    }
    b.box([14, 9, 12], [83, 94, 7], 'connector', 0.5);
    b.repeated(
      [3.5, 0.8, 3.5],
      [-80, 80].flatMap((x) => [26, 90].map((y) => [x, y, -4] as V)),
      'metal',
      true,
    );
  } else if (device.storageFamily === 'nvme' || device.placement === 'm2') {
    // 2280-inspired module: the protocol alone does not prove its actual form factor.
    b.box([80, 1.2, 22], [0, 0.6, 0], 'substrate', 0.15);
    b.repeated(
      [12, 1.5, 14],
      [-17, 0, 17].map((x) => [x, 1.95, 0]),
      'chip',
    );
    b.box([9, 1.5, 12], [-30, 1.95, 0], 'chip', 0.2);
    b.repeated(
      [5, 0.12, 0.8],
      Array.from({ length: 16 }, (_, i): V => [-37.5, 1.3, -9.5 + i * 1.2]).filter(
        (p) => p[2] < 3 || p[2] > 5,
      ),
      'gold',
    );
    b.ring(2.3, 0.6, [36, 1.26, 0], 'gold', [Math.PI / 2, 0, 0]);
    if (detail)
      b.repeated(
        [2, 0.8, 1],
        [-28, -24, 28, 31].map((x) => [x, 1.6, 8]),
        'metal',
      );
  } else if (device.storageFamily === 'hdd') {
    // Representative 3.5-inch enclosure proportions, scaled for the inventory tray.
    b.box([58, 15, 84], [0, 7.5, 0], 'aluminum', 0.8);
    b.box([56, 0.8, 82], [0, 15.4, 0], 'metal', 0.6);
    // Raised top-plate ribs, recessed screw collars, SATA-style connector hint.
    b.box([52, 0.35, 1], [0, 15.95, -35], 'aluminum', 0.1);
    for (const x of [-25, 25]) b.box([0.8, 0.35, 64], [x, 15.95, 0], 'aluminum', 0.1);
    const screws: V[] = [-24, 24].flatMap((x) => [-35, 0, 35].map((z) => [x, 16, z] as V));
    b.repeated([3.4, 0.45, 3.4], screws, 'connector', true);
    b.repeated([1.8, 0.55, 1.8], screws, 'metal', true);
    b.box([36, 5, 3], [0, 3, 42], 'connector', 0.1);
    b.repeated(
      [1, 2.5, 0.3],
      Array.from({ length: 20 }, (_, i) => [-15 + i * 1.5, 3, 43.6]),
      'gold',
    );
  } else if (device.storageFamily === 'sata-ssd') {
    // Thin 2.5-inch-style enclosure, distinct from the thicker metal HDD.
    b.box([42, 4.5, 60], [0, 2.25, 0], 'black', 0.7);
    b.box([40, 0.4, 58], [0, 4.65, 0], 'aluminum', 0.4);
    b.box([30, 2.6, 2.5], [0, 1.7, 30], 'connector', 0.1);
    b.repeated(
      [0.75, 1.5, 0.2],
      Array.from({ length: 20 }, (_, i) => [-13 + i * 1.25, 1.7, 31.3]),
      'gold',
    );
    b.repeated(
      [1.8, 0.35, 1.8],
      [-18, 18].flatMap((x) => [-26, 26].map((z) => [x, 4.95, z] as V)),
      'metal',
      true,
    );
  } else {
    // Neutral fallback avoids asserting media type or interface.
    b.box([58, 7, 43], [0, 4, 0], 'aluminum', 1.1);
    b.box([54, 0.7, 39], [0, 8, 0], 'black', 0.5);
    b.box([35, 0.1, 24], [0, 8.4, 0], 'connector', 0.1);
    b.repeated(
      [2, 0.5, 2],
      [-24, 24].flatMap((x) => [-16, 16].map((z) => [x, 8.5, z] as V)),
      'metal',
      true,
    );
  }
  return b.finish();
}
