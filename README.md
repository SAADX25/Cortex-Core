# Cortex Core

Live temperature monitoring is quarantined after three full-system freezes. Application integration is restored to the committed Update-10 baseline; no sensor engine, provider, subscription or Monitoring route starts with the app. Unfinished work is preserved in [quarantine/update-11](quarantine/update-11/README.md). See [the incident and isolation status](docs/desktop/update-11-monitoring.md). Do not run live sensor tests on the affected machine.

A safety-only Windows development executable was built with `pnpm desktop:build:safety` (`--debug --no-bundle`). Ordinary desktop smoke and native regressions passed, but an idle observation ended with an unexplained application exit after about 92 seconds. Stability is not certified and the conditional safety commit has not been made. Monitoring remains absent from the executable; the system-freeze issue is not called fixed.

**My PC — local Windows hardware detection.** Cortex Core automatically reads the hardware installed in your current PC, presents a clean desktop dashboard, and optionally illustrates the detected devices in a separate read-only 3D view. Scans and the last successful snapshot stay local and work offline. Generic visuals are explicitly labeled; Windows-reported specifications are never replaced with fixture data.

## Launch the desktop application

Cortex Core ships as a **Tauri 2 Windows x64 desktop application**. The unsigned development installer and standalone executable are generated under `release/windows-x64` by `pnpm desktop:package`. Installed users launch **Cortex Core.exe** or the Start menu shortcut. The installed app loads packaged assets; it needs no Node, pnpm, browser or local web server. Windows WebView2 Runtime is required; the installer includes its official bootstrapper.

Developer requirements: Node **24.17+ in the 24.x line**, pnpm **10.17.0**, Rust stable **1.99+**, Visual Studio C++ build tools and Windows SDK. This machine uses an ignored project-local Rust installation in `.toolchains`; other machines use the normal Rust toolchain on PATH.

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:package
```

See [hardware sources, scanner limitations and milestone validation](docs/desktop/my-pc-milestone.md) and [desktop development, security and distribution](docs/desktop/development.md). `apps/web` is the development/browser-test renderer; ordinary browsers cannot scan a Windows PC. `?graphics=off` exercises the accessible hardware fallback. Main navigation contains only My PC, 3D View and Settings. Previous [assembly work](docs/desktop/assembly.md) remains isolated for possible future use. `pnpm test:monitoring:safe` verifies the new dormant diagnostic controller using a hardware-free helper stub; it does not build or launch the desktop application.

## Workspace

| Location                        | Ownership                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/desktop`                  | Tauri native host, SQLite snapshot, capabilities and Windows installer                 |
| `apps/web`                      | Vite development and browser-test renderer                                             |
| `packages/application-ui`       | Shared React shell, inspector, routes, tokens, transient Zustand state                 |
| `packages/build-domain`         | Immutable development build, slot occupancy, operations, totals and version validation |
| `packages/part-schema`          | Category-specific runtime schemas, types, provenance, dimensions                       |
| `packages/compatibility-engine` | Pure reason-coded compatibility checks; missing data stays unknown                     |
| `packages/data-access`          | Validated async repository, cursor limits, fixtures, optional Supabase reads           |
| `packages/asset-runtime`        | Licensing manifests, template registry, integrity-checked GLB loader, leases           |
| `packages/3d-engine`            | Semantic layout, demand renderer, camera, quality policy, reusable LOD                 |
| `tools`                         | Licensed GLB optimization, validated imports, generated fixture seed, build budgets    |
| `supabase`                      | Normalized migration, development seed, pgTAP security checks                          |

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

All domain tables have RLS. Public records require `is_public=true`; API roles have SELECT privileges only, and the catalog view is security-invoker. Secret/service-role credentials stay server-side. The import validator rejects invalid records and real specifications lacking field-level provenance. This optional knowledge database is separate from detected devices. My PC never calls it or uploads specifications. Existing domain/build storage remains isolated through its native SQLite boundary.

## Current scope and later milestones

Startup restores a versioned SQLite hardware snapshot, then performs one fresh background scan. Rescan is explicit; no continuous polling occurs. Six large dashboard cards open detailed inspectors, including individual adapters, DIMMs, physical disks and motherboard firmware. Copy Specifications writes a plain-text local report. 3D View lazily loads original beveled hardware models with PBR finishes, instanced electronics, studio lighting and demand rendering. Only system-confirmed discrete adapters appear as cards; other adapters remain available in system information. Physical disks occupy a labeled inventory tray because their location and form factor are not reliably reported. Board family, socket and slot occupancy remain explicitly illustrative. See [3D reconstruction and validation](docs/desktop/3d-reconstruction.md).

Next: clean Windows 10/11 release hardening, physical high-DPI/multi-monitor testing, signing/update policy, and optional verified product metadata/exact models. No new PC Builder features are planned for this milestone.

The detected viewer includes reversible exploded inspection, continuous scrubbing, smooth camera commands and component isolation. See [Update 7 motion architecture and validation](docs/desktop/update-7-motion.md) for ownership, demand rendering, interruption handling and measured resource tests.
