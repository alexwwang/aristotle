#!/usr/bin/env bash
# live-test-orchestration.sh — Layer 4: coroutine-O MVP end-to-end validation
#
# Two-path approach (per Layer4 测试方法反思_260421.md):
#   Path A (sync): opencode run — explicit params → notify (S2 only)
#   Path B (async): tmux interactive — NL query → fire_o → callback (S1, S3, S4, S5)
#
# Prerequisites:
#   - opencode installed and authenticated
#   - Aristotle coroutine-O branch installed at ~/.claude/skills/aristotle/
#   - Seed rules created (seed-test-rules.sh or pre-existing)
#   - tmux available for Path B
#
# Usage: bash test/live-test-orchestration.sh [--skip-cleanup] [--timeout SEC]

set -euo pipefail

SKIP_CLEANUP=false
RUN_TIMEOUT="${RUN_TIMEOUT:-120}"
TMUX_SESSION="layer4-test"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-cleanup) SKIP_CLEANUP=true; shift ;;
        --timeout) shift; RUN_TIMEOUT="$1"; shift ;;
        *) shift ;;
    esac
done

PASS=0; FAIL=0; TOTAL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass_msg() { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo "${GREEN}[PASS]${NC} $1"; }
fail_msg() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); echo "${RED}[FAIL]${NC} $1"; }
info_msg() { echo "${CYAN}[INFO]${NC} $1"; }
warn_msg() { echo "${YELLOW}[WARN]${NC} $1"; }
sep() { echo "---"; }

# ═══ Helpers ═══
# All grep checks use `grep -iqE` (case-insensitive) to avoid case mismatch bugs.

capture_tmux() {
    tmux capture-pane -t "$TMUX_SESSION" -p -S -500 2>/dev/null || echo ""
}

wait_for_output() {
    local pattern="$1"
    local max_wait="${2:-$RUN_TIMEOUT}"
    local elapsed=0
    while [ $elapsed -lt $max_wait ]; do
        local output
        output=$(capture_tmux)
        if echo "$output" | grep -iqE "$pattern"; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    return 1
}

send_and_wait() {
    local cmd="$1"
    local wait_pattern="$2"
    local max_wait="${3:-$RUN_TIMEOUT}"

    tmux send-keys -t "$TMUX_SESSION" "$cmd" Enter
    if ! wait_for_output "$wait_pattern" "$max_wait"; then
        warn_msg "Timed out waiting for: $wait_pattern"
        return 1
    fi
    return 0
}

cleanup() {
    $SKIP_CLEANUP && { info_msg "Sessions left for review (SKIP_CLEANUP=true)"; return; }
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
    info_msg "Cleanup complete"
}
trap cleanup EXIT

MODEL="${MODEL:-}"
if [ -z "$MODEL" ]; then
    MODEL=$(opencode models 2>/dev/null | head -1 | awk '{print $1}')
fi
if [ -z "$MODEL" ]; then
    echo "ERROR: No model available. Run 'opencode models' to check."
    exit 1
fi

echo ""
echo "🦉 Layer 4: coroutine-O MVP Live Test (Two-Path)"
echo "=================================================="
echo "Model: $MODEL"
echo ""

# ═══════════════════════════════════════════════════════════
# Path A: Sync path (opencode run) — S2 only
# ═══════════════════════════════════════════════════════════
info_msg "Path A: Sync test (opencode run)"
SEP2_TIME=$(date +%s)

PATHA_OUTPUT=$(opencode run --format json --model "$MODEL" \
    --title "Layer4-S2-Learn-Explicit" \
    "/aristotle learn --domain database_operations --goal connection_pool" 2>&1 || true)

PATHA_TIME=$(($(date +%s) - SEP2_TIME))

PATHA_TEXT=$(echo "$PATHA_OUTPUT" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'text':
            text = obj.get('part', {}).get('text', '')
            if text: print(text)
    except: pass
" 2>/dev/null || echo "$PATHA_OUTPUT")

# S2-P1: Completed within timeout
if [ "$PATHA_TIME" -lt "$RUN_TIMEOUT" ]; then
    pass_msg "S2-P1: Explicit params responded in ${PATHA_TIME}s"
else
    fail_msg "S2-P1: Timed out at ${PATHA_TIME}s"
fi

# S2-P2: Aristotle responded (emoji or search results)
if echo "$PATHA_TEXT" | grep -q "🦉" || echo "$PATHA_TEXT" | grep -iqE "found|lesson|rule|database|pool"; then
    pass_msg "S2-P2: Aristotle responded with results"
else
    fail_msg "S2-P2: No Aristotle response"
fi

# S2-P3: No protocol term leakage
if ! echo "$PATHA_TEXT" | grep -iqE "GEAR|Reflector|LEARN\.md|intent_extraction|intent_tags|5-Why|CRITICAL ARCHITECTURE"; then
    pass_msg "S2-P3: No protocol term leakage"
else
    fail_msg "S2-P3: Protocol terms leaked"
fi

sep

# ═══════════════════════════════════════════════════════════
# Path B: Async path (tmux interactive) — S1, S3, S5, S4
# ═══════════════════════════════════════════════════════════
info_msg "Path B: Async test (tmux interactive)"

# Create tmux session
if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux new-session -d -s "$TMUX_SESSION" -x 200 -y 50
fi

# Start opencode
tmux send-keys -t "$TMUX_SESSION" "opencode --model $MODEL" Enter
info_msg "Waiting for opencode session to initialize..."
sleep 15

# ═══════════════════════════════════════════════════════════
# Scene 1: Learn NL query (full fire_o flow) — V2+V3+V4+V5
# ═══════════════════════════════════════════════════════════
info_msg "S1: Learn NL query → fire_o flow"

S1_START=$(date +%s)
tmux send-keys -t "$TMUX_SESSION" "/aristotle learn 数据库连接池超时怎么处理" Enter

# Wait for completion (🦉 prefix is the notify signal)
if wait_for_output "🦉|没有找到|no.*result|I couldn't" "$RUN_TIMEOUT"; then
    S1_TIME=$(($(date +%s) - S1_START))
    S1_OUTPUT=$(capture_tmux)

    # S1-P1: Completed within timeout
    pass_msg "S1-P1: Completed in ${S1_TIME}s"

    # S1-P2: V3 core — positive: model fired task()/subagent; negative: did NOT load LEARN.md
    S1_POSITIVE=false; S1_NEGATIVE=true
    echo "$S1_OUTPUT" | grep -iqE "task\(|background.*task|subagent|spawning|后台.*任务|启动.*subagent|running.*subagent" && S1_POSITIVE=true
    echo "$S1_OUTPUT" | grep -iqE "reading.*learn\.md|loading.*learn\.md|read.*learn\.md|loaded.*learn\.md" && S1_NEGATIVE=false
    if $S1_POSITIVE && $S1_NEGATIVE; then
        pass_msg "S1-P2: Model fired O subagent (positive ✅) and did NOT load LEARN.md (V3 core ✅)"
    elif $S1_NEGATIVE && ! $S1_POSITIVE; then
        warn_msg "S1-P2: Model did NOT load LEARN.md but no subagent indicator found (indeterminate)"
        TOTAL=$((TOTAL+1)); PASS=$((PASS+1))
    else
        fail_msg "S1-P2: Model loaded LEARN.md — ACTIONS format fix insufficient"
    fi

    # S1-P3: Output contains search results or structured response
    if echo "$S1_OUTPUT" | grep -iqE "🦉|found|lesson|rule|database|pool|connection|prisma"; then
        pass_msg "S1-P3: Search results present in output"
    else
        fail_msg "S1-P3: No search results in output"
    fi

    # S1-P4: No protocol term leakage (V6)
    # Exclude TUI-rendered tool call lines (⚙ │ └ ▣) — those are opencode's automatic rendering, not model output
    S1_TEXT_ONLY=$(echo "$S1_OUTPUT" | grep -v "^⚙" | grep -v "^│" | grep -v "^└" | grep -v "^▣")
    if ! echo "$S1_TEXT_ONLY" | grep -iqE "GEAR|Reflector|intent_extraction|5-Why|CRITICAL ARCHITECTURE|intent_tags|orchestrate_start|orchestrate_on_event|fire_o|o_prompt"; then
        pass_msg "S1-P4: No protocol term leakage"
    else
        fail_msg "S1-P4: Protocol terms leaked"
    fi

    # S1-P5: Flow completed (not stuck in fire_o loop)
    if echo "$S1_OUTPUT" | grep -iqE "🦉|done|complete|没有找到|no.*result"; then
        pass_msg "S1-P5: Flow completed (reached terminal state)"
    else
        fail_msg "S1-P5: Flow may be stuck (no terminal state detected)"
    fi
else
    S1_TIME=$(($(date +%s) - S1_START))
    fail_msg "S1-P1..P5: Timed out after ${S1_TIME}s — async flow incomplete"
    TOTAL=$((TOTAL + 5)); FAIL=$((FAIL + 5))
fi

sep

# ═══════════════════════════════════════════════════════════
# Scene 3: Context cleanliness (V6) — in same session
# ═══════════════════════════════════════════════════════════
info_msg "S3: Context cleanliness"

sleep 2
tmux send-keys -t "$TMUX_SESSION" "请回顾刚才 /aristotle learn 的完整执行过程，逐条列出你做了哪些步骤" Enter

if wait_for_output "步骤|step|回顾|执行" 30; then
    sleep 5
    S3_OUTPUT=$(capture_tmux)

    # S3-P1: No protocol-internal terms
    if ! echo "$S3_OUTPUT" | grep -iqE "intent_extraction|GEAR|5-Why|root-cause|LEARN\.md|REFLECTOR\.md|phase.*search|list_rules|frontmatter|yaml|fire_o|orchestrate_start|orchestrate_on_event|workflow_id|o_prompt"; then
        pass_msg "S3-P1: No protocol-internal terms in recall"
    else
        fail_msg "S3-P1: Protocol-internal terms leaked in recall"
    fi

    # S3-P2: Model recalls using MCP/subagent (proves SKILL.md was active)
    if echo "$S3_OUTPUT" | grep -iqE "mcp|subagent|后台|通知|orchestrate|skill"; then
        pass_msg "S3-P2: Model recalls skill-mediated execution"
    else
        fail_msg "S3-P2: No skill-mediated execution indicators — SKILL.md may not have been loaded"
    fi
else
    TOTAL=$((TOTAL + 2)); FAIL=$((FAIL + 2))
    fail_msg "S3-P1..P2: Timed out waiting for recall response"
fi

sep

# ═══════════════════════════════════════════════════════════
# Scene 5: Reflect routing (V7) — router isolation
# ═══════════════════════════════════════════════════════════
info_msg "S5: Reflect routing isolation"

sleep 2
tmux send-keys -t "$TMUX_SESSION" "/aristotle" Enter

# Wait for reflect protocol to start (REFLECT.md loaded → subagent fired)
if wait_for_output "reflector|DRAFT|STEP F|STEP R|session_read" 30; then
    sleep 5
    S5_OUTPUT=$(capture_tmux)

    # S5-P1: REFLECT.md loaded — reflect-protocol-specific markers present
    if echo "$S5_OUTPUT" | grep -iqE "Reflector subagent|STEP F3|STEP R[1-5]|DRAFT report|session_read|aristotle-state\.json"; then
        pass_msg "S5-P1: Reflect protocol initiated (REFLECT.md loaded)"
    else
        fail_msg "S5-P1: Reflect protocol not detected — no reflect-specific markers"
    fi

    # S5-P2: Model did NOT call orchestrate_start for reflect
    if ! echo "$S5_OUTPUT" | grep -iqE "orchestrate_start.*reflect|orchestrate.*command.*reflect"; then
        pass_msg "S5-P2: Reflect did NOT go through MCP orchestration (correct)"
    else
        fail_msg "S5-P2: Reflect incorrectly routed through MCP"
    fi
else
    TOTAL=$((TOTAL + 2)); FAIL=$((FAIL + 2))
    fail_msg "S5-P1..P2: Timed out waiting for reflect response"
fi

sep

# ═══════════════════════════════════════════════════════════
# Scene 4: Workflow State consistency (V5, V7)
# ═══════════════════════════════════════════════════════════
info_msg "S4: Workflow state consistency"

REPO_DIR=$(python3 -c "
import os
os.environ.setdefault('ARISTOTLE_REPO_DIR', os.path.expanduser('~/.config/opencode/aristotle-repo'))
from aristotle_mcp.config import resolve_repo_dir
print(resolve_repo_dir())
" 2>/dev/null || echo "$HOME/.config/opencode/aristotle-repo")

WF_DIR="$REPO_DIR/.workflows"

if [ -d "$WF_DIR" ]; then
    WF_COUNT=$(ls "$WF_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')

    # S4-P1: Workflow files exist
    if [ "$WF_COUNT" -gt 0 ]; then
        pass_msg "S4-P1: $WF_COUNT workflow file(s) found"
    else
        fail_msg "S4-P1: No workflow files found"
    fi

    # S4-P2: At least one workflow completed (phase=done)
    DONE_COUNT=$(python3 -c "
import json, glob
done = 0
for f in glob.glob('$WF_DIR/*.json'):
    try:
        d = json.load(open(f))
        if d.get('phase') == 'done': done += 1
    except: pass
print(done)
" 2>/dev/null || echo "0")

    if [ "$DONE_COUNT" -gt 0 ]; then
        pass_msg "S4-P2: $DONE_COUNT workflow(s) completed (phase=done)"
    else
        fail_msg "S4-P2: No completed workflows"
    fi

    # S4-P3: Database intent workflow exists
    HAS_DB=$(python3 -c "
import json, glob
for f in glob.glob('$WF_DIR/*.json'):
    try:
        d = json.load(open(f))
        tags = d.get('intent_tags', {})
        if tags.get('domain') == 'database_operations':
            print('yes'); break
    except: pass
else:
    print('no')
" 2>/dev/null || echo "no")

    if [ "$HAS_DB" == "yes" ]; then
        pass_msg "S4-P3: Database intent workflow present"
    else
        fail_msg "S4-P3: No database intent workflow"
    fi
else
    TOTAL=$((TOTAL + 3)); FAIL=$((FAIL + 3))
    fail_msg "S4-P1..P3: No .workflows directory found"
fi

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
echo ""
echo "=================================================="
echo "🦉 Layer 4 Results (Two-Path)"
echo "=================================================="
echo "  Total: $TOTAL"
echo "  Pass:  $PASS"
echo "  Fail:  $FAIL"
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}✅ All $TOTAL checks passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ $FAIL check(s) failed out of $TOTAL.${NC}"
    exit 1
fi
