#!/bin/bash
# Phase 3 (AI Layer) - Complete Test Suite
# Run this script to verify all Phase 3 implementation is working

set -e  # Exit on any error

echo "=========================================="
echo "Phase 3 AI Layer - Complete Verification"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
BACKEND_PASSED=true
FRONTEND_PASSED=true

echo "📋 Pre-flight checks..."
echo ""

# Check for running workers
WORKER_COUNT=$(ps aux | grep -E "npm.*worker|node.*worker" | grep -v grep | wc -l)
if [ $WORKER_COUNT -gt 0 ]; then
    echo -e "${YELLOW}⚠️  WARNING: Found $WORKER_COUNT running worker process(es)${NC}"
    echo "Integration tests require workers to be stopped."
    echo "Run: pkill -f 'npm.*worker' or manually stop worker processes"
    echo ""
    read -p "Press Enter to continue anyway, or Ctrl+C to abort..."
fi

echo ""
echo "=========================================="
echo "BACKEND VERIFICATION"
echo "=========================================="
echo ""

cd backend

# T076 - TypeScript Type Checking
echo "🔍 Running TypeScript type check..."
if npm run typecheck 2>&1 | tee /tmp/typecheck.log; then
    echo -e "${GREEN}✅ TypeScript: PASS${NC}"
else
    echo -e "${RED}❌ TypeScript: FAIL${NC}"
    BACKEND_PASSED=false
fi
echo ""

# T076 - Linting
echo "🔍 Running ESLint..."
if npm run lint 2>&1 | tee /tmp/lint.log; then
    echo -e "${GREEN}✅ Linting: PASS${NC}"
else
    echo -e "${RED}❌ Linting: FAIL${NC}"
    BACKEND_PASSED=false
fi
echo ""

# T076 - Unit Tests
echo "🧪 Running unit tests..."
if npm test -- tests/unit 2>&1 | tee /tmp/unit.log; then
    echo -e "${GREEN}✅ Unit tests: PASS${NC}"
else
    echo -e "${RED}❌ Unit tests: FAIL${NC}"
    BACKEND_PASSED=false
fi
echo ""

# T076 - Integration Tests (Phase 3 specific)
echo "🧪 Running Phase 3 integration tests..."
echo "Note: These tests use MockProvider and should pass without live API key"
echo ""

INTEGRATION_TESTS=(
    "tests/integration/conversations.test.ts"
    "tests/integration/agent-runs.test.ts"
    "tests/integration/investigations.test.ts"
    "tests/integration/simulations.test.ts"
    "tests/integration/mapping-suggestions.test.ts"
)

for TEST in "${INTEGRATION_TESTS[@]}"; do
    echo "  Running $TEST..."
    if npm test -- "$TEST" 2>&1 | tee /tmp/$(basename $TEST .ts).log; then
        echo -e "  ${GREEN}✅ PASS${NC}"
    else
        echo -e "  ${RED}❌ FAIL${NC}"
        BACKEND_PASSED=false
    fi
done
echo ""

cd ..

echo ""
echo "=========================================="
echo "FRONTEND VERIFICATION"
echo "=========================================="
echo ""

cd frontend

# T076 - TypeScript Type Checking
echo "🔍 Running TypeScript type check..."
if npm run typecheck 2>&1 | tee /tmp/frontend-typecheck.log; then
    echo -e "${GREEN}✅ TypeScript: PASS${NC}"
else
    echo -e "${RED}❌ TypeScript: FAIL${NC}"
    FRONTEND_PASSED=false
fi
echo ""

# T076 - Linting
echo "🔍 Running ESLint..."
if npm run lint 2>&1 | tee /tmp/frontend-lint.log; then
    echo -e "${GREEN}✅ Linting: PASS${NC}"
else
    echo -e "${RED}❌ Linting: FAIL${NC}"
    FRONTEND_PASSED=false
fi
echo ""

# T076 - Component Tests
echo "🧪 Running component tests..."
if npm test 2>&1 | tee /tmp/frontend-test.log; then
    echo -e "${GREEN}✅ Component tests: PASS${NC}"
else
    echo -e "${RED}❌ Component tests: FAIL${NC}"
    FRONTEND_PASSED=false
fi
echo ""

# T076 - Build Verification
echo "🏗️  Running production build..."
if npm run build 2>&1 | tee /tmp/frontend-build.log; then
    echo -e "${GREEN}✅ Build: PASS${NC}"
else
    echo -e "${RED}❌ Build: FAIL${NC}"
    FRONTEND_PASSED=false
fi
echo ""

cd ..

echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo ""

if [ "$BACKEND_PASSED" = true ] && [ "$FRONTEND_PASSED" = true ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED${NC}"
    echo ""
    echo "Phase 3 (AI Layer) is complete and verified!"
    echo ""
    echo "Next steps:"
    echo "1. ✅ All automated tests passed"
    echo "2. 📝 Manual quickstart verification (T075) - requires GROQ_API_KEY"
    echo "3. 🚀 Ready for deployment"
    echo ""
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo ""
    if [ "$BACKEND_PASSED" = false ]; then
        echo -e "${RED}Backend tests failed${NC}"
        echo "Check logs in /tmp/*backend*.log"
    fi
    if [ "$FRONTEND_PASSED" = false ]; then
        echo -e "${RED}Frontend tests failed${NC}"
        echo "Check logs in /tmp/*frontend*.log"
    fi
    echo ""
    echo "Fix the failures (T077) and re-run this script."
    echo ""
    exit 1
fi
