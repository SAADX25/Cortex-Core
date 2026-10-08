import { version } from '../../../package.json';
import { isDesktop } from './platform';
export default function Settings() {
  return (
    <main className="settings-page">
      <div className="eyebrow">APPLICATION</div>
      <h1>Settings</h1>
      <section className="settings-section">
        <h2>Local hardware detection</h2>
        <p className="muted">
          Cortex Core reads hardware information on this Windows PC. Scans run at startup and when
          you choose Rescan Hardware.
        </p>
        <dl className="spec-list">
          <div>
            <dt>Privacy</dt>
            <dd>Local only · No automatic uploads</dd>
          </div>
          <div>
            <dt>Last successful scan</dt>
            <dd>Cached locally for faster startup</dd>
          </div>
          <div>
            <dt>Identification</dt>
            <dd>No serial numbers, product keys or network addresses</dd>
          </div>
        </dl>
      </section>
      <section className="settings-section">
        <h2>3D visualization</h2>
        <p className="muted">
          Generic category templates illustrate detected devices. Appearance, layout and component
          placement are illustrative; specifications come from your hardware. Exact models are not
          available in this release.
        </p>
      </section>
      <section className="settings-section">
        <h2>Cortex Core Desktop</h2>
        <p className="muted">Version {version} · Unsigned development build</p>
        <p className="muted">
          {isDesktop
            ? 'Tauri 2 · Rust · Windows WebView2'
            : 'Browser preview · Hardware scanning requires Windows Desktop'}
        </p>
        <p className="muted">
          Hardware and graphics diagnostics are stored locally as category and failure codes.
          Provider errors and hardware identifiers are not logged.
        </p>
      </section>
    </main>
  );
}
