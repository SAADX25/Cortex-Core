# Detected hardware visual reconstruction

The My PC dashboard, navigation, automatic scan, local cache and real specification inspectors are preserved. This milestone rebuilds the read-only 3D scene. It adds no assembly controls, product catalog query, network upload or exact-product claim.

## Original models and material ownership

`packages/3d-engine/src/detected-models.ts` contains original CAD-style source. Major surfaces are beveled extrusions, not sharp box primitives. The PCB has actual perforated mounting holes, thickness and clipped corners. The motherboard includes socket retention frame/lever, open DIMM channels and clips, keyed PCIe housings, M.2 connector and posts, VRM chokes/MOSFETs/capacitors, finned sinks, chipset cooler, battery, ATX/EPS pin wells, SATA ports, fan/USB/front-panel headers, rear I/O apertures and surface-mount controller packages/leads. Fine electronics, contacts, silkscreen stencil glyphs and traces use instancing. Compatible primitive batches merge before GPU allocation.

The CPU uses separate substrate and beveled metal IHS with original generic markings. RAM uses thin PCB, individual ICs on both sides, SPD package, label and segmented gold contacts. The generic discrete card has upright PCB, fingers, backplate, output bracket/vents, fins, copper pipes, beveled shroud with genuine apertures, curved fan blades, rims and hubs. Fans remain stationary at idle. Storage tokens have beveled surfaces and hardware details, but deliberately do not assert a drive enclosure form factor.

Twelve shared finish definitions distinguish high-roughness dielectric PCB, substrate, chips and connector polymers from aluminum, steel, gold and copper. Selection adds a subtle edge cage and opens the actual device inspector; it does not replace PBR materials with green. Generated RoomEnvironment lighting provides PBR reflections without remote HDR files. Neutral key/fill/rim lighting and ACES tone mapping replace the developer grid. Standard uses a 512-pixel directional shadow map; High adds a 1024-pixel shadow map and finite planar contact-occlusion bake. The contact bake explicitly releases its render targets, shader materials and quad geometry.

## Identity, placement and provenance

Hardware names/specifications never determine geometry through marketing-name guesses. `packages/asset-runtime/src/detected-visuals.ts` resolves a verified hardware-to-asset key first, then an explicitly reported family, then a safe generic default. The exact-asset registry is currently empty. Registered ATX, micro-ATX, Mini-ITX and OEM/unknown templates are original procedural assets in the existing validated MIT licensing manifest. The detected viewer defaults to OEM/unknown because its scanner does not reliably report board form factor. The real manufacturer/model appears alongside “Generic motherboard visualization.”

Assets use millimetres in source, scale 0.001 into metre-space, +Y up and +Z toward the board front. CPU anchors sit at the generic socket; DIMM modules align with generic connector channels. The discrete card fingers align with the illustrative primary PCIe slot. These anchors do not assert the user's actual slot occupancy or board dimensions. Extra modules use an illustrative inventory location rather than inventing reported slot addresses. Fit computes perspective constraints across every hardware mesh, including the detached tray; camera commands clear residual orbit damping before setting the new pose.

GPU classification uses DXGI software flags and DXCore `IsHardware`/`IsIntegrated`, joined through an in-memory adapter LUID and a unique exact WMI/DXGI description match. LUIDs never cross IPC or enter the cache. The fixed DXCore DLL loads only from System32 and is optional on older Windows. Known virtual display provider descriptions receive the Virtual class. Missing support, ambiguous joins or absent properties stay Unknown. Vendor, adapter name alone and dedicated VRAM size never prove Discrete. Only the Discrete class creates a standalone card. Integrated, virtual, software and unknown adapters remain selectable in system information, with their detected names and classification sources.

Storage counts come from physical disk records, not volumes/partitions. NVMe transport does not imply M.2 form factor. The resolver requires both explicitly reported M.2 and NVMe before using the generic M.2 anchor. The current scanner reports no reliable drive form factor, so all scanned disks correctly occupy “Detected Storage — Inventory; location and form factor unknown.” No SATA/HDD/unknown drive is placed on the motherboard as an installation claim.

No Blender/GLB, bitmap texture, external model or downloaded HDR asset was introduced. New GLB compressed file bytes: **0**; bitmap texture download bytes: **0**. Original procedural v2 entries carry source/author/MIT/commercial/redistribution/modification provenance in the existing manifest. Retained integrity-checked GLB loading, Meshopt compression, KTX2 tooling and resource leases remain available for future reviewed exact assets. Procedural geometry/material resources are created only inside the lazy renderer and disposed on model/tier replacement or unmount; repeated instanced primitives follow R3F disposal. Environment and contact targets have explicit cleanup.

## Quality and validation

Low disables MSAA and shadows and reduces fine traces/contacts/fan curves. Standard caps DPR at 1.25, retains beveled major geometry and electronic detail, and uses a small shadow map. High caps DPR at 1.5, retains the finest near-camera geometry and adds contact occlusion. Distance LOD can reduce detail at any tier. Automatic starts at Standard and uses only sustained active-frame windows; idle intervals do not trigger downgrades. Slow continuous frames above 100 ms still count toward a downgrade, with a unit regression check separating them from idle pauses. The main canvas uses `frameloop="demand"`; no idle animation, hardware polling, animated fan, permanent SSAO loop or external reflection download was added.

Run `pnpm dev` and then `pnpm verify:3d` for the reconstruction harness. Synthetic records are injected exclusively by the harness. It checks mixed integrated/discrete/virtual/software/unknown adapters, exact module and physical disk counts, actual mesh-to-inspector selection, material preservation, fit at desktop/mobile widths, zero draws after settling, bounded scene complexity, repeated quality resource counts and teardown. It emits screenshots and JSON measurements under `.artifacts/reconstruction`. `pnpm test:desktop` checks the packaged application against the real host, including detected classes/counts, scanner/cache, camera, fullscreen/Escape, entry/exit and graphics fallback.

## Measured scene budgets

The synthetic desktop case uses one CPU, one confirmed discrete card, two memory modules and two physical-disk inventory tokens. At 1440 × 1050 browser size (1148 × 651 canvas, DPR 1), completed-frame measurements were:

| Tier     | Draw calls | Rendered triangles | Scene materials | GPU textures | Geometry / instance buffers | Estimated GPU allocation |
| -------- | ---------: | -----------------: | --------------: | -----------: | --------------------------: | -----------------------: |
| Low      |         57 |             18,364 |              11 |            2 |                    1.00 MiB |                 18.4 MiB |
| Standard |        128 |             50,002 |              13 |            4 |                    1.10 MiB |                 37.6 MiB |
| High     |        129 |             54,844 |              14 |            6 |                    1.15 MiB |                 47.7 MiB |

Draw/triangle counters include enabled shadow work; these are not unique mesh triangle counts. The twelve shared PBR finishes are allocated once; Low renders eleven because it omits trace finish. Standard adds the shadow receiver; High adds the contact receiver and two offscreen helper shader materials beyond its fourteen scene materials. GPU texture counters include generated environment and render targets, not downloaded bitmap assets. High's extra contact work bakes once rather than running a permanent postprocessing loop.

GPU allocation is a planning estimate, not driver telemetry: uploaded geometry/instance bytes, RGBA16F environment, assumed color/depth shadow/contact targets, and color/depth multisample/resolve framebuffer storage at the measured canvas size. Driver heaps, shader programs and implementation-specific padding are excluded. Estimates depend on viewport, MSAA and device DPR. Low uses no MSAA; Standard/High used four samples in this run.

The physical Windows host reported two adapters, classified by the system as one Discrete and one Integrated. The scene correctly rendered one card, two memory modules and four physical disks. At its packaged test-window size, native scene measurements were:

| Tier     | Draw calls | Rendered triangles | Scene materials | GPU textures | Estimated GPU allocation |
| -------- | ---------: | -----------------: | --------------: | -----------: | -----------------------: |
| Low      |         65 |             18,916 |              11 |            2 |                 13.8 MiB |
| Standard |        144 |             51,106 |              13 |            4 |                 26.0 MiB |
| High     |        145 |             55,948 |              14 |            6 |                 36.1 MiB |

The larger native draw count comes from two additional inventory disks. Packaged interaction-window RAF intervals had medians around 5 ms and 95th percentiles around 5.1–5.3 ms across at least 170 samples per tier. These are scheduler/interaction measurements, not GPU timer queries or a guaranteed display refresh rate. Software SwiftShader browser runs were substantially slower; quality validation on that backend proves bounded resources and behavior, not smooth hardware performance. No general low-end or integrated-GPU hardware certification is claimed.

The lazy renderer is approximately 254.8 KiB gzip (about 6.7 KiB above the preceding milestone); the lazy viewer shell is 27.3 KiB, entry 79.0 KiB and styles 8.4 KiB. Existing bundle budgets pass, and startup still does not request the renderer. New compressed GLB/bitmap download sizes remain zero. Each tier returned to zero GL draws after settling, and repeated High/Standard changes returned to identical live geometry/texture counts.

## Executed checks and artifacts

| Check                                 | Result                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                          | Typecheck, lint, 116 unit tests in 9 files, production build and gzip budgets passed                                                                                                                                                          |
| `pnpm format:check`                   | Passed                                                                                                                                                                                                                                        |
| `node tools/desktop/run.mjs rust-fmt` | Passed                                                                                                                                                                                                                                        |
| `pnpm desktop:test`                   | 17 native tests passed, including the real Windows scan and new no-VRAM/vendor-inference classification test                                                                                                                                  |
| Supported browser suite               | 22 passed; 2 intentionally skipped Chromium-only draw probes on WebKit projects                                                                                                                                                               |
| Firefox                               | Five functional tests blocked before app execution by this host's existing `browserType.launch: spawn UNKNOWN`; one draw probe intentionally skipped. Firefox remains in Linux CI.                                                            |
| `pnpm verify:3d`                      | Desktop/mobile count, classification, fit, actual mesh selection, PBR preservation, idle, quality budget, resource stability and teardown checks passed                                                                                       |
| `pnpm verify:production`              | Built production bundle passed desktop/mobile lazy loading, actual inspector wiring, layout and error checks                                                                                                                                  |
| `pnpm desktop:build`                  | Windows x64 executable and unsigned development NSIS installer built                                                                                                                                                                          |
| `pnpm test:desktop`                   | All 14 packaged checks passed: real scanner/cache/clipboard/privacy, adapter/count mapping, all quality tiers, actual inspectors, camera, fullscreen/Escape, four entry/exit cycles, context-loss fallback and no page errors/remote requests |

Screenshots and detailed measurements: `.artifacts/reconstruction/scene-{low,medium,high}.png`, `viewer-{1440,390}.png`, `renderer-metrics.json`; `.artifacts/desktop/my-pc-dashboard.png`, `detected-3d-view.png`, `hardware-smoke.json`; `apps/web/dist/budget-report.json`. These are local artifacts, never uploaded. Final distributable copies and SHA-256/size manifest live under `release/windows-x64`. The installer is unsigned development output; this task does not install it over the user's application or certify a fresh Windows machine.

Classification API reference: [Microsoft DXCore adapter properties](https://learn.microsoft.com/en-us/windows/win32/api/dxcore_interface/ne-dxcore_interface-dxcoreadapterproperty). Implementation and test results, rather than marketing-name assumptions, determine the app's physical-card mapping.
