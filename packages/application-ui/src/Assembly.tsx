import { useState } from 'react';
import {
  buildSummary,
  destinations,
  isInstallable,
  remove,
  type SlotId,
} from '@cortex/build-domain';
import { motherboardComponents } from '@cortex/3d-engine';
import { useBuildStore } from './build-store';
import { useViewerStore } from './viewer/store';

export const slotLabel = (id: string) =>
  motherboardComponents.find((c) => c.id === id)?.label ?? id;
export function BuildSummary() {
  const state = useBuildStore();
  const [confirm, setConfirm] = useState(false);
  if (!state.ready) return <p role="status">Loading development build…</p>;
  if (!state.build) return <p role="alert">{state.notice}</p>;
  const summary = buildSummary(state.build, state.catalog);
  return (
    <section className="build-summary" aria-label="Build summary" data-testid="build-summary">
      <div className="summary-values">
        <div>
          <small>CPU</small>
          <strong>{summary.cpu?.model ?? 'Not installed'}</strong>
        </div>
        <div>
          <small>MEMORY / PER MODULE</small>
          <strong>
            {summary.memoryGb ?? 'Unknown'} GB · {summary.memoryUsed} / {summary.memorySlots} DIMMs
          </strong>
        </div>
        <div>
          <small>NVMe STORAGE</small>
          <strong>
            {summary.storageGb ?? 'Unknown'} GB · {summary.storageUsed} / {summary.storageSlots} M.2
          </strong>
        </div>
        <div>
          <small>COMPATIBILITY</small>
          <strong>{summary.compatibility ?? 'No installed components'}</strong>
        </div>
      </div>
      <button
        className="button"
        disabled={state.busy || state.blocked || !state.build.installations.length}
        onClick={() => setConfirm(true)}
      >
        Reset build
      </button>
      {confirm && (
        <div className="reset-backdrop">
          <section
            className="reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConfirm(false);
              if (e.key === 'Tab') {
                const buttons = e.currentTarget.querySelectorAll('button');
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <h2 id="reset-title">Reset development build?</h2>
            <p>
              Remove the CPU, all RAM and M.2 devices from this build. Your catalog and settings are
              kept.
            </p>
            <div className="assembly-actions">
              <button className="button" autoFocus onClick={() => setConfirm(false)}>
                Keep build
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setConfirm(false);
                  void state.reset();
                }}
              >
                Confirm reset
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default function AssemblyPanel() {
  const state = useBuildStore();
  const viewer = useViewerStore();
  const [cameraAssist, setCameraAssist] = useState(true);
  if (!state.build)
    return (
      <section className="assembly-panel">
        <p role="status">{state.notice || 'Loading build…'}</p>
      </section>
    );
  const part = state.catalog.find((p) => p.id === state.chosenPartId);
  const available = part
    ? destinations(
        state.replacing ? remove(state.build, state.replacing) : state.build,
        part,
        state.catalog,
      )
    : [];
  const shown = state.replacing ? available.filter((s) => s.id === state.replacing) : available;
  const installed = part ? state.build.installations.filter((i) => i.partId === part.id) : [];
  const target = shown.find((s) => s.id === state.preview && s.installable);
  const pick = (id: SlotId) => {
    state.setPreview(id);
    viewer.select(id);
    if (cameraAssist) viewer.camera('focus');
  };
  return (
    <section className="assembly-panel" aria-label="Component assembly">
      <div className="eyebrow">DEVELOPMENT BUILD</div>
      <h2>Assembly</h2>
      <label className="assembly-part-label">
        Hardware Library
        <select
          aria-label="Assembly component"
          value={state.chosenPartId ?? ''}
          disabled={state.busy}
          onChange={(e) => state.choose(e.target.value)}
        >
          <option value="">Choose a fixture…</option>
          {state.catalog.filter(isInstallable).map((p) => (
            <option key={p.id} value={p.id}>
              {p.model}
            </option>
          ))}
        </select>
      </label>
      {part && (
        <>
          <h3>{part.model}</h3>
          <p className="muted">{part.category.toUpperCase()} · Fictional fixture</p>
          <dl className="spec-list">
            {Object.entries(part.specs).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value === null ? 'Unknown' : String(value)}</dd>
              </div>
            ))}
          </dl>
          {part.category === 'ram' && (
            <p className="assembly-note">
              Install one {part.specs.capacityGb ?? 'unknown'} GB module at a time. This fixture
              represents a {part.specs.moduleCount ?? 'unknown'}-module kit.
            </p>
          )}
          {!state.choosing && (
            <button
              className="button primary"
              disabled={state.busy || state.blocked || !available.some((s) => s.installable)}
              onClick={() => state.begin()}
            >
              Install
            </button>
          )}
          {state.choosing && (
            <>
              <h3>{state.replacing ? 'Replace in destination' : 'Choose destination'}</h3>
              <p className="assembly-note">
                Select a highlighted destination to preview the part, then confirm installation.
              </p>
            </>
          )}
          <div className="destinations" aria-label="Installation destinations">
            {shown.map((s) => (
              <button
                key={s.id}
                disabled={!state.choosing || !s.installable || state.busy}
                aria-pressed={state.preview === s.id}
                onMouseEnter={() => {
                  if (state.choosing && s.installable) state.setPreview(s.id);
                }}
                onFocus={() => {
                  if (state.choosing && s.installable) state.setPreview(s.id);
                }}
                onClick={() => pick(s.id)}
              >
                <span>{slotLabel(s.id)}</span>
                <small>{s.occupied ? 'Occupied' : s.status}</small>
              </button>
            ))}
          </div>
          {state.choosing && (
            <>
              <label className="camera-assist">
                <input
                  type="checkbox"
                  checked={cameraAssist}
                  onChange={(e) => setCameraAssist(e.target.checked)}
                />{' '}
                Focus camera on destination
              </label>
              <div className="assembly-actions">
                <button
                  className="button primary"
                  disabled={!target || state.busy}
                  onClick={() => {
                    if (target) {
                      pick(target.id);
                      void state.commit(target.id);
                    }
                  }}
                >
                  Install into {target ? slotLabel(target.id) : 'selected slot'}
                </button>
                <button className="button" onClick={state.cancel} disabled={state.busy}>
                  Cancel
                </button>
              </div>
            </>
          )}
          <div className="assembly-checks">
            {(target?.checks ?? shown[0]?.checks ?? []).map((c) => (
              <p key={c.rule}>
                <strong>{c.status}</strong> · {c.explanation}
              </p>
            ))}
          </div>
          {installed.map((i) => (
            <div className="installed-row" key={i.slotId}>
              <strong>Installed in: {slotLabel(i.slotId)}</strong>
              <div className="assembly-actions">
                <button
                  className="button"
                  disabled={state.busy || state.blocked}
                  onClick={() => void state.remove(i.slotId)}
                >
                  Remove {slotLabel(i.slotId)}
                </button>
                <button
                  className="button"
                  disabled={state.busy || state.blocked}
                  onClick={() => state.begin(i.slotId)}
                >
                  Replace {slotLabel(i.slotId)}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      <details className="occupancy">
        <summary>Slot occupancy · {state.build.installations.length} installed</summary>
        {motherboardComponents
          .filter((c) => c.kind === 'socket' || c.kind === 'dimm' || c.kind === 'm2')
          .map((c) => {
            const item = state.build!.installations.find((i) => i.slotId === c.id);
            return (
              <div key={c.id}>
                <span>{c.label}</span>
                <small>
                  {item ? state.catalog.find((p) => p.id === item.partId)?.model : 'Empty'}
                </small>
              </div>
            );
          })}
      </details>
      <p className="assembly-note" role="status" data-testid="build-save-status">
        {state.busy ? 'Assembly in progress…' : state.notice}
      </p>
    </section>
  );
}
