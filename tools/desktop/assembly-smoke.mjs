import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const executable =
  process.env.CORTEX_DESKTOP_EXE ??
  resolve('apps/desktop/src-tauri/target/release/Cortex Core.exe');
const output = resolve('.artifacts/desktop');
const port = Number(process.env.CORTEX_ASSEMBLY_CDP_PORT ?? 9234);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [];
let session;
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function launch() {
  const child = spawn(executable, [], {
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: resolve(output, `assembly-webview-${port}`),
    },
  });
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  let browser;
  for (let i = 0; i < 120; i++) {
    if (launchError) throw launchError;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(500);
    }
  }
  assert(browser, 'Native assembly WebView unavailable');
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 40; i++) {
    page = context.pages().find((p) => p.url().includes('tauri.localhost'));
    if (page) break;
    await delay(250);
  }
  assert(page, 'Packaged application page missing');
  page.on('pageerror', (e) => errors.push(e.message));
  await context.setOffline(true);
  const invoke = (command, args = {}) =>
    page.evaluate(
      ([command, args]) => globalThis.__TAURI_INTERNALS__.invoke(command, args),
      [command, args],
    );
  return { child, browser, page, invoke };
}
async function close() {
  if (!session) return;
  const owned = session;
  session = undefined;
  const exited = once(owned.child, 'exit');
  owned.child.kill();
  await exited;
  await owned.browser.close().catch(() => undefined);
  await delay(600);
}
const ready = async (page) =>
  expect(page.getByTestId('build-save-status')).not.toHaveText('Assembly in progress…');
async function install(part, slot) {
  const { page } = session;
  await page.getByLabel('Assembly component').selectOption(part);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page
    .getByRole('region', { name: 'Component assembly' })
    .getByRole('button', { name: new RegExp(`^${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    .click();
  await page.getByRole('button', { name: `Install into ${slot}`, exact: true }).click();
  await ready(page);
}
let original;
try {
  session = await launch();
  original = await session.invoke('load_development_build');
  await session.page.getByRole('link', { name: 'PC Builder', exact: true }).click();
  await ready(session.page);
  if (original?.installations.length) {
    await session.page.getByRole('button', { name: 'Reset build', exact: true }).click();
    await session.page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
    await ready(session.page);
  }
  await install('fixture-cpu', 'CPU socket');
  await expect(session.page.getByRole('button', { name: 'Install', exact: true })).toBeDisabled();
  check('CPU install and occupied socket rejection');
  await install('fixture-ram', 'DIMM A2');
  await install('fixture-ram', 'DIMM B2');
  await install('fixture-storage', 'M.2 slot 02');
  const summary = session.page.getByTestId('build-summary');
  await expect(summary).toContainText('32 GB · 2 / 4 DIMMs');
  await expect(summary).toContainText('1000 GB · 1 / 2 M.2');
  await expect(summary).toContainText('warning');
  const saved = await session.invoke('load_development_build');
  assert.equal(saved.installations.length, 4);
  assert.equal(saved.schemaVersion, 1);
  assert(saved.installations.some((i) => i.slotId === 'motherboard.m2.slot2'));
  check('Two distinct DIMMs, chosen M.2 slot, domain totals and BIOS warning');
  assert(
    await session.invoke('save_development_build', { build: { ...saved, schemaVersion: 99 } }).then(
      () => false,
      () => true,
    ),
  );
  assert.deepEqual(await session.invoke('load_development_build'), saved);
  check('Native invalid/version mismatch rejection preserves saved state');
  await session.page.screenshot({ path: resolve(output, 'native-assembly.png') });
  await close();
  session = await launch();
  await session.page.getByRole('link', { name: 'PC Builder', exact: true }).click();
  await ready(session.page);
  assert.deepEqual(await session.invoke('load_development_build'), saved);
  await expect(session.page.getByTestId('build-summary')).toContainText('32 GB · 2 / 4 DIMMs');
  check('Native process restart restores SQLite build without a frontend server');
  await session.page.getByLabel('Assembly component').selectOption('fixture-cpu');
  await session.page.getByRole('button', { name: 'Replace CPU socket', exact: true }).click();
  await session.page.getByRole('button', { name: 'Install into CPU socket', exact: true }).click();
  await ready(session.page);
  assert.equal((await session.invoke('load_development_build')).installations.length, 4);
  check('Explicit CPU replacement retains one occupant');
  await session.page.getByLabel('Assembly component').selectOption('fixture-ram');
  await session.page.getByRole('button', { name: 'Remove DIMM A2', exact: true }).click();
  await ready(session.page);
  await expect(session.page.getByTestId('build-summary')).toContainText('16 GB · 1 / 4 DIMMs');
  check('Removal frees exact slot and updates memory');
  await session.page.getByRole('button', { name: 'Reset build', exact: true }).click();
  await session.page.getByRole('button', { name: 'Keep build', exact: true }).click();
  assert.equal((await session.invoke('load_development_build')).installations.length, 3);
  await session.page.getByRole('button', { name: 'Reset build', exact: true }).click();
  await session.page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await ready(session.page);
  assert.equal((await session.invoke('load_development_build')).installations.length, 0);
  check('Reset confirmation, cancellation and clearing all occupancy');
  await close();
  session = await launch();
  assert.equal((await session.invoke('load_development_build')).installations.length, 0);
  assert.equal((await session.invoke('load_catalog_snapshot')).parts.length, 5);
  check('Reset remains empty after restart and keeps the catalog');
  assert.deepEqual(errors, []);
  check('No page errors across all native assembly sessions');
  if (original) await session.invoke('save_development_build', { build: original });
  await writeFile(
    resolve(output, 'assembly-smoke.json'),
    JSON.stringify(
      {
        executable,
        checks,
        errors,
        restartMethod:
          'The runner terminates its owned native process after the awaited atomic save, then launches a fresh process. Native frame close is verified separately.',
        savedBuild: saved,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await close();
}
