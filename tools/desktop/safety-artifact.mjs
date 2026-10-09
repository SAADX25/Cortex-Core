import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function safetyArtifact() {
  const root = resolve('.');
  const baselineFiles = [
    'apps/desktop/src-tauri/src/lib.rs',
    'apps/desktop/src-tauri/build.rs',
    'apps/desktop/src-tauri/capabilities/main.json',
    'packages/application-ui/src/App.tsx',
    'packages/application-ui/src/icons.tsx',
    'tests/e2e/hardware.spec.ts',
    'tools/desktop/smoke.mjs',
  ];
  for (const file of baselineFiles)
    assert.deepEqual(
      readFileSync(file),
      execFileSync('git', ['show', `7e85677:${file}`]),
      `Update-10 mismatch: ${file}`,
    );
  const cargo = readFileSync('apps/desktop/src-tauri/Cargo.toml', 'utf8');
  assert(cargo.includes('default = ["custom-protocol"]'));
  assert(!cargo.includes('experimental-live-sensors'));
  const depInfo = readFileSync('apps/desktop/src-tauri/target/debug/cortex-core.d', 'utf8');
  assert(!/src[\\/]monitoring/i.test(depInfo), 'Monitoring appears in host build dependencies');
  const executable = resolve(root, 'apps/desktop/src-tauri/target/debug/Cortex Core.exe');
  const hash = createHash('sha256');
  // Native Monitoring command/event names must also be absent from this fresh binary.
  const markers = [
    'monitoring_snapshot',
    'set_monitoring_active',
    'monitoring-snapshot',
    'cortex-sensors',
    'nvmlDeviceGetTemperature',
  ];
  const descriptor = openSync(executable, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  let overlap = Buffer.alloc(0);
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      const window = Buffer.concat([overlap, chunk]);
      for (const marker of markers)
        assert(!window.includes(Buffer.from(marker)), `Unexpected Monitoring marker: ${marker}`);
      overlap = Buffer.from(window.subarray(-128));
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    executable,
    sha256: hash.digest('hex'),
    size: statSync(executable).size,
    modifiedAt: statSync(executable).mtime.toISOString(),
    baselineCommit: '7e85677',
    baselineFiles,
    monitoringBuildDependencies: [],
    monitoringCodeLoaded: 'none',
  };
}
