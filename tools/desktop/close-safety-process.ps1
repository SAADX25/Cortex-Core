param([Parameter(Mandatory=$true)][int]$ProcessId)
$ErrorActionPreference = 'Stop'
$exitControlledProcess = Get-Process -Id $ProcessId
$exitExpectedPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/desktop/src-tauri/target/debug/Cortex Core.exe'))
if (-not [string]::Equals($exitControlledProcess.Path, $exitExpectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to close an unrelated process' }
if ($exitControlledProcess.MainWindowHandle -eq 0) { throw 'Cortex window unavailable for planned close' }
if (-not $exitControlledProcess.CloseMainWindow()) { throw 'Normal Cortex window close was rejected' }
'Normal close requested for the owned test window'
