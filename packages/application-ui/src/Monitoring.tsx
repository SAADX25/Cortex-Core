import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop, openDocumentation } from './platform';
import {
  sensorCategories,
  sensorValue,
  SensorPoller,
  unavailableSensors,
} from './external-sensors';
import {
  TemperatureHistory,
  chartRanges,
  chartSegments,
  defaultThresholds,
  freshTemperature,
  sensorKey,
  temperatureWarning,
  type HistoryPoint,
} from './thermal-history';
import './monitoring.css';

const labels = {
  cpu: 'CPU',
  gpu: 'GPU · discrete / integrated',
  motherboard: 'Motherboard',
  storage: 'Storage · SSD / NVMe / HDD',
  memory: 'RAM · DIMM',
  unsupported: 'Unsupported hardware',
};
type Phase = 'disconnected' | 'connecting' | 'monitoring' | 'error';
function HistoryChart({
  points,
  now,
  minutes,
}: {
  points: readonly HistoryPoint[];
  now: number;
  minutes: number;
}) {
  const segments = chartSegments(points, now, minutes);
  const values = segments.flat().map((point) => point[1]!);
  if (!values.length)
    return <div className="thermal-chart-empty">No observations in this range. Not available.</div>;
  const low = Math.floor(Math.min(...values) - 2),
    high = Math.ceil(Math.max(...values) + 2);
  const x = (at: number) => 48 + (650 * (at - (now - minutes * 60000))) / (minutes * 60000);
  const y = (value: number) => 180 - (150 * (value - low)) / (high - low);
  return (
    <>
      <svg
        className="thermal-chart"
        viewBox="0 0 720 218"
        role="img"
        aria-label={`Temperature observations over ${minutes} minutes. ${values.length} observations, ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)} degrees Celsius. Gaps indicate unavailable data.`}
      >
        {[low, (low + high) / 2, high].map((value) => (
          <g key={value}>
            <line x1="48" x2="698" y1={y(value)} y2={y(value)} className="chart-grid" />
            <text x="2" y={y(value) + 4}>
              {value.toFixed(0)}°
            </text>
          </g>
        ))}
        {segments.map((segment, index) => (
          <g key={index}>
            <polyline points={segment.map(([at, value]) => `${x(at!)},${y(value!)}`).join(' ')} />
            <circle cx={x(segment.at(-1)![0]!)} cy={y(segment.at(-1)![1]!)} r="3" />
          </g>
        ))}
        <text x="48" y="210">
          −{minutes} min
        </text>
        <text x="665" y="210">
          Now
        </text>
      </svg>
      <details className="history-values">
        <summary>Read recent observations</summary>
        <table>
          <caption>
            Latest 20 observations in this range. Receipt times, not hardware measurement times.
          </caption>
          <thead>
            <tr>
              <th>Observed</th>
              <th>Temperature</th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter(([at]) => at >= now - minutes * 60000 && at <= now)
              .slice(-20)
              .map(([at, value]) => (
                <tr key={at}>
                  <td>{new Date(at).toLocaleTimeString()}</td>
                  <td>{value === null ? 'Not available' : `${value.toFixed(1)} °C`}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

export default function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => unavailableSensors('disabled'));
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>('disconnected');
  const [now, setNow] = useState(Date.now);
  const [lastObservation, setLastObservation] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<number>(5);
  const [selected, setSelected] = useState('');
  const [warnings, setWarnings] = useState(false);
  const [thresholds, setThresholds] = useState(defaultThresholds);
  const [linkError, setLinkError] = useState('');
  const history = useRef(new TemperatureHistory());
  const poller = useRef<SensorPoller | null>(null);
  const active = phase === 'connecting' || phase === 'monitoring';
  useEffect(() => {
    let alive = true;
    const sessionHistory = history.current;
    const instance = new SensorPoller(
      {
        open: () => invoke<number>('open_external_sensor_session'),
        configure: (consent, owner, revision) =>
          invoke<number>('configure_external_sensors', { consent, owner, revision }),
        read: (session) => invoke<unknown>('read_external_sensors', { session }),
      },
      {
        after: (callback, ms) => window.setTimeout(callback, ms),
        cancel: (timer) => window.clearTimeout(timer as number),
      },
      (snapshot) => {
        if (!alive) return;
        const at = Date.now();
        sessionHistory.observe(snapshot, at);
        setNow(at);
        setSnapshot(snapshot);
        if (
          snapshot.status === 'connected' &&
          snapshot.observedAt !== null &&
          snapshot.observedAt <= at &&
          at - snapshot.observedAt <= 15000
        )
          setLastObservation(snapshot.observedAt);
      },
      (phase) => {
        if (alive) {
          setPhase(phase);
          if (phase === 'error') setConsent(false);
        }
      },
    );
    poller.current = instance;
    const pause = () => {
      sessionHistory.clear();
      instance.stop();
      setConsent(false);
      setLastObservation(null);
    };
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    window.addEventListener('beforeunload', pause);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', pause);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('beforeunload', pause);
      instance.stop();
      sessionHistory.clear();
      poller.current = null;
    };
  }, []);
  // One freshness deadline per observation. No idle timer or high-frequency render loop.
  useEffect(() => {
    if (!active || snapshot.observedAt === null) return;
    const remaining = snapshot.observedAt + 15001 - Date.now();
    if (remaining <= 0 || snapshot.observedAt > Date.now()) return;
    const timer = window.setTimeout(() => {
      const at = Date.now();
      history.current.gap(at);
      history.current.prune(at);
      setNow(at);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [active, snapshot]);
  const entries = history.current.entries();
  const key = entries.some(([key]) => key === selected) ? selected : (entries[0]?.[0] ?? '');
  const fresh =
    snapshot.status === 'connected' &&
    snapshot.observedAt !== null &&
    snapshot.observedAt <= now &&
    now - snapshot.observedAt <= 15000;
  const status =
    phase === 'error'
      ? 'Error'
      : phase === 'disconnected'
        ? 'Disconnected'
        : phase === 'connecting'
          ? 'Connecting'
          : fresh
            ? 'Fresh'
            : 'Stale';
  const alerts = fresh
    ? snapshot.sensors.filter((s) => temperatureWarning(s, now, warnings, thresholds))
    : [];
  const disconnect = () => {
    history.current.clear();
    poller.current?.stop();
    setConsent(false);
    setLastObservation(null);
  };
  return (
    <main className="mypc-page monitoring-page">
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow">EXTERNAL TEMPERATURE SOURCE · EXPERIMENTAL</div>
          <h1>
            Monitoring<span className="title-dot">.</span>
          </h1>
          <p className="muted">
            Source-reported temperatures. Session history. Clear availability.
          </p>
        </div>
        <span className={`thermal-status ${fresh ? 'is-fresh' : ''}`}>{status}</span>
      </div>
      <section className="thermal-source" aria-label="Source status">
        <div>
          <h2>LibreHardwareMonitor</h2>
          <p role="status">
            {!isDesktop
              ? 'Desktop required. Not available in browser preview.'
              : phase === 'disconnected'
                ? 'Disconnected. No sensor requests.'
                : phase === 'error'
                  ? snapshot.status
                  : phase === 'connecting'
                    ? 'Waiting for local source…'
                    : fresh
                      ? 'Local source connected.'
                      : 'Reading stale. Not available.'}
          </p>
          <small>
            Last successful observation:{' '}
            {lastObservation === null
              ? 'Not available'
              : new Date(lastObservation).toLocaleTimeString()}{' '}
            · Freshness limit 15 seconds · Fixed loopback only
          </small>
        </div>
        <button
          className="button secondary"
          disabled={!active && phase !== 'error'}
          onClick={disconnect}
        >
          Disconnect
        </button>
      </section>
      <details className="sensor-setup" open={!active}>
        <summary>Setup and session consent</summary>
        <h2>Set up on an independently validated PC</h2>
        <p>
          This adapter has been tested with mock data only. Support depends on the external
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
                    setLinkError('Could not open official release page'),
                  );
                }
              }}
            >
              official releases
            </a>{' '}
            and review its requirements yourself.
          </li>
          <li>
            Use the reviewed 0.9.5 / 0.9.6 JSON contract. Configure port 8085 for local access only.
            Wildcard and shared Windows HTTP.sys listeners are refused; some official builds may not
            qualify.
          </li>
          <li>
            Keep remote access disabled. Do not open firewall ports. If local-only access cannot be
            verified, leave the source disconnected.
          </li>
        </ol>
        <p>
          Cortex reads only <code>http://127.0.0.1:8085/data.json</code>. Installation, startup,
          configuration and elevation are user-managed.
        </p>
        <label className="sensor-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!isDesktop || active}
            onChange={(event) => setConsent(event.target.checked)}
          />
          I completed setup on a separately validated PC and consent to local, read-only temperature
          polling for this session.
        </label>
        <button
          className="button primary"
          disabled={!isDesktop || !consent || active || document.hidden}
          onClick={() => {
            history.current.clear();
            setLastObservation(null);
            void poller.current?.start();
          }}
        >
          Connect local source
        </button>
        {linkError && <p>{linkError}</p>}
        <p className="muted">
          Polling stops when you leave Monitoring, hide the app, lose window focus or reload.
          Reconnect explicitly to resume.
        </p>
      </details>
      <section className="thermal-history" aria-label="Temperature history">
        <div className="thermal-section-heading">
          <div>
            <div className="eyebrow">SESSION OBSERVATIONS</div>
            <h2>Temperature history</h2>
          </div>
          <label>
            Time range
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              {chartRanges.map((range) => (
                <option key={range} value={range}>
                  {range} min
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="history-selector">
          Source sensor
          <select
            value={key}
            disabled={!entries.length}
            onChange={(event) => setSelected(event.target.value)}
          >
            {!entries.length && <option value="">Not available</option>}
            {entries.map(([key, series]) => (
              <option key={key} value={key}>
                {series.hardwareName} · {series.sensorName} · {series.sensorId}
              </option>
            ))}
          </select>
        </label>
        <HistoryChart points={history.current.get(key)} now={now} minutes={minutes} />
        <p className="muted">
          In memory only, up to 60 minutes. Gaps stay empty. History clears on disconnect or leaving
          this page.{' '}
          {history.current.truncated &&
            'History capacity reached; older observations or additional sensors were omitted.'}
        </p>
      </section>
      <details className="thermal-warnings">
        <summary>Optional temperature warnings</summary>
        <label className="sensor-consent">
          <input
            type="checkbox"
            checked={warnings}
            onChange={(event) => setWarnings(event.target.checked)}
          />
          Show on-screen warnings for fresh, available readings
        </label>
        <div className="threshold-grid">
          {Object.entries(thresholds).map(([category, value]) => (
            <label key={category}>
              {labels[category as keyof typeof labels]} warning threshold (°C)
              <input
                type="number"
                min="-100"
                max="200"
                value={value}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value) && value >= -100 && value <= 200)
                    setThresholds((current) => ({ ...current, [category]: value }));
                }}
              />
            </label>
          ))}
        </div>
        <p className="muted">
          These are user-chosen display thresholds, not device safety limits. No protection,
          shutdown or hardware control. Warnings need a fresh reading and clear automatically when
          data is unavailable.
        </p>
      </details>
      {alerts.length > 0 && (
        <aside className="thermal-alerts" aria-label="Temperature warnings">
          <h2>Temperature warnings</h2>
          {alerts.slice(0, 64).map((sensor, index) => (
            <p key={`${sensorKey(sensor)}:${index}`}>
              {sensor.hardwareName} · {sensor.sensorName}: {sensorValue(sensor, now)} reaches your{' '}
              {thresholds[sensor.category as keyof typeof thresholds]} °C threshold.
            </p>
          ))}
          {alerts.length > 64 && <p>Additional warnings omitted from this view.</p>}
        </aside>
      )}
      <div className="thermal-section-heading">
        <div>
          <div className="eyebrow">SOURCE HARDWARE</div>
          <h2>Temperature sensors</h2>
        </div>
        <span className="muted">
          {fresh ? snapshot.sensors.filter((s) => freshTemperature(s, now) !== null).length : 0}{' '}
          available
        </span>
      </div>
      <p className="muted">
        Exact matching to My PC devices: <strong>Not available</strong>. Source IDs are preserved;
        no name-based mapping is used. Observation time is receipt time; this endpoint supplies no
        hardware measurement timestamp.
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
                {!sensors.length ? (
                  <>
                    <strong className="thermal-value">Not available</strong>
                    <p className="muted">No supported temperature sensor reported.</p>
                  </>
                ) : (
                  sensors.slice(0, 128).map((sensor, index) => (
                    <div className="sensor-row" key={`${sensorKey(sensor)}:${index}`}>
                      <strong>{sensor.hardwareName}</strong>
                      <span>{sensor.sensorName}</span>
                      <b className="thermal-value">
                        {fresh ? sensorValue(sensor, now) : 'Not available'}
                      </b>
                      <span className="sensor-availability">
                        {!fresh && sensor.availability === 'available'
                          ? 'stale'
                          : sensor.availability}
                      </span>
                      <code>
                        {sensor.hardwareId}
                        <br />
                        {sensor.sensorId}
                      </code>
                      <small>
                        Observed {new Date(sensor.observedAt).toLocaleTimeString()} · °C · Device
                        match unavailable
                      </small>
                    </div>
                  ))
                )}
                {sensors.length > 128 && (
                  <p>Additional sensors omitted from this view ({sensors.length - 128}).</p>
                )}
              </article>
            );
          })}
      </section>
    </main>
  );
}
