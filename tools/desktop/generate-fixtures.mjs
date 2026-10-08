import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixtureCatalog } from '../../packages/data-access/src/fixtures.ts';
const directory = new URL('../../apps/desktop/src-tauri/resources/', import.meta.url);
await mkdir(directory, { recursive: true });
const destination = new URL('catalog-fixture.json', directory);
const generated =
  JSON.stringify(
    {
      schemaVersion: 1,
      catalogVersion: '2026.10.07.1',
      assetManifestVersion: 1,
      origin: 'development-fixtures',
      publishedAt: '2026-10-07T00:00:00Z',
      parts: fixtureCatalog,
    },
    null,
    2,
  ) + '\n';
if (process.argv.includes('--check')) {
  // Git may check out LF files as CRLF on Windows; content must still match exactly.
  if ((await readFile(destination, 'utf8')).replaceAll('\r\n', '\n') !== generated)
    throw new Error('Native bundled fixtures are stale; run tools/desktop/generate-fixtures.mjs.');
  console.log('Native catalog fixtures match the shared schema fixtures.');
} else await writeFile(destination, generated);
