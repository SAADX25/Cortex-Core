import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assetManifestEntrySchema } from '../../packages/asset-runtime/src/manifest.ts';
const [, , input, metadataPath] = process.argv;
if (!input || !metadataPath)
  throw new Error('Usage: pnpm assets:optimize INPUT.glb LICENSE-METADATA.json');
const metadata = assetManifestEntrySchema.parse(JSON.parse(await readFile(metadataPath, 'utf8')));
if (metadata.kind !== 'glb') throw new Error('Expected a licensed GLB manifest entry');
const source = await readFile(input);
if (
  source.length !== metadata.bytes ||
  createHash('sha256').update(source).digest('hex') !== metadata.sha256
)
  throw new Error('Source GLB does not match its licensed manifest');
if (
  source.length < 20 ||
  source.readUInt32LE(0) !== 0x46546c67 ||
  source.readUInt32LE(4) !== 2 ||
  source.readUInt32LE(16) !== 0x4e4f534a
)
  throw new Error('Expected glTF 2.0 GLB');
const document = JSON.parse(source.subarray(20, 20 + source.readUInt32LE(12)).toString());
if (
  [...(document.buffers ?? []), ...(document.images ?? [])].some(
    (item) => item.uri && !item.uri.startsWith('data:'),
  )
)
  throw new Error('External resource URIs are unsupported; provide a self-contained GLB');
const hasTextures = (document.textures?.length ?? 0) > 0;
const output = resolve('output');
await mkdir(output, { recursive: true });
const optimized = join(output, 'optimized.glb');
// The CLI is invoked through Node rather than a platform shell; input paths remain literal arguments.
const cli = new URL('./node_modules/@gltf-transform/cli/bin/cli.js', import.meta.url);
const { fileURLToPath } = await import('node:url');
const execution = spawnSync(
  process.execPath,
  [
    fileURLToPath(cli),
    'optimize',
    resolve(input),
    optimized,
    '--compress',
    'meshopt',
    '--texture-compress',
    hasTextures ? 'ktx2' : 'false',
    '--texture-size',
    '2048',
    '--flatten',
    'false',
    '--join',
    'false',
    '--instance',
    'false',
    '--palette',
    'false',
    '--simplify',
    'false',
  ],
  { stdio: 'inherit' },
);
if (execution.error) throw execution.error;
if (execution.status !== 0)
  throw new Error(
    'Asset optimization failed. Install the documented KTX-Software encoder before retrying.',
  );
const data = await readFile(optimized);
const sha256 = createHash('sha256').update(data).digest('hex');
const file = `${sha256}.glb`;
await writeFile(join(output, file), data);
const entry = assetManifestEntrySchema.parse({
  ...metadata,
  sha256,
  bytes: data.length,
  compression: 'meshopt',
  textureEncoding: hasTextures ? 'ktx2' : 'none',
  modified: true,
  url: new URL(file, metadata.url).href,
});
await writeFile(join(output, `${sha256}.manifest.json`), JSON.stringify(entry, null, 2));
console.log(
  `Optimized licensed asset: ${file} (${data.length} bytes). Upload the hash-named asset and manifest to Supabase Storage.`,
);
