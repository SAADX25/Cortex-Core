# Safe Mode for the affected development PC

Safe Mode is a separate build, selected with `--no-default-features --features custom-protocol,safe-mode`. The native policy is immutable for the lifetime of that executable. There is no setting, environment flag, renderer override or consent action that enables discovery or temperatures in this build.

Build without launching or installing:

```powershell
pnpm desktop:build:safe-mode
```

The command builds a debug executable without a bundle in `.artifacts/safe-mode-build/debug/`. It never starts Cortex Core. The older `desktop:build:safety` command is an earlier build workflow and does **not** select this Safe Mode. Ordinary builds still support specification discovery; use only the explicitly verified Safe Mode executable on the affected PC.

Safe Mode excludes Cortex's `hardware.rs` and `external_sensors.rs` implementations. Their replacements contain no WMI queries, DXGI adapter discovery, HTTP requests or listener inventory. WMI is an optional dependency omitted by the Safe Mode build command. Cached hardware restoration, explicit discovery, external sensor sessions, consent and reads are refused before workers or hardware cache access. Revocation is an inert operation. Quarantined providers remain absent from the application module tree.

React obtains the versioned native policy with `get_runtime_policy` before any discovery or sensor IPC. Missing, invalid or failed policy responses keep access disabled. Startup, manual rescans and sensor bridges all enforce the policy. The UI displays Safe Mode, disabled controls and unavailable data; it does not restore hardware cache or substitute mock hardware.

Safe Mode still uses the ordinary Windows window manager and WebView2 renderer. This isolation concerns Cortex's hardware discovery and temperature paths; it does not remove all operating-system graphics activity or prove that the unexplained freezes cannot recur.

Hardware-free verification commands, run sequentially:

```powershell
node tools/desktop/verify-safe-mode.mjs
pnpm typecheck
pnpm exec vitest run --maxWorkers=1 --no-file-parallelism tests/unit/safe-mode.test.ts tests/unit/hardware.test.ts tests/unit/external-sensors.test.ts
pnpm lint
```

Native tests must explicitly select Safe Mode, use `--lib`, and run with `--test-threads=1`. **Do not run the ordinary Windows native test suite on this PC:** it contains a real discovery test. The Safe Mode module gates exclude that test along with its implementation.

The pre-launch evidence and executable hash are retained in `.artifacts/test-2-preflight/`. Application launch requires the user's separate approval. The proposed Test 2 observation is one Safe Mode instance for 180 seconds, with lifecycle tracing, process metadata sampling and relevant Windows event records. No navigation, 3D interaction, sensor connection or discovery is part of that observation. End the observation on an unexpected exit, unresponsive process, lifecycle failure or relevant Windows instability. Record whether shutdown was observer-requested and preserve the actual exit code.

Test 2 remains incomplete until the separately approved real observation has run and been reported. Test 3 requires another approval. Thermal validation belongs exclusively on a separately validated machine while the affected PC's freeze cause remains unresolved. Safe Mode isolation tests do not establish production readiness or freeze prevention.
