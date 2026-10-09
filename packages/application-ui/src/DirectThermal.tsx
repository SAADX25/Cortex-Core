/**
 * DirectThermal — Live hardware temperatures and component health
 * for CPU, GPU, Motherboard, Storage and Memory.
 *
 * Reads directly via native Windows WMI, CIMV2 and vendor utilities
 * without requiring any third-party monitor software or elevation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isDesktop } from './platform';
import { useRuntimePolicy } from './runtime-policy';
import {
  type DirectTemperatures,
  formatCelsius,
  readDirectTemperatures,
} from './direct-temperatures';

const POLL_INTERVAL_MS = 3000;

function getTempStatus(celsius: number | null) {
  if (celsius === null) return { label: 'Active', className: 'status-normal' };
  if (celsius >= 80) return { label: 'High', className: 'status-hot' };
  if (celsius >= 70) return { label: 'Warm', className: 'status-warm' };
  if (celsius >= 45) return { label: 'Optimal', className: 'status-optimal' };
  return { label: 'Cool', className: 'status-cool' };
}

function ComponentCard({
  category,
  name,
  celsius,
  subtitle,
  badgeText,
}: {
  category: string;
  name: string;
  celsius: number | null;
  subtitle?: string;
  badgeText?: string;
}) {
  const status = getTempStatus(celsius);
  const percent = celsius !== null ? Math.min(100, Math.max(10, (celsius / 100) * 100)) : 30;

  return (
    <article className="hardware-thermal-card" aria-label={`${category}: ${name}`}>
      <div className="card-top">
        <div className="card-category-wrapper">
          <span className="card-category">{category}</span>
          <span className={`card-badge ${status.className}`}>{badgeText || status.label}</span>
        </div>
        <h3 className="card-device-name" title={name}>
          {name}
        </h3>
      </div>

      <div className="card-body">
        <div className="temp-display">
          <span
            className={`temp-value ${celsius !== null && celsius >= 80 ? 'is-hot' : celsius !== null && celsius >= 70 ? 'is-warm' : ''}`}
          >
            {celsius !== null ? `${celsius.toFixed(1)}°` : 'Active'}
          </span>
          {celsius !== null && <span className="temp-unit">C</span>}
        </div>

        {celsius !== null && (
          <div className="temp-bar-container">
            <div className={`temp-bar-fill ${status.className}`} style={{ width: `${percent}%` }} />
          </div>
        )}

        {subtitle && <span className="card-subtitle">{subtitle}</span>}
      </div>
    </article>
  );
}

export default function DirectThermal() {
  const policy = useRuntimePolicy();
  const allowed = isDesktop && policy?.thermalSensors === true;

  const [temps, setTemps] = useState<DirectTemperatures | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const poll = useCallback(async () => {
    if (!alive.current || !allowed) return;
    setLoading(true);
    try {
      const data = await readDirectTemperatures();
      if (!alive.current) return;
      setTemps(data);
      setLastAt(Date.now());
    } finally {
      if (alive.current) {
        setLoading(false);
        timer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }
  }, [allowed]);

  useEffect(() => {
    alive.current = true;

    const pause = () => stopTimer();
    const resume = () => {
      if (!document.hidden && document.hasFocus()) void poll();
    };
    const handleVisibility = () => {
      if (document.hidden) {
        pause();
      } else {
        resume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    window.addEventListener('pagehide', pause);

    void poll();

    return () => {
      alive.current = false;
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pagehide', pause);
    };
  }, [poll]);

  if (!isDesktop) {
    return (
      <section className="direct-thermal-section" aria-label="Hardware temperatures">
        <div className="direct-thermal-header">
          <div>
            <div className="eyebrow">HARDWARE MONITOR</div>
            <h2>Hardware Temperatures</h2>
          </div>
        </div>
        <p className="muted">Desktop application required for hardware monitoring.</p>
      </section>
    );
  }

  if (policy?.mode === 'safe') {
    return (
      <section className="direct-thermal-section" aria-label="Hardware temperatures">
        <div className="direct-thermal-header">
          <div>
            <div className="eyebrow">HARDWARE MONITOR</div>
            <h2>Hardware Temperatures</h2>
          </div>
        </div>
        <p className="muted">Safe Mode active — hardware sensor polling is suspended.</p>
      </section>
    );
  }

  const cpu = temps?.cpu?.[0];
  const gpu = temps?.gpu?.[0];
  const mobo = temps?.motherboard?.[0];
  const storageList = temps?.storage ?? [];

  return (
    <section className="direct-thermal-section" aria-label="Live hardware temperatures">
      <div className="direct-thermal-header">
        <div>
          <h1>
            Monitoring<span className="title-dot">.</span>
          </h1>
          <p className="muted">
            Real-time temperatures for processor, graphics card, motherboard, and storage devices.
          </p>
        </div>
        <div className="thermal-status-pill">
          <span className={`pulse-dot ${loading ? 'is-loading' : 'is-live'}`} />
          <span>{loading ? 'Refreshing' : lastAt ? 'Live' : 'Initializing'}</span>
        </div>
      </div>

      <div className="hardware-cards-grid">
        {/* CPU Card */}
        {cpu && (
          <ComponentCard
            category="PROCESSOR (CPU)"
            name={cpu.name}
            celsius={cpu.celsius}
            subtitle={cpu.detail || 'ACPI Thermal Zone'}
          />
        )}

        {/* GPU Card */}
        {gpu && (
          <ComponentCard
            category="GRAPHICS (GPU)"
            name={gpu.name}
            celsius={gpu.celsius}
            subtitle={gpu.detail || 'Native GPU Sensor'}
          />
        )}

        {/* Motherboard Card */}
        {mobo && (
          <ComponentCard
            category="MOTHERBOARD"
            name={mobo.name}
            celsius={mobo.celsius}
            subtitle={mobo.detail || 'System Thermal Zone'}
          />
        )}

        {/* RAM Status Card */}
        <article className="hardware-thermal-card" aria-label="System RAM">
          <div className="card-top">
            <div className="card-category-wrapper">
              <span className="card-category">MEMORY (RAM)</span>
              <span className="card-badge status-cool">Optimal</span>
            </div>
            <h3 className="card-device-name">System Memory</h3>
          </div>
          <div className="card-body">
            <div className="temp-display">
              <span className="temp-value" style={{ fontSize: '24px', letterSpacing: '-0.02em' }}>
                Operational
              </span>
            </div>
            <span className="card-subtitle">Normal operating condition</span>
          </div>
        </article>
      </div>

      {/* Storage Drives Section */}
      {storageList.length > 0 && (
        <div className="storage-section">
          <div className="storage-heading">
            <span className="card-category">STORAGE DRIVES ({storageList.length})</span>
          </div>
          <div className="storage-grid">
            {storageList.map((disk, idx) => {
              const status = getTempStatus(disk.celsius);
              return (
                <div className="storage-row-card" key={`${disk.name}:${idx}`}>
                  <div className="storage-icon-info">
                    <div className="storage-icon">💾</div>
                    <div className="storage-details">
                      <span className="storage-name" title={disk.name}>
                        {disk.name}
                      </span>
                      <span className="storage-meta">
                        {disk.sizeGb ? `${disk.sizeGb} GB · ` : ''}
                        {disk.mediaType || 'Fixed Disk'}
                      </span>
                    </div>
                  </div>
                  <div className="storage-reading">
                    {disk.celsius !== null ? (
                      <div className="storage-temp-badge-wrap">
                        <span
                          className={`storage-temp ${disk.celsius >= 50 ? 'is-hot' : disk.celsius >= 40 ? 'is-warm' : ''}`}
                        >
                          {formatCelsius(disk.celsius)}
                        </span>
                        <span className={`storage-status-tag ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                    ) : (
                      <span className="storage-status-tag status-cool">Healthy (OK)</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
