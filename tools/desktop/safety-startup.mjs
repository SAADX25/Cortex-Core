import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { safetyArtifact } from './safety-artifact.mjs';
const artifact = safetyArtifact();
const output = resolve('.artifacts/desktop-safety');
await mkdir(output, { recursive: true });
const reservation = createServer();
await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const began = Date.now();
const timeline = [];
const record = (event, details = {}) =>
  timeline.push({ elapsedSeconds: (Date.now() - began) / 1000, event, ...details });
let hostExit = null;
let hostStdout = '';
let hostStderr = '';
const child = spawn(artifact.executable, [], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: resolve(output, `startup-webview-${port}`),
  },
});
record('host-spawned', { pid: child.pid });
// Retain bounded failure evidence; this observer never queries a sensor.
child.stdout.on('data', (chunk) => {
  hostStdout = (hostStdout + chunk.toString()).slice(-32768);
});
child.stderr.on('data', (chunk) => {
  hostStderr = (hostStderr + chunk.toString()).slice(-32768);
});
child.on('exit', (code, signal) => {
  hostExit = { code, signal };
  record('host-exit', hostExit);
});
let launchError;
child.on('error', (error) => {
  launchError = error;
  record('host-error', { message: error.message });
});
const samples = [];
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    assert(child.exitCode === null, 'Host exited during startup');
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(500);
    }
  }
  assert(browser, 'WebView2 did not start');
  browser.on('disconnected', () => record('browser-disconnected'));
  let page;
  for (let i = 0; i < 40; i++) {
    page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('tauri.localhost'));
    if (page) break;
    assert(child.exitCode === null, 'Host exited before renderer became available');
    await delay(250);
  }
  assert(page, 'Embedded safety renderer missing');
  page.on('close', () => record('page-closed'));
  page.on('crash', () => record('page-crashed'));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record('page-navigation', { url: frame.url() });
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'My PC.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rescan Hardware', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link'),
  ).toHaveCount(3);
  const invoke = (name, args = {}) =>
    page.evaluate(
      ([command, parameters]) => globalThis.__TAURI_INTERNALS__.invoke(command, parameters),
      [name, args],
    );
  const status = await invoke('desktop_status');
  assert.equal(status.packaged, true); // Embedded assets, even though compiled in debug profile.
  const deniedCommands = [];
  for (const name of ['monitoring_snapshot', 'set_monitoring_active']) {
    const denied = await invoke(name, { active: false }).then(
      () => false,
      () => true,
    );
    assert(denied, 'Monitoring IPC unexpectedly registered');
    deniedCommands.push(name);
  }
  function sampleProcess() {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        resolve('tools/desktop/read-safety-process.ps1'),
        '-ProcessId',
        String(child.pid),
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const sample = JSON.parse(result.stdout);
    assert.equal(sample.executable.toLowerCase(), artifact.executable.toLowerCase());
    assert(
      sample.threads.every((t) => !t.error),
      'Thread metadata incomplete',
    );
    assert(
      !sample.threads.some((t) =>
        /cortex-sensors|sensor-(gpu|storage|cpu|motherboard|memory)-(ipc|reaper)/i.test(
          t.description,
        ),
      ),
      'Monitoring worker exists',
    );
    assert(
      !sample.modules.some((m) =>
        /^(nvml|LibreHardwareMonitor|OpenHardwareMonitor|WinRing0|inpout)/i.test(m.ModuleName),
      ),
      'Thermal/sensor library loaded',
    );
    samples.push(sample);
  }
  sampleProcess();
  console.log(
    'PASS startup: Update-10 routes; no compiled Monitoring code, IPC, named workers or sensor libraries',
  );
  const idleBegan = Date.now();
  while (Date.now() - idleBegan < 300_000) {
    await delay(30_000);
    assert(child.exitCode === null, 'Host exited during stability observation');
    assert.deepEqual(errors, []);
    await expect(
      page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link'),
    ).toHaveCount(3);
    const current = await invoke('desktop_status');
    assert.equal(current.appVersion, status.appVersion);
    sampleProcess();
    console.log(
      `PASS dormant idle observation: ${Math.floor((Date.now() - idleBegan) / 1000)} seconds`,
    );
  }
  const report = {
    artifact,
    status,
    deniedCommands,
    observationSeconds: (Date.now() - idleBegan) / 1000,
    monitoring: {
      codeLoaded: 'none',
      threads: 0,
      providers: 0,
      handles: 0,
      basis:
        'Host integration equals Update-10; no Monitoring build dependency or binary marker; IPC absent; passive process metadata agrees. Monitoring-owned handle count follows from no Monitoring code/provider existing, not from total OS handle count.',
    },
    samples,
    errors,
    timeline,
  };
  await writeFile(resolve(output, 'startup.json'), JSON.stringify(report, null, 2));
  console.log(
    'PASS five-minute safety-only startup observation; Monitoring threads/providers/handles = 0',
  );
} catch (error) {
  await writeFile(
    resolve(output, 'startup-failure.json'),
    JSON.stringify(
      {
        artifact,
        message: error.message,
        elapsedSeconds: (Date.now() - began) / 1000,
        hostExit,
        hostStdout,
        hostStderr,
        timeline,
        samples,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  child.kill();
}
