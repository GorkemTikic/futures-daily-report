# Registers the Windows Scheduled Task for the daily report.
#
# DST-proof design: instead of a fixed local time (which drifts an hour off 00:00 UTC for
# half the year on machines that observe DST), we fire the task ONCE A DAY with an HOURLY
# repetition, and let pipeline/index.js decide — with --scheduled — whether the current
# UTC day's report has already been generated. 23 of every 24 wake-ups do a millisecond
# filesystem check and exit; the one that runs is whenever the just-closed UTC day is not
# yet on disk (shortly after 00:00 UTC). A missed window is caught by the next hour, and
# item 1's honest window-labelling means a late run labels itself correctly.
#
# Run this once. Re-run it to update the task.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = (Get-Command node).Source
if (-not $node) { throw "Node.js not found on PATH." }

# Anchor the daily trigger at the local time that corresponds to ~00:00 UTC today, then
# repeat hourly for 24h so it is timezone/DST-independent.
$startLocal = ([DateTime]::UtcNow.Date).ToLocalTime()

$action = New-ScheduledTaskAction -Execute $node -Argument "pipeline/index.js --scheduled" -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $startLocal
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $startLocal `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Hours 24)).Repetition

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 60) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "Futures Daily Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily multi-exchange crypto-futures market report covering the full UTC day. Fires hourly (DST-proof); the pipeline generates the just-closed UTC day once, then exits cheaply the rest of the day." `
  -Force | Out-Null

Write-Host "Registered 'Futures Daily Report': fires hourly (DST-proof); the pipeline generates the just-closed UTC day and skips the rest."
Write-Host ""
Write-Host "VERIFY the registered action and trigger with:"
Write-Host "  Get-ScheduledTask 'Futures Daily Report' | Select-Object -ExpandProperty Actions"
Write-Host "  Get-ScheduledTask 'Futures Daily Report' | Select-Object -ExpandProperty Triggers"
Write-Host ""
Write-Host "Remove it with:  Unregister-ScheduledTask -TaskName 'Futures Daily Report' -Confirm:`$false"
