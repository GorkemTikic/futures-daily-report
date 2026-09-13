# Convenience runner for the daily multi-exchange report.
#   .\run.ps1            generate the report for the just-closed UTC day
# (The old per-coin divergence generator is retired; its code stays in src/ for history.)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& node "pipeline/index.js"
