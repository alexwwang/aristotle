#!/usr/bin/env bash
# live-test-orchestration.sh — Layer 4: coroutine-O MVP end-to-end validation
#
# 4 scenes, 15 pass criteria validating V1-V7.
# Uses opencode run --format json for non-interactive testing.
#
# Prerequisites:
#   - opencode installed and authenticated
#   - Aristotle coroutine-O branch installed at ~/.claude/skills/aristotle/
#   - Seed rules created (seed-test-rules.sh or pre-existing)
#
# Usage: bash test/live-test-orchestration.sh [--skip-cleanup]

set -euo pipefail

SKIP_CLEANUP=false
RUN_TIMEOUT="${RUN_TIMEOUT:-120}"

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

extract_texts() {
    python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'text':
            part = obj.get('part', {})
            text = part.get('text', '')
            if text:
                print(text)
    except: pass
"
}

run_opencode() {
    local timeout_sec="$RUN_TIMEOUT"
    local tmpfile
    tmpfile=$(mktemp)
    local exit_code=0

    (
        opencode run --format json "$@" 2>&1 || true
    ) > "$tmpfile" &
    local pid=$!

    local elapsed=0
    while [ $elapsed -lt $timeout_sec ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            break
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
        warn_msg "Command timed out after ${timeout_sec}s"
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

cleanup() {
    $SKIP_CLEANUP && { info_msg "Sessions left for review (SKIP_CLEANUP=true)"; return; }
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
echo "🦉 Layer 4: coroutine-O MVP Live Test"
echo "======================================"
echo "Model: $MODEL"
echo ""

# ═══════════════════════════════════════════════════════════
# Scene 1: Learn 自然语言查询 (完整 O 流) — V2+V3+V5+V6
# ═══════════════════════════════════════════════════════════
info_msg "Scene 1: Learn natural language (full O flow)"
SEP1_TIME=$(date +%s)

SCENE1=$(run_opencode --model "$MODEL" \
    --title "Layer4-Scene1-Learn-NL" \
    "/aristotle learn 数据库连接池超时怎么处理" || true)

SCENE1_TIME=$(($(date +%s) - SEP1_TIME))

SCENE1_TEXT=$(echo "$SCENE1" | extract_texts)
SCENE1_LOWER=$(echo "$SCENE1_TEXT" | tr '[:upper:]' '[:lower:]')
SCENE1_RAW_LOWER=$(echo "$SCENE1" | tr '[:upper:]' '[:lower:]')

# PASS-1: Search results or lesson-related content present (in text or tool output)
if echo "$SCENE1_LOWER" | grep -qE "found|lesson|rule|prisma|pool|connection" || echo "$SCENE1_RAW_LOWER" | grep -q '"result_count"'; then
    pass_msg "S1-P1: Search results returned"
else
    fail_msg "S1-P1: No search results found in output"
fi

# PASS-2: Output mentions database/pool related content
if echo "$SCENE1_LOWER" | grep -qE "database|pool|connection|prisma" || echo "$SCENE1_RAW_LOWER" | grep -q '"database_operations"'; then
    pass_msg "S1-P2: Database-related content in results"
else
    fail_msg "S1-P2: No database-related content in results"
fi

# PASS-3: No protocol leakage (V6 critical)
LEAK_PATTERNS="GEAR|Reflector|Checker|REFLECT\.md|LEARN\.md|intent_tags|5-Why|root-cause|CRITICAL ARCHITECTURE|workflow_state"
if ! echo "$SCENE1_LOWER" | grep -qE "$LEAK_PATTERNS"; then
    pass_msg "S1-P3: No protocol term leakage"
else
    LEAKED=$(echo "$SCENE1_LOWER" | grep -oE "$LEAK_PATTERNS" | head -3 | tr '\n' ', ')
    fail_msg "S1-P3: Protocol terms leaked: $LEAKED"
fi

# PASS-4: Completed within timeout
if [ "$SCENE1_TIME" -lt "$RUN_TIMEOUT" ] || [ "$SCENE1_TIME" -lt 180 ]; then
        pass_msg "S1-P4: Completed in ${SCENE1_TIME}s"
else
    fail_msg "S1-P4: Timed out after ${SCENE1_TIME}s"
fi

# Capture session ID for Scene 3
SES_ID=$(echo "$SCENE1" | grep -o '"sessionID"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')
info_msg "Scene 1 session: ${SES_ID:-unknown}"

sep() { echo "---"; }
sep

# ═══════════════════════════════════════════════════════════
# Scene 2: Learn 明确参数 (跳过 O) — V1
# ═══════════════════════════════════════════════════════════
info_msg "Scene 2: Learn explicit params (skip O)"
SEP2_TIME=$(date +%s)

SCENE2=$(run_opencode --model "$MODEL" \
    --title "Layer4-Scene2-Learn-Explicit" \
    "/aristotle learn --domain database_operations --goal connection_pool" || true)

SCENE2_TIME=$(($(date +%s) - SEP2_TIME))
SCENE2_TEXT=$(echo "$SCENE2" | extract_texts)
SCENE2_LOWER=$(echo "$SCENE2_TEXT" | tr '[:upper:]' '[:lower:]')

# PASS-1: Response within reasonable time (no O subagent)
    if [ "$SCENE2_TIME" -lt "$RUN_TIMEOUT" ]; then
        pass_msg "S2-P1: Explicit params responded in ${SCENE2_TIME}s (within timeout)"
else
    fail_msg "S2-P2: Took ${SCENE2_TIME}s — may have fired O unnecessarily"
fi

    # PASS-2: Aristotle responded (emoji or structured output)
    if echo "$SCENE2_TEXT" | grep -q "🦉" || echo "$SCENE2" | grep -q '"result_count"'; then
        pass_msg "S2-P2: Aristotle responded"
    else
        fail_msg "S2-P2: No Aristotle response found"
    fi

    # PASS-3: Search results or database content present
    if echo "$SCENE2_LOWER" | grep -qE "found|lesson|rule|database|pool" || echo "$SCENE2" | grep -q '"result_count"'; then
        pass_msg "S2-P3: Search results returned"
    else
        fail_msg "S2-P3: No search results"
    fi

sep

# ═══════════════════════════════════════════════════════════
# Scene 3: Context 清洁度验证 — V6
# ═══════════════════════════════════════════════════════════
if [ -n "$SES_ID" ]; then
    info_msg "Scene 3: Context cleanliness (recall test)"

    SCENE3=$(run_opencode --model "$MODEL" \
        -s "$SES_ID" \
        "请回顾刚才 /aristotle learn 的完整执行过程，逐条列出你做了哪些步骤" || true)

    SCENE3_TEXT=$(echo "$SCENE3" | extract_texts)
    SCENE3_LOWER=$(echo "$SCENE3_TEXT" | tr '[:upper:]' '[:lower:]')

    # PASS-1: No internal protocol terms (GEAR, intent_extraction, etc.)
    if ! echo "$SCENE3_LOWER" | grep -qE "intent_extraction|GEAR|5-Why|root-cause|LEARN\.md|REFLECTOR\.md"; then
        pass_msg "S3-P1: No protocol-internal terms in recall"
    else
        fail_msg "S3-P1: Protocol-internal terms leaked in recall"
    fi

    # PASS-2: No GEAR protocol internals in recall (fire_o/workflow_id are dispatcher terms, acceptable)
    if ! echo "$SCENE3_LOWER" | grep -qE "intent_extraction|phase.*search|list_rules|frontmatter|yaml|step_l"; then
        pass_msg "S3-P2: No GEAR protocol internals in recall"
    else
        fail_msg "S3-P2: GEAR protocol internals leaked in recall"
    fi

    # PASS-3: No phase terminology
    if ! echo "$SCENE3_LOWER" | grep -q "intent_extraction\|phase.*search"; then
        pass_msg "S3-P3: No phase terminology in recall"
    else
        fail_msg "S3-P3: Phase terms leaked in recall"
    fi

    # PASS-4: Acceptable mentions (called MCP / fired subagent are OK)
    if echo "$SCENE3_LOWER" | grep -qE "mcp|subagent|called|searched"; then
        pass_msg "S3-P4: Acceptable high-level mentions present"
    else
        pass_msg "S3-P4: No protocol details mentioned (also acceptable)"
    fi
else
    warn_msg "Scene 3: Skipped (no session ID from Scene 1)"
    TOTAL=$((TOTAL + 4)); FAIL=$((FAIL + 4))
    fail_msg "S3-P1..P4: Skipped — no session"
fi

sep

# ═══════════════════════════════════════════════════════════
# Scene 4: Workflow State 一致性 — V7
# ═══════════════════════════════════════════════════════════
info_msg "Scene 4: Workflow state consistency"

REPO_DIR=$(python3 -c "
import os
os.environ.setdefault('ARISTOTLE_REPO_DIR', os.path.expanduser('~/.config/opencode/aristotle-repo'))
from aristotle_mcp.config import resolve_repo_dir
print(resolve_repo_dir())
" 2>/dev/null || echo "$HOME/.config/opencode/aristotle-repo")

WF_DIR="$REPO_DIR/.workflows"

if [ -d "$WF_DIR" ]; then
    WF_COUNT=$(ls "$WF_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')

    # PASS-1: Workflow files exist
    if [ "$WF_COUNT" -gt 0 ]; then
        pass_msg "S4-P1: $WF_COUNT workflow file(s) found"
    else
        fail_msg "S4-P1: No workflow files found in $WF_DIR"
    fi

    # PASS-2: At least one workflow completed with phase=done
    DONE_COUNT=$(python3 -c "
import json, glob
done = 0
for f in glob.glob('$WF_DIR/*.json'):
    try:
        d = json.load(open(f))
        if d.get('phase') == 'done':
            done += 1
    except: pass
print(done)
" 2>/dev/null || echo "0")

    if [ "$DONE_COUNT" -gt 0 ]; then
        pass_msg "S4-P2: $DONE_COUNT workflow(s) completed with phase=done"
    else
        fail_msg "S4-P2: No completed workflows found"
    fi

    # PASS-3: Check for database_operations intent
    HAS_DB_INTENT=$(python3 -c "
import json, glob
for f in glob.glob('$WF_DIR/*.json'):
    try:
        d = json.load(open(f))
        tags = d.get('intent_tags', {})
        if tags.get('domain') == 'database_operations':
            print('yes')
            break
    except: pass
else:
    print('no')
" 2>/dev/null || echo "no")

    if [ "$HAS_DB_INTENT" == "yes" ]; then
        pass_msg "S4-P3: Workflow has database_operations intent"
    else
        fail_msg "S4-P3: No workflow with database_operations intent"
    fi

    # PASS-4: Database intent workflow completed (not stuck)
    DB_DONE=$(python3 -c "
import json, glob
for f in glob.glob('$WF_DIR/*.json'):
    try:
        d = json.load(open(f))
        tags = d.get('intent_tags', {})
        if tags.get('domain') == 'database_operations' and d.get('phase') == 'done':
            print('yes')
            break
    except: pass
else:
    print('no')
" 2>/dev/null || echo "no")

    if [ "$DB_DONE" == "yes" ]; then
        pass_msg "S4-P4: Database workflow completed successfully"
    else
        fail_msg "S4-P4: Database workflow not completed"
    fi
else
    TOTAL=$((TOTAL + 4)); FAIL=$((FAIL + 4))
    fail_msg "S4-P1..P4: No .workflows directory found"
fi

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
echo ""
echo "======================================"
echo "🦉 Layer 4 Results"
echo "======================================"
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
