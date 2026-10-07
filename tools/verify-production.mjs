import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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
    await page.goto('http://127.0.0.1:4173/?debug=1');
    await page.getByRole('heading', { name: /Your hardware workspace/ }).waitFor();
    assert(
      !requests.some((url) => /renderer-/.test(url)),
      'Landing must not request renderer code',
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`landing-${viewport.width}.png`, output)),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Open Motherboard Explorer' }).click();
    await page.getByTestId('canvas-stage').locator('canvas').waitFor();
    await page
      .getByRole('navigation', { name: 'Motherboard components' })
      .getByRole('button', { name: /CPU socket/ })
      .click();
    await page.getByRole('heading', { name: 'CPU socket', exact: true }).waitFor();
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
