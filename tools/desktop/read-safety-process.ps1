param([Parameter(Mandatory=$true)][int]$ProcessId, [int]$CdpPort = 0)
$ErrorActionPreference = 'Stop'
# Passive process metadata only: no WMI, NVML, disk/sensor queries or settings changes.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CortexThreadNames {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenThread(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll")] static extern int GetThreadDescription(IntPtr thread, out IntPtr text);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr handle);
    public static string Read(uint id) {
        IntPtr thread = OpenThread(0x0800, false, id);
        if (thread == IntPtr.Zero) throw new Exception("Thread metadata access denied");
        IntPtr text = IntPtr.Zero;
        try {
            int result = GetThreadDescription(thread, out text);
            if (result < 0) throw new Exception("Thread description unavailable");
            return Marshal.PtrToStringUni(text) ?? "";
        } finally {
            if (text != IntPtr.Zero) LocalFree(text);
            CloseHandle(thread);
        }
    }
}
'@
$safetyProcess = Get-Process -Id $ProcessId
$safetyThreads = @($safetyProcess.Threads | ForEach-Object {
    try { [pscustomobject]@{id=$_.Id;description=[CortexThreadNames]::Read($_.Id);error=$null} }
    catch { [pscustomobject]@{id=$_.Id;description=$null;error=$_.Exception.Message} }
})
$safetyListeners = @()
$safetyLoopbackClients = @()
if ($CdpPort -gt 0) {
    $safetyListeners = @(Get-NetTCPConnection -LocalPort $CdpPort -State Listen -ErrorAction Stop | Select-Object LocalAddress,LocalPort,OwningProcess)
    $safetyLoopbackClients = @(Get-NetTCPConnection -RemotePort $CdpPort -ErrorAction SilentlyContinue |
        Where-Object { $_.RemoteAddress -in @('127.0.0.1','::1') } |
        Select-Object LocalAddress,LocalPort,RemotePort,State,OwningProcess,@{Name='ProcessName';Expression={ (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }})
}
[ordered]@{
    processId=$safetyProcess.Id
    executable=$safetyProcess.Path
    collectedAt=(Get-Date).ToString('o')
    totalProcessHandles=$safetyProcess.HandleCount
    totalProcessThreads=$safetyProcess.Threads.Count
    privateBytes=$safetyProcess.PrivateMemorySize64
    mainWindowHandle=$safetyProcess.MainWindowHandle.ToInt64()
    responding=$safetyProcess.Responding
    debuggerListeners=$safetyListeners
    debuggerLoopbackClients=$safetyLoopbackClients
    threads=$safetyThreads
    modules=@($safetyProcess.Modules | Select-Object ModuleName,FileName)
} | ConvertTo-Json -Depth 5
