import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { hardwareFixture } from '../tests/hardware-fixture.ts';
const output = new URL('../.artifacts/reconstruction/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const results = [];
const measureTiming = process.env.CORTEX_VERIFY_TIMING !== '0';
try {
  for (const viewport of [
    { width: 1440, height: 1050 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (scan) => {
        Object.defineProperty(globalThis, 'isTauri', { value: true });
        Object.defineProperty(globalThis, '__TAURI_INTERNALS__', {
          value: {
            invoke: async (c) =>
              c === 'load_hardware_scan' || c === 'scan_hardware' ? scan : undefined,
          },
        });
        globalThis.__cortexSamples = [];
        globalThis.addEventListener('cortex-render-metrics', (e) => {
          globalThis.__cortexMetrics = e.detail;
        });
        let draws = 0;
        Object.defineProperty(globalThis, '__cortexDraws', { get: () => draws });
        for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays']) {
          const original = globalThis.WebGL2RenderingContext.prototype[name];
          globalThis.WebGL2RenderingContext.prototype[name] = function (...args) {
            draws++;
            return Reflect.apply(original, this, args);
          };
        }
      },
      {
        ...hardwareFixture,
        gpu: [
          ...hardwareFixture.gpu,
          { name: 'Unclassified adapter', properties: { 'Dedicated VRAM (bytes)': '4294967296' } },
          { name: 'Virtual display', properties: { 'Adapter class': 'Virtual' } },
          { name: 'Software rasterizer', properties: { 'Adapter class': 'Software' } },
        ],
      },
    );
    await page.goto('http://127.0.0.1:5173/?rendererMetrics=1#/3d');
    await page.getByTestId('canvas-stage').locator('canvas').waitFor();
    const profiles = [];
    for (const quality of ['low', 'medium', 'high']) {
      await page.getByLabel('Rendering quality').selectOption(quality);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
      await page.waitForTimeout(1200);
      if (viewport.width === 1440 && measureTiming) {
        const box = await page.getByTestId('canvas-stage').locator('canvas').boundingBox();
        await page.evaluate(() => {
          globalThis.__cortexSamples = [];
          globalThis.__captureFrames = true;
          let last = 0;
          const sample = (now) => {
            if (!globalThis.__captureFrames) return;
            if (last) globalThis.__cortexSamples.push(now - last);
            last = now;
            globalThis.requestAnimationFrame(sample);
          };
          globalThis.requestAnimationFrame(sample);
        });
        await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.52);
        await page.mouse.down();
        for (let i = 0; i < 45; i++) {
          await page.mouse.move(
            box.x + box.width * (0.48 + 0.04 * Math.sin(i / 7)),
            box.y + box.height * (0.52 + 0.025 * Math.cos(i / 7)),
          );
          await page.waitForTimeout(12);
        }
        await page.mouse.up();
        await page.evaluate(() => {
          globalThis.__captureFrames = false;
        });
        await page.waitForTimeout(800);
        const frames = await page.evaluate(() => globalThis.__cortexSamples);
        const sorted = frames.sort((a, b) => a - b);
        profiles.push({
          orbitSamples: sorted.length,
          activeFrameP50: sorted[Math.floor(sorted.length * 0.5)],
          activeFrameP95: sorted[Math.floor(sorted.length * 0.95)],
          quality,
        });
        await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
        await page.waitForTimeout(2000);
      }
      const metrics = await page.evaluate(() => globalThis.__cortexMetrics);
      assert.equal(metrics.quality, quality);
      assert.equal(metrics.hardwareVisuals.filter((v) => v.category === 'gpu').length, 1);
      assert.equal(metrics.hardwareVisuals.find((v) => v.category === 'gpu').index, 1);
      assert.equal(metrics.hardwareVisuals.filter((v) => v.category === 'memory').length, 2);
      assert.equal(metrics.hardwareVisuals.filter((v) => v.category === 'storage').length, 2);
      assert(
        metrics.hardwareVisuals.every((v) => v.projection.every((n) => n > 0.02 && n < 0.98)),
        'Fit must frame every hardware item',
      );
      await writeFile(new URL('latest-profile.json', output), JSON.stringify(metrics, null, 2));
      assert(
        metrics.calls < 140 && metrics.triangles < 60000,
        `Scene budget exceeded: ${quality} / ${viewport.width} / ${metrics.calls} calls / ${metrics.triangles} triangles`,
      );
      let stable = 0,
        previous = -1;
      for (let i = 0; i < 25 && stable < 3; i++) {
        await page.waitForTimeout(300);
        const current = await page.evaluate(() => globalThis.__cortexDraws);
        stable = current === previous ? stable + 1 : 0;
        previous = current;
      }
      assert.equal(stable, 3, 'Camera must settle within the finite interaction window');
      const before = await page.evaluate(() => globalThis.__cortexDraws);
      await page.waitForTimeout(650);
      assert.equal(
        await page.evaluate(() => globalThis.__cortexDraws),
        before,
        'Idle viewer must stop rendering',
      );
      profiles.push(metrics);
      if (viewport.width === 1440)
        await page
          .getByTestId('canvas-stage')
          .screenshot({ path: fileURLToPath(new URL(`scene-${quality}.png`, output)) });
    }
    await page.getByLabel('Rendering quality').selectOption('medium');
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await page.waitForTimeout(1000);
    if (viewport.width === 1440) {
      for (const category of ['cpu', 'gpu', 'memory', 'storage']) {
        const m = await page.evaluate(() => globalThis.__cortexMetrics);
        const visual = m.hardwareVisuals.find((v) => v.category === category);
        const canvas = await page.getByTestId('canvas-stage').locator('canvas').boundingBox();
        await page.mouse.click(
          canvas.x + visual.projection[0] * canvas.width,
          canvas.y + visual.projection[1] * canvas.height,
        );
        await page.getByRole('dialog').waitFor();
        const name = hardwareFixture[category][visual.index].name;
        assert(
          (await page.getByRole('dialog').innerText()).includes(name),
          `Mesh selection must inspect ${category}`,
        );
        await page.getByRole('button', { name: 'Close details' }).click();
        await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
        await page.waitForTimeout(500);
        assert.deepEqual(
          (await page.evaluate(() => globalThis.__cortexMetrics)).pbrPalette,
          m.pbrPalette,
          'Selection must preserve PBR materials',
        );
      }
      // Switching LOD/quality repeatedly must return to the same live resource counts.
      const counts = [];
      for (let i = 0; i < 3; i++) {
        await page.getByLabel('Rendering quality').selectOption('high');
        await page.waitForTimeout(400);
        await page.getByLabel('Rendering quality').selectOption('medium');
        await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
        await page.waitForTimeout(700);
        counts.push(
          await page.evaluate(() => {
            const m = globalThis.__cortexMetrics;
            return [m.geometries, m.textures];
          }),
        );
      }
      assert(
        counts.every((c) => JSON.stringify(c) === JSON.stringify(counts[0])),
        `Quality switches must release old GPU resources: ${JSON.stringify(counts)}`,
      );
    }
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`viewer-${viewport.width}.png`, output)),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'My PC', exact: true }).click();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      profiles,
      browserErrors: errors,
      idle: true,
      fit: true,
      correctCounts: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(new URL('renderer-metrics.json', output), JSON.stringify(results, null, 2));
console.log(
  'Reconstruction validation passed: low/standard/high, mesh selection, counts, fit, idle, resource stability, teardown, desktop/mobile.',
);
