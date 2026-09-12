# Registers a Windows Scheduled Task that runs the report every day at 23:45 UTC.
# Run this once. Re-run it to update the task (e.g. after DST changes).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = (Get-Command node).Source
if (-not $node) { throw "Node.js not found on PATH." }

# Task Scheduler triggers in LOCAL time, so convert 23:45 UTC to this machine's local time.
$utc = [DateTime]::UtcNow.Date.AddHours(23).AddMinutes(45)
$local = $utc.ToLocalTime()
$timeStr = $local.ToString("HH:mm")

$action   = New-ScheduledTaskAction -Execute $node -Argument "src/index.js" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -Daily -At $timeStr
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "Futures Daily Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily Binance USD-M Futures volatility & mark-vs-last divergence report (23:45 UTC)." `
  -Force | Out-Null

Write-Host "Scheduled 'Futures Daily Report' to run daily at $timeStr local time (= 23:45 UTC today)."
Write-Host "NOTE: this is a fixed local time. If your region observes DST, re-run this script after the clocks change to stay aligned to 23:45 UTC."
Write-Host "Manage it in Task Scheduler, or remove with:  Unregister-ScheduledTask -TaskName 'Futures Daily Report' -Confirm:`$false"
