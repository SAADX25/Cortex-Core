// Compiles the new adapter alone with serde. Tests use bytes and mock state only.
// Never launches Cortex, calls networking inventory, connects HTTP or probes hardware.
import { spawnSync } from 'node:child_process';
import { resolve, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { verifyExternalSensorIsolation } from './verify-external-sensor-isolation.mjs';
const root = resolve('.');
verifyExternalSensorIsolation(root);
const local = resolve(root, '.toolchains/cargo/bin');
const env = { ...process.env, CARGO_BUILD_JOBS: '1', RUST_TEST_THREADS: '1' };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const inherited = env[pathKey];
delete env[pathKey];
env.PATH = inherited;
let cargo = 'cargo';
if (existsSync(resolve(local, 'cargo.exe'))) {
  cargo = resolve(local, 'cargo.exe');
  env.CARGO_HOME = resolve(root, '.toolchains/cargo');
  env.RUSTUP_HOME = resolve(root, '.toolchains/rustup');
  env.PATH = local + delimiter + inherited;
}
const result = spawnSync(
  cargo,
  [
    'test',
    '--locked',
    '--offline',
    '--manifest-path',
    'tools/desktop/sensor-tests/Cargo.toml',
    '--target-dir',
    '.artifacts/external-sensor-tests',
    '--',
    '--test-threads=1',
  ],
  { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 180_000 },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
