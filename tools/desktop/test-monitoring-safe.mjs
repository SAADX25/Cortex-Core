// Compiles only the small std-only controller and a hardware-free IPC stub.
// Does NOT invoke Cargo, Tauri, the app, WMI, NVML, storage APIs or any live provider.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUpdate10Integration } from './safety-artifact.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = [
  'apps/desktop/src-tauri/src/lib.rs',
  'apps/desktop/src-tauri/build.rs',
  'apps/desktop/src-tauri/capabilities/main.json',
  'packages/application-ui/src/App.tsx',
  'packages/application-ui/src/icons.tsx',
  'tests/e2e/hardware.spec.ts',
  'tools/desktop/smoke.mjs',
];
for (const file of baseline) verifyUpdate10Integration(file, root);
const cargo = readFileSync(resolve(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
assert(!cargo.includes('experimental-live-sensors'));
assert(cargo.includes('required-features = ["monitoring-diagnostics"]'));
assert(!existsSync(resolve(root, 'apps/desktop/src-tauri/src/monitoring.rs')));
assert(!existsSync(resolve(root, 'apps/desktop/src-tauri/src/monitoring/windows_providers.rs')));
const output = resolve(root, '.artifacts/monitoring-safe');
mkdirSync(output, { recursive: true });
const extension = process.platform === 'win32' ? '.exe' : '';
const helper = resolve(output, `mock-sensor-helper${extension}`);
const env = { ...process.env, CORTEX_MOCK_HELPER: helper };
const local = resolve(root, '.toolchains/cargo/bin');
const compiler = existsSync(resolve(local, `rustc${extension}`))
  ? resolve(local, `rustc${extension}`)
  : 'rustc';
if (compiler !== 'rustc') {
  env.CARGO_HOME = resolve(root, '.toolchains/cargo');
  env.RUSTUP_HOME = resolve(root, '.toolchains/rustup');
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const inheritedPath = env[pathKey];
  delete env[pathKey];
  env.PATH = local + delimiter + inheritedPath;
}
function run(command, args, quiet = false, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, 'Mock-only verification failed');
  return result;
}
const flags = ['--edition=2024', '-C', 'opt-level=0', '-C', 'debuginfo=0'];
run(compiler, [...flags, 'tools/desktop/mock-sensor-helper.rs', '-o', helper]);
const tests = resolve(output, `isolated-tests${extension}`);
run(compiler, [
  ...flags,
  '--test',
  'apps/desktop/src-tauri/src/monitoring/isolated.rs',
  '-o',
  tests,
]);
run(tests, ['--test-threads=1']);
const diagnostic = resolve(output, `monitoring-diagnostic${extension}`);
run(compiler, [...flags, 'apps/desktop/src-tauri/src/monitoring-diagnostic.rs', '-o', diagnostic]);
const categories = ['gpu', 'storage', 'cpu', 'motherboard', 'memory'];
const dormantOutput = categories
  .map((category) => `[ ] ${category}: Dormant; Not reported by hardware`)
  .join('\n');
assert.equal(run(diagnostic, [], true).stdout.trim(), dormantOutput);
for (const category of categories) {
  const result = run(diagnostic, ['--provider', category], true);
  assert.equal(result.stdout.trim(), dormantOutput);
  assert(result.stderr.includes('Unavailable; live adapters remain quarantined'));
}
run(diagnostic, ['--provider', 'gpu', '--provider', 'storage'], true, 2);
run(diagnostic, ['--provider', 'unknown'], true, 2);
const releaseAttempt = run(
  compiler,
  [
    ...flags,
    '-C',
    'debug-assertions=no',
    'apps/desktop/src-tauri/src/monitoring-diagnostic.rs',
    '-o',
    resolve(output, `forbidden-release${extension}`),
  ],
  true,
  1,
);
assert(releaseAttempt.stderr.includes('Monitoring diagnostics may not be built for release'));
console.log(
  'PASS: Update-10 integration preserved; mock-only isolation checks completed; no live adapter available.',
);
