Param(
  [string]$TaskName = "error_manage_codex_analysis",
  [string]$Task = "user_strategy_refresh",
  [int]$EveryMinutes = 30
)

$ErrorActionPreference = "Stop"

if ($EveryMinutes -lt 5) {
  throw "EveryMinutes must be at least 5."
}

$scriptPath = Join-Path $PSScriptRoot "run-analysis-autopilot.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`" -Task `"$Task`" -IntervalHours 0"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$trigger.Repetition = New-ScheduledTaskRepetitionSettingsSet -Interval (New-TimeSpan -Minutes $EveryMinutes) -Duration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "error_manage Codex analysis autopilot"
Write-Host "Registered scheduled task '$TaskName'"
