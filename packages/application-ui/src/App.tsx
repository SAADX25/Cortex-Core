import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { partKeys } from '@cortex/data-access';
import type { Part } from '@cortex/part-schema';
import { getRepository } from './repository';
import { Icon } from './icons';
import Catalog from './Catalog';
import Settings from './Settings';
import { isDesktop } from './platform';
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

const categories: [string, Part['category']][] = [
  ['Motherboards', 'motherboard'],
  ['CPUs', 'cpu'],
  ['GPUs', 'gpu'],
  ['Memory', 'ram'],
  ['Storage', 'storage'],
];
export default function App() {
  const route = useRoute();
  const catalog = useQuery({
    queryKey: partKeys.catalog,
    queryFn: async ({ signal }) => (await getRepository()).list(signal),
  });
  const slug = route.split('/')[2];
  const isExplorer = route.startsWith('/explorer');
  const board = catalog.data?.find(
    (part) => part.category === 'motherboard' && (!isExplorer || !slug || part.slug === slug),
  );
  const explorerLink = '#/explorer' + (board ? '/' + board.slug : '');
  const category = categories.find(([, key]) => route === '/catalog/' + key)?.[1];
  const title = isExplorer
    ? 'Motherboard Explorer'
    : route.startsWith('/catalog')
      ? 'Hardware Library'
      : route === '/settings'
        ? 'Settings'
        : route === '/builder'
          ? 'PC Builder'
          : route === '/builds'
            ? 'Saved Builds'
            : 'Home';
  return (
    <div className="desktop-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="workspace-rail">
        <a className="brand" href="#/" aria-label="Cortex Core home">
          <span className="brand-mark">
            <Icon name="chip" size={23} />
          </span>
          <span>
            CORTEX<span className="brand-light">CORE</span>
          </span>
        </a>
        <nav className="workspace-nav" aria-label="Primary navigation">
          <a href="#/" aria-current={route === '/' ? 'page' : undefined}>
            <Icon name="grid" />
            Home
          </a>
          <a href="#/catalog" aria-current={route === '/catalog' ? 'page' : undefined}>
            <Icon name="box" />
            Hardware Library
          </a>
          <div className="nav-group-label">COMPONENTS</div>
          {categories.map(([name, key]) => (
            <a
              key={key}
              className="category-link"
              href={'#/catalog/' + key}
              aria-current={category === key ? 'page' : undefined}
            >
              {name}
            </a>
          ))}
          <div className="nav-group-label">WORKSPACE</div>
          <a href="#/builder" aria-current={route === '/builder' ? 'page' : undefined}>
            <Icon name="layers" />
            PC Builder
          </a>
          <a href="#/builds" aria-current={route === '/builds' ? 'page' : undefined}>
            <Icon name="box" />
            Saved Builds
          </a>
          <a href="#/settings" aria-current={route === '/settings' ? 'page' : undefined}>
            <Icon name="info" />
            Settings
          </a>
        </nav>
        <div className="rail-note">
          <span className="hint-dot" /> Desktop foundation
          <br />
          <small>0.2.0 · Development build</small>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">WORKSPACE</span>
            <strong>{title}</strong>
          </div>
          <span className="fixture-badge">
            <span />
            FICTIONAL DEVELOPMENT HARDWARE
          </span>
        </header>
        <div id="main-content" tabIndex={-1}>
          {catalog.isPending ? (
            <div className="page-loading" role="status">
              Loading hardware records…
            </div>
          ) : catalog.isError ? (
            <main className="error-page">
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
          ) : route.startsWith('/catalog') ? (
            <Catalog key={route} parts={catalog.data} category={category} />
          ) : route === '/settings' ? (
            <Settings />
          ) : route === '/builder' || route === '/builds' ? (
            <main className="settings-page">
              <div className="eyebrow">PLANNED WORKSPACE</div>
              <h1>{title}</h1>
              <section className="settings-section">
                <h2>Build assembly is coming later.</h2>
                <p className="muted">
                  This desktop foundation supports hardware inspection. Component installation,
                  portable build files and saved builds will arrive in a later milestone.
                </p>
                <a className="button primary" href={explorerLink}>
                  Open Motherboard Explorer
                </a>
              </section>
            </main>
          ) : (
            <main className="home-page">
              <div className="eyebrow">CORTEX CORE / DESKTOP FOUNDATION</div>
              <h1>
                Your hardware workspace<span className="title-dot">.</span>
              </h1>
              <p className="muted">
                Inspect components, trace connections and explore the architecture of a PC.
              </p>
              <section className="home-workspace">
                <div className="home-preview" aria-hidden="true">
                  <Icon name="chip" size={112} />
                  <span>ATX / REFERENCE 001</span>
                </div>
                <div>
                  <span className="eyebrow">READY TO EXPLORE</span>
                  <h2>Motherboard Explorer</h2>
                  <p className="muted">
                    17 selectable regions · Component specifications · Exploded view
                  </p>
                  <a className="button primary" href={explorerLink}>
                    Open Motherboard Explorer
                    <Icon name="arrow" />
                  </a>
                </div>
              </section>
              <div className="home-summary">
                <section>
                  <span className="eyebrow">LOCAL LIBRARY</span>
                  <strong>{catalog.data.length} hardware fixtures</strong>
                  <p>Independent component schemas and reference compatibility rules.</p>
                  <a className="text-link" href="#/catalog">
                    Browse the library
                    <Icon name="arrow" />
                  </a>
                </section>
                <section>
                  <span className="eyebrow">AVAILABLE OFFLINE</span>
                  <strong>One essential template</strong>
                  <p>The original reference board requires no downloaded models.</p>
                  <a className="text-link" href="#/settings">
                    Catalog & cache status
                    <Icon name="arrow" />
                  </a>
                </section>
              </div>
              <p className="home-fixture">
                <Icon name="info" size={16} />
                These fictional development records do not describe real products.
              </p>
            </main>
          )}
        </div>
        <footer className="workspace-status">
          <span>
            <span className="hint-dot" />{' '}
            {isDesktop ? 'Desktop · Local catalog' : 'Development / browser test renderer'}
          </span>
          <span>CATALOG 2026.10.07.1 · ASSETS v1</span>
        </footer>
      </div>
    </div>
  );
}
