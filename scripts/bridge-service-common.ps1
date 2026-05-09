Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BridgeRepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-BridgeTaskName {
    return 'FeishuCodexBridge'
}

function Get-BridgeStartupScriptPath {
    $appData = [Environment]::GetFolderPath('ApplicationData')
    return Join-Path $appData 'Microsoft\Windows\Start Menu\Programs\Startup\FeishuCodexBridge.cmd'
}

function Read-BridgeEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [hashtable]$Values
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($line.TrimStart().StartsWith('#')) {
            continue
        }

        $parts = $line -split '=', 2
        if ($parts.Count -ne 2) {
            continue
        }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $Values[$key] = $value
    }
}

function Get-BridgeServiceConfig {
    $repoRoot = Get-BridgeRepoRoot
    $envValues = @{}
    Read-BridgeEnvFile -Path (Join-Path $repoRoot '.env') -Values $envValues
    Read-BridgeEnvFile -Path (Join-Path $repoRoot '.env.local') -Values $envValues

    foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
        if (-not [string]::IsNullOrWhiteSpace($entry.Value)) {
            $envValues[[string]$entry.Key] = [string]$entry.Value
        }
    }

    $localAppData = $envValues['LOCALAPPDATA']

    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'LOCALAPPDATA is not set. The bridge service scripts require a normal Windows user profile.'
    }

    $serviceBaseDir = $envValues['BRIDGE_SERVICE_BASE_DIR']
    if ([string]::IsNullOrWhiteSpace($serviceBaseDir)) {
        $serviceBaseDir = Join-Path $localAppData 'feishu-codex-bridge'
    }

    $dataDir = $envValues['BRIDGE_DATA_DIR']
    if ([string]::IsNullOrWhiteSpace($dataDir)) {
        $dataDir = Join-Path $serviceBaseDir 'data'
    }

    $logDir = $envValues['BRIDGE_LOG_DIR']
    if ([string]::IsNullOrWhiteSpace($logDir)) {
        $logDir = Join-Path $serviceBaseDir 'logs'
    }

    $runDir = $envValues['BRIDGE_RUN_DIR']
    if ([string]::IsNullOrWhiteSpace($runDir)) {
        $runDir = Join-Path $serviceBaseDir 'run'
    }

    $nodeCommand = 'node'
    $nodeCommandOverride = $envValues['BRIDGE_NODE_COMMAND']
    if (-not [string]::IsNullOrWhiteSpace($nodeCommandOverride)) {
        $nodeCommand = $nodeCommandOverride
    }

    $npmCommand = 'npm.cmd'
    $npmCommandOverride = $envValues['BRIDGE_NPM_COMMAND']
    if (-not [string]::IsNullOrWhiteSpace($npmCommandOverride)) {
        $npmCommand = $npmCommandOverride
    }

    $port = 8787
    if (-not [string]::IsNullOrWhiteSpace($envValues['PORT'])) {
        $port = [int]$envValues['PORT']
    }

    $stdoutLogFile = Join-Path $logDir 'bridge.stdout.log'
    $stderrLogFile = Join-Path $logDir 'bridge.stderr.log'
    $pidFile = Join-Path $runDir 'bridge.pid'
    $taskFile = Join-Path $dataDir 'tasks.json'

    [pscustomobject]@{
        RepoRoot = $repoRoot
        TaskName = Get-BridgeTaskName
        ServiceBaseDir = $serviceBaseDir
        DataDir = $dataDir
        LogDir = $logDir
        RunDir = $runDir
        TaskFile = $taskFile
        StdoutLogFile = $stdoutLogFile
        StderrLogFile = $stderrLogFile
        PidFile = $pidFile
        NodeCommand = $nodeCommand
        NpmCommand = $npmCommand
        Port = $port
        HealthUrl = "http://127.0.0.1:$port/health"
        BuildMarker = Join-Path $repoRoot 'dist\index.js'
        StartScript = Join-Path $PSScriptRoot 'start-bridge.ps1'
        StartupScriptPath = Get-BridgeStartupScriptPath
    }
}

function Ensure-BridgeDirectories {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    foreach ($directory in @($Config.ServiceBaseDir, $Config.DataDir, $Config.LogDir, $Config.RunDir)) {
        if (-not (Test-Path -LiteralPath $directory)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
    }
}

function Get-BridgePid {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    if (-not (Test-Path -LiteralPath $Config.PidFile)) {
        return $null
    }

    $rawPid = (Get-Content -LiteralPath $Config.PidFile -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($rawPid)) {
        return $null
    }

    return [int]$rawPid
}

function Set-BridgePid {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config,
        [Parameter(Mandatory = $true)]
        [int]$BridgeProcessId
    )

    Set-Content -LiteralPath $Config.PidFile -Value $BridgeProcessId -NoNewline
}

function Get-BridgeProcessCommandLine {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    try {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return $processInfo.CommandLine
    } catch {
        return $null
    }
}

function Test-IsBridgeProcess {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config,
        [Parameter(Mandatory = $true)]
        [psobject]$Process
    )

    $commandLine = Get-BridgeProcessCommandLine -ProcessId $Process.Id
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
        return $false
    }

    $buildMarker = $Config.BuildMarker
    return $commandLine.IndexOf($buildMarker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-BridgeProcessByPort {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    $connections = @()
    try {
        $connections = @(Get-NetTCPConnection -LocalPort $Config.Port -State Listen -ErrorAction Stop)
    } catch {
        return $null
    }

    foreach ($connection in $connections) {
        try {
            $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
            if (Test-IsBridgeProcess -Config $Config -Process $process) {
                return $process
            }
        } catch {
            continue
        }
    }

    return $null
}

function Get-BridgeProcess {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    $bridgePid = Get-BridgePid -Config $Config
    if ($null -ne $bridgePid) {
        try {
            $process = Get-Process -Id $bridgePid -ErrorAction Stop
            if (Test-IsBridgeProcess -Config $Config -Process $process) {
                return $process
            }
        } catch {
        }
    }

    return Get-BridgeProcessByPort -Config $Config
}

function Remove-BridgePidFile {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    if (Test-Path -LiteralPath $Config.PidFile) {
        Remove-Item -LiteralPath $Config.PidFile -Force
    }
}

function Test-BridgeHealth {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config,
        [int]$TimeoutSeconds = 5
    )

    try {
        $response = Invoke-WebRequest -Uri $Config.HealthUrl -UseBasicParsing -TimeoutSec $TimeoutSeconds
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Assert-BridgeBuildPresent {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    if (-not (Test-Path -LiteralPath $Config.BuildMarker)) {
        throw "Build output not found at '$($Config.BuildMarker)'. Run '$($Config.NpmCommand) run build' first."
    }
}

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$CommandName' is not available in PATH."
    }
}
