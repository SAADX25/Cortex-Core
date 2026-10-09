import { expect, test, type Page } from '@playwright/test';
import { hardwareFixture } from '../hardware-fixture';
async function mockNative(page: Page, refused = false) {
  await page.addInitScript(
    ({ scan, refused }) => {
      const commands: { command: string; consent?: boolean }[] = [];
      Object.defineProperty(window, 'sensorCommands', { value: commands });
      Object.defineProperty(window, 'isTauri', { value: true });
      let session = 0;
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: {
          invoke: async (command: string, args?: { consent?: boolean }) => {
            commands.push({ command, consent: args?.consent });
            if (command === 'load_hardware_scan' || command === 'scan_hardware') return scan;
            if (command === 'configure_external_sensors') return ++session;
            if (command === 'read_external_sensors') {
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
    { scan: hardwareFixture, refused },
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
  expect(
    (await calls(page)).filter((c) => c.command === 'read_external_sensors' || c.consent === true),
  ).toHaveLength(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.getByText('48.0 °C', { exact: true })).toBeVisible();
  await expect(page.getByText('Not available', { exact: true })).toHaveCount(5);
  expect(sensorRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'My PC', exact: true }).click();
  await expect.poll(async () => (await calls(page)).at(-1)?.consent).toBe(false);
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByText('48.0 °C', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/external-sensors-disconnected.png', fullPage: true });
});
test('local-only refusal explains why and displays unavailable categories', async ({ page }) => {
  await mockNative(page, true);
  await page.goto('/#/monitoring');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect local source' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Server local-only access cannot be verified',
  );
  await expect(page.getByText('Not available', { exact: true })).toHaveCount(6);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('status')).toContainText('Disconnected');
});
