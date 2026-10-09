# Phase 3 (AI Layer) - Complete Test Suite
# Run this script to verify all Phase 3 implementation is working
# Usage: .\verify-phase3.ps1

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Phase 3 AI Layer - Complete Verification" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"
$BackendPassed = $true
$FrontendPassed = $true

Write-Host "📋 Pre-flight checks..." -ForegroundColor Yellow
Write-Host ""

# Check for running workers
$WorkerProcesses = Get-Process | Where-Object { $_.ProcessName -like "*node*" -and $_.CommandLine -like "*worker*" }
if ($WorkerProcesses) {
    Write-Host "⚠️  WARNING: Found running worker process(es)" -ForegroundColor Yellow
    Write-Host "Integration tests require workers to be stopped." -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to abort and stop workers, or press Enter to continue..."
    Read-Host
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "BACKEND VERIFICATION" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location backend

# T076 - TypeScript Type Checking
Write-Host "🔍 Running TypeScript type check..." -ForegroundColor White
$output = npm run typecheck 2>&1
$output | Out-File -FilePath "$env:TEMP\typecheck.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ TypeScript: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ TypeScript: FAIL" -ForegroundColor Red
    $BackendPassed = $false
}
Write-Host ""

# T076 - Linting
Write-Host "🔍 Running ESLint..." -ForegroundColor White
$output = npm run lint 2>&1
$output | Out-File -FilePath "$env:TEMP\lint.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Linting: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ Linting: FAIL" -ForegroundColor Red
    $BackendPassed = $false
}
Write-Host ""

# T076 - Unit Tests
Write-Host "🧪 Running unit tests..." -ForegroundColor White
$output = npm test -- tests/unit 2>&1
$output | Out-File -FilePath "$env:TEMP\unit.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Unit tests: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ Unit tests: FAIL" -ForegroundColor Red
    $BackendPassed = $false
}
Write-Host ""

# T076 - Integration Tests (Phase 3 specific)
Write-Host "🧪 Running Phase 3 integration tests..." -ForegroundColor White
Write-Host "Note: These tests use MockProvider and should pass without live API key" -ForegroundColor Gray
Write-Host ""

$IntegrationTests = @(
    "tests/integration/conversations.test.ts",
    "tests/integration/agent-runs.test.ts",
    "tests/integration/investigations.test.ts",
    "tests/integration/simulations.test.ts",
    "tests/integration/mapping-suggestions.test.ts"
)

foreach ($Test in $IntegrationTests) {
    Write-Host "  Running $Test..." -ForegroundColor Gray
    $output = npm test -- $Test 2>&1
    $logName = [System.IO.Path]::GetFileNameWithoutExtension($Test)
    $output | Out-File -FilePath "$env:TEMP\$logName.log"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ PASS" -ForegroundColor Green
    } else {
        Write-Host "  ❌ FAIL" -ForegroundColor Red
        $BackendPassed = $false
    }
}
Write-Host ""

Set-Location ..

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "FRONTEND VERIFICATION" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location frontend

# T076 - TypeScript Type Checking
Write-Host "🔍 Running TypeScript type check..." -ForegroundColor White
$output = npm run typecheck 2>&1
$output | Out-File -FilePath "$env:TEMP\frontend-typecheck.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ TypeScript: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ TypeScript: FAIL" -ForegroundColor Red
    $FrontendPassed = $false
}
Write-Host ""

# T076 - Linting
Write-Host "🔍 Running ESLint..." -ForegroundColor White
$output = npm run lint 2>&1
$output | Out-File -FilePath "$env:TEMP\frontend-lint.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Linting: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ Linting: FAIL" -ForegroundColor Red
    $FrontendPassed = $false
}
Write-Host ""

# T076 - Component Tests
Write-Host "🧪 Running component tests..." -ForegroundColor White
$output = npm test 2>&1
$output | Out-File -FilePath "$env:TEMP\frontend-test.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Component tests: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ Component tests: FAIL" -ForegroundColor Red
    $FrontendPassed = $false
}
Write-Host ""

# T076 - Build Verification
Write-Host "🏗️  Running production build..." -ForegroundColor White
$output = npm run build 2>&1
$output | Out-File -FilePath "$env:TEMP\frontend-build.log"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build: PASS" -ForegroundColor Green
} else {
    Write-Host "❌ Build: FAIL" -ForegroundColor Red
    $FrontendPassed = $false
}
Write-Host ""

Set-Location ..

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if ($BackendPassed -and $FrontendPassed) {
    Write-Host "🎉 ALL TESTS PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Host "Phase 3 (AI Layer) is complete and verified!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "1. ✅ All automated tests passed" -ForegroundColor Green
    Write-Host "2. 📝 Manual quickstart verification (T075) - requires GROQ_API_KEY" -ForegroundColor Yellow
    Write-Host "3. 🚀 Ready for deployment" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host "❌ SOME TESTS FAILED" -ForegroundColor Red
    Write-Host ""
    if (-not $BackendPassed) {
        Write-Host "Backend tests failed" -ForegroundColor Red
        Write-Host "Check logs in $env:TEMP\*backend*.log" -ForegroundColor Gray
    }
    if (-not $FrontendPassed) {
        Write-Host "Frontend tests failed" -ForegroundColor Red
        Write-Host "Check logs in $env:TEMP\*frontend*.log" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Fix the failures (T077) and re-run this script." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
