import { useEffect, useRef } from 'react';
import { bytes, categoryNames, type HardwareCategory, type HardwareScan } from './hardware';
import { Icon } from './icons';
import { cpuIdentity } from '@cortex/3d-engine';
import { adapterClass, resolveStorageVisual, storagePlacement } from '@cortex/asset-runtime';
export default function HardwareInspector({
  scan,
  category,
  deviceIndex,
  close,
  visualization = false,
  focusComponent,
}: {
  scan: HardwareScan;
  category: HardwareCategory;
  deviceIndex?: number;
  close(): void;
  visualization?: boolean;
  focusComponent?(): void;
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
      className={`hardware-inspector${visualization ? ' viewer-inspector' : ''}`}
      aria-labelledby="inspector-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="inspector-heading">
        <div>
          <div className="eyebrow">
            {visualization ? 'COMPONENT INSPECTOR' : 'DETECTED SPECIFICATIONS'}
          </div>
          <h2 id="inspector-title">{categoryNames[category]}</h2>
        </div>
        <button className="icon-button" aria-label="Close details" onClick={close}>
          <Icon name="close" size={23} />
        </button>
      </div>
      <p className="muted inspector-source">Reported by Windows on this PC.</p>
      {focusComponent && (
        <button className="button secondary inspector-focus" onClick={focusComponent}>
          <Icon name="focus" /> Focus component
        </button>
      )}
      {category === 'memory' && (
        <p className="inspector-total">Total installed: {bytes(scan.totalMemoryBytes)}</p>
      )}
      {devices.length ? (
        devices.map((d, i) => (
          <section key={i} className="device-details">
            <h3>{d.name === 'Unknown' ? `${categoryNames[category]} ${i + 1}` : d.name}</h3>
            {visualization && (
              <div className="inspector-visual-note">
                <Icon name="info" size={18} />
                <div>
                  <strong>
                    {category === 'cpu'
                      ? cpuIdentity(d.name, d.properties.Manufacturer).note
                      : category === 'storage'
                        ? resolveStorageVisual(d).note
                        : category === 'gpu' && adapterClass(d) !== 'discrete'
                          ? 'System information · no discrete card visual'
                          : `Generic ${category === 'gpu' ? 'GPU' : category} visualization`}
                  </strong>
                  <small>
                    {category === 'storage'
                      ? storagePlacement(d) === 'm2'
                        ? 'Illustrative mounting · exact physical model and slot are not verified.'
                        : 'Inventory placement · representative form only, not verified physical dimensions or location.'
                      : 'Illustrative shape · exact physical model is not verified.'}
                  </small>
                </div>
              </div>
            )}
            <dl className="spec-list">
              {visualization && !d.properties.Manufacturer && !d.properties.Vendor && (
                <div>
                  <dt>Manufacturer</dt>
                  <dd>Not reported by system</dd>
                </div>
              )}
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
