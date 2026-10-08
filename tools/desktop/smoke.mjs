import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:net';
import { parseHardwareScan } from '../../packages/application-ui/src/hardware.ts';
import {
  motionProbeScript,
  metrics,
  motionProfiles,
  motionCycles,
  idle,
  scrubMotion,
} from '../../tests/motion-probe.ts';
import { cpuIdentity } from '../../packages/3d-engine/src/cpu-identity.ts';
if (process.platform !== 'win32') throw new Error('This smoke runner targets Windows WebView2.');
const development = process.argv.includes('--development');
const output = resolve('.artifacts/desktop');
await mkdir(output, { recursive: true });
const executable =
  process.env.CORTEX_DESKTOP_EXE ??
  resolve(
    development
      ? 'apps/desktop/src-tauri/target/debug/cortex-core.exe'
      : 'apps/desktop/src-tauri/target/release/Cortex Core.exe',
  );
// A fresh port prevents attaching to a retired WebView2 from an earlier failed run.
const reservation = createServer();
await new Promise((ready, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', ready);
});
const availablePort = reservation.address().port;
await new Promise((done, reject) => reservation.close((error) => (error ? reject(error) : done())));
const port = Number(process.env.CORTEX_CDP_PORT ?? availablePort);
// CDP is supplied only to the test child. Shipped settings never enable debugging.
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: resolve(output, `hardware-webview-${port}`),
  },
  stdio: 'ignore',
  windowsHide: true,
});
let launchError;
let childExit;
child.on('exit', (code, signal) => {
  childExit = { code, signal };
});
child.on('error', (error) => {
  launchError = error;
});
let browser;
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(500);
    }
  }
  assert(browser, 'Native WebView2 did not become available');
  const context = browser.contexts()[0];
  context.setDefaultTimeout(15000);
  let page;
  for (let i = 0; i < 40; i++) {
    page = context
      .pages()
      .find((p) => p.url().includes(development ? '127.0.0.1:5173' : 'tauri.localhost'));
    if (page) break;
    await delay(250);
  }
  assert(page, 'Application webview missing');
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  const invoke = (command, args = {}) =>
    page.evaluate(
      ([name, parameters]) => globalThis.__TAURI_INTERNALS__.invoke(name, parameters),
      [command, args],
    );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My PC.' })).toBeVisible();
  try {
    await expect(page.getByRole('button', { name: 'CPU details', exact: true })).toBeVisible({
      timeout: 30000,
    });
  } catch (error) {
    const cached = await invoke('load_hardware_scan');
    if (cached) parseHardwareScan(cached);
    const live = await invoke('scan_hardware');
    parseHardwareScan(live);
    throw error;
  }
  await expect(page.getByRole('button', { name: 'Rescan Hardware', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const status = await invoke('desktop_status');
  assert.equal(status.packaged, !development);
  assert.equal(status.offlineReady, true);
  assert.equal(
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link').count(),
    3,
  );
  assert(!requests.some((u) => /renderer-.*\.js/.test(u)), 'Renderer loaded before 3D View');
  check('Native launch, automatic real Windows scan, three routes and lazy renderer');
  const scan = await invoke('load_hardware_scan');
  assert(scan);
  assert.equal(scan.schemaVersion, 1);
  for (const key of ['cpu', 'gpu', 'memory', 'motherboard', 'storage', 'os']) {
    assert(Array.isArray(scan[key]));
  }
  assert(scan.cpu.length > 0 && scan.os.length > 0, 'Core Windows provider responses missing');
  for (const key of ['SerialNumber', 'MACAddress', 'ProductKey', 'PNPDeviceID', 'DeviceId'])
    assert(!JSON.stringify(scan).includes(key));
  const nativeKeys = ['cpu', 'gpu', 'memory', 'motherboard', 'storage', 'os'];
  const deviceCounts = Object.fromEntries(nativeKeys.map((k) => [k, scan[k].length]));
  check('All six categories, physical disks and privacy allowlist from live scanner');
  for (const [category, label] of [
    ['cpu', 'CPU'],
    ['gpu', 'GPU'],
    ['memory', 'Memory'],
    ['motherboard', 'Motherboard'],
    ['storage', 'Storage'],
    ['os', 'Operating System'],
  ]) {
    await page.getByRole('button', { name: `${label} details`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (scan[category][0] && scan[category][0].name !== 'Unknown')
      await expect(
        page
          .getByRole('dialog')
          .getByRole('heading', { name: scan[category][0].name, exact: true })
          .first(),
      ).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  check('Cards open actual detected specifications, modules, adapters and firmware');
  await page.getByRole('heading', { name: 'My PC.' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'my-pc-dashboard.png'), fullPage: true });
  await page.getByRole('button', { name: 'Copy Specifications', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Specifications copied' })).toBeVisible();
  // Verify the OS clipboard we just wrote without triggering a WebView2 read-permission prompt.
  const clipboardResult = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', 'Get-Clipboard -Raw'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(clipboardResult.status, 0);
  const clipboard = clipboardResult.stdout;
  assert(clipboard.includes(scan.cpu[0].name));
  assert(clipboard.includes(scan.os[0].name));
  check('Copy Specifications writes detected CPU and Windows data to native clipboard');
  const denied = await invoke('plugin:window-state|save_window_state').then(
    () => false,
    () => true,
  );
  assert(denied);
  assert(
    await invoke('open_documentation', { key: 'https://untrusted.invalid' }).then(
      () => false,
      () => true,
    ),
  );
  for (const name of ['plugin:shell|execute', 'plugin:fs|read_text_file', 'run_powershell'])
    assert(
      await invoke(name).then(
        () => false,
        () => true,
      ),
    );
  check('Capability denial, documentation allowlist and no arbitrary shell/filesystem IPC');
  if (!development) await context.setOffline(true);
  await page.getByRole('button', { name: 'Rescan Hardware', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rescan Hardware', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const fresh = await invoke('load_hardware_scan');
  assert(fresh.scannedAt >= scan.scannedAt);
  await page.reload();
  await expect(page.getByRole('button', { name: 'CPU details', exact: true })).toBeVisible();
  check('Offline rescan and cached scan restore after webview reload');
  await page.evaluate(() => {
    globalThis.history.replaceState(null, '', '?rendererMetrics=1' + globalThis.location.hash);
    globalThis.addEventListener('cortex-render-metrics', (e) => {
      globalThis.__cortexNativeMetrics = e.detail;
    });
  });
  await page.evaluate(motionProbeScript);
  await page.getByRole('link', { name: 'View in 3D', exact: true }).click();
  const canvas = page.getByTestId('canvas-stage').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => globalThis.__cortexNativeMetrics?.hardwareVisuals?.length ?? 0))
    .toBeGreaterThan(0);
  const nativeMetrics = await page.evaluate(() => globalThis.__cortexNativeMetrics);
  for (const [index, cpu] of fresh.cpu.entries()) {
    const visual = nativeMetrics.hardwareVisuals.find(
      (v) => v.category === 'cpu' && v.index === index,
    );
    const identity = cpuIdentity(cpu.name, cpu.properties.Manufacturer);
    assert.equal(visual.cpuLabel, cpu.name);
    assert.equal(visual.cpuFamily, identity.family);
    assert.equal(visual.cpuTemplate, identity.template);
  }
  check('CPU surface marking matches the native scan and uses a generic family template');
  assert.equal(
    nativeMetrics.hardwareVisuals.filter((v) => v.category === 'gpu').length,
    fresh.gpu.filter((g) => g.properties['Adapter class'] === 'Discrete').length,
  );
  assert.equal(
    nativeMetrics.hardwareVisuals.filter((v) => v.category === 'memory').length,
    fresh.memory.length,
  );
  assert.equal(
    nativeMetrics.hardwareVisuals.filter((v) => v.category === 'storage').length,
    fresh.storage.length,
  );
  check('System-confirmed discrete cards only; exact detected memory and physical disk counts');
  await idle(page, 0);
  const nativeProfiles = await motionProfiles(page);
  await page.getByLabel('Rendering quality').selectOption('auto');
  check('Packaged Low / Standard / High motion intervals, CPU submission time and zero idle draws');
  await expect(
    page.getByText('Generic visualization — specifications are from your detected hardware.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Install|Remove component|Replace|Reset build/ }),
  ).toHaveCount(0);
  const components = page.getByRole('navigation', { name: 'Detected components' });
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await components.getByRole('button', { name: /^CPU(?: 1)?$/ }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: fresh.cpu[0].name, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('dialog')
      .getByText(cpuIdentity(fresh.cpu[0].name, fresh.cpu[0].properties.Manufacturer).note, {
        exact: true,
      }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  check('Detected read-only 3D visualization, explicit generic label and actual inspector');
  await expect(components).toHaveCount(0);
  assert(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    'No horizontal viewer overflow',
  );
  if (await page.evaluate(() => globalThis.innerWidth >= 1100 && globalThis.innerHeight >= 800))
    assert(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollHeight <= globalThis.innerHeight,
      ),
      'Desktop viewer fits the application window',
    );
  for (const category of ['cpu', 'gpu', 'memory', 'storage']) {
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await idle(page, 0);
    const visual = (await metrics(page)).hardwareVisuals.find((v) => v.category === category);
    if (!visual) continue; // Real hardware may have no reported discrete adapter or storage.
    const bounds = await canvas.boundingBox();
    await page.mouse.click(
      bounds.x + visual.projection[0] * bounds.width,
      bounds.y + visual.projection[1] * bounds.height,
    );
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: fresh[category][visual.index].name, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await idle(page, 0);
  const boardVisual = (await metrics(page)).hardwareVisuals.find(
    (v) => v.category === 'motherboard',
  );
  const boardBox = await canvas.boundingBox();
  let boardPicked = false;
  for (const [dx, dy] of [
    [-0.12, -0.12],
    [-0.16, 0.08],
    [0.12, 0.12],
    [0.16, -0.08],
    [0, -0.18],
  ]) {
    await page.mouse.click(
      boardBox.x + (boardVisual.projection[0] + dx) * boardBox.width,
      boardBox.y + (boardVisual.projection[1] + dy) * boardBox.height,
    );
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      boardPicked =
        (await dialog.getByRole('heading', { name: 'Motherboard', exact: true }).count()) > 0;
      await page.getByRole('button', { name: 'Close details' }).click();
      await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
      await idle(page, 0);
      if (boardPicked) break;
    }
  }
  assert(boardPicked, 'Motherboard mesh remains inspectable');
  check('Native CPU/GPU/memory/storage mesh inspection and closed-default component chooser');

  await page.getByLabel('Rendering quality').selectOption('low');
  await expect(page.getByLabel('Rendering quality')).toHaveValue('low');
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await delay(700);
  const before = await canvas.screenshot();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await delay(700);
  assert(!before.equals(await canvas.screenshot()));
  const bounds = await canvas.boundingBox();
  assert(bounds);
  const zoomed = await canvas.screenshot();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.64, bounds.y + bounds.height * 0.6, {
    steps: 12,
  });
  await page.mouse.up();
  await delay(700);
  assert(!zoomed.equals(await canvas.screenshot()));
  assert(
    (await page.evaluate(() => globalThis.__cortexNativeMetrics)).motion.cameraInterruptions > 0,
    'Manual OrbitControls must cancel the active camera transition',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await delay(900);
  const refitted = await page.evaluate(() => globalThis.__cortexNativeMetrics);
  await writeFile(resolve(output, 'refitted-camera.json'), JSON.stringify(refitted, null, 2));
  assert(
    refitted.hardwareVisuals.every(
      (visual) =>
        visual.projection[0] > 0 &&
        visual.projection[0] < 1 &&
        visual.projection[1] > 0 &&
        visual.projection[1] < 1,
    ),
    'Fit must frame every detected visual while preserving orbit orientation',
  );
  await page.getByLabel('Rendering quality').selectOption('auto');
  check('Native camera orbit, zoom, reset, fit and adaptive quality selection');
  await page.mouse.move(10, 10);
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await delay(700);
  await page.screenshot({ path: resolve(output, 'detected-3d-view.png'), fullPage: true });
  await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen viewer' }).click();
  await expect.poll(async () => (await invoke('desktop_status')).fullscreen).toBe(true);
  const fullscreenRail = page
    .getByTestId('canvas-stage')
    .getByRole('navigation', { name: 'Detected components' });
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await fullscreenRail.getByRole('button', { name: /^CPU(?: 1)?$/ }).click();
  await page.getByRole('button', { name: 'Focus component', exact: true }).click();
  await idle(page, 1);
  await page.getByRole('button', { name: 'Return to system', exact: true }).click();
  await scrubMotion(page, 45);
  const gpuIndex = fresh.gpu.findIndex((gpu) => gpu.properties['Adapter class'] === 'Discrete');
  if (gpuIndex >= 0) {
    await page
      .getByRole('button', { name: 'Components', exact: true })
      .filter({ visible: true })
      .click();
    await fullscreenRail
      .getByRole('button', {
        name: fresh.gpu.length > 1 ? 'GPU ' + (gpuIndex + 1) : 'GPU',
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: fresh.gpu[gpuIndex].name, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
  await page.getByTestId('canvas-stage').focus();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await invoke('desktop_status')).fullscreen).toBe(false);
  await expect(page.getByTestId('canvas-stage')).not.toHaveClass(/viewer-fullscreen/);
  check(
    'Native explode, scrub, CPU/GPU selection, focus, reassemble, fullscreen and Escape restore',
  );
  await idle(page, 0);
  await page.bringToFront();
  const motionLifecycle = await motionCycles(page, 25, async (completed, current) => {
    await writeFile(
      resolve(output, 'motion-cycle-progress.json'),
      JSON.stringify({ completed, current }, null, 2),
    );
    console.log(`Motion resource cycles: ${completed}/25`);
  });
  check(
    '25 packaged animated cycles retain geometry, texture and material counts with zero idle draws',
  );
  await page.getByLabel('Rendering quality').selectOption('low');
  // Compare the same selection state; its outline owns one extra geometry.
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await components.getByRole('button', { name: /^CPU(?: 1)?$/ }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await delay(700);
  const resources = await page.evaluate(() => ({
    geometries: globalThis.__cortexNativeMetrics.geometries,
    textures: globalThis.__cortexNativeMetrics.textures,
  }));
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
    await canvas.evaluate((element) => {
      globalThis.__previousContext = element.getContext('webgl2');
    });
    await page.getByRole('link', { name: 'My PC', exact: true }).click();
    await expect(canvas).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => globalThis.__motionProbe.disposed.at(-1)))
      .toEqual({ activeHandles: 0, bindings: 0 });
    await expect
      .poll(() => page.evaluate(() => globalThis.__previousContext.isContextLost()))
      .toBe(true);
    await page.evaluate(() => {
      globalThis.__cortexNativeMetrics = undefined;
      globalThis.__motionProbe.metrics = undefined;
    });
    await page.getByRole('link', { name: 'View in 3D', exact: true }).click();
    await expect(canvas).toBeVisible();
    await page.waitForFunction(() => globalThis.__motionProbe.metrics);
    await page.getByLabel('Rendering quality').selectOption('low');
    if ((await page.evaluate(() => globalThis.__motionProbe.metrics.motion.targetAmount)) > 0)
      await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
    await idle(page, 0);
    await page
      .getByRole('button', { name: 'Components', exact: true })
      .filter({ visible: true })
      .click();
    await components.getByRole('button', { name: /^CPU(?: 1)?$/ }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: fresh.cpu[0].name, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            globalThis.__cortexNativeMetrics?.quality === 'low' && {
              geometries: globalThis.__cortexNativeMetrics.geometries,
              textures: globalThis.__cortexNativeMetrics.textures,
            },
        ),
      )
      .toEqual(resources);
  }
  check('Four viewer cycles release contexts and retain bounded geometry/texture counts');
  await delay(700);
  await canvas.evaluate((element) => {
    const ext = element.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('Context loss extension unavailable');
    ext.loseContext();
  });
  await expect(page.getByTestId('fallback-diagram')).toBeVisible();
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await components.getByRole('button', { name: /^CPU(?: 1)?$/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  check('Graphics context loss keeps detected specification inspection usable');
  assert.deepEqual(errors, []);
  const remote = requests.filter((u) => {
    const url = new URL(u);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !['tauri.localhost', 'ipc.localhost'].includes(url.hostname) &&
      !(development && url.hostname === '127.0.0.1' && url.port === '5173')
    );
  });
  assert.deepEqual(remote, []);
  check('No page errors, remote uploads, catalog or asset requests');
  await writeFile(
    resolve(output, 'hardware-smoke.json'),
    JSON.stringify(
      {
        executable,
        development,
        status,
        deviceCounts,
        unavailableCategories: fresh.unavailable,
        adapterClasses: fresh.gpu.map((g) => ({
          name: g.name,
          class: g.properties['Adapter class'],
          source: g.properties['Classification source'],
        })),
        renderer: nativeMetrics,
        nativeProfiles,
        motionLifecycle,
        checks,
        errors,
        remoteRequests: remote,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const failurePage = browser
    ?.contexts()[0]
    ?.pages()
    .find((candidate) => candidate.url().includes('tauri.localhost'));
  const probe =
    failurePage && !failurePage.isClosed()
      ? await failurePage
          .evaluate(() => ({
            metrics: globalThis.__motionProbe?.metrics,
            history: globalThis.__motionProbe?.history,
            events: globalThis.__motionProbe?.events,
          }))
          .catch(() => null)
      : null;
  await writeFile(
    resolve(output, 'smoke-failure.json'),
    JSON.stringify({ message: error.message, childExit, checks, probe }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  child.kill();
}
