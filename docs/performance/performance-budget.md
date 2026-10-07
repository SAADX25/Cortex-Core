# Performance budgets

Budgets are enforced by `pnpm build` and `tools/check-budgets.mjs`. `dist/budget-report.json` contains measured bytes for every production chunk. Gzip totals can differ slightly from Vite's printed compressed sizes because the enforcement script uses Node's gzip defaults; always compare the same measurement method.

| Resource                  |      Gzip cap |
| ------------------------- | ------------: |
| Landing/catalog JS entry  | 150,000 bytes |
| Lazy renderer JS          | 320,000 bytes |
| Lazy explorer shell JS    |  30,000 bytes |
| Styles                    |  15,000 bytes |
| Optional Supabase adapter |  80,000 bytes |

The landing imports no Three.js, R3F, viewer or GLB decoder code. The build script also rejects a Three.js renderer signature in the entry bundle, and an E2E test checks network requests before navigation. Initial procedural assets cost zero GLB/texture downloads. No external font request or image texture is necessary.

Scene targets: under 100 draw calls, 20,000 triangles, no more than 4 procedural/internal textures, low/medium DPR ≤1.25 on constrained devices, high DPR ≤1.5 and opt-in ultra DPR ≤2. Keep imported board GLB variants below 2 MB, low/mobile texture residency below 16 MB and desktop below 48 MB. These imported/GPU-residency budgets are targets for the next asset milestone, not currently enforced loader limits. Future production assets must add automated triangle/texture-byte audits to the pipeline.

R3F `frameloop="demand"` redraws during controls, finite camera/explosion interpolation or React scene changes and then returns to idle. No perpetual effect runs. Active-frame quality sampling excludes gaps over 100 ms. A 90-frame p75 window downgrades over 28 ms, while four windows below 18 ms upgrade conservatively. A 15-second cooldown prevents oscillation. Automatic mode starts at medium and stops at high; ultra requires explicit selection. The manager survives antialias-driven canvas recreation. Profiles apply DPR, shadows/map size, antialiasing and LOD bias. Texture size/effects/reflections/post-processing are defined seams, not claims that such effects are enabled.

Development diagnostics (`?debug=1`) show recent active FPS/frame time, previous-frame draw calls/triangles, geometry/texture counts, current quality and camera projections. Idle is not a failed frame. GL memory byte estimates are not available; counts are lifecycle proxies. Diagnostics compile out of production. A reference scene in Chromium used approximately 49 draw calls, 1,046–1,550 triangles, 49 geometries and one renderer-internal texture depending on LOD. Measurements use software graphics on this host and are not physical-device benchmarks.

Browser tests check idle rendering, selection, camera interactions and repeated mount/unmount geometry stability. Count stability cannot prove absence of driver-level/JavaScript heap leaks; repeat product swaps under DevTools GPU/heap profiling before integrating real assets. Test low-end physical Android/iOS devices before a public production release. Accessibility fallback remains available regardless of graphics performance.
