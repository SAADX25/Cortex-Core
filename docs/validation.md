# First-pass validation — 2026-10-07

Implemented in the existing `G:/Cortex Core` folder, initialized as a local Git repository on `main`. No remote deployment, Supabase provisioning or GitHub workflow execution was performed.

## Executed results

| Check                                               | Result                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                    | Passed; final lockfile up to date across 8 workspace projects                                                                                         |
| `pnpm typecheck`                                    | Passed; strict TypeScript 6.0.3                                                                                                                       |
| `pnpm lint`                                         | Passed; no errors or warnings                                                                                                                         |
| `pnpm test`                                         | **77 passed** in 5 test files                                                                                                                         |
| `pnpm build`                                        | Passed; production artifacts and all enforced bundle budgets                                                                                          |
| Chromium / WebKit / mobile Chromium / mobile WebKit | **28 passed**, 7 checks per project, no skips in the final run                                                                                        |
| Firefox                                             | **6 attempted checks blocked before execution** by Windows runtime launch failure                                                                     |
| Production preview                                  | Passed at 1440×1000 and 390×844: no browser errors, WebGL canvas present, diagnostics hidden, no horizontal overflow, no renderer requests on landing |

Browser command for the final passing matrix: `pnpm test:e2e --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari`. Earlier runs found and fixed mobile inspector obstruction, test coordinates after scroll, WebKit mobile wheel-driver limitations, and failed ESM retry. The final passing matrix is the source of the result above, not the earlier failed runs.

The attempted complete 30-check matrix before adding the seventh idle check had 20 passes and 10 failures: 6 Firefox launch failures and 4 mobile test/UX failures. Those 4 mobile failures were repaired and all mobile checks subsequently passed. Firefox's downloaded runtime was repaired once with `playwright install --force firefox` and launch retried; it still cannot start. Windows reports a side-by-side activation error: dependent `mozglue` assembly cannot be resolved. Firefox never loaded the application on this host. Its project remains in CI on Ubuntu; Firefox compatibility is **not claimed verified**.

Unit coverage includes all five hardware schema variants, field-level real-data provenance, dimensions, fixture page bounds/cancellation, CPU/RAM/GPU/storage compatibility, candidate M.2 fit aggregation, template/category validation, asset manifest permissions, quality hysteresis/cooldown, LOD, semantic selection, concurrent resource leases and actual deduplicated Three.js geometry/material/texture disposal. PGlite executes the PostgreSQL migration/seed and tests category constraints, negative capacities, unique slugs, mandatory non-fixture source URLs, anonymous/authenticated write denial and private-row/child/view isolation. A CLI test creates an original GLB triangle and executes Meshopt optimization, validates SHA-256 output and checks the preserved semantic anchor.

Browser coverage includes lazy renderer requests, real CPU-region canvas selection, component list/inspector updates, camera focus/reset/orbit/zoom, exploded toggles, quality selection, keyboard fallback, reduced-motion mode, portrait/landscape overflow, unsupported WebGL, renderer import failure/retry, four viewer enter/leave cycles with stable geometry counts, and a stationary scene that performs at most two GL clears over a measured 60-frame browser interval. Native touch pinch/pan and physical phones have not been certified. Mobile tests use tap selection, mouse-driven orbit in device emulation and accessible zoom controls.

## Measured production bundles

Node gzip budget measurements from the final production build:

| Chunk                  | Gzip bytes |   Limit |
| ---------------------- | ---------: | ------: |
| Landing/catalog entry  |    109,503 | 150,000 |
| Lazy Three.js renderer |    251,103 | 320,000 |
| Lazy explorer shell    |      5,996 |  30,000 |
| Styles                 |      5,937 |  15,000 |

The generic scene has no external GLB or image-texture downloads. A sampled medium-quality reference frame used 49 draws, approximately 1,046–1,550 triangles, 49 geometries and one internal texture. These are software-renderer observations, not a physical-device FPS promise. Resource count stability and disposal tests do not prove the absence of all GPU/driver/JavaScript heap leaks.

## Remaining limits

- Five fictional development records, one procedural board template; no real product database, accounts, saved builds or installation animation.
- Supabase's normalized SQL and read-only repository adapter are present; hosted PostgREST/Storage/auth integration and Supabase pgTAP CLI checks are not executed. No Docker/Supabase/psql executable is installed on this host. PostgreSQL constraints and RLS were actually executed through PGlite.
- Texture-free Meshopt processing is tested. Textured KTX2 processing needs KTX-Software 4.4+ and was not executed. No decoder files or external licensed models are shipped in the initial viewer.
- Quality applies pixel ratio, antialiasing, shadows and LOD detail; reserved texture/effects/reflection controls need future assets. No GPU byte estimates, persistent asset cache or installed-slot/power/case solver yet.
- The fixture catalog UI displays the first bounded page; search, paging UI and full detail-by-slug remote lookup are next catalog work.
- Stable R3F emits upstream Three.Clock deprecation and soft-shadow fallback warnings against stable Three.js. They do not produce page errors; moving to alpha R3F is not an acceptable workaround.

Security: public writes are denied, private rows remain invisible, imports are runtime validated, sources are explicit, service-role/secret values are absent, and no third-party model is downloaded. Future authenticated writes require new reviewed migrations and policies.

Next milestone: install fixture CPU/RAM/M.2 components using semantic anchors, track occupied slots and display scoped compatibility/unknown results. Then add one carefully sourced manufacturer record and one reviewed premium model to validate the data/asset pipelines against real inputs.
