import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assetManifestEntrySchema } from '@cortex/asset-runtime';

it('optimizes an original texture-free GLB with Meshopt and preserves its semantic anchor', async () => {
  const parent = resolve('.test-artifacts');
  await mkdir(parent, { recursive: true });
  const temp = await mkdtemp(join(parent, 'pipeline-'));
  if (!resolve(temp).startsWith(parent + sep)) throw new Error('Unsafe test artifact target');
  try {
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const document = {
      asset: { version: '2.0', generator: 'Cortex Core original test fixture' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, extras: { semanticId: 'test.triangle' } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: positions.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(document));
    const json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + json.length + 8 + positions.length, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(json.length);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(positions.length);
    binHeader.writeUInt32LE(0x004e4942, 4);
    const glb = Buffer.concat([header, jsonHeader, json, binHeader, positions]);
    const sourcePath = join(temp, 'original.glb');
    const manifestPath = join(temp, 'license.json');
    await writeFile(sourcePath, glb);
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: 'test.triangle',
        kind: 'glb',
        source: 'Original unit-test triangle',
        author: 'Cortex Core contributors',
        license: 'MIT',
        licenseUrl: 'https://opensource.org/license/mit',
        allowedUse: ['commercial', 'redistribution', 'modification'],
        modified: false,
        url: 'https://example.org/assets/original.glb',
        sha256: createHash('sha256').update(glb).digest('hex'),
        bytes: glb.length,
        compression: 'none',
        textureEncoding: 'none',
        lod: 0,
      }),
    );
    const execution = spawnSync(
      process.execPath,
      [resolve('tools/asset-pipeline/optimize.mjs'), sourcePath, manifestPath],
      { cwd: temp, encoding: 'utf8', timeout: 30000 },
    );
    expect(execution.error).toBeUndefined();
    expect(execution.status, execution.stdout + execution.stderr).toBe(0);
    const files = await readdir(join(temp, 'output'));
    const manifestFile = files.find((file) => file.endsWith('.manifest.json'));
    expect(manifestFile).toBeDefined();
    const manifest = assetManifestEntrySchema.parse(
      JSON.parse(await readFile(join(temp, 'output', manifestFile!), 'utf8')),
    );
    if (manifest.kind !== 'glb') throw new Error('Expected GLB output');
    const output = await readFile(join(temp, 'output', `${manifest.sha256}.glb`));
    expect(createHash('sha256').update(output).digest('hex')).toBe(manifest.sha256);
    const outputDocument = JSON.parse(
      output.subarray(20, 20 + output.readUInt32LE(12)).toString(),
    ) as { nodes: { extras?: { semanticId?: string } }[]; extensionsUsed?: string[] };
    expect(outputDocument.nodes.some((node) => node.extras?.semanticId === 'test.triangle')).toBe(
      true,
    );
    expect(outputDocument.extensionsUsed).toContain('EXT_meshopt_compression');
  } finally {
    // Only remove our verified mkdtemp child inside the workspace artifact directory.
    await rm(temp, { recursive: true, force: true });
  }
}, 45000);
