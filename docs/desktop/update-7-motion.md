# Update 7: motion architecture and exploded inspection

The detected 3D viewer now has reversible explosion, continuous 0–100% scrubbing, smooth camera commands and optional component isolation. My PC, the Windows scanner, local scan cache and hardware classification are unchanged. All models retain their generic visualization notices; storage separation describes inventory, not confirmed installation.

## Ownership and orchestration

`packages/3d-engine/src/motion/` is the isolated motion module:

| Module          | Responsibility                                                                          |
| --------------- | --------------------------------------------------------------------------------------- |
| `types.ts`      | Device identity, assembled pose, bounds, request, rendered values and camera pose       |
| `layout.ts`     | Existing illustrative assembly placement, separate from movement                        |
| `poses.ts`      | Deterministic category/bounds/ordinal-based exploded targets and interpolation          |
| `controller.ts` | Scheduler-free orchestration, current values, one track per visual and one camera track |
| `bindings.ts`   | Sole Three.js writer for detected visual position, rotation and focus tint              |

Device coordinates use millimetres; the render root converts to metres once. Camera fitting consumes metre bounds. A device is identified by category, scan index and detected name, separately from its mesh and quality tier. Replacement meshes bind to the existing controller values. Rescans prune removed identities and clear stale selection/focus. The controller is disposed when the viewer closes.

The controller exposes `idle`, `transitioning`, `exploded`, `focusing` and `returning`. Changing a request first evaluates the current track at the supplied monotonic time, then replaces it from those values. The animation has an exact finite endpoint. Repeated reversals cannot accumulate competing timelines or transform drift. `define`, `prune`/`sync`, `configure`, `tick`, `startCamera`, `cancelCamera` and `dispose` form the reusable boundary; React supplies intent and the render adapter supplies time.

## Interaction

Normal explosion uses a 560 ms cubic transition with 70 ms category offsets: CPU, memory, discrete GPU, storage. Reassembly reverses the order. The motherboard stays anchored. CPUs lift vertically; memory rises with deterministic fan-out; cards move out from the illustrative PCIe region and slightly up. Storage tokens move into a separate inspection grid. Multiple tokens use their ordinal and footprint to remain separated.

Scrubbing applies the requested amount directly, without starting competing cinematic tracks. Focus keeps the selected visual at full intensity and tints other device materials to 38% intensity. Each visual owns its material palette so dimming one device cannot dim the selected device through a shared material. Return restores all palettes and fits the system. Reassembly and isolation are independent intents.

Selection, Fit, Reset and zoom use the same finite camera track. Fit preserves the current orientation; Reset chooses the product orientation. The solver fits projected bounds corners, including inventory and target exploded positions. It retains the azimuth at OrbitControls' near-vertical polar limit; replacing that basis too early can clip an asymmetric inventory. A regression test projects every bounding corner through a real Three.js perspective camera. Manual orbit/zoom cancels the camera track immediately, leaving OrbitControls in control.

The first viewer visit has a restrained settle and camera entrance. Session memory stores only the visited flag and explosion amount, so tab changes do not replay the component entrance. Reduced motion skips cinematic travel while keeping explosion, scrubbing, selection and isolation functional.

Fullscreen contains the motion controls, optional Components chooser, inspector, Fit/Reset and quality selector. Canvas resizing retargets framing; quality changes preserve current device transforms and camera position rather than resetting an in-flight transition.

## Demand rendering and resource lifecycle

The controller owns no RAF, timeout, Three.js object or GPU resource. R3F retains `frameloop="demand"`; active tracks temporarily invalidate frames. One final frame makes the settled transforms available to the finite contact bake. High quality reuses its contact render targets, hides obsolete contact silhouettes during movement and bakes once after settling. It does not run continuous postprocessing.

The controller and bindings survive antialias/context replacement, while model geometry, materials, CPU marking textures, environment and effect targets retain their existing explicit disposal owners. Closing the viewer clears all tracks and bindings and releases its WebGL context. Diagnostics report active handles, resolved visual poses, geometry/texture/material counts and CPU main-scene render submission duration. Normal My PC startup still does not load Three.js or the renderer.

## Validation and measurements

Run `pnpm check`, `pnpm format:check`, `pnpm test:e2e`, `pnpm desktop:check`, `pnpm desktop:test`, `pnpm desktop:build` and `pnpm test:desktop`. The existing production and reconstruction harnesses remain available through `pnpm verify:production` and `pnpm verify:3d` with their respective local servers running.

The motion unit suite covers endpoints/intermediate poses, stagger/reversal, repeated interruption, focus during explosion, reduced motion, quality replacement, rescan pruning, disposal, multiple memory/storage items, discrete-card placement, camera cancellation and near-vertical framing. Browser tests exercise actual controls, material dimming, orbit cancellation, fullscreen selection, quality replacement, mid-transition unmount and session restore. Both desktop and mobile Chromium execute 25 complete animated explode/reassemble cycles with equal geometry/texture/material counts and exact original transforms afterward. A separate WebGL submission probe verifies zero idle draws and fails if continuous rendering survives the finite settle window.

Measurements are local to this host. Frame intervals are event-to-event intervals within active transitions, including slow samples; the gap between separate transitions is excluded. CPU render duration measures JavaScript/WebGL submission for the main scene, including enabled lighting-shadow work. It is not GPU time or a guaranteed refresh rate. SwiftShader browser measurements demonstrate behavior and bounded work; native WebView2 measurements are reported separately.

Detailed machine-readable browser measurements and screenshots live in `.artifacts/motion/`; native measurements and screenshots live in `.artifacts/desktop/`. CI retains these explicit validation artifacts. No runtime upload or remote asset request was introduced.

## Executed results — 8 October 2026

`pnpm check` passed TypeScript, lint, **141 unit tests**, production build and gzip budgets. Rust check/format passed, and all **17 native tests** passed, including the real Windows scan. The supported browser runs and targeted regression rechecks passed **34 checks** across desktop/mobile Chromium and WebKit; 14 probes are intentionally Chromium-only. Firefox was attempted but its installed Windows runtime failed before loading the application with `browserType.launch: spawn UNKNOWN`; it remains configured in Linux CI.

The production desktop/mobile harness and reconstruction harness passed lazy loading, layout, mesh selection, framing, material preservation, quality/resource budgets, zero settled draws and teardown. The actual rebuilt Tauri executable passed **16 packaged checks**, including real scanned CPU marking, explode/scrub, CPU/GPU inspection, focus/return, manual camera interruption, near-vertical Fit, fullscreen/Escape, 25 complete motion cycles, four viewer context-release cycles and graphics-loss fallback. Page errors and remote requests were both empty.

The native scene contained one processor, one system-confirmed discrete card, two memory modules and four disk inventory tokens. Native active-transition measurements:

| Quality  | Samples | Frame interval P50 / P95 (ms) | CPU scene submission P50 / P95 (ms) | Moving draw calls per frame | Draws in settled idle window | Geometries / textures / materials |
| -------- | ------: | ----------------------------: | ----------------------------------: | --------------------------: | ---------------------------: | --------------------------------: |
| Low      |     310 |                     5.0 / 5.7 |                           1.0 / 1.4 |                          65 |                            0 |                       65 / 3 / 47 |
| Standard |     309 |                     5.0 / 5.8 |                           1.5 / 2.4 |                         143 |                            0 |                       73 / 5 / 49 |
| High     |     310 |                     5.0 / 5.8 |                           1.6 / 2.3 |                         143 |                            0 |                       75 / 7 / 50 |

These are this WebView2 run's scheduler and CPU submission measurements, not GPU timer queries or a guaranteed display refresh rate. High contact occlusion is hidden during movement and rebaked once afterward. Native resize/paint notifications are allowed a bounded settle period; a subsequent complete 650 ms idle window must contain zero submissions. Continuous rendering fails the probe.

| 25 complete cycles                    | Before                                    | After       | Retained motion handles | Settled idle draws |
| ------------------------------------- | ----------------------------------------- | ----------- | ----------------------: | -----------------: |
| Native Low, selected outline retained | 66 geometries / 3 textures / 48 materials | 66 / 3 / 48 |                       0 |                  0 |
| Desktop Chromium, SwiftShader         | 56 geometries / 3 textures / 38 materials | 56 / 3 / 38 |                       0 |                  0 |
| Mobile Chromium, SwiftShader          | 56 geometries / 3 textures / 38 materials | 56 / 3 / 38 |                       0 |                  0 |

Both original transforms and resource counts matched after the cycles. The selected outline adds one geometry/material to the native cycle baseline. Browser moving draws were 56 at Low, 125 at desktop Standard/High, and 111–125 on mobile as distance LOD changed. Desktop software-rendered frame interval P50/P95 was 19.9/72.7 ms at Low, 17.2/248.4 ms at Standard and 69.9/205.3 ms at High. These slower, variable software-backend results are not hardware performance certification.

The lazy renderer remains approximately **257.1 KiB gzip**; viewer controls are 3.7 KiB and entry code is 105.8 KiB. Existing bundle budgets pass. Motion introduces no remote assets, downloaded textures or additional bitmap pipeline. The updated executable, development installer and SHA-256 manifest are copied to `release/windows-x64/`.
