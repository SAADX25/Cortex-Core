# Immersive 3D viewer cleanup

The persistent component grid has been removed from both the normal viewer and fullscreen. Detected device data, generic asset classification, mesh selection, HardwareInspector and the motion engine remain intact. My PC and hardware scanning are unchanged.

The viewer fills the available application height. The visualization explanation opens over the workspace without shrinking the scene. A compact Components button opens a closed-by-default modal list grouped by category, including devices that have no discrete 3D visual. Native dialog semantics provide keyboard focus trapping, Escape dismissal and focus restoration. Selecting a device closes the chooser and opens the existing inspector. Escape in either dialog preserves desktop fullscreen.

All old component grid/card selectors and responsive styles were removed. No renderer resources, animation scheduling or camera algorithms changed.

## Validation

- Type checking, lint, 141 unit tests, production build and bundle budgets pass.
- Rust checking and all 17 native tests pass; Windows executable and NSIS package build successfully.
- Existing production and reconstruction harnesses pass at desktop/mobile sizes, including Low/Standard/High quality, fit, mesh selection, idle rendering, resource stability and teardown.
- The desktop 1080p browser check clicks CPU, discrete GPU, memory, storage and exposed motherboard meshes and verifies the corresponding detected inspector. The page has no horizontal or vertical overflow; the canvas exceeds 700 pixels in height.
- Keyboard-only chooser selection, Escape and focus restoration are tested across Chromium and WebKit desktop/mobile configurations. Existing Intel/AMD top markings, selection, quality, resource disposal, reduced motion, orbit cancellation, focus and fullscreen checks remain covered.
- Across those browser configurations, 39 checks pass and 17 WebGL/desktop-only cases are intentionally skipped. Two initial Chromium failures were corrected and retested: a stale storage selector and overlapping Playwright trace output. Both focused retests pass, including 25 complete desktop animated cycles with zero idle draws. Firefox cannot launch on this Windows host (`spawn UNKNOWN`, before application load); its CI project remains enabled.
- The packaged desktop smoke passes 17 checks using real scanned hardware, including mesh selection, fullscreen, context loss fallback, four viewer reopen cycles and 25 animated explode/reassemble cycles. Resource counts remain 66 geometries, 3 textures and 48 materials before and after the native cycles, with zero retained motion handles and zero settled idle draws. No page errors or remote requests occur.
- Detailed results and screenshots are saved under `.artifacts/motion/` and `.artifacts/desktop/`; development executable, installer and checksum manifest are under `release/windows-x64/`.
