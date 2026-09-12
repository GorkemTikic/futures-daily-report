# Convenience runner.
#   .\run.ps1                      generate today's report
#   .\run.ps1 -Date 2026-06-13     generate a specific past UTC day
#   .\run.ps1 -All                 deep-scan every symbol (slower, most thorough)
param([string]$Date, [switch]$All)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$nodeArgs = @("src/index.js")
if ($Date) { $nodeArgs += @("--date", $Date) }
if ($All)  { $nodeArgs += "--all" }
& node @nodeArgs
