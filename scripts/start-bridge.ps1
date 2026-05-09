Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig
Ensure-BridgeDirectories -Config $config
Assert-BridgeBuildPresent -Config $config
Assert-CommandAvailable -CommandName $config.NodeCommand

$existingProcess = Get-BridgeProcess -Config $config
if ($null -ne $existingProcess) {
    Set-BridgePid -Config $config -BridgeProcessId $existingProcess.Id
    Write-Output "Bridge is already running with PID $($existingProcess.Id)."
    exit 0
}

Remove-BridgePidFile -Config $config

$nodeExecutable = (Get-Command $config.NodeCommand -ErrorAction Stop).Source
$workingDirectory = $config.RepoRoot
$scriptPath = Join-Path $workingDirectory 'dist\index.js'

$arguments = @(
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-Command'
    "& { Set-Location -LiteralPath '$workingDirectory'; `$env:BRIDGE_SERVICE_BASE_DIR='$($config.ServiceBaseDir)'; `$env:BRIDGE_DATA_DIR='$($config.DataDir)'; `$env:BRIDGE_LOG_DIR='$($config.LogDir)'; `$env:BRIDGE_RUN_DIR='$($config.RunDir)'; & '$nodeExecutable' '$scriptPath' 1>> '$($config.StdoutLogFile)' 2>> '$($config.StderrLogFile)' }"
)

$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
$bridgeProcess = $null

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    $bridgeProcess = Get-BridgeProcessByPort -Config $config
    if ($null -ne $bridgeProcess) {
        break
    }
}

if ($null -ne $bridgeProcess) {
    Set-BridgePid -Config $config -BridgeProcessId $bridgeProcess.Id
    Write-Output "Bridge started with PID $($bridgeProcess.Id)."
} elseif (-not $process.HasExited) {
    Set-BridgePid -Config $config -BridgeProcessId $process.Id
    Write-Output "Bridge wrapper started with PID $($process.Id), but listener on port $($config.Port) was not detected yet. Check logs if health does not come up."
} else {
    Write-Output "Bridge process exited immediately. Check logs:"
    Write-Output "  stdout: $($config.StdoutLogFile)"
    Write-Output "  stderr: $($config.StderrLogFile)"
    exit 1
}
