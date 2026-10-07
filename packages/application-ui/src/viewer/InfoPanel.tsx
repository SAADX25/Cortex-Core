import type { Motherboard } from '@cortex/part-schema';
import { componentInfo, motherboardComponents } from '@cortex/3d-engine';
import { useViewerStore } from './store';
import { Icon } from '../icons';
import { useState } from 'react';
export default function InfoPanel({ board }: { board: Motherboard }) {
  const selected = useViewerStore((s) => s.selected);
  const select = useViewerStore((s) => s.select);
  const camera = useViewerStore((s) => s.camera);
  const descriptor = motherboardComponents.find((item) => item.id === selected);
  const [expanded, setExpanded] = useState(false);
  return (
    <aside
      className={`info-panel ${descriptor ? 'has-selection' : ''} ${expanded ? 'sheet-expanded' : ''}`}
      aria-label="Component information"
    >
      <div className="sheet-handle" />
      <div className="panel-heading">
        <div className="section-label">INSPECTOR</div>
        {selected && (
          <div className="sheet-actions">
            <button
              className="sheet-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Less detail' : 'More details'}
            </button>
            <button
              className="icon-button"
              onClick={() => {
                select(null);
                setExpanded(false);
              }}
              aria-label="Close component information"
            >
              <Icon name="close" size={17} />
            </button>
          </div>
        )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {descriptor && selected ? (
          <>
            <div className="inspector-symbol">
              <Icon name="chip" size={32} />
            </div>
            <span className="eyebrow">MOTHERBOARD REGION</span>
            <h2>{descriptor.label}</h2>
            <p className="panel-description">{descriptor.description}</p>
            <div className="spec-title">TECHNICAL DETAILS</div>
            <dl className="spec-list">
              {componentInfo(board, selected).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <button className="button secondary focus-button" onClick={() => camera('focus')}>
              <Icon name="focus" />
              Focus component
            </button>
            <div className="semantic-id">
              <span>SEMANTIC ID</span>
              <code>{selected}</code>
            </div>
          </>
        ) : (
          <>
            <div className="inspector-symbol muted-symbol">
              <Icon name="focus" size={32} />
            </div>
            <h2>
              Every connection,
              <br />
              explained.
            </h2>
            <p className="panel-description">
              Select a component to explore its role, specifications and connection points.
            </p>
            <div className="spec-title">BOARD OVERVIEW</div>
            <dl className="spec-list">
              <div>
                <dt>Form factor</dt>
                <dd>{board.specs.formFactor ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>CPU socket</dt>
                <dd>{board.specs.socket ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Memory</dt>
                <dd>{board.specs.memoryGeneration ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>{board.specs.m2Slots.length} × M.2</dd>
              </div>
            </dl>
          </>
        )}
      </div>
      <div className="fixture-note">
        <Icon name="info" size={16} />
        <p>
          <strong>Development fixture</strong>
          <br />
          Illustrative hardware. Specifications are sample data, not a real product.
        </p>
      </div>
    </aside>
  );
}
