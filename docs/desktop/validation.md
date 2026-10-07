# Desktop Foundation validation — 2026-10-07

Executed locally on Windows x64, Rust stable 1.99.0, Node 24.17.0 and pnpm 10.17.0. Native display scale was 1×. Tauri CLI/API/crate are 2.12.1; tauri-build is 2.7.1. No releases were published and no signing certificate was configured.

## Exact results

| Check                             | Executed command / method                                                                           | Result                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Typecheck                         | `pnpm typecheck`                                                                                    | Passed, exit 0                                                                                                      |
| Lint                              | `pnpm lint`                                                                                         | Passed, exit 0                                                                                                      |
| Formatting                        | `pnpm format:check`                                                                                 | Passed                                                                                                              |
| Unit tests                        | `pnpm test`                                                                                         | **79 passed**, 6 files                                                                                              |
| Database tests                    | Included in `pnpm test`, `tests/unit/database.test.ts`                                              | **7 passed**; real PostgreSQL execution through PGlite, migration/seed, constraints and RLS                         |
| Asset pipeline                    | Included in `pnpm test`, `tests/unit/pipeline.test.ts`                                              | **1 passed**; actual glTF Transform/Meshopt CLI optimization of an original GLB and anchor preservation             |
| Browser renderer                  | `pnpm test:e2e --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari` | **28 passed**, final run 1.8 minutes                                                                                |
| Native fixture consistency        | `node tools/desktop/generate-fixtures.mjs --check`                                                  | Passed                                                                                                              |
| Frontend production build         | `pnpm build`, also executed by `pnpm desktop:build`                                                 | Passed; lazy renderer and gzip budgets passed                                                                       |
| Rust compilation                  | `pnpm desktop:check` / `node tools/desktop/run.mjs rust-check`                                      | Passed with locked Cargo dependencies                                                                               |
| Rust tests                        | `pnpm desktop:test` / `node tools/desktop/run.mjs rust-test`                                        | **4 passed**; migrations, round trips, invalid cache preservation, future schema refusal, fixture/size restrictions |
| Rust formatting                   | `node tools/desktop/run.mjs rust-fmt`                                                               | Passed                                                                                                              |
| Tauri development launch          | `node tools/desktop/run.mjs dev --no-watch`                                                         | Compiled and launched actual native window with Vite renderer                                                       |
| Development native smoke          | CDP attach on port 9225, `node tools/desktop/smoke.mjs --development`                               | **10 checks passed**, zero page errors                                                                              |
| Tauri release build               | `pnpm desktop:build`                                                                                | Passed; final native release compilation 2 minutes 9 seconds                                                        |
| NSIS generation                   | Tauri release bundling                                                                              | Passed; Windows x64 development installer generated                                                                 |
| Install                           | NSIS `/S /D=G:\Cortex Core\.artifacts\desktop\installed`                                            | Exit **0**; executable, uninstaller and correct Start menu shortcut verified                                        |
| Installed binary verification     | `node tools/desktop/verify-install.mjs`                                                             | Passed; every byte matches standalone output except Tauri's expected `UNK` → `NSS` bundle marker (3 bytes)          |
| Installed production native smoke | `CORTEX_DESKTOP_EXE` set to installed executable, CDP port 9226, `pnpm test:desktop`                | **13 checks passed**, zero page errors                                                                              |
| Uninstall                         | Isolated NSIS uninstaller `/S`                                                                      | Exit **0**; executable/Start menu removed and catalog database hash unchanged; final package reinstalled afterward  |
| Signatures                        | `Get-AuthenticodeSignature`                                                                         | Both artifacts are **NotSigned**, as intended for development                                                       |

The 79 unit tests include the original 77 plus two tests for the host-independent snapshot repository. Database and asset tests are part of that suite, not additional counts. The browser heading expectation changed to the desktop Home copy; existing interaction/failure/resource tests were retained.

Local Firefox was excluded due to the previously recorded Playwright `mozglue` environment failure. It remains configured in CI; no Firefox troubleshooting was performed during this pivot. Supabase CLI/Docker/pgTAP services were not executed; PGlite database tests did execute. GitHub Actions itself has not run from this local workspace; the Windows CI job is configured, not claimed remotely passed.

## Production/native evidence

`.artifacts/desktop/production-smoke.json` records the installed executable, `packaged=true`, `cacheStatus=local-snapshot`, `offlineReady=true`, restored 1360×680 pixel window size and scale 1×. The 13 checks verify packaged startup, restored saved size, capability denial, motherboard rendering, all 17 semantic regions through the component tree/inspector, explosion/quality controls, camera zoom/orbit/reset/fit, native fullscreen/Escape and its resize, four viewer entry/exit cycles, offline fixtures, real WebGL context-loss recovery, absence of page errors/remote requests and no new external browser processes.

The development server had **zero listeners on port 5173** before installed production validation. Requests were confined to `http://tauri.localhost` (Tauri's packaged-asset protocol) and `http://ipc.localhost` (native IPC). Neither is a frontend HTTP server. The runner injected a temporary localhost CDP port only for automation; the shipped configuration does not enable it. Offline mode was applied before entering the lazy explorer, exercising native catalog access and packaged chunks without internet.

`production-explorer.png`, `native-fallback.png`, `dev-explorer.png`, `dev-smoke.json`, `installer.json`, `uninstaller.json`, `installed-binary.json` and `frontend-listener-check.json` are under `.artifacts/desktop`. Browser traces/reports are under the normal Playwright output directories. Runtime support logging accepts only three enumerated graphics codes and omits personal paths/device identifiers.

Browser Playwright coverage validates the shared React/Three renderer. Native CDP coverage targets the real Tauri/WebView2 process and tests native commands plus packaged assets. It does not certify every Windows frame/input/display behavior. Renderer disposal unit tests and repeated native canvas teardown pass; the smoke runner terminates its owned process rather than testing a normal native Close-button lifecycle.

## Artifacts

| Artifact              | Location                                                                     |      Bytes |      Size |
| --------------------- | ---------------------------------------------------------------------------- | ---------: | --------: |
| Standalone executable | `G:\Cortex Core\release\windows-x64\Cortex Core.exe`                         | 11,879,424 | 11.33 MiB |
| Development installer | `G:\Cortex Core\release\windows-x64\Cortex Core-0.2.0-development-setup.exe` |  5,955,569 |  5.68 MiB |

Intermediate Tauri installer: `apps/desktop/src-tauri/target/release/bundle/nsis/Cortex Core_0.2.0_x64-setup.exe`. `release/windows-x64/manifest.json` records versions, exact sizes and SHA-256 hashes:

- Standalone: `b2ef0c5bed97150ac11b77aecc18efd16a9b4d1d44d677461d86c3e195510bea`
- Installer: `8a4e3f7a37cdfeba86ee3984cbe4e43ff1a300954e7279d5db958eec53c3ef81`
- Installed NSIS-stamped executable: `ababef7dd36b002b30810c00f0b23e0b775ce1ff2765f07e3800afa76fac5dd2`

Final gzip sizes: entry **110,938 B**, renderer **251,096 B**, explorer **6,187 B**, styles **6,834 B**, all within existing caps. The renderer remains lazy; the essential board uses no downloaded GLBs or textures.

## Architecture and changed files

- **Added `apps/desktop`**: native Cargo manifest/lock, Rust bootstrap, SQLite snapshot module/tests, build command manifest, Tauri configuration, main capability, generated app icons and bundled fixture envelope.
- **Extracted `packages/application-ui`** from `apps/web/src`: one shared UI, separate catalog/settings/platform adapter, desktop Home/left navigation/status layout, original explorer/list/inspector/fallback/state/tokens. `apps/web/src/main.tsx` now imports that shared bootstrap and `apps/web` is the test/development harness.
- **Added `packages/data-access/src/snapshot.ts`** and package export; two boundary tests in `tests/unit/desktop-data.test.ts`. The repository remains independent of Tauri/SQLite.
- **Fixed `packages/3d-engine/src/renderer.tsx`** to preserve camera pose when adaptive antialias quality recreates a graphics context. The original semantic scene, instancing, demand rendering, LOD and disposal ownership remain.
- **Added `tools/desktop`** launch/build/toolchain runner, fixture consistency generator, native smoke, release packaging/hash manifest and installed-byte verification.
- **Updated root scripts, lockfile/version record, browser expectation/store test import, lint/format ignore rules and Windows CI** while retaining existing validation jobs.
- **Added ADR 0003/0004 and desktop development/validation docs**, and updated README/architecture ownership. Part schemas, compatibility engine, asset pipeline/runtime and Supabase migration were preserved.

The main-window capability permits five explicit native operations; no unrestricted filesystem, SQL, shell/process or general opener/window API is exposed. Production navigation/new-window/CSP restrictions are configured and were reviewed; ungranted-plugin and invalid-documentation-key rejection were exercised in native tests. SQLite holds fictional development snapshots; Supabase remains the future authoritative remote catalog. Application 0.2.0, catalog 2026.10.07.1 and asset manifest 1 are independent versions.

## Remaining limits and next milestone

Computer Use was stopped by an Escape input. Further Windows UI automation was stopped for this turn. Manual drag-resizing, native minimize/maximize/restore and normal Close-button resource/state behavior remain pending. The native window frame/icon and application layout were observed before that stop; automated fullscreen resize and saved-size restoration did execute afterward through the dedicated test interface. Physical DPI above 1×, mixed-DPI/multi-monitor/disconnected-monitor behavior and clean Windows 10/11 machines remain unverified.

Unsigned development distribution is complete; trusted/public distribution requires a deliberate publisher/signing/release policy. A missing WebView2 runtime requires internet for the embedded bootstrapper's first installation. Auto-update, remote catalog sync, downloaded asset caching/eviction, destructive cache controls and `.cortexbuild` import/export remain designed future features. Windows ARM64/macOS/Linux are architecture paths, not built/tested targets.

Next: Windows release hardening and the pending native frame/display/clean-machine checks, followed by signing/update policy. No CPU/RAM/GPU installation milestone was started.

Reference documentation: [Tauri capabilities](https://v2.tauri.app/security/capabilities/), [window state](https://v2.tauri.app/plugin/window-state/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/), and [Playwright WebView2 testing](https://playwright.dev/docs/webview2).
