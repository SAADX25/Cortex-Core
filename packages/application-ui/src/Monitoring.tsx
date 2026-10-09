import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop, openDocumentation } from './platform';
import {
  sensorCategories,
  sensorValue,
  SensorPoller,
  unavailableSensors,
} from './external-sensors';
import './monitoring.css';

const labels = {
  cpu: 'CPU',
  gpu: 'GPU (discrete / integrated)',
  motherboard: 'Motherboard',
  storage: 'Physical storage',
  memory: 'RAM',
  unsupported: 'Unsupported hardware',
};
export default function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => unavailableSensors('disabled'));
  const [consent, setConsent] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [now, setNow] = useState(Date.now);
  const poller = useRef<SensorPoller | null>(null);
  useEffect(() => {
    const instance = new SensorPoller(
      {
        configure: (consent) => invoke<number>('configure_external_sensors', { consent }),
        read: (session) => invoke<unknown>('read_external_sensors', { session }),
      },
      {
        after: (callback, ms) => window.setTimeout(callback, ms),
        cancel: (timer) => window.clearTimeout(timer as number),
      },
      setSnapshot,
    );
    poller.current = instance;
    const pause = () => {
      if (document.hidden) {
        instance.stop();
        setEnabled(false);
        setConsent(false);
      }
    };
    const freshness = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('visibilitychange', pause);
    return () => {
      instance.stop();
      poller.current = null;
      window.clearInterval(freshness);
      document.removeEventListener('visibilitychange', pause);
    };
  }, []);
  return (
    <main className="mypc-page monitoring-page">
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow">EXTERNAL TEMPERATURE SOURCE · EXPERIMENTAL</div>
          <h1>
            Monitoring<span className="title-dot">.</span>
          </h1>
          <p className="muted">
            Read temperatures reported by your own LibreHardwareMonitor installation.
          </p>
        </div>
      </div>
      <section className="sensor-setup" aria-label="Sensor setup">
        <h2>Set up on an independently validated PC</h2>
        <p>
          This adapter has been tested with mock data only. Hardware support depends on the external
          application and actual sensors. The previous native providers remain disabled.
        </p>
        <ol>
          <li>
            Obtain LibreHardwareMonitor from its{' '}
            <a
              href="https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (isDesktop) {
                  event.preventDefault();
                  void openDocumentation('sensor-source').catch(() =>
                    setSnapshot(unavailableSensors('Could not open official release page')),
                  );
                }
              }}
            >
              official releases
            </a>{' '}
            and review its requirements yourself.
          </li>
          <li>
            Use a version with the reviewed 0.9.5 / 0.9.6 JSON contract. Configure port 8085 for
            local access only. A wildcard listener or shared Windows HTTP.sys listener will be
            refused. Some official builds may not meet this requirement.
          </li>
          <li>
            Keep remote access disabled. Do not open firewall ports. If local-only access cannot be
            verified, leave the source disconnected.
          </li>
        </ol>
        <p>
          Cortex reads only <code>http://127.0.0.1:8085/data.json</code>. Installation, startup,
          configuration and elevation are entirely user-managed.
        </p>
        <label className="sensor-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!isDesktop || enabled}
            onChange={(event) => setConsent(event.target.checked)}
          />{' '}
          I completed setup on a separately validated PC and consent to local, read-only temperature
          polling for this session.
        </label>
        <div className="dashboard-actions">
          <button
            className="button primary"
            disabled={!isDesktop || !consent || enabled || document.hidden}
            onClick={() => {
              setEnabled(true);
              void poller.current?.start().then((started) => {
                if (!started) setEnabled(false);
              });
            }}
          >
            Connect local source
          </button>
          <button
            className="button secondary"
            disabled={!enabled}
            onClick={() => {
              poller.current?.stop();
              setEnabled(false);
              setConsent(false);
            }}
          >
            Disconnect
          </button>
        </div>
        <p role="status">
          {!isDesktop
            ? 'Desktop required. Not available in browser preview.'
            : snapshot.status === 'disabled'
              ? 'Disconnected. No sensor requests.'
              : snapshot.status === 'waiting'
                ? 'Waiting for local source…'
                : snapshot.status === 'connected'
                  ? 'Local source connected.'
                  : snapshot.status}
        </p>
        <p className="muted">
          Polling stops when you leave Monitoring or hide the app. Reconnect explicitly to resume.
          No source is enabled automatically.
        </p>
      </section>
      <p className="muted">
        Sensors are grouped by the source’s hardware IDs. Exact matching to My PC devices is{' '}
        <strong>Not available</strong>: the source does not share verified device identities. No
        name-based mapping is used. Observation time records receipt; hardware measurement time is
        not supplied by this endpoint.
      </p>
      <section className="sensor-grid" aria-label="Source-reported temperature sensors">
        {sensorCategories
          .filter(
            (category) =>
              category !== 'unsupported' || snapshot.sensors.some((s) => s.category === category),
          )
          .map((category) => {
            const sensors = snapshot.sensors.filter((s) => s.category === category);
            return (
              <article className="sensor-card" key={category}>
                <h2>{labels[category]}</h2>
                {sensors.length === 0 ? (
                  <>
                    <strong>Not available</strong>
                    <p className="muted">No supported temperature sensor reported.</p>
                  </>
                ) : (
                  sensors.map((sensor, index) => (
                    <div className="sensor-row" key={`${sensor.sensorId}:${index}`}>
                      <strong>{sensor.hardwareName}</strong>
                      <span>{sensor.sensorName}</span>
                      <b>{sensorValue(sensor, now)}</b>
                      <code>
                        {sensor.hardwareId} · {sensor.sensorId}
                      </code>
                      <small>
                        {sensorValue(sensor, now) === 'Not available'
                          ? 'Missing, stale, ambiguous or unsupported'
                          : `Observed ${new Date(sensor.observedAt).toLocaleTimeString()}`}
                      </small>
                    </div>
                  ))
                )}
              </article>
            );
          })}
      </section>
    </main>
  );
}
