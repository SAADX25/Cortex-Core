# ADR 0003 — Desktop-first distribution

Status: accepted · 2026-10-07

Cortex Core ships as a Tauri 2 Windows application. React, R3F and all domain packages are preserved. `packages/application-ui` owns the single shared application UI; `apps/web` is a development/browser-test harness, and `apps/desktop` is the shipping native target. Production embeds the Vite output with `frontendDist`; only development uses `devUrl`.

Pin current stable Tauri 2.12.1 (Rust and CLI/API), tauri-build 2.7.1, window-state 2.5.0 and Rust 1.99.0. Use native decorations, a minimum/default logical window size and OS taskbar identity. Window state restores size/position/maximized status, with off-screen coordinates checked against connected monitors. Fullscreen is a narrowly scoped native command, independently of browser fullscreen APIs.

No filesystem or shell plugin is exposed. The main local window has an explicit command allowlist, no remote capability origins and a restrictive production CSP. Rust owns application directories, SQLite cache and diagnostic files. External documentation is addressed by known keys and opens in the default browser; privileged remote navigation is rejected. Native import/export features will use dialogs and schema-validated formats, not renderer-provided paths.

The installer is per-user NSIS, contains core templates only, creates a Start menu entry and provides an uninstaller. Desktop shortcuts are optional installer choices. Publisher identity is a development placeholder; no signing certificate or updater endpoint is configured. An unsigned development build must not be published as a trusted release. App, catalog and manifest versions are independent.

This host supports Windows 10/11 x64 first. Tauri's platform APIs and portable Rust/domain contracts preserve a future path to Windows ARM64, macOS and Linux. Those targets are not claimed built or tested until their CI/toolchains exist. Browser tests remain renderer evidence, separate from actual native-window/packaged-app evidence.
