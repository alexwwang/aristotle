#!/usr/bin/env bash
# aristotle-live-test.sh — End-to-end live test for Aristotle skill
# Usage: bash test/live-test.sh [--model MODEL] [--skip-cleanup]
#
# Creates a real opencode session with known error patterns,
# triggers /aristotle, and verifies the full flow.
#
# Prerequisites:
#   - opencode installed and authenticated
#   - oh-my-opencode installed
#   - Aristotle skill installed at ~/.config/opencode/skills/aristotle/

set -euo pipefail

MODEL="${MODEL:-}"
SKIP_CLEANUP=false
RUN_TIMEOUT="${RUN_TIMEOUT:-180}"

# Parse arguments — use while/shift instead of for-in to avoid set -u issues
while [[ $# -gt 0 ]]; do
    case "$1" in
        --model) shift; MODEL="$1"; shift ;;
        --skip-cleanup) SKIP_CLEANUP=true; shift ;;
        --timeout) shift; RUN_TIMEOUT="$1"; shift ;;
        *) shift ;;
    esac
done

# Resolve model
if [ -z "$MODEL" ]; then
    MODEL=$(opencode models 2>/dev/null | head -1 | awk '{print $1}')
fi

if [ -z "$MODEL" ]; then
    echo "ERROR: No model available. Run 'opencode models' to check."
    exit 1
fi

echo "Using model: $MODEL"

PASS=0; FAIL=0; TOTAL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'
pass_msg() { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo "${GREEN}[PASS]${NC} $1"; }
fail_msg() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); echo "${RED}[FAIL]${NC} $1"; }
info_msg() { echo "${CYAN}[INFO]${NC} $1"; }
warn_msg() { echo "${YELLOW}[WARN]${NC} $1"; }

cleanup() {
    $SKIP_CLEANUP && return
    info_msg "Cleanup: test sessions left for manual review"
}
trap cleanup EXIT

# Helper: extract all text content from JSON stream output
extract_texts() {
    # Parse JSON lines and extract "text" field values
    grep '"type":"text"' | sed -n 's/.*"text":"\([^"]*\)".*/\1/p' | sed 's/\\n/\n/g; s/\\"/"/g; s/\\\\/\\/g'
}

# Helper: extract all tool_use events as raw JSON
extract_tool_uses() {
    grep '"type":"tool"' | grep '"tool"'
}

# Helper: run opencode with timeout, capture output
run_opencode() {
    local timeout_sec="$RUN_TIMEOUT"
    # Use a temp file to avoid subshell variable scope issues
    local tmpfile
    tmpfile=$(mktemp)
    local exit_code=0

    # Run with a subprocess timeout
    (
        opencode run --format json "$@" 2>&1 || true
    ) > "$tmpfile" &
    local pid=$!

    # Wait up to timeout_sec
    local elapsed=0
    while [ $elapsed -lt $timeout_sec ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            break
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    # If still running, kill it
    if kill -0 "$pid" 2>/dev/null; then
        warn_msg "Command timed out after ${timeout_sec}s, terminating..."
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        exit_code=2
    else
        wait "$pid" 2>/dev/null || true
    fi

    cat "$tmpfile"
    rm -f "$tmpfile"
    return $exit_code
}

echo ""
echo "🦉 Aristotle Live Test"
echo "====================="
echo ""

# ─── Step 1: Create test session with deliberate error ───
info_msg "Step 1: Creating test session with deliberate error..."
STEP1=$(run_opencode --model "$MODEL" \
    --title "Aristotle Live Test - Error Scenario" \
    "Write a Python function called multiply that adds two numbers. Use the wrong function name deliberately." || true)

SES_ID=$(echo "$STEP1" | grep -oP '"sessionID"\s*:\s*"\K[^"]+' | head -1)

if [ -z "$SES_ID" ]; then
    fail_msg "Could not create test session"
    echo "$STEP1" | tail -5
    exit 1
fi
pass_msg "Test session created: $SES_ID"

# ─── Step 2: Add user correction ───
info_msg "Step 2: Adding user correction..."
STEP2=$(run_opencode -s "$SES_ID" --model "$MODEL" \
    "no that is wrong. The function should be called add not multiply. You misunderstood my requirement. The name is wrong." || true)

if echo "$STEP2" | grep -q '"type":"text"'; then
    pass_msg "Correction added to session"
else
    fail_msg "Failed to add correction"
fi

# ─── Step 3: Force model to accept correction ───
info_msg "Step 3: Forcing model to accept correction..."
STEP3=$(run_opencode -s "$SES_ID" --model "$MODEL" \
    "I'm telling you it is wrong. Change it to add. This is a correction. Learn from this mistake." || true)

if echo "$STEP3" | grep -q '"type":"text"'; then
    pass_msg "Model accepted correction"
else
    fail_msg "Model did not accept correction"
fi

# ─── Step 4: Trigger /aristotle ───
info_msg "Step 4: Triggering /aristotle (may take a while)..."
STEP4=$(run_opencode -s "$SES_ID" --model "$MODEL" \
    --command "aristotle" || true)

# Dump step 4 texts for debugging
info_msg "Step 4 output texts:"
echo "$STEP4" | extract_texts | head -10
echo ""

# Check if Aristotle activated (look for keywords in text output or tool names)
if echo "$STEP4" | grep -qi "aristotle\|reflection\|reflector"; then
    pass_msg "Aristotle activated"
else
    fail_msg "Aristotle did not activate"
    echo "$STEP4" | grep '"text"' | head -3
fi

# Check if task() was called with load_skills: []
# The JSON may contain "load_skills":[] or "load_skills":[]
# Match both patterns — also check the tool input field
if echo "$STEP4" | extract_tool_uses | grep -q '"task"'; then
    # Found a task() call — check load_skills
    # Extract the task input and check for empty load_skills
    TASK_INPUT=$(echo "$STEP4" | extract_tool_uses | grep '"task"' | head -1)
    if echo "$TASK_INPUT" | grep -q '"load_skills":\[\]\|"load_skills": \[\]'; then
        pass_msg "task() called with load_skills=[] (no recursion)"
    elif echo "$TASK_INPUT" | grep -q '"load_skills"'; then
        fail_msg "task() called with non-empty load_skills (check for recursion risk)"
    else
        warn_msg "task() called but load_skills field not found in output (may be truncated)"
        # Don't count as pass or fail — inconclusive
    fi
else
    fail_msg "No task() call found in output — Aristotle may not have launched reflector"
fi

# Check if session switch instructions provided
# Look in text output for "opencode -s" pattern
if echo "$STEP4" | extract_texts | grep -qi "opencode -s"; then
    pass_msg "Session switch instructions provided"
else
    # Also check raw JSON for the pattern (may be in tool output)
    if echo "$STEP4" | grep -qi "opencode -s"; then
        pass_msg "Session switch instructions provided (in tool output)"
    else
        fail_msg "No session switch instructions"
    fi
fi

# Check if background task was launched
BG_TASK=$(echo "$STEP4" | grep -oP 'bg_[a-z0-9]+' | head -1)
if [ -n "$BG_TASK" ]; then
    pass_msg "Background task launched: $BG_TASK"
else
    fail_msg "No background task ID found"
fi

# Check if reflector session ID provided
ARI_SES=$(echo "$STEP4" | grep -oP 'ses_[a-zA-Z0-9]+' | sort -u | tail -1)
if [ -n "$ARI_SES" ] && [ "$ARI_SES" != "$SES_ID" ]; then
    pass_msg "Reflector session ID provided: $ARI_SES"
else
    fail_msg "No separate reflector session ID"
fi

# ─── Summary ───
echo ""
echo "====================="
echo "🦉 Live Test Results"
echo "====================="
echo "  Total: $TOTAL"
echo "  Pass:  $PASS"
echo "  Fail:  $FAIL"
echo ""
echo "Test session: $SES_ID"
if [ -n "$ARI_SES" ]; then
    echo "Reflector session: $ARI_SES"
    echo ""
    echo "To review reflector output:"
    echo "  opencode -s $ARI_SES"
fi
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo "${GREEN}✅ All checks passed!${NC}"
    exit 0
else
    echo "${RED}❌ $FAIL check(s) failed.${NC}"
    exit 1
fi
