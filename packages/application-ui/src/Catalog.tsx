import { useState } from 'react';
import type { Part } from '@cortex/part-schema';
import { checkCompatibility, summarizeCompatibility } from '@cortex/compatibility-engine';
import { Icon } from './icons';
export default function Catalog({
  parts,
  category,
}: {
  parts: Part[];
  category?: Part['category'];
}) {
  const [selected, setSelected] = useState<Part | null>(null);
  const board = parts.find((part) => part.category === 'motherboard');
  const compatibility =
    selected && board?.category === 'motherboard' && selected.category !== 'motherboard'
      ? checkCompatibility(board, selected)
      : [];
  return (
    <main className="catalog-page">
      <div className="eyebrow">A FOUNDATION FOR EXPLORATION</div>
      <h1>
        Hardware library<span className="title-dot">.</span>
      </h1>
      <p className="muted">
        Five fictional records. Reusable templates. A connected hardware domain.
      </p>
      <div className="catalog-grid">
        {parts
          .filter((part) => !category || part.category === category)
          .map((part) => (
            <button key={part.id} className="catalog-card" onClick={() => setSelected(part)}>
              <div className="card-category">
                {part.category.toUpperCase()}
                <Icon name="arrow" />
              </div>
              <div className="catalog-icon">
                <Icon
                  name={
                    part.category === 'cpu' ? 'chip' : part.category === 'ram' ? 'layers' : 'box'
                  }
                  size={58}
                />
              </div>
              <span className="eyebrow">{part.manufacturer}</span>
              <h2>{part.model}</h2>
              <span className="card-fixture">Development fixture</span>
            </button>
          ))}
      </div>
      {selected && (
        <section className="catalog-detail" aria-label="Hardware details">
          <div className="panel-heading">
            <h2>{selected.model}</h2>
            <button
              className="icon-button"
              aria-label="Close hardware details"
              onClick={() => setSelected(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <p className="muted">
            Fictional development hardware — these values do not describe a real product.
          </p>
          <dl className="spec-list">
            {Object.entries(selected.specs)
              .filter(([, value]) => !Array.isArray(value))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value === null ? 'Unknown' : String(value)}</dd>
                </div>
              ))}
          </dl>
          {selected.category === 'motherboard' ? (
            <a className="button primary" href={`#/explorer/${selected.slug}`}>
              Explore motherboard
              <Icon name="arrow" />
            </a>
          ) : (
            <div className="compatibility-results">
              <h3>Reference board checks · {summarizeCompatibility(compatibility)}</h3>
              {compatibility.map((item) => (
                <p key={item.rule}>
                  <strong>{item.status.toUpperCase()}</strong> {item.explanation}
                </p>
              ))}
              <small>Rule checks do not certify a complete build.</small>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
