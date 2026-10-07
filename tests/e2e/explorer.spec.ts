import { expect, test, type Page } from '@playwright/test';

async function openExplorer(page: Page, diagram = false) {
  await page.goto(`/?debug=1${diagram ? '&graphics=off' : ''}#/explorer`);
  await expect(page.getByRole('heading', { name: 'Motherboard Explorer.' })).toBeVisible();
  await expect(
    page.getByTestId('canvas-stage').locator('canvas').or(page.getByTestId('fallback-diagram')),
  ).toBeVisible();
}
test('landing stays lightweight; viewer, selection, exploded view and quality work', async ({
  page,
}) => {
  const errors: string[] = [];
  const assets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => assets.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Get closer to/ })).toBeVisible();
  expect(assets.some((url) => /renderer\.tsx|three\.module|react-three_fiber/.test(url))).toBe(
    false,
  );
  await page.getByRole('link', { name: 'Open Motherboard Explorer' }).click();
  await expect(page.getByRole('heading', { name: 'Motherboard Explorer.' })).toBeVisible();
  await expect(
    page.getByTestId('canvas-stage').locator('canvas').or(page.getByTestId('fallback-diagram')),
  ).toBeVisible();
  const components = page.getByRole('navigation', { name: 'Motherboard components' });
  await components.getByRole('button', { name: /CPU socket/ }).click();
  await expect(page.getByRole('heading', { name: 'CPU socket', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary').getByText('AM5', { exact: true })).toBeVisible();
  await expect(page.getByTestId('viewport')).toHaveAttribute(
    'data-selected',
    'motherboard.cpuSocket',
  );
  await components.getByRole('button', { name: /DIMM A2/ }).click();
  await expect(page.getByRole('heading', { name: 'DIMM A2', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary').getByText('DDR5', { exact: true })).toBeVisible();
  await components.getByRole('button', { name: /Primary PCIe/ }).click();
  await expect(page.getByRole('heading', { name: 'Primary PCIe x16', exact: true })).toBeVisible();
  await components.getByRole('button', { name: /M.2 slot 01/ }).click();
  await expect(page.getByRole('complementary').getByText('NVME', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exploded view' }).click();
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-exploded', 'true');
  await page.getByRole('button', { name: 'Exploded view' }).click();
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-exploded', 'false');
  await page.getByLabel('Rendering quality').selectOption('low');
  await expect(page.getByLabel('Rendering quality')).toHaveValue('low');
  await page.getByLabel('Rendering quality').selectOption('high');
  await expect(page.getByLabel('Rendering quality')).toHaveValue('high');
  expect(errors).toEqual([]);
});

test('canvas region selection and camera orbit, zoom, focus and reset', async ({
  page,
  isMobile,
}) => {
  await openExplorer(page);
  const canvas = page.getByTestId('canvas-stage').locator('canvas');
  test.skip(
    (await canvas.count()) === 0,
    'This browser environment has no WebGL 2; fallback is tested separately.',
  );
  const diagnostics = page.getByTestId('diagnostics');
  await expect(diagnostics).toBeAttached();
  const raw = await diagnostics.getAttribute('data-projections');
  const projections = JSON.parse(raw ?? '{}') as Record<string, [number, number]>;
  const socket = projections['motherboard.cpuSocket'];
  const bounds = await canvas.boundingBox();
  expect(socket).toBeDefined();
  expect(bounds).not.toBeNull();
  if (!bounds || !socket) throw new Error('Missing camera projection');
  const position = { x: socket[0] * bounds.width, y: socket[1] * bounds.height };
  if (isMobile) await canvas.tap({ position });
  else await canvas.click({ position });
  await expect(page.getByRole('heading', { name: 'CPU socket', exact: true })).toBeVisible();
  const initial = await diagnostics.getAttribute('data-camera');
  if (isMobile) await page.getByRole('button', { name: 'More details' }).click();
  await page.getByRole('button', { name: 'Focus component' }).click();
  await expect(diagnostics).not.toHaveAttribute('data-camera', initial ?? '');
  await page.getByRole('button', { name: 'Reset camera' }).click();
  await expect
    .poll(async () => {
      const current = ((await diagnostics.getAttribute('data-camera')) ?? '')
        .split(',')
        .map(Number);
      const start = (initial ?? '').split(',').map(Number);
      return Math.max(...current.map((n, i) => Math.abs(n - (start[i] ?? 0))));
    })
    .toBeLessThan(0.02);
  if (isMobile) await page.getByRole('button', { name: 'Close component information' }).click();
  await canvas.scrollIntoViewIfNeeded();
  const currentBounds = await canvas.boundingBox();
  if (!currentBounds) throw new Error('Canvas is unavailable');
  await page.mouse.move(
    currentBounds.x + currentBounds.width * 0.5,
    currentBounds.y + currentBounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    currentBounds.x + currentBounds.width * 0.65,
    currentBounds.y + currentBounds.height * 0.6,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(diagnostics).not.toHaveAttribute('data-camera', initial ?? '');
  const rotated = await diagnostics.getAttribute('data-camera');
  if (isMobile) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  else await page.mouse.wheel(0, 150);
  await expect(diagnostics).not.toHaveAttribute('data-camera', rotated ?? '');
});

test('non-3D fallback remains useful, keyboard-accessible and responsive', async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExplorer(page, true);
  await expect(page.getByTestId('fallback-diagram')).toBeVisible();
  const socket = page
    .getByRole('navigation', { name: 'Motherboard components' })
    .getByRole('button', { name: /CPU socket/ });
  await socket.focus();
  await page.keyboard.press('Enter');
  await expect(socket).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'CPU socket', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (isMobile) {
    await page.setViewportSize({ width: 844, height: 390 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('unsupported graphics and failed renderer load recover to a diagram', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]) === 'webgl2') return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await openExplorer(page);
  await expect(page.getByText(/WebGL 2 is unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry 3D' }).click();
  await expect(page.getByTestId('fallback-diagram')).toBeVisible();
});

test('renderer module network failure leaves component information usable', async ({ page }) => {
  await page.route('**/packages/3d-engine/src/renderer.tsx*', (route) => route.abort());
  await openExplorer(page);
  await expect(page.getByTestId('fallback-diagram')).toBeVisible();
  // If this environment supports WebGL, it exercises the rejected lazy import.
  await page
    .getByRole('navigation', { name: 'Motherboard components' })
    .getByRole('button', { name: /CPU socket/ })
    .click();
  await expect(page.getByRole('heading', { name: 'CPU socket', exact: true })).toBeVisible();
  await page.unroute('**/packages/3d-engine/src/renderer.tsx*');
  await page.getByRole('button', { name: 'Retry 3D' }).click();
  await expect(
    page.getByTestId('canvas-stage').locator('canvas').or(page.getByTestId('fallback-diagram')),
  ).toBeVisible();
});

test('repeated viewer mount/unmount keeps geometry counts stable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExplorer(page);
  const canvas = page.getByTestId('canvas-stage').locator('canvas');
  test.skip((await canvas.count()) === 0, 'No WebGL 2 in this browser environment.');
  const counts: number[] = [];
  for (let i = 0; i < 4; i++) {
    await expect(page.getByTestId('diagnostics')).toHaveAttribute('data-geometries', /\d+/);
    // Trigger a frame after geometry upload to capture an initialized renderer.
    await page.getByRole('button', { name: 'Exploded view' }).click();
    await expect(page.getByTestId('diagnostics')).not.toHaveAttribute('data-geometries', '0');
    counts.push(Number(await page.getByTestId('diagnostics').getAttribute('data-geometries')));
    await page.getByRole('link', { name: 'Cortex Core home', exact: true }).click();
    await expect(canvas).toHaveCount(0);
    await page.getByRole('link', { name: 'Open Motherboard Explorer' }).click();
    await expect(canvas).toBeVisible();
  }
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(5);
  expect(errors).toEqual([]);
});

test('stationary scene returns to idle demand rendering', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as { gpuClears: number };
    host.gpuClears = 0;
    if (!window.WebGL2RenderingContext) return;
    const original = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function (mask: number) {
      host.gpuClears += 1;
      return original.call(this, mask);
    };
  });
  await openExplorer(page);
  test.skip(
    (await page.getByTestId('canvas-stage').locator('canvas').count()) === 0,
    'No WebGL 2 in this browser environment.',
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { gpuClears: number }).gpuClears))
    .toBeGreaterThan(0);
  const measurement = await page.evaluate(async () => {
    const frames = async (count: number) => {
      for (let i = 0; i < count; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    await frames(60);
    const start = (window as unknown as { gpuClears: number }).gpuClears;
    await frames(60);
    return (window as unknown as { gpuClears: number }).gpuClears - start;
  });
  expect(measurement).toBeLessThanOrEqual(2);
});
