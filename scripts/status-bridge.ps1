Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'bridge-service-common.ps1')

$config = Get-BridgeServiceConfig
$process = Get-BridgeProcess -Config $config
$task = Get-ScheduledTask -TaskName $config.TaskName -ErrorAction SilentlyContinue
$taskInfo = $null
 $startupFallbackInstalled = Test-Path -LiteralPath $config.StartupScriptPath
if ($null -ne $task) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $config.TaskName
}

$healthOk = Test-BridgeHealth -Config $config
$portProcess = Get-BridgeProcessByPort -Config $config

if ($null -ne $process) {
    Set-BridgePid -Config $config -BridgeProcessId $process.Id
} elseif ($null -ne $portProcess) {
    $process = $portProcess
    Set-BridgePid -Config $config -BridgeProcessId $process.Id
}

[pscustomobject]@{
    TaskName = $config.TaskName
    TaskInstalled = ($null -ne $task)
    TaskState = if ($taskInfo) { $taskInfo.State.ToString() } else { 'NotInstalled' }
    TaskLastResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    StartupFallbackInstalled = $startupFallbackInstalled
    StartupScriptPath = $config.StartupScriptPath
    ProcessRunning = ($null -ne $process)
    Pid = if ($process) { $process.Id } else { $null }
    HealthOk = $healthOk
    HealthUrl = $config.HealthUrl
    TaskFile = $config.TaskFile
    StdoutLogFile = $config.StdoutLogFile
    StderrLogFile = $config.StderrLogFile
    PidFile = $config.PidFile
} | Format-List
