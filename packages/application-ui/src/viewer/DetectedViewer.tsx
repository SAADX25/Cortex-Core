import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { adapterClass, storagePlacement } from '@cortex/asset-runtime';
import {
  cpuIdentity,
  type CameraAction,
  type ComponentId,
  type QualityMode,
  type DetectedScene,
} from '@cortex/3d-engine';
import type { HardwareCategory, HardwareScan } from '../hardware';
import { categoryNames } from '../hardware';
import HardwareInspector from '../HardwareInspector';
import { Icon } from '../icons';
import { isDesktop, recordGraphicsFailure, setDesktopFullscreen } from '../platform';
import { supportsWebGL2 } from './graphics';
import { GraphicsBoundary } from './GraphicsBoundary';
const Renderer = lazy(() => import('@cortex/3d-engine/renderer'));
function categoryForRegion(id: ComponentId): HardwareCategory {
  if (id === 'motherboard.cpuSocket') return 'cpu';
  if (id.includes('.dimm.')) return 'memory';
  if (id.includes('.pcie.')) return 'gpu';
  if (id.includes('.m2.') || id === 'motherboard.sata') return 'storage';
  return 'motherboard';
}
export default function DetectedViewer({ scan }: { scan: HardwareScan }) {
  const [selected, setSelected] = useState<HardwareCategory | null>(null);
  const [deviceIndex, setDeviceIndex] = useState<number | undefined>();
  const [visualSelection, setVisualSelection] = useState<DetectedScene['selected']>();
  const [region, setRegion] = useState<ComponentId | null>(null);
  const [hovered, setHovered] = useState<ComponentId | null>(null);
  const [quality, setQuality] = useState<QualityMode>('auto');
  const [camera, setCamera] = useState({ action: 'fit' as CameraAction, revision: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const [graphics, setGraphics] = useState(
    () => new URLSearchParams(location.search).get('graphics') !== 'off' && supportsWebGL2(),
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const failed = useCallback(() => {
    setGraphics(false);
    recordGraphicsFailure('context-lost');
  }, []);
  const selectDevice = useCallback((category: HardwareCategory, index?: number) => {
    setDeviceIndex(index);
    setSelected(category);
    setVisualSelection({ category, index });
  }, []);
  const detected: DetectedScene = {
    devices: (['cpu', 'gpu', 'memory', 'storage'] as const).flatMap((category) =>
      scan[category].flatMap((device, index) =>
        category === 'gpu' && adapterClass(device) !== 'discrete'
          ? []
          : [
              {
                category,
                index,
                name: device.name,
                manufacturer: device.properties.Manufacturer,
                ...(category === 'storage' ? { placement: storagePlacement(device) } : {}),
              },
            ],
      ),
    ),
    boardFamily: 'oem',
    boardName: scan.motherboard[0]?.name ?? 'Motherboard not reported',
    selected: visualSelection,
    onSelect: selectDevice,
  };
  const command = (action: CameraAction) =>
    setCamera((c) => ({ action, revision: c.revision + 1 }));
  async function toggleFullscreen(enabled: boolean) {
    try {
      if (isDesktop) await setDesktopFullscreen(enabled);
      else if (enabled) await stage.current?.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
      setFullscreen(enabled);
      setFullscreenError('');
    } catch {
      setFullscreenError('Fullscreen is unavailable.');
    }
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) void toggleFullscreen(false);
    };
    const changed = () => {
      if (!isDesktop && !document.fullscreenElement) setFullscreen(false);
    };
    window.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      window.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', changed);
    };
  }, [fullscreen]);
  useEffect(
    () => () => {
      if (isDesktop) void setDesktopFullscreen(false).catch(() => undefined);
    },
    [],
  );
  const fallback = (
    <div className="detected-fallback" data-testid="fallback-diagram">
      <Icon name="chip" size={64} />
      <h2>Hardware overview</h2>
      <p className="muted">
        3D graphics are unavailable. Select a detected component below to see its specifications.
      </p>
    </div>
  );
  return (
    <main className="detected-viewer">
      <div className="eyebrow">YOUR DETECTED HARDWARE</div>
      <h1>
        Inside your PC<span className="title-dot">.</span>
      </h1>
      <p className="visual-note">
        Generic visualization — specifications are from your detected hardware.
      </p>
      <details className="viewer-info">
        <summary>
          <Icon name="info" size={16} /> About this visualization
        </summary>
        <p>
          Brand-aware generic shapes, with names and specifications from your scan. These are
          illustrative assets, not verified exact physical models. Motherboard layout, socket, form
          factor and slot occupancy are illustrative. Only system-confirmed discrete adapters appear
          as cards. Storage inventory does not imply a physical location.
        </p>
      </details>
      <div className="detected-toolbar">
        <button className="button secondary" onClick={() => command('reset')}>
          <Icon name="reset" />
          Reset camera
        </button>
        <button className="button secondary" onClick={() => command('fit')}>
          <Icon name="focus" />
          Fit to view
        </button>
        <button className="button secondary" onClick={() => command('zoom-in')}>
          Zoom in
        </button>
        <button className="button secondary" onClick={() => command('zoom-out')}>
          Zoom out
        </button>
        <label>
          Quality{' '}
          <select
            aria-label="Rendering quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as QualityMode)}
          >
            {['auto', 'low', 'medium', 'high'].map((q) => (
              <option key={q} value={q}>
                {q === 'auto'
                  ? 'Automatic'
                  : q === 'medium'
                    ? 'Standard'
                    : q[0]!.toUpperCase() + q.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" onClick={() => void toggleFullscreen(true)}>
          <Icon name="expand" />
          Fullscreen viewer
        </button>
        {fullscreenError && <span role="status">{fullscreenError}</span>}
      </div>
      <div
        ref={stage}
        className={`detected-stage ${fullscreen ? 'viewer-fullscreen' : ''}`}
        data-testid="canvas-stage"
        tabIndex={0}
      >
        {fullscreen && (
          <button
            className="button secondary exit-fullscreen"
            onClick={() => void toggleFullscreen(false)}
          >
            Exit fullscreen
          </button>
        )}
        {graphics ? (
          <GraphicsBoundary
            fallback={fallback}
            onError={() => {
              recordGraphicsFailure('renderer-load-failed');
              setGraphics(false);
            }}
          >
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  Loading 3D renderer…
                </div>
              }
            >
              <Renderer
                detected={detected}
                selected={region}
                hovered={hovered}
                onSelect={(id) => {
                  setRegion(id);
                  selectDevice(categoryForRegion(id));
                }}
                onHover={setHovered}
                exploded={false}
                labels={false}
                reducedMotion={reducedMotion}
                quality={quality}
                cameraCommand={camera}
                diagnostics={new URLSearchParams(location.search).get('rendererMetrics') === '1'}
                onMetrics={(metrics) =>
                  window.dispatchEvent(
                    new CustomEvent('cortex-render-metrics', { detail: metrics }),
                  )
                }
                onFailure={failed}
              />
            </Suspense>
          </GraphicsBoundary>
        ) : (
          fallback
        )}
        <button className="board-caption" onClick={() => selectDevice('motherboard')}>
          {scan.motherboard[0]?.properties.Manufacturer &&
          scan.motherboard[0].properties.Manufacturer !== 'Unknown'
            ? `${scan.motherboard[0].properties.Manufacturer} · `
            : ''}
          {scan.motherboard[0]?.name ?? 'Motherboard not reported'}
          <small>Generic motherboard visualization</small>
        </button>
        {!!scan.storage.length && (
          <div className="storage-caption">
            Detected Storage · {scan.storage.length} physical devices
            <small>Inventory · location and form factor unknown</small>
          </div>
        )}
      </div>
      <nav className="detected-components" aria-label="Detected components">
        {(['motherboard', 'cpu', 'gpu', 'memory', 'storage'] as const).map((category) => (
          <section className="component-group" key={category}>
            <h2>
              {categoryNames[category]} <span>{scan[category].length || '—'}</span>
            </h2>
            {scan[category].length ? (
              scan[category].map((device, index) => (
                <button
                  className="component-entry"
                  key={`${category}-${index}`}
                  aria-label={`${categoryNames[category]}${scan[category].length > 1 ? ` ${index + 1}` : ''}`}
                  aria-describedby={`component-name-${category}-${index}`}
                  aria-pressed={
                    visualSelection?.category === category &&
                    (visualSelection.index === index ||
                      (category === 'motherboard' && visualSelection.index === undefined))
                  }
                  onClick={() => selectDevice(category, index)}
                >
                  <span className="component-entry-icon">
                    <Icon
                      name={
                        category === 'cpu'
                          ? 'chip'
                          : category === 'motherboard'
                            ? 'grid'
                            : category === 'storage'
                              ? 'box'
                              : 'layers'
                      }
                      size={20}
                    />
                  </span>
                  <span className="component-entry-copy">
                    <strong id={`component-name-${category}-${index}`}>{device.name}</strong>
                    <small>
                      {category === 'gpu'
                        ? adapterClass(device) === 'discrete'
                          ? 'Discrete adapter'
                          : `${adapterClass(device)} · system info`
                        : category === 'storage'
                          ? 'Detected inventory'
                          : category === 'cpu'
                            ? cpuIdentity(device.name, device.properties.Manufacturer).note.replace(
                                ' visualization',
                                '',
                              )
                            : category === 'motherboard'
                              ? 'Generic motherboard'
                              : `Module ${index + 1}`}
                    </small>
                  </span>
                  <Icon name="chevron" size={14} />
                </button>
              ))
            ) : (
              <p className="component-empty">Not reported by system</p>
            )}
          </section>
        ))}
      </nav>
      {selected && (
        <HardwareInspector
          scan={scan}
          category={selected}
          deviceIndex={deviceIndex}
          visualization
          close={() => setSelected(null)}
        />
      )}
    </main>
  );
}
