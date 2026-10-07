# ADR 0001 — Foundation and first milestone

Status: accepted · 2026-10-07

The first milestone is an offline-capable fictional motherboard explorer, not a product database. This repository uses the existing `G:/Cortex Core` workspace rather than creating a second nested checkout.

## Decisions

- Use React 19 with React Three Fiber 9, WebGL 2, strict TypeScript, Vite and pnpm. Resolve exact stable versions from npm; reject prereleases. The stable major pairing is documented by [R3F](https://r3f.docs.pmnd.rs/getting-started/installation). [Vite](https://vite.dev/guide/) documents the supported Node baseline.
- Keep runtime-validated hardware and provenance in `part-schema`; pure compatibility rules in `compatibility-engine`; repositories and query keys in `data-access`; licensed template resolution, GLB loading and resource leases in `asset-runtime`; semantic geometry and renderer policy in `3d-engine`. The application owns transient Zustand state and CSS tokens. Do not create empty UI/shared/testing packages before they have an independent owner.
- Use a fixture repository behind a portable async interface and TanStack Query for server state. Supabase is an optional read-only adapter. PostgreSQL migrations establish normalized specifications and deny writes to frontend roles. No credentials are required to run the milestone.
- Procedural original geometry is the default visual template. Technical information comes from the hardware record, never from the mesh. Stable semantic IDs join descriptors, selection, fallback diagram and information panel.
- Lazy-load the explorer and renderer. Render on demand, instance repeated decorations, monitor only active frames and use conservative hysteresis. Dispose runtime-owned resources through reference-counted leases; procedural JSX resources remain R3F-owned.
- Use unit tests for domain and policy boundaries, Playwright across desktop and mobile browser engines, SQL tests for constraints/RLS, and independent build budgets. CI performs validation and does not deploy.

## Consequences

Generic templates can scale independently from product records. Real manufacturer ingestion, accounts, saved builds, installation animations and premium licensed assets remain later milestones. Unknown specifications remain unknown. Fixture dimensions describe an illustrative ATX layout, not a manufacturing drawing.
