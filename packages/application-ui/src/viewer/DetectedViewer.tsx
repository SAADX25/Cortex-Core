import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { adapterClass, storagePlacement } from '@cortex/asset-runtime';
import {
  cpuIdentity,
  visualId,
  type MotionRequest,
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
import { motionSession } from './motion-session';
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
  const [motion, setMotion] = useState<MotionRequest>(() => ({
    amount: motionSession.amount,
    revision: 0,
    mode: 'sequence',
    entrance: !motionSession.visited,
  }));
  useEffect(() => {
    motionSession.visited = true;
  }, []);
  const changeMotion = (amount: number, mode: MotionRequest['mode']) => {
    motionSession.amount = amount;
    setMotion((previous) => ({ ...previous, amount, mode, revision: previous.revision + 1 }));
    setCamera((previous) => ({ action: 'fit', revision: previous.revision + 1 }));
  };
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
  const selectDevice = useCallback(
    (category: HardwareCategory, index?: number) => {
      setDeviceIndex(index);
      setSelected(category);
      setVisualSelection({ category, index });
      const device = scan[category][index ?? 0];
      const visible = device && (category !== 'gpu' || adapterClass(device) === 'discrete');
      setMotion((previous) =>
        previous.focusId && visible
          ? {
              ...previous,
              focusId: visualId(category, index ?? 0, device.name),
              mode: 'sequence',
              revision: previous.revision + 1,
            }
          : previous,
      );
      setCamera((previous) => ({ action: 'focus', revision: previous.revision + 1 }));
    },
    [scan],
  );
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
    motion,
  };
  const selectedVisual =
    visualSelection?.category === 'motherboard'
      ? { category: 'motherboard', index: 0, name: detected.boardName }
      : detected.devices.find(
          (device) =>
            device.category === visualSelection?.category &&
            device.index === visualSelection?.index,
        );
  const focusComponent = () => {
    if (!selectedVisual) return;
    setMotion((previous) => ({
      ...previous,
      mode: 'sequence',
      focusId: visualId(selectedVisual.category, selectedVisual.index, selectedVisual.name),
      revision: previous.revision + 1,
    }));
    setSelected(null);
    command('focus');
  };
  const returnToSystem = () => {
    setMotion((previous) => ({
      ...previous,
      mode: 'sequence',
      focusId: undefined,
      revision: previous.revision + 1,
    }));
    command('fit');
  };
  const previousScan = useRef(scan);
  useEffect(() => {
    if (previousScan.current === scan) return;
    previousScan.current = scan;
    setSelected(null);
    setVisualSelection(undefined);
    setCamera((previous) => ({ action: 'fit', revision: previous.revision + 1 }));
    setMotion((previous) => ({
      ...previous,
      focusId: undefined,
      mode: 'scrub',
      revision: previous.revision + 1,
    }));
  }, [scan]);
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
  const motionControls = (
    <div className="motion-controls" role="group" aria-label="Scene motion">
      <button
        className="motion-toggle"
        aria-pressed={motion.amount > 0}
        disabled={!graphics}
        onClick={() => changeMotion(motion.amount > 0 ? 0 : 1, 'sequence')}
      >
        <Icon name="layers" /> Exploded View
      </button>
      <label htmlFor="explode-amount">
        Explode{' '}
        <input
          id="explode-amount"
          aria-label="Explode amount"
          type="range"
          min="0"
          max="100"
          value={Math.round(motion.amount * 100)}
          disabled={!graphics}
          onChange={(event) => changeMotion(Number(event.target.value) / 100, 'scrub')}
        />
        <output htmlFor="explode-amount">{Math.round(motion.amount * 100)}%</output>
      </label>
      <button disabled={motion.amount === 0} onClick={() => changeMotion(0, 'sequence')}>
        Reassemble
      </button>
      {motion.focusId && <button onClick={returnToSystem}>Return to system</button>}
      {motion.amount > 0 && <small>Illustrative separation · storage remains inventory</small>}
    </div>
  );
  const componentRail = (
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
      <div className="detected-toolbar" hidden={fullscreen}>
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
      {!fullscreen && motionControls}
      <div
        ref={stage}
        className={`detected-stage ${fullscreen ? 'viewer-fullscreen' : ''}`}
        data-testid="canvas-stage"
        tabIndex={0}
      >
        {fullscreen && (
          <div className="fullscreen-motion">
            <div className="fullscreen-tools">
              <button onClick={() => command('fit')}>Fit to view</button>
              <button onClick={() => command('reset')}>Reset camera</button>
              <label>
                Quality{' '}
                <select
                  aria-label="Rendering quality"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as QualityMode)}
                >
                  <option value="auto">Automatic</option>
                  <option value="low">Low</option>
                  <option value="medium">Standard</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
            {motionControls}
            {componentRail}
          </div>
        )}
        {fullscreen && (
          <button
            className="button secondary exit-fullscreen"
            onClick={() => void toggleFullscreen(false)}
          >
            Exit fullscreen
          </button>
        )}
        <div className="detected-canvas">
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
        {selected && (
          <HardwareInspector
            scan={scan}
            category={selected}
            deviceIndex={deviceIndex}
            visualization
            focusComponent={graphics && selectedVisual ? focusComponent : undefined}
            close={() => setSelected(null)}
          />
        )}
      </div>
      {!fullscreen && componentRail}
    </main>
  );
}
