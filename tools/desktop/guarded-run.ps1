param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('web-check','rust-check','rust-test','desktop-build','browser-monitoring','packaged-monitoring','packaged-regression','safety-build','safety-startup','safety-regression','baseline-browser','exit-passive','exit-extended','exit-pipe')]
    [string]$Task,
    [switch]$Child
)
$ErrorActionPreference = 'Stop'
if ($Task -in @('packaged-monitoring','browser-monitoring')) {
    throw 'Live Monitoring is quarantined. Only hardware-free isolation tests may run.'
}
$cortexWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $cortexWorkspace
if ($Child) {
    $env:CARGO_BUILD_JOBS = '1'
    $env:RAYON_NUM_THREADS = '1'
    switch ($Task) {
        'web-check' { & pnpm check }
        'rust-check' { & pnpm desktop:check }
        'rust-test' { & pnpm desktop:test }
        'desktop-build' { & pnpm desktop:build }
        'safety-build' { & pnpm desktop:build:safety }
        'safety-startup' { & pnpm test:desktop:safety-startup }
        'safety-regression' { & pnpm test:desktop:safety-regression }
        'exit-passive' { & node tools/desktop/exit-investigation.mjs passive }
        'exit-extended' { & node tools/desktop/exit-investigation.mjs extended }
        'exit-pipe' { & node tools/desktop/exit-investigation.mjs passive --break-stderr }
        'baseline-browser' { & pnpm exec playwright test --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari --workers=1 }
        'browser-monitoring' { & pnpm exec playwright test tests/e2e/monitoring.spec.ts --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari }
        'packaged-monitoring' { & pnpm test:monitoring:desktop }
        'packaged-regression' { & pnpm test:desktop }
    }
    exit $LASTEXITCODE
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CortexValidationResources {
    [StructLayout(LayoutKind.Sequential)] public struct Memory {
        public uint length, load;
        public ulong totalPhysical, availablePhysical, totalPageFile, availablePageFile, totalVirtual, availableVirtual, availableExtendedVirtual;
    }
    [DllImport("kernel32.dll")] public static extern bool GlobalMemoryStatusEx(ref Memory m);
    [DllImport("kernel32.dll")] public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
    public static ulong FreeBytes() {
        Memory m = new Memory(); m.length = (uint)Marshal.SizeOf(typeof(Memory));
        if (!GlobalMemoryStatusEx(ref m)) throw new Exception("Memory guard unavailable");
        return m.availablePhysical;
    }
}
'@
$cortexGuardDirectory = Join-Path $cortexWorkspace '.artifacts/desktop-guard'
New-Item -ItemType Directory -Path $cortexGuardDirectory -Force | Out-Null
$cortexOutput = Join-Path $cortexGuardDirectory "$Task.stdout.log"
$cortexErrorOutput = Join-Path $cortexGuardDirectory "$Task.stderr.log"
$cortexReportPath = Join-Path $cortexGuardDirectory "$Task.resources.json"
$cortexBaseline = [CortexValidationResources]::FreeBytes()
if ($cortexBaseline -lt 4GB) { throw "Validation not started: less than 4 GiB free memory." }
$cortexGuardLock = [IO.File]::Open((Join-Path $cortexGuardDirectory 'active.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$cortexRunner = (Get-Command pwsh).Source
$cortexChild = Start-Process -FilePath $cortexRunner -ArgumentList @('-NoProfile','-NonInteractive','-File',('"' + $PSCommandPath + '"'),'-Task',$Task,'-Child') -WorkingDirectory $cortexWorkspace -WindowStyle Hidden -RedirectStandardOutput $cortexOutput -RedirectStandardError $cortexErrorOutput -PassThru
$cortexSamples = [Collections.Generic.List[object]]::new()
$cortexClock = [Diagnostics.Stopwatch]::StartNew()
$cortexReason = $null
$cortexHighCpuSince = $null
[long]$cortexPreviousIdle = 0; [long]$cortexPreviousKernel = 0; [long]$cortexPreviousUser = 0
[void][CortexValidationResources]::GetSystemTimes([ref]$cortexPreviousIdle,[ref]$cortexPreviousKernel,[ref]$cortexPreviousUser)
try {
    while (-not $cortexChild.HasExited) {
        Start-Sleep -Seconds 2
        $cortexFree = [CortexValidationResources]::FreeBytes()
        [long]$cortexIdle = 0; [long]$cortexKernel = 0; [long]$cortexUser = 0
        if (-not [CortexValidationResources]::GetSystemTimes([ref]$cortexIdle,[ref]$cortexKernel,[ref]$cortexUser)) { throw 'CPU guard unavailable' }
        $cortexDelta = ($cortexKernel - $cortexPreviousKernel) + ($cortexUser - $cortexPreviousUser)
        $cortexCpu = if ($cortexDelta -gt 0) { 100 * (1 - ($cortexIdle - $cortexPreviousIdle) / $cortexDelta) } else { 0 }
        $cortexPreviousIdle = $cortexIdle; $cortexPreviousKernel = $cortexKernel; $cortexPreviousUser = $cortexUser
        $cortexSamples.Add([pscustomobject]@{elapsedSeconds=[math]::Round($cortexClock.Elapsed.TotalSeconds,1);freeGiB=[math]::Round($cortexFree/1GB,2);systemCpuPercent=[math]::Round($cortexCpu,1)})
        # Preserve partial resource evidence if the host is interrupted again.
        if ($cortexSamples.Count % 5 -eq 0) {
            @{task=$Task;baselineFreeGiB=[math]::Round($cortexBaseline/1GB,2);completed=$false;samples=$cortexSamples.ToArray()} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $cortexGuardDirectory "$Task.resources.progress.json")
        }
        if ($cortexFree -lt 3GB) { $cortexReason = 'Stopped: free physical memory fell below 3 GiB'; break }
        if ($cortexCpu -gt 95) {
            if ($null -eq $cortexHighCpuSince) { $cortexHighCpuSince = $cortexClock.Elapsed.TotalSeconds }
            if ($cortexClock.Elapsed.TotalSeconds - $cortexHighCpuSince -ge 16) { $cortexReason = 'Stopped: system CPU remained above 95 percent'; break }
        } else { $cortexHighCpuSince = $null }
        if ($cortexClock.Elapsed.TotalMinutes -gt 25) { $cortexReason = 'Stopped: validation exceeded 25 minutes'; break }
        $cortexChild.Refresh()
    }
} catch { $cortexReason = 'Stopped: resource guard failed'; throw }
finally {
    $cortexChild.Refresh()
    if (-not $cortexChild.HasExited) {
        # Terminate only this known validation process tree, never unrelated apps.
        & taskkill.exe /PID $cortexChild.Id /T /F | Out-Null
        $cortexChild.WaitForExit(5000) | Out-Null
    }
    @{task=$Task;baselineFreeGiB=[math]::Round($cortexBaseline/1GB,2);stopReason=$cortexReason;samples=$cortexSamples.ToArray()} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $cortexReportPath
    $cortexGuardLock.Dispose()
}
Get-Content -LiteralPath $cortexOutput -Tail 35
Get-Content -LiteralPath $cortexErrorOutput -Tail 25
Write-Output "Resource report: $cortexReportPath"
if ($cortexReason) { Write-Error $cortexReason; exit 2 }
$cortexChild.WaitForExit()
exit $cortexChild.ExitCode
