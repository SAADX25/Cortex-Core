# Cortex Core

**Foundation + Motherboard Explorer** — a typed hardware platform built around reusable visual templates. The first milestone uses five fictional development records and an original procedural ATX layout. No real product specifications or external 3D models are presented as verified hardware.

## Run locally

Requirements: Node **24.17+ in the 24.x line**, pnpm **10.17.0**. Exact stable dependency versions are pinned in manifests and `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173. Choose **Open Motherboard Explorer**. Orbit, zoom, pan, select any of 17 regions, inspect fixture specifications, focus/reset/fit the camera, toggle labels or exploded view, and choose an automatic/manual quality profile. A keyboard-accessible component list mirrors the model. On mobile, the inspector becomes a compact bottom sheet with a More details control. Fullscreen appears when the browser supports it.

Use `/?graphics=off#/explorer` to open the diagram. WebGL initialization, context loss and rejected renderer imports also recover to that diagram. A retry after a rejected ESM import reloads the page because browsers cache failed module URLs. Development-only diagnostics are available at `/?debug=1#/explorer` and are stripped from production.

## Workspace

| Location                        | Ownership                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/web`                      | React shell, accessible inspector, routes, CSS tokens, transient Zustand state      |
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

Next: a small PC Builder slice that installs fixture CPU/RAM/M.2 parts into semantic anchors, tracks occupied slots and exposes scoped compatibility results. Validate that slice before importing real manufacturer data or premium assets.
