import { expect, test, type Page } from '@playwright/test';
import { hardwareFixture } from '../hardware-fixture';
async function mockScanner(page: Page, partial = false) {
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
    { scan: hardwareFixture, partial },
  );
}
test('automatic scan, six cards, only three routes, real details and rescan', async ({ page }) => {
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
  ).toHaveCount(3);
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
