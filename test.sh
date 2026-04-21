#!/usr/bin/env bash
# test.sh — Aristotle Static Test Suite (file structure, content, pattern detection)
# Usage: bash test.sh [--skip-cleanup]
#
# Works from both the source repo AND the installed location.
# Auto-detects ARISTOTLE_DIR based on script location.

set -euo pipefail

SKIP_CLEANUP=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-cleanup) SKIP_CLEANUP=true; shift ;;
        *) shift ;;
    esac
done

# Auto-detect: prefer repo-local, fall back to installed location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/SKILL.md" ]; then
    ARISTOTLE_DIR="$SCRIPT_DIR"
else
    ARISTOTLE_DIR="$HOME/.claude/skills/aristotle"
fi

TEST_DIR=$(mktemp -d)
LOG_FILE="$TEST_DIR/test-output.log"

PASS=0; FAIL=0; TOTAL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log() { echo -e "$1" | tee -a "$LOG_FILE"; }
info() { log "${CYAN}[INFO]${NC} $1"; }
pass() { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); log "${GREEN}[PASS]${NC} $1"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); log "${RED}[FAIL]${NC} $1"; }
skip() { log "${YELLOW}[SKIP]${NC} $1"; }
sep() { log "---"; }

assert_exists() {
    [ -f "$1" ] && pass "exists: $(basename $1)" || fail "missing: $1"
}
assert_contains() {
    local f="$1" p="$2" d="$3"
    if [ -f "$f" ] && grep -q -- "$p" "$f" 2>/dev/null; then pass "$d"
    else fail "$d (expected: $p)"; fi
}
assert_not_contains() {
    local f="$1" p="$2" d="$3"
    if [ -f "$f" ] && grep -q -- "$p" "$f" 2>/dev/null; then fail "$d (should NOT contain: $p)"
    else pass "$d"; fi
}

cleanup() {
    $SKIP_CLEANUP && { info "Test dir preserved: $TEST_DIR"; return; }
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Helper: count matching lines safely (handles grep exit code on no match)
# On Windows Git Bash, "|| echo 0" produces "0\n0" when grep finds 0 matches.
count_matches() { local V; V=$(grep -ciE "$1" "$2" || true); echo "${V:-0}"; }
info "ARISTOTLE_DIR=$ARISTOTLE_DIR"
log ""; log "🦉 Aristotle Test Suite"; sep

# ═══ T1: File Structure ═══
info "T1: File Structure"; sep
assert_exists "$ARISTOTLE_DIR/SKILL.md"
assert_exists "$ARISTOTLE_DIR/REFLECTOR.md"
assert_exists "$ARISTOTLE_DIR/REFLECT.md"
assert_exists "$ARISTOTLE_DIR/REVIEW.md"
assert_exists "$ARISTOTLE_DIR/CHECKER.md"
assert_exists "$ARISTOTLE_DIR/aristotle_mcp/evolution.py"
assert_exists "$ARISTOTLE_DIR/install.sh"
assert_exists "$ARISTOTLE_DIR/install.ps1"
assert_exists "$ARISTOTLE_DIR/test/live-test.sh"
sep

# ═══ T2: SKILL.md Content (Dispatcher) ═══
info "T2: SKILL.md Content (Dispatcher)"; sep
assert_contains "$ARISTOTLE_DIR/SKILL.md" "name: aristotle" "frontmatter: name"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "description:" "frontmatter: description"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "orchestrate_start" "dispatcher calls MCP orchestrate_start"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "orchestrate_on_event" "dispatcher calls MCP orchestrate_on_event"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "fire_o" "dispatcher handles fire_o action"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "REFLECT.md" "dispatcher routes reflect to REFLECT.md"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "learn --domain" "dispatcher supports explicit learn params"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "learn <query>" "dispatcher supports natural language learn"
sep

# ═══ T2b: SKILL.md Auto-Trigger Keywords ═══
info "T2b: Auto-Trigger Keywords"; sep
assert_contains "$ARISTOTLE_DIR/SKILL.md" "wrong" "description includes 'wrong' trigger"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "mistake" "description includes 'mistake' trigger"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "incorrect" "description includes 'incorrect' trigger"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "不对" "description includes Chinese trigger"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "搞错" "description includes Chinese trigger"
sep

# ═══ T2c: File Size Constraints (Progressive Disclosure) ═══
info "T2c: File Size Constraints"; sep
SKILL_LINES=$(wc -l < "$ARISTOTLE_DIR/SKILL.md" | tr -d ' ')
if [ "$SKILL_LINES" -le 40 ]; then
    pass "SKILL.md MVP is $SKILL_LINES lines (≤40)"
else
    fail "SKILL.md MVP is $SKILL_LINES lines (expected ≤40)"
fi
REFLECT_LINES=$(wc -l < "$ARISTOTLE_DIR/REFLECT.md" | tr -d ' ')
if [ "$REFLECT_LINES" -le 140 ]; then
    pass "REFLECT.md is $REFLECT_LINES lines (≤140)"
else
    fail "REFLECT.md is $REFLECT_LINES lines (expected ≤140)"
fi
REVIEW_LINES=$(wc -l < "$ARISTOTLE_DIR/REVIEW.md" | tr -d ' ')
if [ "$REVIEW_LINES" -le 180 ]; then
    pass "REVIEW.md is $REVIEW_LINES lines (≤180)"
else
    fail "REVIEW.md is $REVIEW_LINES lines (expected ≤180)"
fi
sep

# ═══ T3: Hook Pattern Detection ═══
info "T3: Hook Pattern Detection"; sep
mkdir -p "$TEST_DIR/transcripts"

# T3a: English errors
cat > "$TEST_DIR/transcripts/en-errors.txt" << 'EOF'
User: make me a login page
Assistant: Here is a login page with username and password
User: no, that is wrong. I wanted OAuth login
Assistant: sorry, let me fix that
User: actually you also forgot error handling
EOF

SCORE=0
V=$(count_matches "wrong|incorrect|not right|actually," "$TEST_DIR/transcripts/en-errors.txt"); SCORE=$((SCORE + V))
V=$(count_matches "sorry|apologize|I was wrong" "$TEST_DIR/transcripts/en-errors.txt"); SCORE=$((SCORE + V))
[ "$SCORE" -ge 2 ] && pass "English error patterns detected (score=$SCORE)" || fail "English patterns not detected (score=$SCORE)"

# T3b: Chinese errors
cat > "$TEST_DIR/transcripts/cn-errors.txt" << 'EOF'
User: 帮我写一个API
Assistant: 好的，这是API代码
User: 不对，你搞错了接口路径
Assistant: sorry，你说得对，我搞错了，让我修正
EOF

SCORE=0
V=$(count_matches "不对|错了|搞错|不是这样" "$TEST_DIR/transcripts/cn-errors.txt"); SCORE=$((SCORE + V))
V=$(count_matches "sorry|apologize|I was wrong" "$TEST_DIR/transcripts/cn-errors.txt"); SCORE=$((SCORE + V))
[ "$SCORE" -ge 2 ] && pass "Chinese error patterns detected (score=$SCORE)" || fail "Chinese patterns not detected (score=$SCORE)"

# T3c: Clean session (no errors)
cat > "$TEST_DIR/transcripts/clean.txt" << 'EOF'
User: create a hello world function
Assistant: Here is a hello world function in Python
User: thanks, that is perfect
EOF

SCORE=0
V=$(count_matches "wrong|incorrect|not right|actually," "$TEST_DIR/transcripts/clean.txt"); SCORE=$((SCORE + V))
V=$(count_matches "sorry|apologize|I was wrong" "$TEST_DIR/transcripts/clean.txt"); SCORE=$((SCORE + V))
[ "$SCORE" -lt 2 ] && pass "Clean session correctly ignored (score=$SCORE)" || fail "Clean session false positive (score=$SCORE)"

# T3d: Single sorry threshold test
cat > "$TEST_DIR/transcripts/threshold.txt" << 'EOF'
User: create a function
Assistant: Here it is. Sorry for the delay.
User: thanks
EOF

SCORE=0
V=$(count_matches "wrong|incorrect|not right|actually," "$TEST_DIR/transcripts/threshold.txt"); SCORE=$((SCORE + V))
V=$(count_matches "sorry|apologize|I was wrong" "$TEST_DIR/transcripts/threshold.txt"); SCORE=$((SCORE + V))
[ "$SCORE" -lt 2 ] && pass "Single sorry below threshold (score=$SCORE)" || fail "Threshold too low (score=$SCORE)"

# T3e: Explicit learning signal
cat > "$TEST_DIR/transcripts/explicit.txt" << 'EOF'
User: remember this mistake for next time
Assistant: I will learn from this
User: 以后别再犯同样的错误
EOF

SCORE=0
V=$(count_matches "remember this|learn from this|记住|以后别" "$TEST_DIR/transcripts/explicit.txt"); SCORE=$((SCORE + V))
[ "$SCORE" -ge 2 ] && pass "Explicit learning signals detected (score=$SCORE)" || fail "Explicit signals not detected (score=$SCORE)"

sep

# ═══ T5: Install Script Syntax ═══
info "T5: Install Script Syntax"; sep
bash -n "$ARISTOTLE_DIR/install.sh" 2>/dev/null && pass "install.sh syntax valid" || fail "install.sh syntax error"
sep

# ═══ T6: Architecture Guarantees ═══
info "T6: Architecture Guarantees"; sep

# SKILL.md is a thin dispatcher — no protocol details
assert_contains "$ARISTOTLE_DIR/SKILL.md" "Dispatcher" "dispatcher identity"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "STEP R1" "dispatcher omits R1"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "STEP F1" "router omits F1"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "STEP V1" "router omits V1"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "5 Whys Template" "router omits 5-Why template"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "APPEND ONLY" "router delegates APPEND ONLY to REVIEW.md"

# Reflector protocol lives in REFLECTOR.md (subagent reads this)
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "STEP R1" "reflector: read session"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "STEP R2" "reflector: detect errors"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "STEP R3" "reflector: 5-Why analysis"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "STEP R4" "reflector: draft rules"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "STEP R5" "reflector: persist draft"
assert_not_contains "$ARISTOTLE_DIR/REFLECTOR.md" "STEP R6" "reflector has no R6 (non-interactive)"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "DRAFT" "draft output format"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "MISUNDERSTOOD_REQUIREMENT" "error categories"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "5 Whys" "5-Why analysis"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "session_read" "subagent reads session"
assert_contains "$ARISTOTLE_DIR/REFLECTOR.md" "non-interactive" "non-interactive declaration"

# Reflect protocol lives in REFLECT.md (coordinator fires subagent)
assert_contains "$ARISTOTLE_DIR/REFLECT.md" "STEP F3" "reflect: fire subagent"
assert_contains "$ARISTOTLE_DIR/REFLECT.md" "run_in_background" "reflect: background execution"
assert_contains "$ARISTOTLE_DIR/REFLECT.md" "aristotle-state.json" "reflect: state update"
assert_not_contains "$ARISTOTLE_DIR/REFLECT.md" "APPEND ONLY" "reflect: no file writing"

# Review protocol lives in REVIEW.md (coordinator handles user interaction)
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "STEP V1" "review: load draft"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "STEP V2" "review: user feedback"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "STEP V3" "review: write rules"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "STEP V4" "review: post-write revision"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "STEP V5" "review: cross-session reflection"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "STEP V6" "review: re-reflect"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "REFLECT.md" "review: cross-loads REFLECT.md on re-reflect"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "APPEND ONLY" "review: append-only rule"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "NO DUPLICATES" "review: no-duplicates rule"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "confirm" "review: confirm mechanism"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "revise" "review: revise mechanism"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "reject" "review: reject mechanism"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "Revised:" "review: revision timestamp"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "get_audit_decision" "review: V3c Δ decision"
assert_contains "$ARISTOTLE_DIR/REVIEW.md" "audit_level" "review: dynamic audit level"

# ═══ T-ORCH: MVP Dispatcher SKILL.md static tests ═══
info "T-ORCH: MVP Dispatcher SKILL.md"; sep

assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "GEAR" "no GEAR protocol name"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "Reflector" "no R role name"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "Checker" "no C role name"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "Searcher" "no S role name"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "intent_tags" "no protocol field name"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "CRITICAL ARCHITECTURE" "no old suppression rules"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "LEARN.md" "no LEARN.md reference"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "REVIEW.md" "no REVIEW.md reference"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "CHECKER.md" "no CHECKER.md reference"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "NEVER.*protocol" "no old suppression pattern"

assert_contains "$ARISTOTLE_DIR/SKILL.md" "orchestrate_start" "dispatcher calls orchestrate_start"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "orchestrate_on_event" "dispatcher calls orchestrate_on_event"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "fire_o" "dispatcher handles fire_o action"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "notify" "dispatcher handles notify action"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "ROUTE" "dispatcher has ROUTE section"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "EVENT LOOP" "dispatcher has EVENT LOOP section"

skill_mvp_lines=$(wc -l < "$ARISTOTLE_DIR/SKILL.md" | tr -d ' ')
if [ "$skill_mvp_lines" -le 40 ]; then
    pass "SKILL.md MVP is $skill_mvp_lines lines (≤40)"
else
    fail "SKILL.md MVP is $skill_mvp_lines lines (expected ≤40)"
fi
sep

# Summary
sep
echo ""
echo "====================="
echo "🦉 Test Suite Results"
echo "====================="
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
