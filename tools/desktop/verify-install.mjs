import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const standalone = await readFile(resolve('release/windows-x64/Cortex Core.exe'));
const installed = await readFile(
  process.env.CORTEX_DESKTOP_EXE ?? resolve('.artifacts/desktop/installed/Cortex Core.exe'),
);
const expected = Buffer.from(standalone);
const marker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
const offset = expected.indexOf(marker);
if (!standalone.equals(installed)) {
  // Tauri's bundler stamps the embedded NSIS copy, then restores the standalone
  // binary. Official tauri-utils::platform defines the UNK/NSS marker values.
  assert(
    offset >= 0 && expected.indexOf(marker, offset + 1) < 0,
    'Expected unique Tauri bundle marker',
  );
  Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS').copy(expected, offset);
  assert(expected.equals(installed), 'Installed executable differs beyond Tauri NSIS metadata');
}
const report = {
  executableVerified: true,
  bytes: installed.length,
  installedSha256: createHash('sha256').update(installed).digest('hex'),
  standaloneSha256: createHash('sha256').update(standalone).digest('hex'),
  bundleMetadata: standalone.equals(installed)
    ? 'Identical'
    : 'Only Tauri UNK → NSS marker differs (3 bytes)',
};
await writeFile(
  resolve('.artifacts/desktop/installed-binary.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
