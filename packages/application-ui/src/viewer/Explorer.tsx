import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Motherboard } from '@cortex/part-schema';
import { type QualityMode } from '@cortex/3d-engine';
import type { SceneMetrics } from '@cortex/3d-engine/renderer';
import { useViewerStore } from './store';
import { supportsWebGL2 } from './graphics';
import { GraphicsBoundary } from './GraphicsBoundary';
import ComponentList from './ComponentList';
import InfoPanel from './InfoPanel';
import FallbackDiagram from './FallbackDiagram';
import { Icon } from '../icons';
import { isDesktop, setDesktopFullscreen, recordGraphicsFailure } from '../platform';
import AssemblyPanel, { BuildSummary } from '../Assembly';
import { useBuildStore } from '../build-store';
import { destinations, remove, type SlotId } from '@cortex/build-domain';

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
export default function Explorer({
  board,
  assembly = false,
}: {
  board: Motherboard;
  assembly?: boolean;
}) {
  const state = useViewerStore();
  const build = useBuildStore();
  const [panel, setPanel] = useState<'inspect' | 'assembly'>(assembly ? 'assembly' : 'inspect');
  const part = build.catalog.find((p) => p.id === build.chosenPartId);
  const validSlots =
    build.build && part && build.choosing
      ? destinations(
          build.replacing ? remove(build.build, build.replacing) : build.build,
          part,
          build.catalog,
        )
          .filter((s) => s.installable && (!build.replacing || s.id === build.replacing))
          .map((s) => s.id)
      : [];
  const previewSlot =
    validSlots.find((id) => id === state.hovered) ??
    (validSlots.includes(build.preview!) ? build.preview : null);
  const select = (id: Parameters<typeof state.select>[0]) => {
    state.select(id);
    if (id && validSlots.includes(id as SlotId)) build.setPreview(id as SlotId);
    else if (!build.choosing && !build.busy) {
      const installed = build.build?.installations.find((i) => i.slotId === id);
      if (installed) {
        build.choose(installed.partId);
        setPanel('assembly');
      }
    }
  };
  const reducedMotion = useReducedMotion();
  const [graphics, setGraphics] = useState<
    'ready' | 'unsupported' | 'failed' | 'load-failed' | 'diagram'
  >(() =>
    new URLSearchParams(location.search).get('graphics') === 'off'
      ? 'diagram'
      : supportsWebGL2()
        ? 'ready'
        : 'unsupported',
  );
  const [attempt, setAttempt] = useState(0);
  // Recreate the boundary for context retries. Failed ESM imports require a reload.
  const Renderer = useMemo(() => {
    void attempt;
    return lazy(() => import('@cortex/3d-engine/renderer'));
  }, [attempt]);
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  const [notice, setNotice] = useState('');
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const diagnostics = import.meta.env.DEV && new URLSearchParams(location.search).has('debug');
  const onFailure = useCallback(() => setGraphics('failed'), []);
  const onLoadFailure = useCallback(
    (error: Error) =>
      setGraphics(/fetch|module|chunk|import/i.test(error.message) ? 'load-failed' : 'failed'),
    [],
  );
  useEffect(() => () => useViewerStore.getState().clear(), [board.id]);
  useEffect(() => {
    if (graphics === 'unsupported') recordGraphicsFailure('unsupported-webgl2');
    if (graphics === 'failed') recordGraphicsFailure('context-lost');
    if (graphics === 'load-failed') recordGraphicsFailure('renderer-load-failed');
  }, [graphics]);
  useEffect(() => {
    if (!nativeFullscreen) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void setDesktopFullscreen(false).then(setNativeFullscreen);
    };
    window.addEventListener('keydown', exit);
    return () => {
      window.removeEventListener('keydown', exit);
    };
  }, [nativeFullscreen]);
  useEffect(
    () => () => {
      if (isDesktop) void setDesktopFullscreen(false);
    },
    [],
  );
  const fallback = (
    <FallbackDiagram selected={state.selected} onSelect={select} exploded={state.exploded} />
  );
  const retry = () => {
    if (graphics === 'load-failed') {
      location.reload();
      return;
    }
    setAttempt((n) => n + 1);
    setGraphics(supportsWebGL2() ? 'ready' : 'unsupported');
  };
  const fullscreen = async () => {
    try {
      if (isDesktop) {
        setNativeFullscreen(await setDesktopFullscreen(!nativeFullscreen));
        viewport.current?.focus();
      } else if (document.fullscreenElement) await document.exitFullscreen();
      else await viewport.current?.requestFullscreen();
    } catch {
      setNotice('Fullscreen could not be changed.');
    }
  };
  return (
    <main className="explorer-page">
      <div className="breadcrumb">
        <a href="#/">Workspace</a>
        <Icon name="chevron" size={12} />
        <span>Motherboard Explorer</span>
      </div>
      <div className="explorer-heading">
        <div>
          <div className="eyebrow">THE HARDWARE WORKSPACE</div>
          <h1>
            Motherboard Explorer<span className="title-dot">.</span>
          </h1>
          <p>Explore the architecture. Understand every connection.</p>
        </div>
        <span className="fixture-badge">
          <span />
          DEVELOPMENT FIXTURE
        </span>
      </div>
      <BuildSummary />
      <div className="explorer-workspace">
        <ComponentList onSelect={select} />
        <section
          className={`viewport ${nativeFullscreen ? 'viewer-fullscreen' : ''}`}
          ref={viewport}
          tabIndex={-1}
          aria-label="Interactive motherboard viewer"
          data-testid="viewport"
          data-exploded={state.exploded}
          data-selected={state.selected ?? ''}
        >
          <div className="viewport-heading">
            <div>
              <span className="eyebrow">CORTEX LAB</span>
              <h2>{board.model}</h2>
            </div>
            <span className="view-badge">
              {graphics === 'ready' ? '3D EXPLORER' : '2D DIAGRAM'}
            </span>
          </div>
          <div
            className={`canvas-stage ${state.hovered ? 'has-hover' : ''}`}
            data-testid="canvas-stage"
          >
            {graphics === 'ready' ? (
              <GraphicsBoundary key={attempt} fallback={fallback} onError={onLoadFailure}>
                <Suspense
                  fallback={
                    <div className="scene-loading" role="status">
                      <span className="loading-ring" />
                      Preparing your workspace…
                    </div>
                  }
                >
                  <Renderer
                    board={board}
                    selected={state.selected}
                    hovered={state.hovered}
                    onSelect={select}
                    onHover={state.hover}
                    exploded={state.exploded}
                    labels={state.labels}
                    reducedMotion={reducedMotion}
                    quality={state.quality}
                    cameraCommand={state.cameraCommand}
                    diagnostics={diagnostics}
                    onMetrics={setMetrics}
                    onFailure={onFailure}
                    assembly={{
                      installations: build.build?.installations ?? [],
                      transitions: build.transitions,
                      preview:
                        previewSlot && part ? { slotId: previewSlot, partId: part.id } : null,
                      validSlots,
                      catalog: build.catalog,
                    }}
                  />
                </Suspense>
              </GraphicsBoundary>
            ) : (
              fallback
            )}
          </div>
          {graphics === 'ready' && (
            <div className="camera-zoom-controls">
              <button
                className="tool-button"
                aria-label="Zoom in"
                onClick={() => state.camera('zoom-in')}
              >
                +
              </button>
              <button
                className="tool-button"
                aria-label="Zoom out"
                onClick={() => state.camera('zoom-out')}
              >
                −
              </button>
            </div>
          )}
          {graphics !== 'ready' && (
            <div className="graphics-notice" role="status">
              <Icon name="info" size={16} />
              <span>
                {graphics === 'unsupported'
                  ? 'WebGL 2 is unavailable. All component information is available in this diagram.'
                  : graphics === 'failed' || graphics === 'load-failed'
                    ? '3D rendering failed. You can keep exploring the diagram.'
                    : 'Diagram mode. Select any component to inspect it.'}
              </span>
              <button onClick={retry}>{graphics === 'diagram' ? 'Open 3D' : 'Retry 3D'}</button>
            </div>
          )}
          <div className="viewport-footer">
            <div className="interaction-hint">
              <span className="hint-dot" />
              {graphics === 'ready'
                ? 'Drag to orbit · Scroll to zoom · Right-drag to pan'
                : 'Tap a region or select from the component list'}
            </div>
            <span className="board-dimensions">
              {board.visual.dimensions.width} × {board.visual.dimensions.depth} MM
            </span>
          </div>
          <div className="viewer-toolbar">
            <div className="toolbar-group">
              <button
                className="tool-button"
                onClick={() => state.camera('reset')}
                aria-label="Reset camera"
                disabled={graphics !== 'ready'}
              >
                <Icon name="reset" />
              </button>
              <button
                className="tool-button"
                onClick={() => state.camera('fit')}
                aria-label="Fit board to view"
                disabled={graphics !== 'ready'}
              >
                <Icon name="focus" />
              </button>
            </div>
            <div className="toolbar-divider" />
            <button
              className={`tool-button labeled ${state.exploded ? 'on' : ''}`}
              aria-pressed={state.exploded}
              onClick={state.toggleExploded}
            >
              <Icon name="layers" />
              <span>Exploded view</span>
            </button>
            <button
              className={`tool-button labeled ${state.labels ? 'on' : ''}`}
              aria-pressed={state.labels}
              onClick={state.toggleLabels}
              disabled={graphics !== 'ready'}
            >
              <Icon name="eye" />
              <span>Labels</span>
            </button>
            <div className="toolbar-spacer" />
            <label className="quality-label">
              <span>Quality</span>
              <select
                aria-label="Rendering quality"
                value={state.quality}
                onChange={(e) => state.setQuality(e.target.value as QualityMode)}
              >
                {['auto', 'low', 'medium', 'high', 'ultra'].map((level) => (
                  <option key={level} value={level}>
                    {level[0]?.toUpperCase()}
                    {level.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="tool-button diagram-toggle"
              onClick={() => (graphics === 'ready' ? setGraphics('diagram') : retry())}
              aria-label={graphics === 'ready' ? 'Use 2D diagram' : 'Use 3D viewer'}
            >
              <Icon name="grid" />
            </button>
            {(isDesktop || document.fullscreenEnabled) && (
              <button
                className="tool-button"
                onClick={() => void fullscreen()}
                aria-label="Fullscreen viewer"
              >
                <Icon name="expand" />
              </button>
            )}
          </div>
          {notice && (
            <p role="status" className="toolbar-notice">
              {notice}
            </p>
          )}
          {diagnostics && metrics && (
            <output
              className="dev-metrics"
              data-testid="diagnostics"
              data-camera={metrics.camera}
              data-projections={JSON.stringify(metrics.projections)}
              data-geometries={metrics.geometries}
              data-materials={metrics.materials}
              data-textures={metrics.textures}
              data-installed-visuals={JSON.stringify(metrics.installedVisuals)}
              data-transitions={build.transitions.length}
            >
              {metrics.fps || 'idle'} FPS · {metrics.frameMs} ms · {metrics.calls} draws ·{' '}
              {metrics.triangles} triangles · {metrics.geometries} geometries · {metrics.textures}{' '}
              textures · {metrics.quality}
            </output>
          )}
        </section>
        <div className="inspector-stack">
          <div className="inspector-tabs">
            <button aria-pressed={panel === 'inspect'} onClick={() => setPanel('inspect')}>
              Inspect
            </button>
            <button aria-pressed={panel === 'assembly'} onClick={() => setPanel('assembly')}>
              Assembly
            </button>
          </div>
          {panel === 'inspect' ? <InfoPanel board={board} /> : <AssemblyPanel />}
        </div>
      </div>
      <div className="explorer-bottom-note">
        <span>
          <Icon name="check" size={14} />
          Original procedural model · No external assets
        </span>
        <span>REFERENCE SERIES / 001</span>
      </div>
    </main>
  );
}
