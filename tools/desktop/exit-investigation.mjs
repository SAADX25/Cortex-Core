import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { safetyArtifact } from './safety-artifact.mjs';

const mode = process.argv[2] ?? 'passive';
assert(['passive', 'extended'].includes(mode), 'Expected passive or extended');
const durationSeconds = mode === 'passive' ? 180 : 900;
const breakStderr = process.argv.includes('--break-stderr');
assert(!breakStderr || mode === 'passive', 'The broken-pipe check uses the passive mode');
const artifact = safetyArtifact();
const startedAt = new Date().toISOString();
const output = resolve('.artifacts/desktop-exit', `${startedAt.replaceAll(':', '-')}-${mode}`);
mkdirSync(output, { recursive: true });
const timelinePath = resolve(output, 'observer.jsonl');
const lifecyclePath = resolve(output, 'application.jsonl');
const began = Date.now();
let cleanupIntent = false;
let hostExit = null;
let hostClosed = false;
let browser;
let failure = null;
let launchError = null;
let samples = 0;
let status;
let deniedCommands;
let completedObservation = false;
const record = (event, details = {}) =>
  appendFileSync(
    timelinePath,
    JSON.stringify({
      timeUtc: new Date().toISOString(),
      elapsedMs: Date.now() - began,
      event,
      cleanupIntent,
      ...details,
    }) + '\n',
  );
const runPs = (script, args = []) => {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', resolve('tools/desktop', script), ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
let port = null;
if (mode === 'extended') {
  const reservation = createServer();
  await new Promise((ready, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', ready);
  });
  port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
}
const env = { ...process.env };
// Remove every casing before assigning Windows keys. No inherited debugger/session overrides.
for (const key of Object.keys(env)) {
  if (
    /^(WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS|WEBVIEW2_USER_DATA_FOLDER|CORTEX_LIFECYCLE_LOG)$/i.test(
      key,
    )
  )
    delete env[key];
}
env.WEBVIEW2_USER_DATA_FOLDER = resolve(output, 'webview');
env.CORTEX_LIFECYCLE_LOG = lifecyclePath;
if (port) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
const child = spawn(artifact.executable, [], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
record('host-spawn', {
  observerPid: process.pid,
  pid: child.pid,
  mode,
  port,
  artifact,
  durationSeconds,
});
const streamBytes = { stdout: 0, stderr: 0 };
const truncated = { stdout: false, stderr: false };
for (const name of ['stdout', 'stderr']) {
  writeFileSync(resolve(output, `${name}.log`), '');
  child[name].on('data', (chunk) => {
    const available = Math.max(0, 8 * 1024 * 1024 - streamBytes[name]);
    if (chunk.length > available) truncated[name] = true;
    if (available) appendFileSync(resolve(output, `${name}.log`), chunk.subarray(0, available));
    streamBytes[name] += chunk.length;
  });
}
child.on('error', (error) => {
  launchError = error;
  record('host-error', { message: error.message });
});
child.on('exit', (code, signal) => {
  hostExit = {
    code,
    signal,
    windowsCodeHex: code === null ? null : `0x${(code >>> 0).toString(16).padStart(8, '0')}`,
    timeUtc: new Date().toISOString(),
    elapsedMs: Date.now() - began,
    cleanupIntent,
  };
  record('host-exit', hostExit);
});
child.on('close', (code, signal) => {
  hostClosed = true;
  record('host-streams-closed', { code, signal });
});
function assertAlive() {
  if (launchError) throw launchError;
  assert(
    hostExit === null && child.exitCode === null && child.signalCode === null,
    `Unsolicited host exit: ${JSON.stringify(hostExit)}`,
  );
}
function nativeRows() {
  assert(existsSync(lifecyclePath), 'Lifecycle trace was not initialized');
  return readFileSync(lifecyclePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
function sample() {
  assertAlive();
  const args = ['-ProcessId', String(child.pid)];
  if (port) args.push('-CdpPort', String(port));
  const data = JSON.parse(runPs('read-safety-process.ps1', args));
  // Persist raw observations before assertions so a metadata/harness failure loses no evidence.
  appendFileSync(
    resolve(output, 'process-samples.jsonl'),
    JSON.stringify({ elapsedMs: Date.now() - began, ...data }) + '\n',
  );
  samples++;
  assert.equal(data.executable.toLowerCase(), artifact.executable.toLowerCase());
  assert(
    data.responding && data.mainWindowHandle !== 0,
    'Ordinary application window is unavailable or unresponsive',
  );
  assert(
    !data.modules.some((m) =>
      /^(nvml|LibreHardwareMonitor|OpenHardwareMonitor|WinRing0|inpout)/i.test(m.ModuleName),
    ),
    'Sensor library unexpectedly loaded',
  );
  assert(
    !data.threads.some((t) =>
      /cortex-sensors|sensor-(gpu|storage|cpu|motherboard|memory)-(ipc|reaper)/i.test(
        t.description ?? '',
      ),
    ),
    'Monitoring worker unexpectedly running',
  );
  const rows = nativeRows();
  assert(
    !rows.some((row) =>
      ['rust-panic', 'webview-process-failed', 'webview-hooks-error'].includes(row.event),
    ),
    'Native lifecycle/WebView fault captured',
  );
  const hook = rows.find((row) => row.event === 'webview-process-hooks-attached');
  assert(hook, 'Native WebView process hooks did not attach');
  if (port) {
    assert(data.debuggerListeners.length > 0, 'Owned WebView debugger listener is missing');
    assert(
      data.debuggerListeners.every(
        (listener) => listener.OwningProcess === hook.details.browserPid,
      ),
      'CDP listener belongs to another process',
    );
  }
}
async function attach() {
  record('observer-attach-begin', { port });
  const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: globalThis.AbortSignal.timeout(5000),
  });
  assert(response.ok, 'Debugger version endpoint unavailable');
  record('debugger-version', { version: await response.json() });
  const connected = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
  connected.on('disconnected', () => record('webview-cdp-disconnected'));
  const contexts = connected.contexts();
  assert.equal(contexts.length, 1, 'Expected only the owned WebView context');
  const pages = contexts[0].pages();
  assert.equal(pages.length, 1, 'Expected only the owned Cortex WebView page');
  const page = pages[0];
  assert(new URL(page.url()).hostname === 'tauri.localhost', 'Unexpected debugger target');
  page.setDefaultTimeout(10000);
  page.on('close', () => record('webview-page-close'));
  page.on('crash', () => record('webview-page-crash'));
  page.on('pageerror', (error) => record('webview-page-error', { message: error.message }));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record('webview-navigation', { url: frame.url() });
  });
  record('observer-attached', { url: page.url() });
  return { connected, page };
}
try {
  // A bounded readiness wait, then no observer/browser intervention during the passive run.
  await delay(8000);
  assertAlive();
  sample();
  assert(
    nativeRows().some((row) => row.event === 'application-ready'),
    'Application-ready event missing',
  );
  if (breakStderr) {
    assert(
      nativeRows().some(
        (row) => row.event === 'trace-enabled' && row.details.stderrWriteErrors === 'ignored',
      ),
      'Broken-pipe-safe diagnostic build required',
    );
    record('planned-stderr-reader-close');
    child.stderr.destroy();
  }
  let page;
  if (port) {
    ({ connected: browser, page } = await attach());
    await expect(page.getByRole('heading', { name: 'My PC.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rescan Hardware', exact: true })).toBeEnabled({
      timeout: 30000,
    });
    status = await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('desktop_status'));
    deniedCommands = await page.evaluate(async () => {
      const results = [];
      for (const command of ['monitoring_snapshot', 'set_monitoring_active']) {
        results.push({
          command,
          denied: await globalThis.__TAURI_INTERNALS__.invoke(command, { active: false }).then(
            () => false,
            () => true,
          ),
        });
      }
      return results;
    });
    assert(
      deniedCommands.every((result) => result.denied),
      'Monitoring IPC registered',
    );
  }
  let runtimeOpened = false;
  let runtimeClosed = false;
  let reattached = false;
  while (Date.now() - began < durationSeconds * 1000) {
    await delay(30000);
    assertAlive();
    const elapsed = (Date.now() - began) / 1000;
    sample();
    if (page) {
      await expect(
        page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link'),
      ).toHaveCount(3);
      const current = await page.evaluate(() =>
        globalThis.__TAURI_INTERNALS__.invoke('desktop_status'),
      );
      assert.equal(current.appVersion, status.appVersion);
      if (!runtimeOpened && elapsed >= 240) {
        record('planned-ui-interaction', { action: 'open-3d-view' });
        await page
          .getByRole('navigation', { name: 'Primary navigation' })
          .getByRole('link', { name: '3D View', exact: true })
          .click();
        runtimeOpened = true;
      } else if (runtimeOpened && !runtimeClosed && elapsed >= 330) {
        record('planned-ui-interaction', { action: 'settings-then-my-pc' });
        await page
          .getByRole('navigation', { name: 'Primary navigation' })
          .getByRole('link', { name: 'Settings', exact: true })
          .click();
        await page
          .getByRole('navigation', { name: 'Primary navigation' })
          .getByRole('link', { name: 'My PC', exact: true })
          .click();
        runtimeClosed = true;
      }
      if (!reattached && elapsed >= 450) {
        record('planned-debugger-detach');
        await browser.close();
        browser = null;
        page = null;
        await delay(10000);
        assertAlive();
        sample();
        record('planned-debugger-reattach');
        ({ connected: browser, page } = await attach());
        reattached = true;
      }
    }
    record('heartbeat', { samples, elapsedSeconds: Math.floor(elapsed) });
    console.log(`PASS ${mode}: ${Math.floor(elapsed)} seconds; host responsive; Monitoring absent`);
  }
  completedObservation = true;
} catch (error) {
  failure = { message: error.message, stack: error.stack, timeUtc: new Date().toISOString() };
  record('observation-failed', failure);
} finally {
  // Record intent before any cleanup; never mislabel our close as an unexplained exit.
  if (hostExit === null && child.exitCode === null && child.signalCode === null) {
    cleanupIntent = true;
    record('planned-normal-window-close');
    try {
      record('normal-close-result', {
        result: runPs('close-safety-process.ps1', ['-ProcessId', String(child.pid)]).trim(),
      });
    } catch (error) {
      record('normal-close-error', { message: error.message });
    }
    for (let i = 0; i < 100 && hostExit === null; i++) await delay(100);
    if (hostExit === null) {
      record('forced-owned-host-cleanup');
      child.kill();
      failure ??= {
        message: 'Normal window close did not terminate the host',
        timeUtc: new Date().toISOString(),
      };
    }
  }
  for (let i = 0; i < 50 && !hostClosed; i++) await delay(100);
  record('observer-cleanup-begin');
  await browser
    ?.close()
    .catch((error) => record('observer-cleanup-error', { message: error.message }));
  const endedAt = new Date().toISOString();
  const eventsPath = resolve(output, 'windows-events.json');
  try {
    runPs('read-exit-events.ps1', [
      '-StartUtc',
      startedAt,
      '-EndUtc',
      endedAt,
      '-OutputPath',
      eventsPath,
    ]);
  } catch (error) {
    record('event-correlation-error', { message: error.message });
    failure ??= { message: 'Windows event correlation unavailable', timeUtc: endedAt };
  }
  const report = {
    observerPid: process.pid,
    artifact,
    mode,
    breakStderr,
    startedAt,
    endedAt,
    requiredObservationSeconds: durationSeconds,
    completedObservation,
    failure,
    hostExit,
    hostClosed,
    streamBytes,
    truncated,
    processSamples: samples,
    status,
    deniedCommands,
    monitoring: { codeLoaded: 'none', threads: 0, providers: 0, handles: 0 },
    output,
    lifecycle: existsSync(lifecyclePath) ? nativeRows() : [],
    windowsEvents: existsSync(eventsPath)
      ? JSON.parse(readFileSync(eventsPath, 'utf8').replace(/^\uFEFF/, ''))
      : null,
  };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(`Evidence preserved: ${output}`);
  if (
    failure ||
    !completedObservation ||
    !hostExit?.cleanupIntent ||
    hostExit.code !== 0 ||
    hostExit.signal !== null
  )
    process.exitCode = 1;
}
