# Cortex Core

**Foundation + Motherboard Explorer** — a typed hardware platform built around reusable visual templates. The first milestone uses five fictional development records and an original procedural ATX layout. No real product specifications or external 3D models are presented as verified hardware.

## Launch the desktop application

Cortex Core ships as a **Tauri 2 Windows x64 desktop application**. The unsigned development installer and standalone executable are generated under `release/windows-x64` by `pnpm desktop:package`. Installed users launch **Cortex Core.exe** or the Start menu shortcut. The installed app loads packaged assets; it needs no Node, pnpm, browser or local web server. Windows WebView2 Runtime is required; the installer includes its official bootstrapper.

Developer requirements: Node **24.17+ in the 24.x line**, pnpm **10.17.0**, Rust stable **1.99+**, Visual Studio C++ build tools and Windows SDK. This machine uses an ignored project-local Rust installation in `.toolchains`; other machines use the normal Rust toolchain on PATH.

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:package
```

See [desktop development, security and distribution](docs/desktop/development.md) and [desktop validation](docs/desktop/validation.md). `apps/web` is the development/browser-test renderer; `pnpm dev` serves it for tests, not for end users. Its optional `?graphics=off` and development-only `?debug=1` remain available. Motherboard selection, inspector, camera, exploded view, adaptive quality and accessible fallback share one implementation across both hosts.

## Workspace

| Location                        | Ownership                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/desktop`                  | Tauri native host, SQLite snapshot, capabilities and Windows installer              |
| `apps/web`                      | Vite development and browser-test renderer                                          |
| `packages/application-ui`       | Shared React shell, inspector, routes, tokens, transient Zustand state              |
| `packages/part-schema`          | Category-specific runtime schemas, types, provenance, dimensions                    |
| `packages/compatibility-engine` | Pure reason-coded compatibility checks; missing data stays unknown                  |
| `packages/data-access`          | Validated async repository, cursor limits, fixtures, optional Supabase reads        |
| `packages/asset-runtime`        | Licensing manifests, template registry, integrity-checked GLB loader, leases        |
| `packages/3d-engine`            | Semantic layout, demand renderer, camera, quality policy, reusable LOD              |
| `tools`                         | Licensed GLB optimization, validated imports, generated fixture seed, build budgets |
| `supabase`                      | Normalized migration, development seed, pgTAP security checks                       |

See [architecture](docs/architecture/overview.md), [database schema](docs/database/schema.md), [asset pipeline](docs/assets/asset-pipeline.md), [performance budgets](docs/performance/performance-budget.md), and [ADRs](docs/adr/0001-foundation.md).

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

The unit suite includes real PostgreSQL execution through PGlite: migration/seed round trips, category constraints, anonymous/authenticated write denial and private-record RLS. It needs no Docker service. Playwright defines Chromium, Firefox, WebKit, Pixel-like Chromium and iPhone-like WebKit projects, including portrait/landscape layouts. These are emulations, not physical-device certification. See [the first-pass validation report](docs/validation.md) for actual execution results and limitations. CI validates; it does not deploy.

## Optional Supabase

The app runs without credentials. To provision a local Supabase environment, install the official Supabase CLI and Docker, then run `supabase start`, `supabase db reset`, and `supabase test db`. These services are not installed or remotely provisioned by this milestone. Development seed fixtures must not be loaded into a production catalog. Copy `.env.example` to `.env.local` and set the documented public URL/key and data-source flag only after the migration is applied.

All domain tables have RLS. Public records require `is_public=true`; API roles have SELECT privileges only, and the catalog view is security-invoker. Secret/service-role credentials stay server-side. The import validator rejects invalid records and real specifications lacking field-level provenance. No unsafe HTML or network scraping is used. Private writes/authentication/build persistence remain future work.

## First-pass scope and next milestone

The explorer renders one generic motherboard template; the other four categories demonstrate domain schemas and compatibility, not independent 3D viewers. Adaptive profiles apply DPR, antialiasing, shadows and detail bias; texture/post-processing/reflection settings are reserved policy fields because this scene uses no image textures or post-processing. GLB loading and optimization are supported seams, not a catalog of downloaded assets. Installation animation, occupied-slot bookkeeping, aggregate build memory/power and exact CPU/BIOS validation are not implemented.

Next: complete Windows release hardening on clean Windows 10/11 machines, physical high-DPI/multi-monitor testing and a deliberate signing/update policy. CPU/RAM/GPU installation work remains deferred until desktop validation is stable.
