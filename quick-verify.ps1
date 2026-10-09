# Phase 3 Quick Verification Script
# Simple version - runs essential checks only

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Phase 3 AI Layer - Quick Verification" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$script:passed = $true

function Test-Command {
    param($Name, $Command, $Location = ".")

    Write-Host "Testing: $Name..." -ForegroundColor White
    Push-Location $Location

    try {
        Invoke-Expression $Command 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✅ PASS`n" -ForegroundColor Green
        } else {
            Write-Host "  ❌ FAIL`n" -ForegroundColor Red
            $script:passed = $false
        }
    } catch {
        Write-Host "  ❌ ERROR: $_`n" -ForegroundColor Red
        $script:passed = $false
    } finally {
        Pop-Location
    }
}

# Backend
Write-Host "BACKEND CHECKS" -ForegroundColor Yellow
Test-Command "TypeScript" "npm run typecheck" "backend"
Test-Command "Linting" "npm run lint" "backend"

# Frontend
Write-Host "FRONTEND CHECKS" -ForegroundColor Yellow
Test-Command "TypeScript" "npm run typecheck" "frontend"
Test-Command "Linting" "npm run lint" "frontend"

# Summary
Write-Host "========================================" -ForegroundColor Cyan
if ($script:passed) {
    Write-Host "✅ ALL CHECKS PASSED" -ForegroundColor Green
    Write-Host "`nPhase 3 is ready. Run full tests with:" -ForegroundColor White
    Write-Host "  cd backend && npm test" -ForegroundColor Gray
    Write-Host "  cd frontend && npm test`n" -ForegroundColor Gray
} else {
    Write-Host "❌ SOME CHECKS FAILED" -ForegroundColor Red
    Write-Host "Review errors above and fix before proceeding.`n" -ForegroundColor Yellow
}
