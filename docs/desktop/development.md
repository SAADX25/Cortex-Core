# Cortex Core Desktop Foundation

The shipped product is `apps/desktop`: Tauri 2.12.1, stable Rust 1.99.0 and Windows WebView2. `packages/application-ui` contains the only React application. `apps/web` owns Vite's development/test entry and production asset build; Tauri embeds that build. Hardware schemas, compatibility, repositories, asset ownership and semantic rendering remain reusable packages.

## Development and builds

Install Node 24.17.x, pnpm 10.17.0, Rust stable, Visual Studio C++ tools and a Windows SDK. Run `pnpm install --frozen-lockfile`, then `pnpm desktop:dev`. The runner detects this workspace's optional ignored `.toolchains/cargo` and `.toolchains/rustup`; elsewhere it uses system Rust. No global PATH change is required by the runner.

`pnpm desktop:check` runs Cargo check with the committed lockfile. `pnpm desktop:test` tests SQLite migrations/envelopes. `node tools/desktop/run.mjs rust-fmt` checks formatting. `node tools/desktop/generate-fixtures.mjs --check` verifies the bundled native catalog matches shared fixtures; omit `--check` to regenerate after deliberate fixture changes.

`pnpm desktop:build` builds frontend assets, checks gzip budgets, compiles release Rust, and produces a Windows NSIS installer. `pnpm desktop:package` additionally copies the executable and explicitly named development installer to `release/windows-x64` and records SHA-256 hashes/sizes. Intermediate outputs are `apps/desktop/src-tauri/target/release/Cortex Core.exe` and `target/release/bundle/nsis/Cortex Core_0.3.0_x64-setup.exe`. Generated build/release output is ignored by Git.

## Windows installation

Product name is Cortex Core, app version 0.3.0, identity `dev.cortexcore.desktop`; the window and Settings visibly identify a development build. NSIS installs per user, normally under `%LOCALAPPDATA%\Cortex Core`, permits a chosen directory, creates a Start menu entry in the Cortex Core folder and an uninstaller. The finish page offers a desktop shortcut; silent/passive installation creates one unless `/NS` is supplied. Shortcut application identity uses the bundle ID and original app icon.

These builds are **unsigned**. Publisher is an explicitly documented development placeholder. Before public distribution, replace development identity/publisher, configure a real Windows signing certificate, verify signatures and define release approval/retention policy. CI validates and uploads development artifacts; it does not publish releases.

The official WebView2 bootstrapper is embedded. If the runtime is absent, its initial installation needs internet. Once the runtime exists, fixture hardware and the essential procedural board work offline. Clean Windows 10/11 certification is still required.

## Packaged assets and native security

Development alone uses `http://127.0.0.1:5173`. Release uses Tauri's packaged asset protocol (`http://tauri.localhost` on Windows), **not an HTTP server listening on localhost**. The test runner injects an external CDP debugging environment variable; normal launches do not enable that endpoint.

The main-window capability permits only `load_catalog_snapshot`, `desktop_status`, `set_viewer_fullscreen`, `record_graphics_failure`, `open_documentation`, `load_development_build`, and `save_development_build`. AppManifest explicitly restricts app commands. No default broad capability, filesystem, SQL, process/shell, general opener or general window API is granted to the renderer. There are no remote capabilities or wildcard window scopes. Test checks prove an installed plugin's ungranted state-save command is denied.

Production CSP restricts scripts/assets to packaged origins, allows IPC and necessary inline styles/blob workers, and blocks arbitrary remote connections, framing and forms. Native navigation only allows the app origin; new windows are denied. Reviewed documentation keys open fixed HTTPS addresses through Rust in the default browser. Invalid keys cannot open arbitrary URLs.

## Persistence, offline data and diagnostics

Phase 2 stores one versioned build in a separate fixed app-local-data `development-build.sqlite3`. Rust validates structure/references and saves atomically; the shared build domain validates compatibility on restore. Invalid/newer builds are preserved with assembly disabled. Confirmed reset removes only installations. See [assembly architecture](../architecture/adr-0005-assembly-domain.md) and [assembly usage](assembly.md).

Tauri's OS directory APIs separate app-config/window state, app-local-data/catalog SQLite, app-cache/assets, app-cache/temp and app-log. No writes occur beside the executable. Windows resolves these under the user's Roaming/Local AppData areas. Window-state persistence saves size/position/maximize; a disconnected-monitor position is recentered. Native minimum size is 1000×680 logical pixels; default is 1440×960. Fullscreen is explicit and exits on Escape/route teardown; it is not restored at next launch.

SQLite holds schema version 1 and a catalog envelope independently versioned as catalog 2026.10.07.1 / asset manifest 1. Unsupported/corrupt caches are preserved and use bundled fixtures. The renderer validates full hardware schemas and also falls back to bundled fixtures if domain validation fails. Settings reports fallback status. Remote Supabase remains the authoritative future catalog; sync and downloadable asset caching are designed in ADR 0004 and are not enabled here.

Graphics initialization/context/import failures keep the diagram and inspector available. A bounded, once-per-launch local support log records only app version, platform, renderer and enumerated failure code. It omits device identifiers, arbitrary exception text and personal paths. Settings reports native display scale, window pixels, catalog/cache status and independent versions.

Future file operations will implement explicit native import/export commands with OS dialogs and bounded, validated `.cortexbuild` files containing versioned identifiers/configuration. Screenshot and diagnostic export will use similarly scoped save commands. No arbitrary path/file operation is exposed in this slice.

## Native automation

`pnpm test:desktop` launches the actual release executable, injects a test-only WebView2 CDP port and runs Playwright against its existing native webview. It does not launch a browser renderer instead of Tauri. Use `CORTEX_DESKTOP_EXE` to test an installed executable. `CORTEX_CDP_URL=http://127.0.0.1:9225` and `--development` attach to a deliberately instrumented development host. Reports/screenshots go in `.artifacts/desktop`.

The runner verifies packaged mode, SQLite fixtures, capability denial, 17 regions/inspector, camera rendered pixels, quality/explosion, native fullscreen, repeated scene teardown, offline navigation and real WebGL context-loss recovery. Runner cleanup terminates its owned child; graceful native-frame closing/persisted geometry require separate window testing. Browser Playwright projects remain shared-renderer coverage; they are not native OS-window coverage. Physical monitor/DPI and platform-specific installers need their own validation.

Application updates remain disabled. A future Tauri signed updater requires a pinned verification key, reviewed HTTPS release endpoint, signed artifacts and release notes. Application, catalog and asset updates have separate versions/trust policies. Windows ARM64, macOS and Linux can reuse this UI/native boundary, but their toolchain targets, installers and platform testing are not yet configured.
