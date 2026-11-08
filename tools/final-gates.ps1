# Final gate chain (ASCII only: PowerShell 5.1 + no BOM issues).
# Runs every gate serially and records exit codes into a log file.
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Administrator\dsh-source\dsh-palm'
$log = Join-Path $repo 'final-gates.log'
if (Test-Path $log) { Remove-Item $log -Force }

function Step([string]$name, [scriptblock]$body) {
  Add-Content -Path $log -Value "=== STEP $name ==="
  & $body 2>&1 | Add-Content -Path $log
  $code = $LASTEXITCODE
  Add-Content -Path $log -Value "=== EXIT $name = $code ==="
  Write-Host "$name exit=$code"
}

Push-Location (Join-Path $repo 'packages\dsh-palm')
Step 'gen-css'   { pnpm gen:css }
Step 'typecheck' { pnpm typecheck }
Step 'build'     { pnpm build }
Step 'test'      { pnpm test }
Pop-Location

Push-Location $repo
Step 'budget'          { node tools/check-budget.mjs }
Step 'budget-sync'     { node tools/sync-budgets.mjs --check }
Step 'health'          { node tools/health-check.mjs }
Step 'visual'          { node tools/mobile-visual/run.mjs }
Step 'scenarios'       { node tools/mobile-scenarios/run.mjs }
Step 'dead-css'        { node tools/dead-css.mjs }
Pop-Location

Add-Content -Path $log -Value '=== DONE ==='
Write-Host 'ALL DONE'
