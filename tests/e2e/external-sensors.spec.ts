import { expect, test, type Page } from '@playwright/test';
import { hardwareFixture } from '../hardware-fixture';
async function mockNative(page: Page, refused = false, delayed = false, hung = false) {
  await page.addInitScript(
    ({ scan, refused, delayed, hung }) => {
      const commands: { command: string; consent?: boolean }[] = [];
      Object.defineProperty(window, 'sensorCommands', { value: commands });
      Object.defineProperty(window, 'isTauri', { value: true });
      let session = 0;
      let owner = 0,
        revision = 0,
        enables = 0,
        reads = 0;
      const state = { enabled: false };
      Object.defineProperty(window, 'mockSensorState', { value: state });
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: {
          invoke: async (
            command: string,
            args?: { consent?: boolean; owner?: number; revision?: number },
          ) => {
            commands.push({ command, consent: args?.consent });
            if (command === 'load_hardware_scan' || command === 'scan_hardware') return scan;
            if (command === 'open_external_sensor_session') {
              owner = ++session;
              revision = 0;
              state.enabled = false;
              return owner;
            }
            if (command === 'configure_external_sensors') {
              if (args?.consent && delayed && ++enables === 1)
                await new Promise<void>((resolve) =>
                  Object.defineProperty(window, 'finishSensorSetup', { value: resolve }),
                );
              if (args?.owner !== owner || !args.revision || args.revision <= revision)
                throw new Error('Expired owner or revision');
              revision = args.revision;
              state.enabled = !!args.consent;
              return ++session;
            }
            if (command === 'read_external_sensors') {
              if (hung && ++reads > 1) return new Promise(() => undefined);
              const observedAt = Date.now();
              return {
                schemaVersion: 1,
                source: 'librehardwaremonitor',
                status: refused
                  ? 'Server local-only access cannot be verified; wildcard, remote or shared HTTP.sys listeners are refused'
                  : 'connected',
                observedAt: refused ? null : observedAt,
                staleAfterMs: 15000,
                sensors: refused
                  ? []
                  : [
                      {
                        hardwareId: '/gpu-nvidia/0',
                        hardwareName: 'Mock NVIDIA device',
                        category: 'gpu',
                        sensorId: '/gpu-nvidia/0/temperature/0',
                        sensorName: 'GPU Core',
                        kind: 'temperature',
                        unit: 'celsius',
                        value: 48,
                        observedAt,
                        measuredAt: null,
                        availability: 'available',
                        deviceMatch: 'unmatched',
                      },
                    ],
              };
            }
            throw new Error('Unexpected mock command');
          },
        },
      });
    },
    { scan: hardwareFixture, refused, delayed, hung },
  );
}
const calls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { sensorCommands: { command: string; consent?: boolean }[] })
        .sensorCommands,
  );
test('Monitoring stays dormant until consent and clears data on navigation', async ({ page }) => {
  await mockNative(page);
  const sensorRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(':8085')) sensorRequests.push(request.url());
  });
  await page.goto('/#/monitoring');
  await expect(page.getByRole('heading', { name: 'Monitoring.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect local source' })).toBeDisabled();
  expect((await calls(page)).filter((c) => /external_sensor/.test(c.command))).toHaveLength(0);
  await page.getByRole('checkbox', { name: /I completed setup/ }).check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toBeVisible();
  await expect(
    page.locator('.sensor-grid').getByText('Not available', { exact: true }),
  ).toHaveCount(4);
  expect(sensorRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'My PC', exact: true }).click();
  await expect.poll(async () => (await calls(page)).at(-1)?.consent).toBe(false);
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /I completed setup/ })).not.toBeChecked();
  await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/external-sensors-disconnected.png', fullPage: true });
});
test('local-only refusal explains why and displays unavailable categories', async ({ page }) => {
  await mockNative(page, true);
  await page.goto('/#/monitoring');
  await page.getByRole('checkbox', { name: /I completed setup/ }).check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Server local-only access cannot be verified',
  );
  await expect(
    page.locator('.sensor-grid').getByText('Not available', { exact: true }),
  ).toHaveCount(5);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('status')).toContainText('Disconnected');
});

test('disconnect during pending setup rejects a late enable and permits rapid reconnect', async ({
  page,
}) => {
  await mockNative(page, false, true);
  await page.goto('/#/monitoring');
  const consent = page.getByRole('checkbox', { name: /I completed setup/ });
  await consent.check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect
    .poll(async () => (await calls(page)).filter((c) => c.consent === true).length)
    .toBe(1);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await consent.check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishSensorSetup(): void }).finishSensorSetup(),
  );
  await expect(page.getByRole('status')).toContainText('Local source connected');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { mockSensorState: { enabled: boolean } }).mockSensorState.enabled,
    ),
  ).toBe(true);
  expect((await calls(page)).filter((c) => c.command === 'read_external_sensors')).toHaveLength(1);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('status')).toContainText('Disconnected');
});

test('freshness deadline clears values and warnings while a mocked read is hung', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await mockNative(page, false, false, true);
  await page.goto('/#/monitoring');
  await page.getByRole('checkbox', { name: /I completed setup/ }).check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toBeVisible();
  await page.getByLabel('Time range').selectOption('60');
  await expect(
    page.getByRole('img', { name: /Temperature observations over 60 minutes/ }),
  ).toBeVisible();
  await page.getByText('Optional temperature warnings', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Show on-screen warnings/ }).check();
  await page.getByRole('spinbutton', { name: /GPU/ }).fill('40');
  await expect(page.getByRole('complementary', { name: 'Temperature warnings' })).toBeVisible();
  await page.screenshot({
    path: `.artifacts/update-14-monitoring-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.clock.runFor(16000);
  await expect(page.getByRole('status')).toContainText('Reading stale');
  await expect(page.getByRole('complementary', { name: 'Temperature warnings' })).toHaveCount(0);
  await expect(
    page.locator('.sensor-grid').getByText('Not available', { exact: true }),
  ).toHaveCount(5);
  expect((await calls(page)).filter((c) => c.command === 'read_external_sensors')).toHaveLength(2);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('img', { name: /Temperature observations/ })).toHaveCount(0);
});

for (const event of ['blur', 'pagehide', 'beforeunload', 'visibilitychange'])
  test(`${event} revokes the session and requires fresh consent`, async ({ page }) => {
    await mockNative(page);
    await page.goto('/#/monitoring');
    await page.getByRole('checkbox', { name: /I completed setup/ }).check();
    await page.getByRole('button', { name: 'Connect local source' }).click();
    await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toBeVisible();
    await page.evaluate((event) => {
      if (event === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event(event));
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      } else window.dispatchEvent(new Event(event));
    }, event);
    await expect(page.getByRole('status')).toContainText('Disconnected');
    await expect(page.getByRole('checkbox', { name: /I completed setup/ })).not.toBeChecked();
    await expect.poll(async () => (await calls(page)).at(-1)?.consent).toBe(false);
    await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toHaveCount(0);
  });

test('renderer reload opens a dormant page with no new sensor commands', async ({ page }) => {
  await mockNative(page);
  await page.goto('/#/monitoring');
  await page.getByRole('checkbox', { name: /I completed setup/ }).check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.locator('.sensor-grid').getByText('48.0 °C', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Disconnected');
  expect((await calls(page)).filter((c) => /external_sensor/.test(c.command))).toHaveLength(0);
});
