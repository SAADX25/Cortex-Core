// Static boundary audit only. Never launches Cortex Core or contacts a hardware source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyExternalSensorIsolation } from './verify-external-sensor-isolation.mjs';
const read = (p) => readFileSync(p, 'utf8');
verifyExternalSensorIsolation();
const lib = read('apps/desktop/src-tauri/src/lib.rs');
for (const module of ['hardware', 'external_sensors']) {
  assert(
    lib.includes(
      `#[cfg(all(not(feature = "safe-mode"), feature = "hardware-discovery"))]\nmod ${module};`,
    ),
  );
  assert(
    lib.includes(
      `#[cfg(any(feature = "safe-mode", not(feature = "hardware-discovery")))]\n#[path = "${module}_disabled.rs"]\nmod ${module};`,
    ),
  );
}
for (const command of [
  'scan_hardware',
  'load_hardware_scan',
  'open_external_sensor_session',
  'read_external_sensors',
]) {
  const body = lib.slice(lib.indexOf(`fn ${command}(`));
  assert.match(body, /\) -> Result<[^]*?\{\s*safe_mode::require_access\(\)\?;/);
}
assert.match(
  lib.slice(lib.indexOf('fn configure_external_sensors(')),
  /if consent\s*\{\s*safe_mode::require_access\(\)\?;/,
);
for (const p of [
  'hardware_disabled.rs',
  'external_sensors_disabled.rs',
  'hardware_types.rs',
  'safe_mode.rs',
]) {
  assert(
    !/WMIConnection|CreateDXGIFactory|DXCoreCreate|TcpStream|GetExtendedTcpTable|DeviceIoControl|LoadLibraryW|Command::/.test(
      read(`apps/desktop/src-tauri/src/${p}`),
    ),
  );
}
assert.match(
  read('packages/application-ui/src/hardware-store.ts'),
  /createHardwareStore\(\s*guardHardwareBridge\(/,
);
assert.match(read('packages/application-ui/src/Monitoring.tsx'), /guardSensorBridge\(\s*\{/);
assert(
  read('tools/desktop/run.mjs')
    .replace(/\s+/g, '')
    .includes(
      "['build','--debug','--no-bundle','--features','custom-protocol,safe-mode','--','--no-default-features','--locked','--offline',]",
    ),
);
assert(read('apps/desktop/src-tauri/Cargo.toml').includes('optional = true'));
console.log(
  'PASS: native compile gates, IPC guards, provider-free stubs, guarded frontend, quarantine and build-only command',
);
