// Evidence collection only. This script never starts the built executable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const target = resolve('.artifacts/safe-mode-build/debug');
const exe = ['Cortex Core.exe', 'cortex-core.exe']
  .map((name) => join(target, name))
  .find(existsSync);
assert(exe, 'Build-only Safe Mode executable required');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fingerprintRoot = join(target, '.fingerprint');
const folders = readdirSync(fingerprintRoot);
assert(!folders.some((name) => /^wmi-/.test(name)), 'WMI must be absent from this isolated build');
const fingerprints = folders
  .filter((name) => name.startsWith('cortex-core-desktop-'))
  .map((name) => join(fingerprintRoot, name, 'lib-cortex_core_desktop.json'))
  .filter(existsSync);
assert(fingerprints.length, 'Native library fingerprint required');
for (const file of fingerprints) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(JSON.parse(data.features).sort(), ['custom-protocol', 'safe-mode']);
}
const dependencies = join(target, 'deps', 'cortex_core_desktop.d');
const compiled = readFileSync(dependencies, 'utf8');
for (const source of [
  'safe_mode.rs',
  'hardware_types.rs',
  'hardware_disabled.rs',
  'external_sensors_disabled.rs',
])
  assert(compiled.includes(source), `Compiled source required: ${source}`);
for (const source of ['hardware.rs', 'external_sensors.rs', 'windows_providers.rs'])
  assert(
    !new RegExp(`[/\\\\]${source.replaceAll('.', '\\.')}(?:\\s|:|$)`).test(compiled),
    `Excluded source present: ${source}`,
  );
const assets = resolve('apps/web/dist/assets');
assert(
  readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .some((name) => readFileSync(join(assets, name), 'utf8').includes('get_runtime_policy')),
  'Guarded renderer must be built',
);
const sourceFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((file) => file && existsSync(file))
  .sort();
const sources = Object.fromEntries(sourceFiles.map((file) => [file, digest(file)]));
const evidence = {
  test: 'Test 2 pre-launch isolation',
  recordedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeChanged: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  executable: exe,
  executableSha256: digest(exe),
  features: ['custom-protocol', 'safe-mode'],
  fingerprints: Object.fromEntries(fingerprints.map((file) => [file, digest(file)])),
  compiledDependencyFile: dependencies,
  compiledDependencySha256: digest(dependencies),
  realProviderSourcesExcluded: true,
  wmiDependencyAbsent: true,
  applicationLaunched: false,
  hardwareRequestsPerformed: false,
  observationStatus: 'Awaiting explicit launch approval',
  sources,
};
writeFileSync(
  '.artifacts/test-2-preflight/build-evidence.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      executable: exe,
      sha256: evidence.executableSha256,
      features: evidence.features,
      excluded: ['hardware.rs', 'external_sensors.rs', 'WMI dependency'],
      launched: false,
    },
    null,
    2,
  ),
);
