import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Icon, type IconName } from './icons';
import Settings from './Settings';
import { isDesktop } from './platform';
import { hardwareStore } from './hardware-store';
import {
  hardwareCategories,
  categoryNames,
  cardSummary,
  specifications,
  type HardwareCategory,
} from './hardware';
import HardwareInspector from './HardwareInspector';
import { version } from '../../../package.json';
const DetectedViewer = lazy(() => import('./viewer/DetectedViewer'));
const Monitoring = lazy(() => import('./Monitoring'));
const icons: Record<HardwareCategory, IconName> = {
  cpu: 'chip',
  gpu: 'layers',
  memory: 'grid',
  motherboard: 'chip',
  storage: 'box',
  os: 'grid',
};
export default function App() {
  const [route, setRoute] = useState(location.hash.slice(1));
  const [selected, setSelected] = useState<HardwareCategory | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const { scan, scanning, error, start, rescan } = useStore(hardwareStore);
  useEffect(() => {
    void start();
  }, [start]);
  useEffect(() => {
    const update = () => {
      setRoute(location.hash.slice(1));
      setSelected(null);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const view =
    route === '/monitoring'
      ? 'Monitoring'
      : route === '/3d'
        ? '3D View'
        : route === '/settings'
          ? 'Settings'
          : 'My PC';
  async function copy() {
    if (!scan) return;
    try {
      await navigator.clipboard.writeText(specifications(scan));
      setCopyStatus('Specifications copied');
    } catch {
      setCopyStatus('Clipboard unavailable. Please try again.');
    }
  }
  return (
    <div className="desktop-shell mypc-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="workspace-rail">
        <a className="brand" href="#/" aria-label="Cortex Core home">
          <span className="brand-mark">
            <Icon name="chip" size={24} />
          </span>
          <span>
            CORTEX<span className="brand-light">CORE</span>
          </span>
        </a>
        <nav className="workspace-nav" aria-label="Primary navigation">
          <a href="#/" aria-current={view === 'My PC' ? 'page' : undefined}>
            <Icon name="grid" size={20} />
            My PC
          </a>
          <a href="#/3d" aria-current={view === '3D View' ? 'page' : undefined}>
            <Icon name="box" size={20} />
            3D View
          </a>
          <a href="#/settings" aria-current={view === 'Settings' ? 'page' : undefined}>
            <Icon name="info" size={20} />
            Settings
          </a>
          <a href="#/monitoring" aria-current={view === 'Monitoring' ? 'page' : undefined}>
            <Icon name="layers" size={20} />
            Monitoring
          </a>
        </nav>
        <div className="rail-note">
          <span className="hint-dot" /> Local by design
          <br />
          <small>Cortex Core {version}</small>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <strong>{view}</strong>
          <span className="local-badge">
            <span className="hint-dot" />
            {isDesktop ? 'ON YOUR DEVICE' : 'BROWSER PREVIEW'}
          </span>
        </header>
        <div id="main-content" tabIndex={-1}>
          {view === 'Monitoring' ? (
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  Opening Monitoring…
                </div>
              }
            >
              <Monitoring />
            </Suspense>
          ) : view === 'Settings' ? (
            <Settings />
          ) : view === '3D View' && scan ? (
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  Opening 3D View…
                </div>
              }
            >
              <DetectedViewer scan={scan} />
            </Suspense>
          ) : (
            <main className="mypc-page">
              <div className="dashboard-heading">
                <div>
                  <div className="eyebrow">YOUR HARDWARE, AT A GLANCE</div>
                  <h1>
                    My PC<span className="title-dot">.</span>
                  </h1>
                  <p className="muted">
                    The hardware inside your computer. Automatically detected.
                  </p>
                </div>
                <div className="scan-label">
                  <span className="hint-dot" />
                  {scanning ? 'Scanning your PC…' : scan ? 'Hardware detected' : 'Ready to scan'}
                  {scan && <small>Last scanned: {new Date(scan.scannedAt).toLocaleString()}</small>}
                </div>
              </div>
              <div className="dashboard-actions">
                <button
                  className="button secondary"
                  disabled={scanning}
                  onClick={() => void rescan()}
                >
                  <Icon name="reset" />
                  {scanning ? 'Scanning…' : 'Rescan Hardware'}
                </button>
                <a
                  className={`button primary ${!scan ? 'action-disabled' : ''}`}
                  href={scan ? '#/3d' : undefined}
                  aria-disabled={!scan}
                >
                  <Icon name="box" />
                  View in 3D
                </a>
                <button className="button secondary" disabled={!scan} onClick={() => void copy()}>
                  <Icon name="layers" />
                  Copy Specifications
                </button>
                <span role="status" className="copy-status">
                  {copyStatus}
                </span>
              </div>
              {error && (
                <p className="scan-error" role="alert">
                  {error}
                </p>
              )}
              {!scan ? (
                <div className="scan-empty" role="status">
                  <Icon name="chip" size={60} />
                  <h2>
                    {scanning || !error ? 'Scanning your PC…' : 'Hardware information unavailable'}
                  </h2>
                  <p className="muted">
                    {isDesktop
                      ? 'Reading system-reported specifications locally.'
                      : 'Open Cortex Core Desktop to detect your Windows hardware.'}
                  </p>
                </div>
              ) : (
                <>
                  <section className="hardware-grid" aria-label="Detected hardware">
                    {hardwareCategories.map((key) => {
                      const summary = cardSummary(scan, key);
                      return (
                        <button
                          key={key}
                          className={`hardware-card hardware-${key}`}
                          onClick={(event) => {
                            event.currentTarget.focus();
                            setSelected(key);
                          }}
                          aria-label={`${categoryNames[key]} details`}
                        >
                          <div className="hardware-card-label">
                            <span className="hardware-symbol">
                              <Icon name={icons[key]} size={25} />
                            </span>
                            <span>{categoryNames[key]}</span>
                            <Icon name="chevron" size={17} />
                          </div>
                          <h2>{summary.name}</h2>
                          <div className="hardware-card-summary">
                            {summary.lines.map((line, i) => (
                              <p key={i}>{line}</p>
                            ))}
                          </div>
                          <span className="card-detail-link">
                            View details <Icon name="arrow" size={16} />
                          </span>
                        </button>
                      );
                    })}
                  </section>
                  <div className="dashboard-note">
                    <Icon name="check" size={18} />
                    <p>Scanned locally. Your specifications stay on this PC.</p>
                    <span>Works offline</span>
                  </div>
                </>
              )}
            </main>
          )}
        </div>
      </div>
      {scan && selected && (
        <HardwareInspector scan={scan} category={selected} close={() => setSelected(null)} />
      )}
    </div>
  );
}
