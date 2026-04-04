#!/usr/bin/env bash
# test.sh — Aristotle Static Test Suite (file structure, content, hook logic)
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
    ARISTOTLE_DIR="$HOME/.config/opencode/skills/aristotle"
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
    if [ -f "$f" ] && grep -q "$p" "$f" 2>/dev/null; then pass "$d"
    else fail "$d (expected: $p)"; fi
}
assert_not_contains() {
    local f="$1" p="$2" d="$3"
    if [ -f "$f" ] && grep -q "$p" "$f" 2>/dev/null; then fail "$d (should NOT contain: $p)"
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
assert_exists "$ARISTOTLE_DIR/hooks/aristotle-reflector.sh"
assert_exists "$ARISTOTLE_DIR/hooks/aristotle-reflector.ps1"
assert_exists "$ARISTOTLE_DIR/install.sh"
assert_exists "$ARISTOTLE_DIR/install.ps1"
assert_exists "$ARISTOTLE_DIR/test/live-test.sh"
sep

# ═══ T2: SKILL.md Content ═══
info "T2: SKILL.md Content"; sep
assert_contains "$ARISTOTLE_DIR/SKILL.md" "name: aristotle" "frontmatter: name"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "description:" "frontmatter: description"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "run_in_background" "delegates to background"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "opencode -s" "session switch instructions"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "DRAFT" "draft-then-confirm pattern"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "confirm" "confirm mechanism"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "revise" "revise mechanism"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "reject" "reject mechanism"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "APPEND ONLY" "append-only rule"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "NO DUPLICATES" "no-duplicates rule"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "CRITICAL ARCHITECTURE RULE" "architecture guard"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "session_read" "subagent reads session"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "5 Whys" "5-Why analysis"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "MISUNDERSTOOD_REQUIREMENT" "error categories"
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

# ═══ T4: Hook Script Execution ═══
info "T4: Hook Script Execution"; sep

cat > "$TEST_DIR/transcripts/hook-test.txt" << 'EOF'
User: write a function
Assistant: here it is
User: wrong, the function name is incorrect
Assistant: sorry about that, let me fix
User: remember this mistake
EOF

HOOK_OUT=$(echo "{\"transcript_path\":\"$TEST_DIR/transcripts/hook-test.txt\"}" | bash "$ARISTOTLE_DIR/hooks/aristotle-reflector.sh" 2>/dev/null || echo "")
if echo "$HOOK_OUT" | grep -q "Aristotle"; then
    pass "Hook outputs Aristotle suggestion"
else
    fail "Hook did not output suggestion (output: $(echo $HOOK_OUT | head -c 100))"
fi

cat > "$TEST_DIR/transcripts/hook-clean.txt" << 'EOF'
User: hello
Assistant: hi there
User: thanks
EOF

HOOK_OUT=$(echo "{\"transcript_path\":\"$TEST_DIR/transcripts/hook-clean.txt\"}" | bash "$ARISTOTLE_DIR/hooks/aristotle-reflector.sh" 2>/dev/null || echo "")
if [ -z "$HOOK_OUT" ] || ! echo "$HOOK_OUT" | grep -q "Aristotle"; then
    pass "Hook silent on clean transcript"
else
    fail "Hook fired on clean transcript"
fi

sep

# ═══ T5: Install Script Syntax ═══
info "T5: Install Script Syntax"; sep
bash -n "$ARISTOTLE_DIR/install.sh" 2>/dev/null && pass "install.sh syntax valid" || fail "install.sh syntax error"
[ -x "$ARISTOTLE_DIR/hooks/aristotle-reflector.sh" ] && pass "reflector.sh is executable" || fail "reflector.sh not executable"
sep

# ═══ T6: SKILL.md Architecture Guarantees ═══
info "T6: Architecture Guarantees"; sep
assert_contains "$ARISTOTLE_DIR/SKILL.md" "NEVER perform" "isolation guarantee"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "background" "background execution"

R_STEP_COUNT=$(grep -c "STEP R" "$ARISTOTLE_DIR/SKILL.md" || echo "0")
[ "$R_STEP_COUNT" -ge 4 ] && pass "Subagent has $R_STEP_COUNT steps" || fail "Only $R_STEP_COUNT subagent steps"

assert_contains "$ARISTOTLE_DIR/SKILL.md" "STEP R5" "feedback processing step"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "STEP R5" "feedback processing step"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "STEP R6" "file writing step"
assert_contains "$ARISTOTLE_DIR/SKILL.md" "WAIT for the user" "waits for user input"
assert_not_contains "$ARISTOTLE_DIR/SKILL.md" "auto.*commit" "no auto-commit"

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
