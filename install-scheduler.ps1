# Registers a Windows Scheduled Task that runs the daily report at 00:00 UTC
# (= 03:00 Europe/Istanbul), covering the full UTC day that just closed.
# Run this once. Re-run it to update the task (e.g. after DST changes).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = (Get-Command node).Source
if (-not $node) { throw "Node.js not found on PATH." }

# Task Scheduler triggers in LOCAL time, so convert 00:00 UTC to this machine's local time.
$utc = [DateTime]::UtcNow.Date.AddDays(1)  # next 00:00 UTC
$local = $utc.ToLocalTime()
$timeStr = $local.ToString("HH:mm")

$action   = New-ScheduledTaskAction -Execute $node -Argument "pipeline/index.js" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -Daily -At $timeStr
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "Futures Daily Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily multi-exchange crypto-futures market report (00:00 UTC = 03:00 Istanbul), covering the full UTC day." `
  -Force | Out-Null

Write-Host "Scheduled 'Futures Daily Report' to run daily at $timeStr local time (= 00:00 UTC)."
Write-Host "NOTE: this is a fixed local time. If your region observes DST, re-run this script after the clocks change to stay aligned to 00:00 UTC."
Write-Host "Manage it in Task Scheduler, or remove with:  Unregister-ScheduledTask -TaskName 'Futures Daily Report' -Confirm:`$false"
