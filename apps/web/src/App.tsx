import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { partKeys } from '@cortex/data-access';
import type { Part } from '@cortex/part-schema';
import { checkCompatibility, summarizeCompatibility } from '@cortex/compatibility-engine';
import { getRepository } from './repository';
import { Icon } from './icons';
const Explorer = lazy(() => import('./viewer/Explorer'));

function useRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
function BoardIllustration() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="art-grid" />
      <div className="art-board">
        <div className="art-io" />
        <div className="art-vrm" />
        <div className="art-socket">
          <Icon name="chip" size={54} />
        </div>
        <div className="art-memory">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} />
          ))}
        </div>
        <div className="art-m2" />
        <div className="art-pcie" />
        <div className="art-chipset">
          <Icon name="chip" size={28} />
        </div>
        <div className="art-pcie second" />
        <div className="art-brand">
          CORTEX
          <br />
          <small>REFERENCE / 01</small>
        </div>
        <div className="art-screws">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <span className="art-caption one">01 / CPU SOCKET</span>
      <span className="art-caption two">02 / MEMORY CHANNELS</span>
      <div className="art-coordinates">
        244 × 305 MM
        <br />
        ATX REFERENCE TEMPLATE
      </div>
    </div>
  );
}
function Catalog({ parts }: { parts: Part[] }) {
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
        {parts.map((part) => (
          <button key={part.id} className="catalog-card" onClick={() => setSelected(part)}>
            <div className="card-category">
              {part.category.toUpperCase()}
              <Icon name="arrow" />
            </div>
            <div className="catalog-icon">
              <Icon
                name={part.category === 'cpu' ? 'chip' : part.category === 'ram' ? 'layers' : 'box'}
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
export default function App() {
  const route = useRoute();
  const catalog = useQuery({
    queryKey: partKeys.catalog,
    queryFn: async ({ signal }) => (await getRepository()).list(signal),
  });
  const isExplorer = route.startsWith('/explorer');
  const isCatalog = route === '/catalog';
  const slug = route.split('/')[2];
  const board = catalog.data?.find(
    (part) => part.category === 'motherboard' && (!slug || part.slug === slug),
  );
  const explorerLink = `#/explorer${board ? `/${board.slug}` : ''}`;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <a className="brand" href="#/" aria-label="Cortex Core home">
          <span className="brand-mark">
            <Icon name="chip" size={23} />
          </span>
          <span>
            CORTEX<span className="brand-light">CORE</span>
          </span>
        </a>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a className={!isExplorer && !isCatalog ? 'nav-active' : ''} href="#/">
            Overview
          </a>
          <a className={isExplorer ? 'nav-active' : ''} href={explorerLink}>
            Explorer
          </a>
          <a className={isCatalog ? 'nav-active' : ''} href="#/catalog">
            Hardware library
          </a>
        </nav>
        <span className="header-status">
          <span />
          FOUNDATION <small>v0.1</small>
        </span>
      </header>
      <div id="main-content" tabIndex={-1}>
        {catalog.isPending ? (
          <div className="page-loading" role="status">
            Loading hardware records…
          </div>
        ) : catalog.isError ? (
          <main className="error-page">
            <Icon name="info" size={32} />
            <h1>Hardware data is unavailable.</h1>
            <p>{catalog.error.message}</p>
            <button className="button primary" onClick={() => void catalog.refetch()}>
              Retry data
            </button>
          </main>
        ) : isExplorer ? (
          board?.category === 'motherboard' ? (
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  Opening explorer…
                </div>
              }
            >
              <Explorer board={board} />
            </Suspense>
          ) : (
            <main className="error-page">
              <h1>Motherboard not found.</h1>
              <a href="#/catalog">Return to the hardware library</a>
            </main>
          )
        ) : isCatalog ? (
          <Catalog parts={catalog.data} />
        ) : (
          <main className="landing-page">
            <section className="hero">
              <div className="hero-copy">
                <div className="hero-eyebrow">
                  <span />
                  HARDWARE, UNDERSTOOD.
                </div>
                <h1>
                  Get closer to
                  <br />
                  the <span>core.</span>
                </h1>
                <p>
                  A new perspective on PC hardware. Explore components in three dimensions and
                  understand how everything connects.
                </p>
                <div className="hero-actions">
                  <a className="button primary" href={explorerLink}>
                    Open Motherboard Explorer
                    <Icon name="arrow" />
                  </a>
                  <a className="text-link" href="#/catalog">
                    Browse the library
                    <Icon name="chevron" size={15} />
                  </a>
                </div>
                <div className="hero-meta">
                  <span>INTERACTIVE 3D</span>
                  <i />
                  <span>COMPONENT INSPECTION</span>
                  <i />
                  <span>BUILT TO CONNECT</span>
                </div>
              </div>
              <BoardIllustration />
            </section>
            <section className="workspace-intro">
              <div>
                <div className="eyebrow">YOUR FIRST WORKSPACE</div>
                <h2>One board. A whole system.</h2>
                <p>Start with the foundation of every PC.</p>
              </div>
              <a className="workspace-card" href={explorerLink}>
                <span className="workspace-card-icon">
                  <Icon name="chip" size={34} />
                </span>
                <div>
                  <span className="eyebrow">REFERENCE SERIES / 001</span>
                  <h3>Motherboard Explorer</h3>
                  <p>17 selectable regions · ATX template · Exploded view</p>
                </div>
                <Icon name="arrow" size={22} />
              </a>
            </section>
            <div className="landing-fixture">
              <Icon name="info" size={16} />
              <span>
                This foundation uses fictional development hardware and original procedural models.
              </span>
            </div>
          </main>
        )}
      </div>
      <footer className="app-footer">
        <span>
          CORTEX CORE <span className="muted">/ A clearer view of hardware.</span>
        </span>
        <span>FOUNDATION RELEASE · 2026</span>
      </footer>
    </div>
  );
}
