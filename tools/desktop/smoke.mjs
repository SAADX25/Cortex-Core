import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { motherboardComponents } from '../../packages/3d-engine/src/semantics.ts';

if (process.platform !== 'win32') throw new Error('This smoke runner targets Windows WebView2.');
function browserProcessIds() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-Process chrome,msedge,firefox,brave,opera -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) throw result.error;
  return new Set(result.stdout.trim().split(/\s+/).filter(Boolean));
}
const existingBrowserIds = browserProcessIds();
const development = process.argv.includes('--development');
const attach = process.env.CORTEX_CDP_URL;
const port = Number(process.env.CORTEX_CDP_PORT ?? 9224);
const output = resolve('.artifacts/desktop');
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
await mkdir(output, { recursive: true });
const executable =
  process.env.CORTEX_DESKTOP_EXE ??
  resolve(
    development
      ? 'apps/desktop/src-tauri/target/debug/cortex-core.exe'
      : 'apps/desktop/src-tauri/target/release/Cortex Core.exe',
  );
// Debugging is injected only by this test process, never by shipped configuration.
const child = attach
  ? undefined
  : spawn(executable, [], {
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        WEBVIEW2_USER_DATA_FOLDER: resolve(output, `webview-${port}`),
      },
      stdio: 'ignore',
    });
let launchError;
child?.on('error', (error) => {
  launchError = error;
});
let browser;
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  for (let i = 0; i < 120; i++) {
    if (launchError) throw launchError;
    try {
      browser = await chromium.connectOverCDP(attach ?? `http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(500);
    }
  }
  assert(browser, 'Native WebView2 CDP did not become available');
  const context = browser.contexts()[0];
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
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  const invoke = (command, args = {}) =>
    page.evaluate(
      ([name, parameters]) => globalThis.__TAURI_INTERNALS__.invoke(name, parameters),
      [command, args],
    );
  await page.getByRole('link', { name: 'Cortex Core home', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Your hardware workspace/ })).toBeVisible();
  const status = await invoke('desktop_status');
  assert.equal(status.appVersion, version);
  assert.equal(status.packaged, !development);
  assert.equal(status.offlineReady, true);
  assert.equal(status.catalogVersion, '2026.10.07.1');
  assert.equal(status.cacheStatus, 'local-snapshot');
  assert(!page.url().includes('127.0.0.1') || development);
  check(development ? 'Tauri dev launch' : 'Packaged native launch without a frontend server');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText(`Version ${version} · Unsigned development build`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Cortex Core home', exact: true }).click();
  check('Shared Settings version label agrees with native package version');
  const savedState = await readFile(
    resolve(process.env.APPDATA, 'dev.cortexcore.desktop/.window-state.json'),
    'utf8',
  ).then(
    (text) => JSON.parse(text).main,
    () => null,
  );
  if (savedState && !savedState.maximized) {
    assert.equal(status.windowWidth, savedState.width);
    assert.equal(status.windowHeight, savedState.height);
    check('Restores saved native window size at the current display scale');
  }
  const denied = await invoke('plugin:window-state|save_window_state').then(
    () => false,
    () => true,
  );
  assert(denied, 'Unscoped plugin capability unexpectedly allowed');
  assert(
    await invoke('open_documentation', { key: 'https://untrusted.invalid' }).then(
      () => false,
      () => true,
    ),
  );
  check('Capability denial and documentation allowlist');
  if (!development) await context.setOffline(true);
  await page.getByRole('link', { name: 'Open Motherboard Explorer' }).click();
  const canvas = page.getByTestId('canvas-stage').locator('canvas');
  await expect(canvas).toBeVisible();
  check('Motherboard renders in native WebView2');
  const components = page.getByRole('navigation', { name: 'Motherboard components' });
  assert.equal(await components.getByRole('button').count(), 17);
  for (const component of motherboardComponents) {
    await components
      .getByRole('button', {
        name: new RegExp(component.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .click();
    await expect(page.getByTestId('viewport')).toHaveAttribute('data-selected', component.id);
    await expect(
      page.getByRole('complementary').getByRole('heading', { name: component.label, exact: true }),
    ).toBeVisible();
  }
  check('All 17 semantic regions and contextual inspector');
  await page.getByRole('button', { name: 'Exploded view' }).click();
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-exploded', 'true');
  await page.getByRole('button', { name: 'Exploded view' }).click();
  await page.getByLabel('Rendering quality').selectOption('low');
  await expect(page.getByLabel('Rendering quality')).toHaveValue('low');
  await page.getByLabel('Rendering quality').selectOption('auto');
  check('Exploded view and quality controls');
  await page.getByRole('button', { name: 'Reset camera' }).click();
  await delay(700);
  const before = await canvas.screenshot();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await delay(700);
  assert(!before.equals(await canvas.screenshot()), 'Zoom did not change native rendered pixels');
  const bounds = await canvas.boundingBox();
  assert(bounds);
  const zoomed = await canvas.screenshot();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.6, {
    steps: 12,
  });
  await page.mouse.up();
  await delay(700);
  assert(!zoomed.equals(await canvas.screenshot()), 'Orbit did not change native rendered pixels');
  await page.getByRole('button', { name: 'Fit board to view' }).click();
  check('Camera zoom, orbit, reset and fit in native renderer');
  await page.getByRole('button', { name: 'Fullscreen viewer' }).click();
  await expect.poll(async () => (await invoke('desktop_status')).fullscreen).toBe(true);
  await expect(page.getByTestId('viewport')).toHaveClass(/viewer-fullscreen/);
  const expanded = await invoke('desktop_status');
  assert(
    expanded.windowWidth !== status.windowWidth || expanded.windowHeight !== status.windowHeight,
    'Native fullscreen did not resize the window',
  );
  await expect(canvas).toBeVisible();
  // Native fullscreen changes the window frame asynchronously. Focus the
  // workspace after that transition before exercising its Escape handler.
  await page.getByTestId('viewport').focus();
  await delay(400);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await invoke('desktop_status')).fullscreen).toBe(false);
  check('Native fullscreen and Escape restore');
  await page.screenshot({
    path: resolve(output, development ? 'dev-explorer.png' : 'production-explorer.png'),
  });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('link', { name: 'Cortex Core home', exact: true }).click();
    await expect(canvas).toHaveCount(0);
    await page.getByRole('link', { name: 'Open Motherboard Explorer' }).click();
    await expect(canvas).toBeVisible();
  }
  check('Four viewer entry/exit cycles and canvas teardown');
  if (!development) check('Offline fixture navigation and native SQLite snapshot');
  // Canvas attachment precedes scene effects; let the new scene initialize.
  await delay(700);
  await canvas.evaluate((element) => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Context loss test extension unavailable');
    extension.loseContext();
  });
  await expect(page.getByTestId('fallback-diagram')).toBeVisible();
  await components.getByRole('button', { name: /CPU socket/ }).click();
  await expect(page.getByRole('heading', { name: 'CPU socket', exact: true })).toBeVisible();
  check('Lost graphics context preserves usable diagram and inspector');
  await page.screenshot({ path: resolve(output, 'native-fallback.png') });
  assert.deepEqual(errors, []);
  assert(!requests.some((url) => /127\.0\.0\.1:5173/.test(url)) || development);
  const remoteRequests = requests.filter((url) => {
    const requestUrl = new URL(url);
    if (!['http:', 'https:'].includes(requestUrl.protocol)) return false;
    if (['tauri.localhost', 'ipc.localhost'].includes(requestUrl.hostname)) return false;
    return !(development && requestUrl.hostname === '127.0.0.1' && requestUrl.port === '5173');
  });
  assert.deepEqual(remoteRequests, []);
  check('No page errors or remote catalog/asset requests');
  assert.deepEqual(
    [...browserProcessIds()].filter((id) => !existingBrowserIds.has(id)),
    [],
  );
  check('Native host did not launch an external browser');
  await writeFile(
    resolve(output, development ? 'dev-smoke.json' : 'production-smoke.json'),
    JSON.stringify(
      {
        executable,
        development,
        status,
        checks,
        errors,
        requests,
        cleanup:
          'Runner terminates its child; native-frame close and geometry persistence are validated separately.',
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  child?.kill();
}
