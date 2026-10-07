import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await expect(page.getByTestId('build-save-status')).not.toHaveText('Assembly in progress…');
}
async function install(page: Page, part: string, slot: string) {
  await page.getByLabel('Assembly component').selectOption(part);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page
    .getByRole('region', { name: 'Component assembly' })
    .getByRole('button', { name: new RegExp(`^${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    .click();
  await page.getByRole('button', { name: `Install into ${slot}`, exact: true }).click();
  await ready(page);
}
test('library to assembly, occupied slots, replace, persistence, removal and confirmed reset', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/catalog/cpu');
  await page.getByRole('button', { name: /Sample 8-core CPU/ }).click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose destination', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Component assembly' })
    .getByRole('button', { name: /^CPU socket/ })
    .click();
  await page.getByRole('button', { name: 'Install into CPU socket', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: 'Install', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Replace CPU socket', exact: true }).click();
  await page.getByRole('button', { name: 'Install into CPU socket', exact: true }).click();
  await ready(page);
  await install(page, 'fixture-ram', 'DIMM A2');
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Component assembly' })
      .getByRole('button', { name: /^DIMM A2/ }),
  ).toBeDisabled();
  await page
    .getByRole('region', { name: 'Component assembly' })
    .getByRole('button', { name: /^DIMM B2/ })
    .click();
  await page.getByRole('button', { name: 'Install into DIMM B2', exact: true }).click();
  await ready(page);
  await install(page, 'fixture-storage', 'M.2 slot 02');
  await expect(page.getByTestId('build-summary')).toContainText('32 GB · 2 / 4 DIMMs');
  await expect(page.getByTestId('build-summary')).toContainText('1000 GB · 1 / 2 M.2');
  await expect(page.getByTestId('build-summary')).toContainText('warning');
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('build-summary')).toContainText('32 GB · 2 / 4 DIMMs');
  await page.getByLabel('Assembly component').selectOption('fixture-ram');
  await expect(page.getByText('Installed in: DIMM A2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove DIMM A2', exact: true }).click();
  await ready(page);
  await expect(page.getByTestId('build-summary')).toContainText('16 GB · 1 / 4 DIMMs');
  await page.getByRole('button', { name: 'Reset build', exact: true }).click();
  await page.getByRole('button', { name: 'Keep build', exact: true }).click();
  await expect(page.getByTestId('build-summary')).toContainText('16 GB');
  await page.getByRole('button', { name: 'Reset build', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await ready(page);
  await expect(page.getByTestId('build-summary')).toContainText('0 GB · 0 / 4 DIMMs');
  await expect(page.getByTestId('build-summary')).toContainText('No installed components');
  expect(errors).toEqual([]);
});

test('invalid and newer persisted builds are preserved and assembly is disabled', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'cortex.development-build.v1',
      JSON.stringify({ schemaVersion: 99, motherboardId: 'fixture-board-atx', installations: [] }),
    ),
  );
  await page.goto('/#/builder');
  await expect(page.getByRole('alert')).toContainText('original data is preserved');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('cortex.development-build.v1')!).schemaVersion,
    ),
  ).toBe(99);
});

test('real renderer places CPU, DIMM and M.2 and repeated cycles dispose resources and return to idle', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const host = window as unknown as { gpuClears: number; buffers: number; textures: number };
    host.gpuClears = 0;
    host.buffers = 0;
    host.textures = 0;
    if (!window.WebGL2RenderingContext) return;
    const prototype = WebGL2RenderingContext.prototype;
    const clear = prototype.clear,
      create = prototype.createBuffer,
      dispose = prototype.deleteBuffer,
      texture = prototype.createTexture,
      disposeTexture = prototype.deleteTexture;
    prototype.clear = function (mask) {
      host.gpuClears++;
      return clear.call(this, mask);
    };
    prototype.createBuffer = function () {
      const result = create.call(this);
      if (result) host.buffers++;
      return result;
    };
    prototype.deleteBuffer = function (buffer) {
      if (buffer) host.buffers--;
      return dispose.call(this, buffer);
    };
    prototype.createTexture = function () {
      const result = texture.call(this);
      if (result) host.textures++;
      return result;
    };
    prototype.deleteTexture = function (value) {
      if (value) host.textures--;
      return disposeTexture.call(this, value);
    };
  });
  await page.goto('/?debug=1#/builder');
  await ready(page);
  await expect(
    page.getByTestId('canvas-stage').locator('canvas').or(page.getByTestId('fallback-diagram')),
  ).toBeVisible();
  test.skip(
    (await page.getByTestId('canvas-stage').locator('canvas').count()) === 0,
    'No WebGL2; domain assembly is covered independently.',
  );
  const diagnostics = page.getByTestId('diagnostics');
  await expect(diagnostics).toBeAttached();
  await page.getByLabel('Rendering quality').selectOption('low');
  const sample = async () => {
    const before = await diagnostics.getAttribute('data-camera');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(diagnostics).not.toHaveAttribute('data-camera', before ?? '');
    await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
    await page.waitForTimeout(750);
    return {
      geometries: Number(await diagnostics.getAttribute('data-geometries')),
      materials: Number(await diagnostics.getAttribute('data-materials')),
      textures: Number(await diagnostics.getAttribute('data-textures')),
      gpu: await page.evaluate(() => {
        const host = window as unknown as { buffers: number; textures: number };
        return { buffers: host.buffers, textures: host.textures };
      }),
    };
  };
  const baseline = await sample();
  for (const [part, slot, id, position] of [
    ['fixture-cpu', 'CPU socket', 'motherboard.cpuSocket', [-0.022, 0.016, -0.066]],
    ['fixture-ram', 'DIMM A2', 'motherboard.dimm.a2', [0.061, 0.0285, -0.058]],
    ['fixture-storage', 'M.2 slot 02', 'motherboard.m2.slot2', [-0.049, 0.0085, 0.132]],
  ] as const) {
    await install(page, part, slot);
    await sample();
    const visuals = JSON.parse(
      (await diagnostics.getAttribute('data-installed-visuals')) ?? '[]',
    ) as { slotId: string; position: number[]; rotation: number[] }[];
    const visual = visuals.find((v) => v.slotId === id);
    expect(visual).toBeDefined();
    for (let i = 0; i < 3; i++) expect(visual!.position[i]).toBeCloseTo(position[i]!, 5);
    expect(visual!.rotation).toEqual([0, 0, 0]);
    await page.getByRole('button', { name: `Remove ${slot}`, exact: true }).click();
    await ready(page);
  }
  for (let cycle = 0; cycle < 5; cycle++) {
    await install(page, 'fixture-ram', cycle % 2 ? 'DIMM A2' : 'DIMM B2');
    await page
      .getByRole('button', { name: `Remove ${cycle % 2 ? 'DIMM A2' : 'DIMM B2'}`, exact: true })
      .click();
    await ready(page);
  }
  const after = await sample();
  expect(after).toEqual(baseline);
  await expect(diagnostics).toHaveAttribute('data-transitions', '0');
  const idle = await page.evaluate(async () => {
    const frames = async () => {
      for (let i = 0; i < 60; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const host = window as unknown as { gpuClears: number };
    await frames();
    const start = host.gpuClears;
    await frames();
    return host.gpuClears - start;
  });
  expect(idle).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});
