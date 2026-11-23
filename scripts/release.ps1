<#
.SYNOPSIS
  QAReadar release: bump version -> changelog -> test + build -> commit -> push -> deploy -> desktop installers -> GitHub Release.

.DESCRIPTION
  Thin PowerShell wrapper around scripts/release.mjs (the logic lives there so it also
  works on macOS / Linux via `npm run release`). Requires Node.js on PATH.

.EXAMPLE
  .\scripts\release.ps1 patch "fix: JSON search ignores case"
.EXAMPLE
  .\scripts\release.ps1 minor "feat: export locators as CSV"
.EXAMPLE
  .\scripts\release.ps1 none "docs: update README" -NoDeploy
.EXAMPLE
  .\scripts\release.ps1 patch "fix: ..." -DryRun
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Bump,

  [Parameter(Position = 1)]
  [string]$Message = '',

  [switch]$NoPush,
  [switch]$NoDeploy,
  [switch]$NoDesktop,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is required (https://nodejs.org).'
  exit 1
}

$script = Join-Path $PSScriptRoot 'release.mjs'
$nodeArgs = @($script, $Bump)
if ($Message -ne '') { $nodeArgs += $Message }
if ($NoPush) { $nodeArgs += '--no-push' }
if ($NoDeploy) { $nodeArgs += '--no-deploy' }
if ($NoDesktop) { $nodeArgs += '--no-desktop' }
if ($DryRun) { $nodeArgs += '--dry-run' }

& node @nodeArgs
exit $LASTEXITCODE
