# Unfinished Update-11 — do not build or run

Preserved locally before restoring application integration to Update-10 (`7e85677`). These source copies and `pre-isolation.patch` are ignored by this directory's `.gitignore`, so the unfinished live implementation cannot enter the safety isolation commit. The `.disabled` suffix excludes them from Rust module discovery, renderer imports, normal test discovery and tool execution. The patch preserves earlier tracked changes; individual copies also include previously untracked Monitoring work.

The old single-worker engine and Windows WMI/NVML backends are disconnected. No Cargo feature can restore them. The ignored real enumeration test is retained only as incident evidence, not as a test to rerun. Do not strip these suffixes or wire these files back into the app on the affected machine.

The replacement architecture is `apps/desktop/src-tauri/src/monitoring/isolated.rs`. Its development diagnostic registry contains no live adapters. All five providers remain off. See [the incident and future validation gates](../../docs/desktop/update-11-monitoring.md).
