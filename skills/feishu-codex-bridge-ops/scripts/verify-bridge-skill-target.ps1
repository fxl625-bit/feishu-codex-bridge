$ErrorActionPreference = 'Stop'

$cwd = Get-Location
$packageJsonPath = Join-Path $cwd 'package.json'
$indexPath = Join-Path $cwd 'src\index.ts'
$readmePath = Join-Path $cwd 'README.md'

if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  throw "package.json not found in $cwd"
}

if (-not (Test-Path -LiteralPath $indexPath)) {
  throw "src\index.ts not found in $cwd"
}

if (-not (Test-Path -LiteralPath $readmePath)) {
  throw "README.md not found in $cwd"
}

$package = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
$readme = Get-Content -Raw -LiteralPath $readmePath
$indexText = Get-Content -Raw -LiteralPath $indexPath

if ($package.name -ne 'feishu-codex-bridge') {
  throw "Unexpected package name: $($package.name)"
}

if ($readme -notmatch 'Feishu Codex Bridge') {
  throw 'README does not match expected bridge title'
}

if ($indexText -notmatch 'createLarkTransport' -or $indexText -notmatch 'startHealthServer') {
  throw 'src\index.ts does not look like the expected bridge entrypoint'
}

[pscustomobject]@{
  ok = $true
  cwd = [string]$cwd
  package = $package.name
  verifiedFiles = @(
    $packageJsonPath
    $readmePath
    $indexPath
  )
} | ConvertTo-Json -Depth 4
