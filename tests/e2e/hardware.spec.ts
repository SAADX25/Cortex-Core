import { expect, test, type Page } from '@playwright/test';
import { hardwareFixture } from '../hardware-fixture';
import { motionProbeScript, idle, metrics, idleDraws } from '../motion-probe';
import { resolveStorageVisual } from '@cortex/asset-runtime';
async function mockScanner(page: Page, partial = false, scan = hardwareFixture) {
  await page.addInitScript(
    ({ scan, partial }) => {
      Object.defineProperty(window, 'isTauri', { value: true });
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: {
          invoke: async (command: string) => {
            if (command === 'load_hardware_scan') return null;
            if (command === 'scan_hardware') {
              await new Promise((r) => setTimeout(r, 200));
              return partial
                ? { ...scan, motherboard: [], unavailable: ['Motherboard'] }
                : { ...scan, scannedAt: Date.now() };
            }
            if (command === 'set_viewer_fullscreen') return false;
            if (command === 'record_graphics_failure') return;
            throw new Error('Unexpected command');
          },
        },
      });
    },
    { scan, partial },
  );
}
test('automatic scan, six cards, four routes, real details and rescan', async ({ page }) => {
  await mockScanner(page);
  const errors: string[] = [];
  const assets: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => assets.push(r.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My PC.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CPU details', exact: true })).toBeVisible();
  expect(assets.some((u) => /renderer\.tsx|three\.module|react-three_fiber/.test(u))).toBe(false);
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link'),
  ).toHaveCount(4);
  await expect(
    page.getByRole('button', {
      name: /^(CPU|GPU|Memory|Motherboard|Storage|Operating System) details$/,
    }),
  ).toHaveCount(6);
  await expect(page.getByText('32 GiB DDR5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GPU details', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Discrete test adapter', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Integrated test adapter', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'GPU details', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Memory details', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Test DIMM', exact: true }),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Storage details', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: /Test SSD|Test disk/ }),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Rescan Hardware', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rescan Hardware', exact: true })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: /Install|Replace|Remove component|Reset build/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('partial failure keeps available hardware and unavailable inspector', async ({ page }) => {
  await mockScanner(page, true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Motherboard details' })).toContainText(
    'Information unavailable',
  );
  await page.getByRole('button', { name: 'Motherboard details' }).click();
  await expect(
    page.getByRole('dialog').getByText('Information unavailable. Rescan Hardware to try again.'),
  ).toBeVisible();
});
test('generic viewer shows detected devices, details, quality and tears down on exit', async ({
  page,
}) => {
  await mockScanner(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'CPU details', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View in 3D', exact: true }).click();
  await expect(
    page.getByText('Generic visualization — specifications are from your detected hardware.'),
  ).toBeVisible();
  await expect(
    page.getByTestId('canvas-stage').locator('canvas').or(page.getByTestId('fallback-diagram')),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Detected components' })
    .getByRole('button', { name: 'GPU 2', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Discrete test adapter', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Integrated test adapter', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByLabel('Rendering quality').selectOption('low');
  await expect(page.getByLabel('Rendering quality')).toHaveValue('low');
  await page.getByRole('link', { name: 'My PC', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(errors).toEqual([]);
});
test('graphics fallback keeps actual hardware details usable', async ({ page }) => {
  await mockScanner(page);
  await page.goto('/?graphics=off#/3d');
  await expect(page.getByTestId('fallback-diagram')).toBeVisible();
  await page
    .getByRole('button', { name: 'Components', exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Detected components' })
    .getByRole('button', { name: 'CPU', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Test 8-core processor', exact: true }),
  ).toBeVisible();
});
test('ordinary browser cannot fabricate a detected machine', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Windows desktop app');
  await expect(page.getByRole('button', { name: 'CPU details' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy Specifications' })).toBeDisabled();
});

test.describe('renderer performance protection', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'The draw-call probe targets Chromium WebGL; fallback is checked on every browser.',
    );
  });
  for (const cpu of [
    { name: 'Intel Core i7-8700', manufacturer: 'GenuineIntel', family: 'intel' },
    { name: 'AMD Ryzen 7 7800X3D', manufacturer: 'AuthenticAMD', family: 'amd' },
  ]) {
    test(`${cpu.family} CPU has the detected top marking and generic template`, async ({
      page,
    }) => {
      await mockScanner(page, false, {
        ...hardwareFixture,
        cpu: [
          {
            ...hardwareFixture.cpu[0]!,
            name: cpu.name,
            properties: { ...hardwareFixture.cpu[0]!.properties, Manufacturer: cpu.manufacturer },
          },
        ],
      });
      await page.addInitScript(() =>
        window.addEventListener('cortex-render-metrics', (event) => {
          (window as unknown as { __metrics: unknown }).__metrics = (event as CustomEvent).detail;
        }),
      );
      await page.goto('/?rendererMetrics=1#/3d');
      const cpuVisual = () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __metrics?: {
                hardwareVisuals: {
                  category: string;
                  cpuLabel?: string;
                  cpuFamily?: string;
                  cpuTemplate?: string;
                  projection: number[];
                }[];
              };
            }
          ).__metrics?.hardwareVisuals.find((v) => v.category === 'cpu'),
        );
      await expect.poll(cpuVisual).toMatchObject({
        cpuLabel: cpu.name,
        cpuFamily: cpu.family,
        cpuTemplate: `generic-${cpu.family}-desktop-cpu`,
      });
      const rail = page.getByRole('navigation', { name: 'Detected components' });
      await page.getByRole('button', { name: 'Components', exact: true }).click();
      await expect(rail.getByRole('button', { name: 'CPU', exact: true })).toContainText(cpu.name);
      await rail.getByRole('button', { name: 'CPU', exact: true }).click();
      await expect(
        page.getByRole('dialog').getByRole('heading', { name: cpu.name, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('dialog')
          .getByText(`Generic ${cpu.family === 'intel' ? 'Intel' : 'AMD'} CPU visualization`, {
            exact: true,
          }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Close details' }).click();
      await page.locator('canvas').scrollIntoViewIfNeeded();
      const visual = await cpuVisual();
      const bounds = await page.locator('canvas').boundingBox();
      expect(bounds).not.toBeNull();
      await page.mouse.click(
        bounds!.x + visual!.projection[0]! * bounds!.width,
        bounds!.y + visual!.projection[1]! * bounds!.height,
      );
      await expect(
        page.getByRole('dialog').getByRole('heading', { name: cpu.name, exact: true }),
      ).toBeVisible();
    });
  }
  test('repeated opens release WebGL contexts and retain bounded GPU resources', async ({
    page,
  }) => {
    await mockScanner(page, false, {
      ...hardwareFixture,
      cpu: [{ ...hardwareFixture.cpu[0]!, name: 'AMD Ryzen 7 7800X3D' }],
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() =>
      window.addEventListener('cortex-render-metrics', (event) => {
        (window as unknown as { __metrics: unknown }).__metrics = (event as CustomEvent).detail;
      }),
    );
    await page.goto('/?rendererMetrics=1#/3d');
    const counts = () =>
      page.evaluate(() => {
        const metrics = (
          window as unknown as {
            __metrics?: { geometries: number; textures: number; quality: string };
          }
        ).__metrics;
        return (
          metrics?.quality === 'low' && {
            geometries: metrics.geometries,
            textures: metrics.textures,
          }
        );
      });
    await page.getByLabel('Rendering quality').selectOption('low');
    await expect.poll(counts).toBeTruthy();
    await page.waitForTimeout(1000);
    const baseline = await counts();
    for (let cycle = 0; cycle < 4; cycle++) {
      await page.locator('canvas').evaluate((canvas) => {
        (
          window as unknown as { __previousContext: WebGL2RenderingContext | null }
        ).__previousContext = (canvas as HTMLCanvasElement).getContext('webgl2');
      });
      await page.getByRole('link', { name: 'My PC', exact: true }).click();
      await expect(page.locator('canvas')).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              window as unknown as { __previousContext: WebGL2RenderingContext }
            ).__previousContext.isContextLost(),
          ),
        )
        .toBe(true);
      await page.evaluate(() => {
        (window as unknown as { __metrics: unknown }).__metrics = undefined;
      });
      await page.getByRole('link', { name: 'View in 3D', exact: true }).click();
      await page.getByLabel('Rendering quality').selectOption('low');
      await expect.poll(counts).toEqual(baseline);
    }
  });
  test('demand rendering returns to idle after camera interaction', async ({ page }) => {
    await page.addInitScript(() => {
      let draws = 0;
      Object.defineProperty(globalThis, '__cortexTestDraws', { get: () => draws });
      const prototype = WebGL2RenderingContext.prototype;
      const original = prototype.drawElements;
      prototype.drawElements = function (
        ...args: Parameters<WebGL2RenderingContext['drawElements']>
      ) {
        draws += 1;
        return Reflect.apply(original, this, args);
      };
    });
    await mockScanner(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#/3d');
    await expect(page.getByTestId('canvas-stage').locator('canvas')).toBeVisible();
    const count = () =>
      page.evaluate(
        () => (globalThis as typeof globalThis & { __cortexTestDraws: number }).__cortexTestDraws,
      );
    await expect.poll(count).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const before = await count();
    await page.waitForTimeout(600);
    expect(await count()).toBe(before);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(count).toBeGreaterThan(before);
    await page.waitForTimeout(1500);
    const after = await count();
    await page.waitForTimeout(600);
    expect(await count()).toBe(after);
    await page.getByRole('link', { name: 'My PC', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});

test('compact Components chooser retains keyboard inspection without persistent cards', async ({
  page,
}) => {
  await mockScanner(page);
  await page.goto('/?graphics=off#/3d');
  const trigger = page.getByRole('button', { name: 'Components', exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Detected components' })).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const chooser = page.getByRole('dialog', { name: 'Components', exact: true });
  await expect(chooser).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const name of ['Motherboard', 'CPU', 'GPU 1', 'Memory 1', 'Storage 1']) {
    await page.keyboard.press('Enter');
    const item = page
      .getByRole('navigation', { name: 'Detected components' })
      .getByRole('button', { name, exact: true });
    await item.focus();
    await page.keyboard.press('Enter');
    await expect(chooser).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

test('immersive 1080p layout selects every mesh and has no page overflow', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium' || info.project.name !== 'chromium',
    'Desktop WebGL composition check',
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockScanner(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(motionProbeScript);
  await page.goto('/?rendererMetrics=1#/3d');
  await idle(page, 0);
  const overflow = () =>
    page.evaluate(() => ({
      x: document.documentElement.scrollWidth > innerWidth,
      y: document.documentElement.scrollHeight > innerHeight,
    }));
  expect(await overflow()).toEqual({ x: false, y: false });
  await expect(page.getByRole('navigation', { name: 'Detected components' })).toHaveCount(0);
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  expect(box.height).toBeGreaterThan(700);
  for (const category of ['cpu', 'gpu', 'memory', 'storage'] as const) {
    const visual = (await metrics(page)).hardwareVisuals.find((v) => v.category === category)!;
    await page.mouse.click(
      box.x + visual.projection[0]! * box.width,
      box.y + visual.projection[1]! * box.height,
    );
    await expect(
      page.getByRole('dialog').getByRole('heading', {
        name: hardwareFixture[category][visual.index!]!.name,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await idle(page, 0);
  }
  // Probe exposed PCB areas through real pointer events, since its bounds centre is covered by the GPU.
  const board = (await metrics(page)).hardwareVisuals.find((v) => v.category === 'motherboard')!;
  let boardPicked = false;
  for (const [dx, dy] of [
    [-0.12, -0.12],
    [-0.16, 0.08],
    [0.12, 0.12],
    [0.16, -0.08],
    [0, -0.18],
  ]) {
    await page.mouse.click(
      box.x + (board.projection[0]! + dx!) * box.width,
      box.y + (board.projection[1]! + dy!) * box.height,
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
  expect(boardPicked).toBe(true);
  await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
  await idle(page, 1);
  expect(await overflow()).toEqual({ x: false, y: false });
  await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
  await idle(page, 0);
  await idleDraws(page);
  await page.screenshot({ path: '.artifacts/motion/immersive-1080p.png' });
});

test('storage family shapes carry detected labels, pick exact disks and release resources', async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== 'chromium', 'WebGL physical storage rendering check');
  test.setTimeout(90000);
  const storage = [
    {
      name: 'Mechanical test disk',
      properties: { 'Media type': 'HDD', 'Bus type': 'SATA', 'Size (bytes)': '2000000000000' },
    },
    {
      name: 'SATA test SSD',
      properties: { 'Media type': 'SSD', 'Bus type': 'SATA', 'Size (bytes)': '1000000000000' },
    },
    {
      name: 'KINGSTON SNVS500',
      properties: { 'Media type': 'SSD', 'Bus type': 'NVMe', 'Size (bytes)': '500000000000' },
    },
    {
      name: 'Unknown physical disk',
      properties: {
        'Media type': 'Unknown',
        'Bus type': 'Unknown',
        'Size (bytes)': '250000000000',
      },
    },
  ];
  await mockScanner(page, false, { ...hardwareFixture, storage });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(motionProbeScript);
  await page.goto('/?rendererMetrics=1#/3d');
  await idle(page, 0);
  await page.getByLabel('Rendering quality').selectOption('low');
  await page.waitForFunction(() => window.__motionProbe.metrics?.quality === 'low');
  await idle(page, 0);
  const before = await metrics(page);
  const visuals = before.hardwareVisuals.filter((v) => v.category === 'storage');
  expect(visuals).toHaveLength(4);
  expect(visuals.map((v) => v.storageFamily)).toEqual(['hdd', 'sata-ssd', 'nvme', 'unknown']);
  expect(visuals.every((v) => v.storagePlacement === 'inventory')).toBe(true);
  for (let i = 0; i < storage.length; i++) {
    const disk = storage[i]!;
    expect(visuals[i]).toMatchObject({
      storageLabel: disk.name,
      assetId: resolveStorageVisual(disk).assetId,
    });
    const visual = (await metrics(page)).hardwareVisuals.find(
      (v) => v.category === 'storage' && v.index === i,
    )!;
    const box = (await page.locator('canvas').boundingBox())!;
    await page.mouse.click(
      box.x + visual.projection[0]! * box.width,
      box.y + visual.projection[1]! * box.height,
    );
    const inspector = page.getByRole('dialog');
    await expect(inspector.getByRole('heading', { name: disk.name, exact: true })).toBeVisible();
    await expect(
      inspector.getByText(resolveStorageVisual(disk).note, { exact: true }),
    ).toBeVisible();
    await expect(inspector.locator('dl')).toContainText('Size');
    await expect(inspector.locator('dl')).toContainText(['2 TB', '1 TB', '500 GB', '250 GB'][i]!);
    await expect(inspector.locator('dl')).toContainText('Media type');
    await expect(inspector.locator('dl')).toContainText('Bus type');
    if (disk.properties['Bus type'] !== 'Unknown')
      await expect(inspector.locator('dl')).toContainText(disk.properties['Bus type']);
    if (i === 0 || i === 2) {
      await page.getByRole('button', { name: 'Focus component', exact: true }).click();
      await idle(page, 0);
      await page
        .locator('canvas')
        .screenshot({ path: `.artifacts/motion/storage-focus-${i}-${info.project.name}.png` });
      await page.getByRole('button', { name: 'Return to system', exact: true }).click();
      await idle(page, 0);
    } else await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await idle(page, 0);
  }
  await page
    .locator('canvas')
    .screenshot({ path: `.artifacts/motion/storage-families-${info.project.name}.png` });
  const counts = (m: Awaited<ReturnType<typeof metrics>>) => ({
    geometries: m.geometries,
    textures: m.textures,
    materials: m.materials,
  });
  const baseline = counts(await metrics(page));
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
    await idle(page, 1);
    await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
    await idle(page, 0);
    await page.getByLabel('Rendering quality').selectOption('high');
    await page.waitForFunction(() => window.__motionProbe.metrics?.quality === 'high');
    await idle(page, 0);
    await page.getByLabel('Rendering quality').selectOption('low');
    await page.waitForFunction(() => window.__motionProbe.metrics?.quality === 'low');
    await idle(page, 0);
    expect(counts(await metrics(page))).toEqual(baseline);
  }
  await idleDraws(page);
  await page.getByRole('link', { name: 'My PC', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__motionProbe.disposed.at(-1)))
    .toEqual({ activeHandles: 0, bindings: 0 });
});
