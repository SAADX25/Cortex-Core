import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { hardwareFixture } from '../hardware-fixture';
import {
  motionProbeScript,
  metrics,
  idle,
  idleDraws,
  motionProfiles,
  motionCycles,
  scrubMotion,
} from '../motion-probe';

test.beforeEach(async ({ page, browserName }) => {
  test.skip(
    browserName !== 'chromium',
    'Motion resource probes require WebGL; fallback remains covered on all browsers.',
  );
  await page.addInitScript((scan) => {
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'load_hardware_scan') return null;
          if (command === 'scan_hardware') return { ...scan, scannedAt: Date.now() };
          if (command === 'set_viewer_fullscreen') return false;
          if (command === 'record_graphics_failure') return;
          throw new Error('Unexpected command');
        },
      },
    });
  }, hardwareFixture);
  await page.addInitScript(motionProbeScript);
});

test('animated profiles and 25 cycles retain resources, transforms and zero idle draws', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [],
    remote: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1')
      remote.push(request.url());
  });
  await page.goto('/?rendererMetrics=1#/3d');
  await idle(page, 0);
  const profiles = await motionProfiles(page);
  const cycles = await motionCycles(page);
  expect(profiles.every((profile) => profile.animationSamples > 0)).toBe(true);
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
  await mkdir('.artifacts/motion', { recursive: true });
  await writeFile(
    `.artifacts/motion/${info.project.name}.json`,
    JSON.stringify({ profiles, cycles, errors, remoteRequests: remote }, null, 2),
  );
  await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
  await idle(page, 1);
  await page
    .locator('canvas')
    .screenshot({ path: `.artifacts/motion/${info.project.name}-exploded.png` });
});

test('reversal, focus, orbit cancellation, quality replacement, fullscreen and mid-motion disposal', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?rendererMetrics=1#/3d');
  await idle(page, 0);
  const rail = page.getByRole('navigation', { name: 'Detected components' });
  const toggle = page.getByRole('button', { name: 'Exploded View', exact: true });
  for (let i = 0; i < 6; i++) await toggle.click();
  await toggle.click();
  await page.getByLabel('Rendering quality').selectOption('high');
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await rail.getByRole('button', { name: 'CPU', exact: true }).click();
  await page.getByRole('button', { name: 'Focus component', exact: true }).click();
  await idle(page, 1);
  let motion = (await metrics(page)).motion;
  expect(motion.visuals.find((v) => v.id.startsWith('cpu:'))?.intensity).toBe(1);
  expect(motion.visuals.find((v) => v.id.startsWith('motherboard:'))?.intensity).toBe(0.38);
  await idleDraws(page);
  await page.getByRole('button', { name: 'Return to system', exact: true }).click();
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await rail.getByRole('button', { name: 'GPU 2', exact: true }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByLabel('Rendering quality').selectOption('low');
  await page.waitForFunction(() => window.__motionProbe.metrics?.quality === 'low');
  await idle(page, 1);
  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
  await page.evaluate(() => {
    window.__motionProbe.metrics = undefined;
  });
  await page
    .getByRole('button', { name: 'Fit to view', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.waitForFunction(() => window.__motionProbe.metrics?.motion.cameraActive);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await idle(page, 1);
  motion = (await metrics(page)).motion;
  expect(motion.cameraInterruptions).toBeGreaterThan(0);
  expect(motion.visuals.every((v) => v.intensity === 1)).toBe(true);
  await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen viewer', exact: true }).click();
  await expect(rail).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await rail.getByRole('button', { name: 'CPU', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByLabel('Rendering quality').filter({ visible: true }).selectOption('low');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await idle(page, 0);
  await toggle.click();
  await canvas.evaluate((element) => {
    (window as unknown as { __closingContext: WebGL2RenderingContext | null }).__closingContext = (
      element as HTMLCanvasElement
    ).getContext('webgl2');
  });
  await page.getByRole('link', { name: 'My PC', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__motionProbe.disposed.at(-1)))
    .toEqual({ activeHandles: 0, bindings: 0 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __closingContext: WebGL2RenderingContext }
        ).__closingContext.isContextLost(),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.__motionProbe.metrics = undefined;
  });
  await page.getByRole('link', { name: 'View in 3D', exact: true }).click();
  await idle(page, 1);
  expect((await metrics(page)).motion.visuals.every((v) => v.settle === 0)).toBe(true);
  await idleDraws(page);
  expect(errors).toEqual([]);
});

test('reduced motion retains immediate exploded poses, scrub, selection and focus', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?rendererMetrics=1#/3d');
  await idle(page, 0);
  const baseline = (await metrics(page)).motion.visuals;
  const scrub = async (value: string) => {
    await scrubMotion(page, Number(value));
    await idle(page, Number(value) / 100);
  };
  await scrub('50');
  const midway = (await metrics(page)).motion.visuals;
  await scrub('100');
  const exploded = (await metrics(page)).motion.visuals;
  for (let i = 0; i < baseline.length; i++) {
    expect(midway[i]!.position).toEqual(
      baseline[i]!.position.map((n, axis) => (n + exploded[i]!.position[axis]!) / 2),
    );
    expect(exploded[i]!.settle).toBe(0);
  }
  const rail = page.getByRole('navigation', { name: 'Detected components' });
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await rail.getByRole('button', { name: 'Memory 2', exact: true }).click();
  await page.getByRole('button', { name: 'Focus component', exact: true }).click();
  await idle(page, 1);
  expect(
    (await metrics(page)).motion.visuals.find((v) => v.id.startsWith('memory:1:'))?.intensity,
  ).toBe(1);
  await page.getByRole('button', { name: 'Return to system', exact: true }).click();
  await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
  await idle(page, 0);
  expect((await metrics(page)).motion.visuals).toEqual(baseline);
  await idleDraws(page);
});
