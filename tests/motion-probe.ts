import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import type { SceneMetrics } from '../packages/3d-engine/src/renderer';

interface Probe {
  metrics?: SceneMetrics;
  draws: number;
  frames: { at: number; cpuRenderMs: number; calls: number }[];
  disposed: { activeHandles: number; bindings: number }[];
  history: { at: number; camera: string; handles: number; width: number; height: number }[];
  events: { at: number; type: string }[];
}
declare global {
  interface Window {
    __motionProbe: Probe;
  }
}
/** Counts actual WebGL submissions independently of the renderer's demand-loop metrics. */
export function motionProbeScript() {
  if (window.__motionProbe) return;
  const probe: Probe = (window.__motionProbe = {
    draws: 0,
    frames: [],
    disposed: [],
    history: [],
    events: [],
  });
  for (const type of ['resize', 'scroll', 'pointermove', 'focus', 'blur', 'visibilitychange'])
    window.addEventListener(
      type,
      () => {
        probe.events.push({ at: performance.now(), type });
        if (probe.events.length > 100) probe.events.shift();
      },
      true,
    );
  for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype])
    for (const method of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ] as const) {
      const original = (prototype as WebGL2RenderingContext)[method];
      if (!original) continue;
      Object.defineProperty(prototype, method, {
        value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
          probe.draws++;
          return Reflect.apply(original, this, args);
        },
      });
    }
  window.addEventListener('cortex-render-metrics', (event) => {
    const metrics = (event as CustomEvent<SceneMetrics>).detail;
    probe.metrics = metrics;
    probe.history.push({
      at: performance.now(),
      camera: metrics.camera,
      handles: metrics.motion.activeHandles,
      width: metrics.viewport.width,
      height: metrics.viewport.height,
    });
    if (probe.history.length > 100) probe.history.shift();
    if (metrics.motion.activeHandles > 0) {
      probe.frames.push({
        at: performance.now(),
        cpuRenderMs: metrics.cpuRenderMs,
        calls: metrics.calls,
      });
      if (probe.frames.length > 2000) probe.frames.shift();
    }
  });
  window.addEventListener('cortex-motion-disposed', (event) => {
    probe.disposed.push((event as CustomEvent).detail);
  });
}
export const metrics = (page: Page) => page.evaluate(() => window.__motionProbe.metrics!);
export async function scrubMotion(page: Page, value: number) {
  await page.getByRole('slider', { name: 'Explode amount' }).evaluate((element, amount) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      element,
      String(amount),
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await idle(page, value / 100);
}
export async function idle(page: Page, amount?: number) {
  await page.waitForFunction(
    (target) => {
      const motion = window.__motionProbe.metrics?.motion;
      return (
        motion &&
        motion.activeHandles === 0 &&
        (target === undefined || motion.targetAmount === target)
      );
    },
    amount,
    { timeout: 15000, polling: 50 },
  );
}
export async function idleDraws(page: Page) {
  // Permit the last invalidation and OrbitControls damping to finish before measuring.
  await page.waitForTimeout(900);
  let stable = 0,
    before = await page.evaluate(() => window.__motionProbe.draws);
  for (let attempt = 0; attempt < 30 && stable < 3; attempt++) {
    await page.waitForTimeout(250);
    const current = await page.evaluate(() => window.__motionProbe.draws);
    stable = current === before ? stable + 1 : 0;
    before = current;
  }
  assert.equal(
    stable,
    3,
    'The finite settle window must finish; continuous rendering is a failure',
  );
  // Native resize/paint notifications may arrive after a context replacement.
  // Require a complete quiet window within a bounded settle period; a RAF loop fails every window.
  for (let windowIndex = 0; windowIndex < 6; windowIndex++) {
    await page.waitForTimeout(650);
    const current = await page.evaluate(() => window.__motionProbe.draws);
    if (current === before) return 0;
    before = current;
  }
  assert.fail('A settled viewer must submit zero idle draws');
}
export const resources = (value: SceneMetrics) => ({
  geometries: value.geometries,
  textures: value.textures,
  materials: value.materials,
});
function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}
/** Shared browser / packaged WebView2 measurement. CPU submission time is not GPU time. */
export async function motionProfiles(page: Page) {
  const profiles = [];
  for (const quality of ['low', 'medium', 'high']) {
    await page.getByLabel('Rendering quality').selectOption(quality);
    await page.waitForFunction((q) => window.__motionProbe.metrics?.quality === q, quality);
    await idle(page, 0);
    await page.evaluate(() => {
      window.__motionProbe.frames = [];
    });
    await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
    await idle(page, 1);
    const opening = await page.evaluate(() => window.__motionProbe.frames);
    await page.evaluate(() => {
      window.__motionProbe.frames = [];
    });
    await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
    await idle(page, 0);
    const closing = await page.evaluate(() => window.__motionProbe.frames);
    const frames = [...opening, ...closing];
    const intervals = [opening, closing].flatMap((transition) =>
      transition.slice(1).map((frame, i) => frame.at - transition[i]!.at),
    );
    const value = await metrics(page);
    profiles.push({
      quality,
      animationSamples: frames.length,
      frameIntervalP50Ms: percentile(intervals, 0.5),
      frameIntervalP95Ms: percentile(intervals, 0.95),
      cpuRenderP50Ms: percentile(
        frames.map((f) => f.cpuRenderMs),
        0.5,
      ),
      cpuRenderP95Ms: percentile(
        frames.map((f) => f.cpuRenderMs),
        0.95,
      ),
      movingDrawCalls: [
        Math.min(...frames.map((f) => f.calls)),
        Math.max(...frames.map((f) => f.calls)),
      ],
      idleDraws: await idleDraws(page),
      resources: resources(value),
    });
  }
  return profiles;
}
export async function motionCycles(
  page: Page,
  count = 25,
  onProgress?: (completed: number, current: SceneMetrics) => Promise<void>,
) {
  await page.getByLabel('Rendering quality').selectOption('low');
  await page.waitForFunction(() => window.__motionProbe.metrics?.quality === 'low');
  await idle(page, 0);
  const before = await metrics(page);
  for (let i = 0; i < count; i++) {
    await page.getByRole('button', { name: 'Exploded View', exact: true }).click();
    await idle(page, 1);
    await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
    await idle(page, 0);
    if (onProgress && (i + 1) % 5 === 0) await onProgress(i + 1, await metrics(page));
  }
  const after = await metrics(page);
  assert.deepEqual(resources(after), resources(before));
  assert.deepEqual(
    after.motion.visuals,
    before.motion.visuals,
    '25 cycles must not introduce transform drift',
  );
  assert.equal(after.motion.activeHandles, 0);
  return {
    count,
    before: resources(before),
    after: resources(after),
    activeHandles: 0,
    idleDraws: await idleDraws(page),
  };
}
