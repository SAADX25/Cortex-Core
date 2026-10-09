param(
    [Parameter(Mandatory=$true)][string]$StartUtc,
    [Parameter(Mandatory=$true)][string]$EndUtc,
    [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
# Read existing Windows logs only; never enable auditing, services, diagnostics or a provider.
$exitEventStart = [DateTimeOffset]::Parse($StartUtc).LocalDateTime.AddMinutes(-1)
$exitEventEnd = [DateTimeOffset]::Parse($EndUtc).LocalDateTime.AddMinutes(1)
$exitEventReport = [ordered]@{startUtc=$StartUtc;endUtc=$EndUtc;collectedAt=(Get-Date).ToUniversalTime().ToString('o');logs=@();events=@();errors=@()}
foreach ($exitEventLog in @('Application','System')) {
    try {
        $exitEventRows = @(Get-WinEvent -FilterHashtable @{LogName=$exitEventLog;StartTime=$exitEventStart;EndTime=$exitEventEnd} -ErrorAction Stop)
        $exitEventReport.logs += [pscustomobject]@{name=$exitEventLog;status='read';totalEventsInWindow=$exitEventRows.Count}
        $exitEventReport.events += @($exitEventRows | Where-Object {
            if ($exitEventLog -eq 'Application') {
                $_.ProviderName -in @('Application Error','Application Hang','Windows Error Reporting') -and $_.Message -match '(?i)cortex|msedgewebview2'
            } else {
                $_.ProviderName -match '(?i)WHEA|Display|nvlddmkm|stornvme|storahci|volmgr|WER-SystemErrorReporting' -or ($_.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $_.Id -eq 41)
            }
        } | Select-Object -First 100 @{Name='timeUtc';Expression={$_.TimeCreated.ToUniversalTime().ToString('o')}},Id,ProviderName,RecordId,Message)
    } catch {
        if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') {
            $exitEventReport.logs += [pscustomobject]@{name=$exitEventLog;status='read';totalEventsInWindow=0}
        } else {
            $exitEventReport.logs += [pscustomobject]@{name=$exitEventLog;status='unavailable'}
            $exitEventReport.errors += [pscustomobject]@{log=$exitEventLog;error=$_.Exception.Message}
        }
    }
}
$exitEventRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.artifacts/desktop-exit')) + [IO.Path]::DirectorySeparatorChar
$exitEventTarget = [IO.Path]::GetFullPath($OutputPath)
if (-not $exitEventTarget.StartsWith($exitEventRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Exit evidence must stay within the workspace evidence directory' }
$exitEventReport | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $exitEventTarget -Encoding utf8
Write-Output "Event correlation preserved: $exitEventTarget"
