Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig

try {
    & (Join-Path $PSScriptRoot 'stop-bridge.ps1')
} catch {
    throw
}
