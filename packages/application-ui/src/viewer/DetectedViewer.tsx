import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { fixtureCatalog } from '@cortex/data-access';
import type { CameraAction, ComponentId, QualityMode, DetectedScene } from '@cortex/3d-engine';
import type { HardwareCategory, HardwareScan } from '../hardware';
import { categoryNames } from '../hardware';
import HardwareInspector from '../HardwareInspector';
import { Icon } from '../icons';
import { isDesktop, recordGraphicsFailure, setDesktopFullscreen } from '../platform';
import { supportsWebGL2 } from './graphics';
import { GraphicsBoundary } from './GraphicsBoundary';
const Renderer = lazy(() => import('@cortex/3d-engine/renderer'));
// Fixture metadata is used only to locate the existing procedural template. No fixture specification enters a detected record or inspector.
const board = fixtureCatalog.find((p) => p.category === 'motherboard')!;
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
  }, []);
  const detected: DetectedScene = {
    devices: (['cpu', 'gpu', 'memory', 'storage'] as const).flatMap((category) =>
      scan[category].map((_, index) => ({ category, index })),
    ),
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
        <br />
        Component shapes, board size and placement are illustrative. Socket, physical layout and
        integrated versus discrete adapter placement are not inferred.
      </p>
      <div className="detected-toolbar">
        <button className="button secondary" onClick={() => command('reset')}>
          Reset camera
        </button>
        <button className="button secondary" onClick={() => command('fit')}>
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
                {q === 'auto' ? 'Automatic' : q[0]!.toUpperCase() + q.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" onClick={() => void toggleFullscreen(true)}>
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
        {graphics && board.category === 'motherboard' ? (
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
                board={board}
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
                diagnostics={false}
                onMetrics={() => undefined}
                onFailure={failed}
              />
            </Suspense>
          </GraphicsBoundary>
        ) : (
          fallback
        )}
      </div>
      <nav className="detected-components" aria-label="Detected components">
        <button className="button secondary" onClick={() => selectDevice('motherboard')}>
          Motherboard
        </button>
        {detected.devices.map((d) => (
          <button
            className="button secondary"
            key={`${d.category}-${d.index}`}
            onClick={() => selectDevice(d.category, d.index)}
          >
            {categoryNames[d.category]}
            {scan[d.category].length > 1 ? ` ${d.index + 1}` : ''}
          </button>
        ))}
      </nav>
      {selected && (
        <HardwareInspector
          scan={scan}
          category={selected}
          deviceIndex={deviceIndex}
          close={() => setSelected(null)}
        />
      )}
    </main>
  );
}
