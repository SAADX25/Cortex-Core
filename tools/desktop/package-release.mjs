import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const directory = resolve('apps/desktop/src-tauri/target/release');
const output = resolve('release/windows-x64');
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
await mkdir(output, { recursive: true });
const installer = (await readdir(resolve(directory, 'bundle/nsis'))).find(
  (file) => file.endsWith('-setup.exe') && file.includes(`_${version}_`),
);
if (!installer) throw new Error('NSIS installer missing');
const rows = [];
for (const [source, name] of [
  [resolve(directory, 'Cortex Core.exe'), 'Cortex Core.exe'],
  [resolve(directory, 'bundle/nsis', installer), `Cortex Core-${version}-development-setup.exe`],
]) {
  const data = await readFile(source);
  await copyFile(source, resolve(output, name));
  rows.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(
  resolve(output, 'manifest.json'),
  JSON.stringify(
    {
      applicationVersion: version,
      catalogVersion: '2026.10.07.1',
      assetManifestVersion: 1,
      target: 'Windows x64',
      signing: 'Unsigned development build',
      files: rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(rows, null, 2));
