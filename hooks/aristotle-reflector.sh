#!/usr/bin/env bash
# aristotle-reflector.sh - Lightweight Stop hook for Aristotle
# Only suggests, does NOT auto-trigger.

set -euo pipefail

INPUT=$(cat)
# Parse transcript_path from JSON — try python3 first, fall back to sed
TRANSCRIPT_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get(\"transcript_path\",\"\"))" 2>/dev/null || echo "$INPUT" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    exit 0
fi

TRANSCRIPT=$(cat "$TRANSCRIPT_PATH" 2>/dev/null || echo "")
if [ -z "$TRANSCRIPT" ]; then
    exit 0
fi

ERROR_SCORE=0

# Use || true - grep -ciE outputs count to stdout.
# On Windows Git Bash, || echo 0 produces double "0\n0" when grep finds 0 matches.
V=$(echo "$TRANSCRIPT" | grep -ciE "wrong|incorrect|not right|actually," || true) ; ERROR_SCORE=$((ERROR_SCORE + ${V:-0}))
V=$(echo "$TRANSCRIPT" | grep -ciE "不对|错了|搞错|不是这样" || true) ; ERROR_SCORE=$((ERROR_SCORE + ${V:-0}))
V=$(echo "$TRANSCRIPT" | grep -ciE "sorry|apologize|I was wrong" || true) ; ERROR_SCORE=$((ERROR_SCORE + ${V:-0}))
V=$(echo "$TRANSCRIPT" | grep -ciE "remember this|learn from this|记住|以后别" || true) ; ERROR_SCORE=$((ERROR_SCORE + ${V:-0}))

if [ "$ERROR_SCORE" -lt 2 ]; then
    exit 0
fi

cat << 'OUTPUT'
{
  "decision": "continue",
  "inject_prompt": "🦉 Aristotle: Error-correction patterns detected. Type /aristotle to launch an isolated reflection subagent, or ignore to skip."
}
OUTPUT
