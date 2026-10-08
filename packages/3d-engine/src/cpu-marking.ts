import { CanvasTexture, SRGBColorSpace } from 'three';
import { cpuIdentity } from './cpu-identity';

/** One small, local decal per mounted CPU, independent of quality/LOD changes. */
export function createCpuMarking(name: string, manufacturer?: string) {
  const identity = cpuIdentity(name, manufacturer);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#283238';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '600 42px sans-serif';
  context.fillText(
    identity.family === 'intel' ? 'INTEL' : identity.family === 'amd' ? 'AMD RYZEN' : 'CPU',
    256,
    106,
  );
  context.fillRect(96, 158, 320, 2);
  let lines: string[] = [];
  let fontSize = 36;
  for (; fontSize >= 12; fontSize -= 2) {
    context.font = `500 ${fontSize}px sans-serif`;
    lines = [''];
    // Character wrapping also handles unusually long system-reported tokens.
    for (const character of name) {
      const last = lines.length - 1;
      const candidate = lines[last] + character;
      if (context.measureText(candidate).width > 380) {
        const boundary = candidate.lastIndexOf(' ');
        if (boundary > 0) {
          lines[last] = candidate.slice(0, boundary + 1);
          lines.push(candidate.slice(boundary + 1));
        } else lines.push(character);
      } else lines[last] = candidate;
    }
    if (lines.length * fontSize * 1.3 <= 176) break;
  }
  lines.forEach((line, index) =>
    context.fillText(line, 256, 264 + (index - (lines.length - 1) / 2) * fontSize * 1.3),
  );
  context.font = '400 18px sans-serif';
  context.fillStyle = '#586268';
  context.fillText('GENERIC VISUALIZATION', 256, 411);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.userData = { cpuLabel: name, cpuFamily: identity.family };
  return texture;
}
