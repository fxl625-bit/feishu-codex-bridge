param(
    [ValidateSet('stdout', 'stderr')]
    [string]$LogStream = 'stdout',
    [int]$Tail = 40,
    [switch]$Follow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig
$logFile = if ($LogStream -eq 'stderr') { $config.StderrLogFile } else { $config.StdoutLogFile }

if (-not (Test-Path -LiteralPath $logFile)) {
    Write-Output "Log file not found yet: $logFile"
    exit 0
}

$content = Get-Content -LiteralPath $logFile -Tail $Tail
if ($content) {
    $content
}

if ($Follow) {
    Get-Content -LiteralPath $logFile -Wait -Tail 0
}
