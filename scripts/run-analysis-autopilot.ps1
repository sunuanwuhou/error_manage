Param(
  [string]$Task = "user_strategy_refresh",
  [int]$IntervalHours = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$args = @("run", "analysis:autopilot", "--", "--task=$Task", "--interval-hours=$IntervalHours")
& npm @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
