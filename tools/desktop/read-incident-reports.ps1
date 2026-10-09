param()
$ErrorActionPreference = 'Stop'
$incidentOutputDirectory = 'G:\Cortex Core\.artifacts\incident-admin'
New-Item -ItemType Directory -Path $incidentOutputDirectory -Force | Out-Null
$incidentReport = [ordered]@{
    collectedAt = (Get-Date).ToString('o')
    elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    dumpFiles = @()
    errors = @()
    events = @()
}
foreach ($incidentDumpDirectory in @('C:\Windows\LiveKernelReports', 'C:\Windows\Minidump')) {
    try {
        $incidentReport.dumpFiles += @(Get-ChildItem -LiteralPath $incidentDumpDirectory -Filter '*.dmp' -File -Recurse -ErrorAction Stop | Select-Object FullName, Length, @{Name='modifiedAt';Expression={$_.LastWriteTime.ToString('o')}})
    } catch {
        $incidentReport.errors += [ordered]@{path=$incidentDumpDirectory; error=$_.Exception.Message}
    }
}
try {
    if (Test-Path -LiteralPath 'C:\Windows\MEMORY.DMP') {
        $incidentReport.dumpFiles += Get-Item -LiteralPath 'C:\Windows\MEMORY.DMP' | Select-Object FullName, Length, @{Name='modifiedAt';Expression={$_.LastWriteTime.ToString('o')}}
    }
} catch {
    $incidentReport.errors += [ordered]@{path='C:\Windows\MEMORY.DMP'; error=$_.Exception.Message}
}
try {
    $incidentStartTime = (Get-Date).AddDays(-2)
    $incidentReport.events = @(Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=$incidentStartTime; Id=@(41,6008,1001,46,161,17,18,19,20,129,153)} -ErrorAction Stop | Select-Object -First 100 @{Name='time';Expression={$_.TimeCreated.ToString('o')}}, Id, ProviderName, Message)
} catch {
    $incidentReport.errors += [ordered]@{path='System event log'; error=$_.Exception.Message}
}
$incidentReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $incidentOutputDirectory 'report.json') -Encoding UTF8
