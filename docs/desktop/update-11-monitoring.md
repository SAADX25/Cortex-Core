# Update 11 — Monitoring quarantined; Update-10 runtime restored

**Safety status, 9 October 2026:** the user reported three full-system freezes during Monitoring development, each requiring forced power-off. All live sensor testing on this machine has stopped. A Windows development executable has now been built with Monitoring completely absent. The normal desktop smoke and 17 native regression tests passed, but an idle startup observation ended unexpectedly after about 92 seconds; the user confirmed the app exited on its own. Stability remains unconfirmed, so the safety isolation is not committed. No installer or release build was created. Neither the freeze issue nor the unexpected exit is called fixed.

## Ordinary application behavior

Application integration is restored byte-for-byte to Update-10 (7e85677): src/lib.rs, build.rs, main capability permissions, App.tsx, icons, the existing hardware navigation test and packaged baseline smoke script. The normal application has My PC, 3D View and Settings only. Its existing specification scan/cache and viewer behavior are unchanged.

The host has no Monitoring module, command, managed engine, worker, renderer import, event subscription or startup provider factory. Startup does not load sensor libraries, enumerate temperatures, initialize GPU thermal APIs or query disk/CPU/motherboard/memory temperatures. The old experimental-live-sensors feature is removed. No ordinary feature flag can restore the quarantined backend.

Unfinished UI, schema/store, engine, Windows providers, tests and earlier integration changes are preserved under [quarantine/update-11](../../quarantine/update-11/README.md), with .disabled suffixes and a pre-isolation patch. These files are outside active build/test/import paths. Their earlier historical report is preserved there too. The former direct disk-temperature IOCTL implementation had already been removed before this isolation step; the archived backend must still not be restored or executed.

The existing release executable was not rebuilt, modified or launched during this safety work. The separate debug executable and ordinary regression results are recorded below; extended stability has not passed. No Windows drivers, driver settings, ACLs, ownership, BIOS settings or sensor services were installed or changed.

## Evidence for the current incident

The user reports hard freezes, not an ordinary application exception, and forced shutdowns. These records belong to **9 October 2026, Asia/Amman (UTC+03:00)**. They are reboot/log timestamps; the exact moment of each freeze is not independently known.

| Reboot Event 41 time | Event 6008 recorded | Event 6008 reports previous shutdown at |
| -------------------- | ------------------- | --------------------------------------- |
| 00:46:02.307         | 00:46:20.940        | 00:21:46                                |
| 00:53:21.097         | 00:53:39.180        | 00:46:20                                |
| 01:08:05.843         | 01:08:24.079        | 00:53:39                                |

All three Event 41 records contain BugcheckCode = 0. Event 41 establishes an unexpected restart, **not the root cause**. The zero codes do not disprove the user's forced-power-off account. See [Microsoft's Event 41 guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart).

Passive inspection covered System and Application events between 00:00 and 01:15 local time: 419 System events and 154 Application events. No matching WHEA-Logger, Display/nvlddmkm, Disk/stornvme/storahci/storport, BugCheck/WER-SystemErrorReporting or volmgr failure was found in that window. No Application Error, Application Hang or Windows Error Reporting entry was found there either. Absence of a logged fault does not prove that a driver or component is healthy.

Post-boot Service Control Manager failures were recorded: Intel TPM Provisioning Service timeout, PlanetVPNService missing file and cphs unspecified failure. These also appeared on older ordinary boots; they do not identify the freeze cause. The earlier rustc WER report is outside this selected incident window and does not establish memory exhaustion at the third freeze.

The final native log ends at monitoring::windows_providers::tests::real_windows_start_read_release_cycles after the compiler finished and 22 tests passed. That test initialized the legacy WMI/NVML provider set and sampled categories sequentially, including the then-present disk temperature query. No per-provider completion trace was recorded before the hang; the log cannot identify which provider or driver blocked. It does not prove a CPU-temperature fault. The implementation did not install a kernel driver or implement direct CPU MSR access.

After explicit user authorization, Windows UAC elevation succeeded for a narrow read-only dump inventory: elevated = true, no collection errors. It found no current MEMORY.DMP, Minidump file or LiveKernelReports dump for the October incident. The only kernel dump was ResourceTimeout-20260715-0249.dmp, last modified **15 July 2026**, approximately 2.39 GB. It was not copied, analyzed or used as proof of the current cause.

Local evidence files, with no telemetry:

- .artifacts/incident-admin/report.json: elevated dump inventory and existing event records.
- .artifacts/incident-admin/current-incident-events.json: October incident events including Event 41 fields, successfully recollected outside the sandbox after an initial sandbox-denied query.
- .artifacts/incident-admin/third-freeze-native-log/rust-test.stdout.log and .stderr.log: preserved final native-test output from the freeze, before the normal Update-10 suite reused the guard's log names.

The initial resource-pressure hypothesis is unconfirmed. The third interruption at live enumeration makes that path a stronger suspect, without establishing a particular provider/driver cause. No completed resource report exists for that interrupted run. The resource guard cannot recover a system-wide kernel hang.

## Replacement isolation architecture

The standalone module apps/desktop/src-tauri/src/monitoring/isolated.rs contains no hardware imports or adapters and is not included by the Update-10 application library. The separate monitoring-diagnostic binary requires the non-default monitoring-diagnostics Cargo feature and rejects ordinary release compilation. It is a development diagnostic CLI, not a product route.

With no arguments it shows all five providers off. The --provider argument accepts exactly one known category; unknown categories, executable paths and multiple selections are rejected. **The current registry contains no live adapter for any category. Selection reports unavailable and starts nothing.**

Each category owns an independent Provider with start(), sample(), stop() and health():

| Provider    | Current state                   | Future candidate after independent review                                                    |
| ----------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| GPU         | Disabled; no adapter registered | One documented read-only vendor API in a GPU-only helper; no LHM/WMI fallback                |
| Storage     | Disabled; no adapter registered | One documented Windows source in a storage-only helper; no SMART/NVMe/IOCTL probing fallback |
| CPU         | Disabled; no adapter registered | Only a documented vetted source; otherwise Not reported by hardware                          |
| Motherboard | Disabled; no adapter registered | No Super-I/O, EC, MSR or undocumented register probing; otherwise Not reported by hardware   |
| Memory      | Disabled; no adapter registered | No low-level DIMM probing; otherwise Not reported by hardware                                |

No provider constructs another or shares a sensor-library instance. The prior combined factory is quarantined. Future approved hardware access must run inside that category's fixed, reviewed helper executable. The CLI accepts no user-supplied executable, shell command or unreviewed DLL.

Implemented boundaries:

- Nonblocking dispatch and completion polling. Hardware and pipe I/O cannot execute inside controller calls or a Tauri UI callback.
- One in-flight lifecycle request per provider, with one-entry command/result queues. Replies have bounded allocation (64 KiB payload), request-ID checks and terminal rejection of malformed/stale data. Transport payloads are internal bytes, not displayable sensor records. Typed schema/category validation must be restored before any approved live adapter can publish them.
- Separate monotonic deadlines: start 2000 ms, sample 500 ms, stop 250 ms. Deadline checks precede completion processing; late success is discarded. Future host integration requires its own nonblocking timer to tick the controller. This is not a real-time OS guarantee.
- Timeout clears that provider's data, opens its session circuit, signals cancellation and prevents retries. Three explicit sample failures also open the circuit. Invalid payloads, crashes and initialization failures are terminal.
- At most one IPC actor and one cancellation/reaping worker per provider lifetime, created lazily for explicit approved starts. Process creation, pipe reads, kill and wait run off the caller thread. Cancellation and Drop never join a worker on the UI thread.
- If termination or IPC cleanup cannot finish, the worker slot remains leased; replacements cannot accumulate. Development selection refuses switching until prior work is reaped, enforcing one provider at a time after a timeout as well.
- Sampling starts only after successful initialization. Subsequent reads are spaced at least 1000 ms after completion with no overlap. Disable clears samples and cancels a pending read; stop requests also reap their helper.

Process isolation protects application control flow from a hung user-mode provider. **It cannot guarantee prevention or recovery of a kernel/driver/hardware freeze affecting the whole PC.** All real adapters therefore remain absent. No live test is authorized on this primary machine.

## Initial mock-only isolation verification

The command pnpm test:monitoring:safe compiles only the small std-only controller, diagnostic CLI and a test-only IPC stub directly with rustc. It does not invoke Cargo, compile Tauri/WMI, launch Cortex Core or access hardware. Checks run serially with per-process time limits. The stub parks its own process during SAMPLE; the controller times out and reaps that stub, not a sensor or driver.

- Seven restored integration files match Update-10 bytes. Default Cargo features still include only custom-protocol; the extra binary is gated and the ordinary app remains the default binary.
- Thirteen mock-only Rust tests passed: dormant registry, start/read/stop and cancellation deadlines, no overlapping reads, late/malformed/oversized replies, independent provider progress, one-at-a-time selection, unreaped worker bound, cancellation, three-failure circuit breaker, one-second scheduling, and timeout/crash/oversized-reply/normal-stop handling with hardware-free stub processes.
- CLI checks confirm all categories stay off/unavailable, multiple/unknown selections are rejected, and an ordinary release compile is rejected.
- The old live packaged smoke entry point now fails immediately before imports/process creation. The guarded runner rejects both old Monitoring validation tasks. The old real enumeration test is outside active discovery, not merely ignored.

No full native suite, browser graphics suite, desktop build, packaged smoke, provider enumeration or extended application stability test was run in that initial mock-only phase. The subsequently authorized development build and normal regression checks are recorded below. Historical green tests do not certify a live provider's safety.

## Safety-only Windows development build and runtime evidence

Command: `pnpm desktop:build:safety`, invoking Tauri `build --debug --no-bundle`, under the sequential resource guard. Output: `apps/desktop/src-tauri/target/debug/Cortex Core.exe`, 17,382,912 bytes, SHA-256 `ca8b225272dc188ebde4cb5bf45c90bb824260d48a501ba068dbca8e3072d2ee`. The executable embeds the ordinary Update-10 assets. The desktop status field `packaged=true` means embedded assets; it does not turn this debug compilation into a release or installer.

The first link failed with LNK1285 against an existing corrupt `cortex_core_desktop.pdb`, last modified near the third freeze. That generated file and failed-build logs were preserved in `.artifacts/desktop-safety/corrupt-pdb-attempt-1/`. Rebuilding after moving only that generated PDB succeeded. This repairs a build artifact, not the Monitoring or system-freeze issue.

Exactly **no Monitoring code is loaded by the ordinary application**: neither the old engine/Windows providers nor the replacement `monitoring/isolated.rs`/diagnostic CLI is included. The source integration remains identical to Update-10; the fresh Cargo dependency file contains no Monitoring source; Monitoring command/event/worker/native-temperature markers are absent from the executable. Both `monitoring_snapshot` and `set_monitoring_active` IPC calls were rejected as unregistered. The latter check passed `active=false` and never tried to enable a provider.

Passive process metadata at startup and during the first minute found no Monitoring IPC/reaper threads and no NVML, LibreHardwareMonitor, OpenHardwareMonitor, WinRing0 or inpout modules. All thread metadata reads completed without errors. Monitoring-owned counts are **threads=0, providers=0, handles=0** because no Monitoring code or provider is compiled or instantiated; this is not a claim that the application has zero ordinary Windows/WebView handles or threads. The replacement controller, empty provider registry and disabled archived sources remain on disk only. The Update-10 one-shot specification scan/cache still runs; it does not query temperatures or initialize sensor providers.

Normal regression results:

- TypeScript, ESLint, 161 web unit tests and renderer build/budget checks passed.
- All 17 default native tests passed, including the existing specification scan structure/privacy check. No Monitoring tests or providers were discovered by this Cargo run.
- The unchanged Update-10 desktop smoke passed all 18 checks using this exact executable: local/offline hardware behavior, clipboard/privacy, 3D inspection, motion/resource cycles, profiles, fullscreen, teardown and graphics fallback. Its resource guard completed without termination; minimum free memory 4.08 GiB, maximum sampled system CPU 41.6%, duration about 82 seconds.
- Browser regressions scheduled 60 checks across Chromium, WebKit, mobile Chrome and mobile Safari with one worker. Twelve Chromium checks passed; the remaining checks did not complete because the guard stopped the test tree after system CPU stayed above 95% for 16 seconds. Minimum sampled free memory was 3.90 GiB, maximum sampled system CPU 99.5%, elapsed time 160.4 seconds. No retry was made. Firefox was not run in this attempt. The full browser suite is **incomplete**, not green.
- The safety scripts passed ESLint, formatting, PowerShell parsing and `git diff --check`. A final static artifact check reconfirms the binary's hash and absence of Monitoring without launching the app. These checks do not establish runtime stability.

The five-minute idle observation **did not pass**. The first attempt's fixed My PC heading assumption failed when the route changed to 3D View; the observer now tolerates all three baseline routes. A second attempt exposed a page-discovery race, corrected with the normal smoke's bounded readiness wait. In the third attempt, startup checks and samples at approximately 0, 30 and 61 seconds passed, then the host was found exited at 92.498 seconds. The user confirmed it exited on its own. The guard did not terminate it, and a read-only event-log check found no matching application crash/hang or system hardware-fault event. Those absences do not explain the exit. The observer did not originally retain its exit code, so no code is invented; future observations now retain bounded stdout/stderr, the child exit code/signal and page/disconnection/navigation events. This instrumentation was checked statically and was not used to launch another desktop session.

Failure evidence is preserved in `.artifacts/desktop-safety/startup-attempt-1/`, `startup-attempt-2/` and `startup-attempt-3/`; normal smoke results are in `.artifacts/desktop/hardware-smoke.json`, and the final summary is `.artifacts/desktop-safety/validation.json`. No successful five-minute startup report exists. No further desktop startup retry was made after the normal smoke, and runtime testing stopped when the browser resource guard triggered. The current stability gate remains failed, so the conditional safety-isolation commit was not made. All unfinished live implementation remains local and excluded by `quarantine/update-11/.gitignore`.

## Future validation gates — not authorization to run them now

1. Keep Update-10 integration and confirm ordinary startup plus extended stability with Monitoring absent. Record duration and behavior; source equivalence alone is not a runtime stability claim.
2. Independently review a replacement GPU-only helper using documented APIs. Validate first on a separate test machine, with explicit approval, helper lifecycle evidence and sensor schema validation. The old combined factory and July dump cannot justify enabling it.
3. On a later explicitly authorized diagnostic machine/session, enable GPU alone, record lifecycle/deadline results, then fully stop and reap it before another category. Every other provider stays off.
4. Review Storage separately and apply the same gates before enabling it alone. Do not add SMART/NVMe/direct disk probing as a missing-value fallback.
5. Memory, CPU and motherboard remain unavailable without an independently vetted documented path. Low-level CPU/motherboard access is outside this redesign and must come last if ever separately authorized.
6. Any system-level freeze ends testing immediately. Blacklist that implementation on the affected hardware and remove its registry entry until replaced. Application timeouts are not permission to reproduce a kernel hang.

The immediate deliverable is dormant application integration and independently controlled, mock-tested provider infrastructure. Temperature monitoring and a claim of repaired system stability are deferred.
