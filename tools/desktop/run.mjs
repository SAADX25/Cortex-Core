import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mode = process.argv[2];
const env = { ...process.env };
// Keep local Rust builds within modest-memory Windows machines; callers may opt into more jobs.
env.CARGO_BUILD_JOBS ??= '1';
env.RUST_TEST_THREADS ??= '1';
// Windows environment keys are case-insensitive, but spawn deduplicates them.
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const inheritedPath = env[pathKey];
delete env[pathKey];
env.PATH = inheritedPath;
const local = resolve(root, '.toolchains/cargo/bin');
if (existsSync(resolve(local, process.platform === 'win32' ? 'cargo.exe' : 'cargo'))) {
  env.CARGO_HOME = resolve(root, '.toolchains/cargo');
  env.RUSTUP_HOME = resolve(root, '.toolchains/rustup');
  env.PATH = local + delimiter + env.PATH;
}
const cwd = resolve(root, 'apps/desktop');
let execution;
if (mode.startsWith('rust-')) {
  const args =
    mode === 'rust-test'
      ? ['test', '--locked']
      : mode === 'rust-fmt'
        ? ['fmt', '--check']
        : ['check', '--locked'];
  execution = spawnSync('cargo', args, { cwd: resolve(cwd, 'src-tauri'), env, stdio: 'inherit' });
} else {
  const cli = resolve(cwd, 'node_modules/@tauri-apps/cli/tauri.js');
  const cliArgs =
    mode === 'safety-build'
      ? ['build', '--debug', '--no-bundle']
      : [mode, ...process.argv.slice(3)];
  execution = spawnSync(process.execPath, [cli, ...cliArgs], {
    cwd,
    env,
    stdio: 'inherit',
  });
}
if (execution.error) throw execution.error;
process.exitCode = execution.status ?? 1;
