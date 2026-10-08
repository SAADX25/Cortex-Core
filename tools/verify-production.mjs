import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { hardwareFixture } from '../tests/hardware-fixture.ts';
const output = new URL('../.artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({
      viewport,
      isMobile: viewport.width < 680,
      hasTouch: viewport.width < 680,
    });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    // Synthetic data is injected by this test harness, never shipped by the app.
    await page.addInitScript((scan) => {
      Object.defineProperty(globalThis, 'isTauri', { value: true });
      Object.defineProperty(globalThis, '__TAURI_INTERNALS__', {
        value: {
          invoke: async (command) => {
            if (command === 'load_hardware_scan') return scan;
            if (command === 'scan_hardware') return scan;
            if (command === 'set_viewer_fullscreen' || command === 'record_graphics_failure')
              return;
            throw new Error('Unexpected test IPC');
          },
        },
      });
    }, hardwareFixture);
    await page.goto('http://127.0.0.1:4173/?debug=1');
    await page.getByRole('button', { name: 'CPU details', exact: true }).waitFor();
    assert(
      !requests.some((url) => /renderer-/.test(url)),
      'Landing must not request renderer code',
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`landing-${viewport.width}.png`, output)),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'View in 3D', exact: true }).click();
    await page.getByTestId('canvas-stage').locator('canvas').waitFor();
    await page
      .getByRole('navigation', { name: 'Detected components' })
      .getByRole('button', { name: 'CPU', exact: true })
      .click();
    await page.getByRole('heading', { name: 'Test 8-core processor', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close details' }).click();
    assert.equal(
      await page.getByTestId('diagnostics').count(),
      0,
      'Production must hide development diagnostics',
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
      'Viewport must not overflow horizontally',
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 45; i++)
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
    });
    if (viewport.width < 680) await page.getByTestId('canvas-stage').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL(`explorer-${viewport.width}.png`, output)),
      fullPage: viewport.width >= 680,
    });
    assert.deepEqual(errors, [], 'Production must not throw browser errors');
    results.push({
      viewport,
      browserErrors: errors,
      diagnosticsHidden: true,
      landingRendererRequests: 0,
      webglCanvas: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(new URL('production-verification.json', output), JSON.stringify(results, null, 2));
console.log(
  'Production preview passed at desktop and mobile widths; screenshots saved in .artifacts.',
);
