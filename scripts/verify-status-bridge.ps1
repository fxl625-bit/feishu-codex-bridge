Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig
$healthOk = Test-BridgeHealth -Config $config
if (-not $healthOk) {
    throw "Bridge health endpoint is not healthy at $($config.HealthUrl)."
}

$portProcess = Get-BridgeProcessByPort -Config $config
if ($null -eq $portProcess) {
    throw "No bridge listener detected on port $($config.Port)."
}

$commandLine = Get-BridgeProcessCommandLine -ProcessId $portProcess.Id
$exactBuildMarkerMatched = $false
if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
    $exactBuildMarkerMatched = $commandLine.IndexOf($config.BuildMarker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

$resolvedProcess = Get-BridgeProcess -Config $config
if ($null -eq $resolvedProcess) {
    throw 'Get-BridgeProcess did not resolve the healthy bridge listener.'
}

[pscustomobject]@{
    HealthOk = $healthOk
    PortPid = $portProcess.Id
    ResolvedPid = $resolvedProcess.Id
    ExactBuildMarkerMatched = $exactBuildMarkerMatched
    CommandLine = $commandLine
    BuildMarker = $config.BuildMarker
} | Format-List
