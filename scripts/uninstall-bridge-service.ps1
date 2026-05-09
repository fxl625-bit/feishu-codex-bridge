Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig

if (Get-ScheduledTask -TaskName $config.TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $config.TaskName -Confirm:$false
    Write-Output "Scheduled Task '$($config.TaskName)' removed."
} else {
    Write-Output "Scheduled Task '$($config.TaskName)' is not installed."
}

if (Test-Path -LiteralPath $config.StartupScriptPath) {
    Remove-Item -LiteralPath $config.StartupScriptPath -Force
    Write-Output "Startup fallback removed from '$($config.StartupScriptPath)'."
}
