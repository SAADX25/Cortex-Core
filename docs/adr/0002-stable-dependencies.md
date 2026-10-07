# ADR 0002 — Exact stable dependencies and compatibility

Status: accepted · 2026-10-07

Registry `latest` metadata was checked before implementation. React/React DOM **19.3.0**, Vite **8.3.3**, plugin-react **6.1.2**, Three.js **0.186.1**, R3F **9.8.1**, Drei **10.7.9**, Zustand **5.0.15**, TanStack Query **5.104.1**, Zod **4.6.5**, Vitest **5.0.3**, Playwright **1.63.0**, Supabase JS **2.117.3** and glTF Transform CLI **4.5.1** are stable releases. `dependency-versions.json` records all selected direct versions. pnpm **10.17.0** is the installed stable package manager used to generate the frozen lockfile.

TypeScript's latest stable **7.0.2** exceeded typescript-eslint **8.71.1**'s peer range (`>=4.8.4 <6.1.0`). Pin **6.0.3**, the latest stable release within that range. Do not suppress peer warnings to use an unsupported compiler. PGlite **0.5.8** executes the portable PostgreSQL migration/security tests without requiring Docker and is a test-only dependency.

R3F 9 is paired with React 19, following the [official installation guide](https://r3f.docs.pmnd.rs/getting-started/installation). Node 24 satisfies the [Vite baseline](https://vite.dev/guide/). Dependencies are pinned exactly, not to moving tags or prereleases. Updates require the same matrix and budget checks. Upstream R3F currently emits a Three.Clock deprecation warning with this stable Three.js release; application code does not use that deprecated API. This is not a reason to adopt R3F 10 prereleases.
