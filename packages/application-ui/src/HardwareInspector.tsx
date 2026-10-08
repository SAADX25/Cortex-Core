import { useEffect, useRef } from 'react';
import { bytes, categoryNames, type HardwareCategory, type HardwareScan } from './hardware';
import { Icon } from './icons';
export default function HardwareInspector({
  scan,
  category,
  deviceIndex,
  close,
}: {
  scan: HardwareScan;
  category: HardwareCategory;
  deviceIndex?: number;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  const devices =
    deviceIndex === undefined ? scan[category] : scan[category].filter((_, i) => i === deviceIndex);
  return (
    <dialog
      ref={dialog}
      className="hardware-inspector"
      aria-labelledby="inspector-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="inspector-heading">
        <div>
          <div className="eyebrow">DETECTED SPECIFICATIONS</div>
          <h2 id="inspector-title">{categoryNames[category]}</h2>
        </div>
        <button className="icon-button" aria-label="Close details" onClick={close}>
          <Icon name="close" size={23} />
        </button>
      </div>
      <p className="muted inspector-source">Reported by Windows on this PC.</p>
      {category === 'memory' && (
        <p className="inspector-total">Total installed: {bytes(scan.totalMemoryBytes)}</p>
      )}
      {devices.length ? (
        devices.map((d, i) => (
          <section key={i} className="device-details">
            <h3>{d.name === 'Unknown' ? `${categoryNames[category]} ${i + 1}` : d.name}</h3>
            <dl className="spec-list">
              {Object.entries(d.properties).map(([key, val]) => (
                <div key={key}>
                  <dt>{key.replace(' (bytes)', '')}</dt>
                  <dd>
                    {key.endsWith('(bytes)')
                      ? bytes(val, category === 'storage')
                      : val === 'Unknown'
                        ? 'Not reported by system'
                        : val}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      ) : (
        <p className="scan-error">Information unavailable. Rescan Hardware to try again.</p>
      )}
      {category === 'motherboard' && (
        <section className="device-details">
          <h3>BIOS / firmware</h3>
          {scan.bios.length ? (
            scan.bios.map((d, i) => (
              <dl key={i} className="spec-list">
                {Object.entries(d.properties).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ))
          ) : (
            <p className="muted">Information unavailable</p>
          )}
        </section>
      )}
      <p className="muted inspector-source">
        Last scanned: {new Date(scan.scannedAt).toLocaleString()}
      </p>
    </dialog>
  );
}
