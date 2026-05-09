Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig
$process = Get-BridgeProcess -Config $config

if ($null -eq $process) {
    Remove-BridgePidFile -Config $config
    Write-Output 'Bridge is not running.'
    exit 0
}

Stop-Process -Id $process.Id -Force
try {
    Wait-Process -Id $process.Id -Timeout 10 -ErrorAction Stop
} catch {
}

$residualProcess = Get-BridgeProcessByPort -Config $config
if ($null -ne $residualProcess -and $residualProcess.Id -ne $process.Id) {
    Stop-Process -Id $residualProcess.Id -Force
    try {
        Wait-Process -Id $residualProcess.Id -Timeout 10 -ErrorAction Stop
    } catch {
    }
}

Remove-BridgePidFile -Config $config
Write-Output "Bridge stopped (PID $($process.Id))."
