param(
    [switch]$Rebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig
Ensure-BridgeDirectories -Config $config

Assert-CommandAvailable -CommandName $config.NpmCommand

if ($Rebuild -or -not (Test-Path -LiteralPath $config.BuildMarker)) {
    Push-Location $config.RepoRoot
    try {
        & $config.NpmCommand run build
    } finally {
        Pop-Location
    }
}

Assert-BridgeBuildPresent -Config $config

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$($config.StartScript)`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$description = "Starts the Feishu Codex bridge from $($config.RepoRoot). Logs: $($config.LogDir)"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

try {
    Register-ScheduledTask -TaskName $config.TaskName -Action $action -Trigger $trigger -Settings $settings -Description $description -Principal $principal -Force | Out-Null
    Write-Output "Scheduled Task '$($config.TaskName)' installed."
} catch {
    $startupScript = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$($config.StartScript)`"`r`n"
    Set-Content -LiteralPath $config.StartupScriptPath -Value $startupScript -Encoding ASCII
    $reason = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($reason)) {
        $reason = 'unknown error'
    }

    Write-Warning "Scheduled Task install failed ($reason); installed Startup fallback instead at $($config.StartupScriptPath)"
}

Write-Output "Start it now with: powershell -ExecutionPolicy Bypass -File scripts/start-bridge.ps1"
Write-Output "Logs:"
Write-Output "  stdout: $($config.StdoutLogFile)"
Write-Output "  stderr: $($config.StderrLogFile)"
Write-Output "Health: $($config.HealthUrl)"
