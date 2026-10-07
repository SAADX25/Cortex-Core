import { useQuery } from '@tanstack/react-query';
import { getDesktopStatus, isDesktop, openDocumentation } from './platform';
export default function Settings() {
  const status = useQuery({
    queryKey: ['desktop-status'],
    queryFn: getDesktopStatus,
    enabled: isDesktop,
  });
  const data = status.data;
  return (
    <main className="settings-page">
      <div className="eyebrow">APPLICATION</div>
      <h1>Settings</h1>
      <section className="settings-section">
        <h2>Cortex Core Desktop</h2>
        <p className="muted">Version 0.2.0 · Unsigned development build</p>
        <dl className="spec-list">
          <div>
            <dt>Runtime</dt>
            <dd>{isDesktop ? 'Tauri 2 / WebView2' : 'Browser test renderer'}</dd>
          </div>
          <div>
            <dt>Hardware catalog</dt>
            <dd>{data?.catalogVersion ?? '2026.10.07.1'} · Fictional fixtures</dd>
          </div>
          <div>
            <dt>Asset manifest</dt>
            <dd>v{data?.assetManifestVersion ?? 1}</dd>
          </div>
          <div>
            <dt>Offline catalog</dt>
            <dd>{data?.cacheStatus ?? (isDesktop ? 'Checking…' : 'Bundled fixtures')}</dd>
          </div>
          {data && (
            <>
              <div>
                <dt>Display scale</dt>
                <dd>
                  {data.scaleFactor}× · {data.windowWidth} × {data.windowHeight} pixels
                </dd>
              </div>
              <div>
                <dt>Application assets</dt>
                <dd>{data.packaged ? 'Packaged locally' : 'Development server'}</dd>
              </div>
            </>
          )}
        </dl>
        {status.isError && <p role="status">Native diagnostics are unavailable.</p>}
      </section>
      <section className="settings-section">
        <h2>3D asset cache</h2>
        <p className="muted">0 bytes · The reference board is an original procedural template.</p>
        <button className="button secondary" disabled>
          Clear unused assets
        </button>
        <p className="muted">
          Cache management will become available with downloadable product assets. The hardware
          database is stored separately.
        </p>
      </section>
      <section className="settings-section">
        <h2>Updates & support</h2>
        <p className="muted">
          Application updates are not enabled in this development build. Catalog and asset versions
          are independent.
        </p>
        <p className="muted">
          Graphics failures record an app version, platform and failure code locally. No hardware
          serial numbers, file paths or personal information are collected.
        </p>
        <div className="settings-actions">
          <button className="button secondary" onClick={() => void openDocumentation('tauri')}>
            Desktop runtime documentation
          </button>
          <button
            className="button secondary"
            onClick={() => void openDocumentation('hardware-sources')}
          >
            3D format documentation
          </button>
        </div>
      </section>
    </main>
  );
}
