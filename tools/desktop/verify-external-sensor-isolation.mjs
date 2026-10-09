import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function verifyExternalSensorIsolation(root = resolve('.')) {
  const read = (path) => readFileSync(resolve(root, path), 'utf8');
  const lib = read('apps/desktop/src-tauri/src/lib.rs');
  assert(lib.includes('mod external_sensors;'));
  assert(!/mod monitoring\b|windows_providers|quarantine\/|\.disabled/.test(lib));
  assert(!existsSync(resolve(root, 'apps/desktop/src-tauri/src/monitoring.rs')));
  assert(!existsSync(resolve(root, 'apps/desktop/src-tauri/src/monitoring/windows_providers.rs')));
  const adapter = read('apps/desktop/src-tauri/src/external_sensors.rs');
  assert(!/wmi::|nvml|DeviceIoControl|LibreHardwareMonitorLib|Command::|LoadLibrary/.test(adapter));
  assert(adapter.includes('GET /data.json HTTP/1.1'));
  assert(!adapter.includes('GET /Sensor') && !adapter.includes('POST /'));
  assert(adapter.includes('127.0.0.1:8085/data.json'));
  assert(adapter.includes('enabled: false'));
  const ui = read('packages/application-ui/src/Monitoring.tsx');
  assert(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(ui));
  assert(!read('apps/desktop/src-tauri/Cargo.toml').includes('experimental-live-sensors'));
}
