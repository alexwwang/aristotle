#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Aristotle E2E Automated Test Suite (opencode run)
#
# Uses `opencode run --format json` to drive real OpenCode sessions
# through the Aristotle skill. Tests MCP integration end-to-end.
#
# Usage:
#   bash test/e2e_opencode.sh          # run all
#   bash test/e2e_opencode.sh --skip   # skip slow tests
#
# Requirements:
#   - opencode CLI installed and authenticated
#   - aristotle MCP server configured in opencode
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

PASS=0; FAIL=0; SKIP=0
RESULTS=()

GREEN='\033[32m'; RED='\033[31m'; YELLOW='\033[33m'; CYAN='\033[36m'; RESET='\033[0m'

record() {
  local id="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    PASS=$((PASS+1))
    RESULTS+=("$id: PASS ${detail}")
    echo -e "  [${GREEN}PASS${RESET}] $id ${detail}"
  elif [ "$ok" = "skip" ]; then
    SKIP=$((SKIP+1))
    RESULTS+=("$id: SKIP ${detail}")
    echo -e "  [${YELLOW}SKIP${RESET}] $id ${detail}"
  else
    FAIL=$((FAIL+1))
    RESULTS+=("$id: FAIL ${detail}")
    echo -e "  [${RED}FAIL${RESET}] $id ${detail}"
  fi
}

# Helper: run opencode with a message and capture JSON output
run_opencode() {
  local msg="$1"
  opencode run "$msg" --format json 2>/dev/null || echo ''
}

# Helper: extract last text from JSON stream
extract_text() {
  grep '"type":"text"' | tail -1 | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        obj = json.loads(line)
        if obj.get('type') == 'text':
            print(obj.get('part', {}).get('text', ''))
    except: pass
" 2>/dev/null || echo ""
}

# Helper: extract tool calls from JSON stream (returns tool names)
extract_tools() {
  grep '"tool_use"' | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        obj = json.loads(line)
        tool = obj.get('part', {}).get('tool', '')
        if tool: print(tool)
    except: pass
" 2>/dev/null || echo ""
}

# ═══════════════════════════════════════════════════════════════
# E2E-1: Aristotle skill loads
# ═══════════════════════════════════════════════════════════════
test_skill_loads() {
  echo -e "\n${CYAN}═══ E2E-1: Skill Load ═══${RESET}"
  
  local output
  output=$(run_opencode "aristotle" | extract_text)
  
  if echo "$output" | grep -qi "aristotle"; then
    record "E2E-1.1" "true" "Aristotle skill loaded"
  else
    record "E2E-1.1" "false" "Skill did not load. Output: $(echo "$output" | head -c 200)"
  fi
}

# ═══════════════════════════════════════════════════════════════
# E2E-2: /aristotle sessions
# ═══════════════════════════════════════════════════════════════
test_sessions() {
  echo -e "\n${CYAN}═══ E2E-2: Sessions Command ═══${RESET}"
  
  local raw output tools
  raw=$(run_opencode "show me my aristotle sessions")
  output=$(echo "$raw" | extract_text)
  tools=$(echo "$raw" | extract_tools)
  
  # Should have called MCP tools
  if echo "$tools" | grep -qi "aristotle"; then
    record "E2E-2.1" "true" "Called aristotle MCP tools: $(echo "$tools" | tr '\n' ' ')"
  else
    record "E2E-2.1" "false" "No aristotle tools called. Tools: $(echo "$tools" | tr '\n' ' ')"
  fi
  
  # Sessions should return content
  if [ -n "$output" ]; then
    record "E2E-2.2" "true" "Sessions returned content: $(echo "$output" | head -c 100)"
  else
    record "E2E-2.2" "false" "Sessions returned empty"
  fi
}

# ═══════════════════════════════════════════════════════════════
# E2E-3: /aristotle learn
# ═══════════════════════════════════════════════════════════════
test_learn() {
  echo -e "\n${CYAN}═══ E2E-3: Learn Flow ═══${RESET}"
  
  local raw output tools
  raw=$(run_opencode "run /aristotle learn prisma connection pool timeout")
  output=$(echo "$raw" | extract_text)
  tools=$(echo "$raw" | extract_tools)
  
  # Should have called orchestrate_start or aristotle tools
  if echo "$tools" | grep -qiE "orchestrate|aristotle"; then
    record "E2E-3.1" "true" "Called orchestration tools: $(echo "$tools" | grep -iE "orchestrate|aristotle" | tr '\n' ' ')"
  else
    record "E2E-3.1" "false" "No orchestration tools called"
  fi
  
  if [ -n "$output" ]; then
    record "E2E-3.2" "true" "Learn returned content"
  else
    record "E2E-3.2" "false" "Learn returned empty"
  fi
}

# ═══════════════════════════════════════════════════════════════
# E2E-4: /aristotle reflect (trigger, verify MCP receives session_file)
# ═══════════════════════════════════════════════════════════════
test_reflect_trigger() {
  echo -e "\n${CYAN}═══ E2E-4: Reflect Trigger (slow - skipped by default) ═══${RESET}"
  
  # Reflect requires LLM sub-agent to complete — skip in CI
  record "E2E-4.1" "skip" "Reflect requires sub-agent (LLM), skipped in automated runs"
  record "E2E-4.2" "skip" "Depends on E2E-4.1"
}

# ═══════════════════════════════════════════════════════════════
# E2E-5: Snapshot file creation (verify disk artifact)
# ═══════════════════════════════════════════════════════════════
test_snapshot_artifact() {
  echo -e "\n${CYAN}═══ E2E-5: Snapshot File Check ═══${RESET}"
  
  local sessions_dir="$HOME/.config/opencode/aristotle-sessions"
  
  # Count snapshot files
  local count=0
  if [ -d "$sessions_dir" ]; then
    count=$(ls -1 "$sessions_dir"/*_snapshot.json 2>/dev/null | wc -l | tr -d ' ')
  fi
  
  if [ "$count" -gt 0 ]; then
    record "E2E-5.1" "true" "Found $count snapshot file(s) in $sessions_dir"
    
    # Verify latest snapshot is valid JSON with correct schema
    local latest
    latest=$(ls -t "$sessions_dir"/*_snapshot.json 2>/dev/null | head -1)
    if [ -n "$latest" ]; then
      local has_version has_session_id
      has_version=$(python3 -c "import json; d=json.load(open('$latest')); print(d.get('version',''))" 2>/dev/null)
      has_session_id=$(python3 -c "import json; d=json.load(open('$latest')); print(d.get('session_id',''))" 2>/dev/null)
      
      if [ "$has_version" = "1" ] && [ -n "$has_session_id" ]; then
        record "E2E-5.2" "true" "Latest snapshot has valid schema (v1, session_id=$has_session_id)"
      else
        record "E2E-5.2" "false" "Invalid schema: version=$has_version, session_id=$has_session_id"
      fi
    fi
  else
    record "E2E-5.1" "skip" "No snapshot files found (may not have triggered reflect yet)"
    record "E2E-5.2" "skip" "Depends on E2E-5.1"
  fi
}

# ═══════════════════════════════════════════════════════════════
# E2E-6: Bridge marker file
# ═══════════════════════════════════════════════════════════════
test_bridge_marker() {
  echo -e "\n${CYAN}═══ E2E-6: Bridge Marker ═══${RESET}"
  
  local sessions_dir="$HOME/.config/opencode/aristotle-sessions"
  local marker="$sessions_dir/.bridge-active"
  
  if [ -f "$marker" ]; then
    record "E2E-6.1" "true" ".bridge-active marker exists"
    
    # Verify content
    local has_pid
    has_pid=$(python3 -c "import json; d=json.load(open('$marker')); print('pid' in d and 'startedAt' in d)" 2>/dev/null)
    if [ "$has_pid" = "True" ]; then
      record "E2E-6.2" "true" "Marker has valid schema (pid + startedAt)"
    else
      record "E2E-6.2" "false" "Invalid marker content"
    fi
  else
    record "E2E-6.1" "skip" "Bridge plugin not loaded (no .bridge-active marker)"
    record "E2E-6.2" "skip" "Depends on E2E-6.1"
  fi
}

# ═══════════════════════════════════════════════════════════════
# E2E-7: Workflow store file
# ═══════════════════════════════════════════════════════════════
test_workflow_store() {
  echo -e "\n${CYAN}═══ E2E-7: Workflow Store ═══${RESET}"
  
  local sessions_dir="$HOME/.config/opencode/aristotle-sessions"
  local store="$sessions_dir/bridge-workflows.json"
  
  if [ -f "$store" ]; then
    record "E2E-7.1" "true" "bridge-workflows.json exists"
    
    local count
    count=$(python3 -c "import json; d=json.load(open('$store')); print(len(d))" 2>/dev/null)
    record "E2E-7.2" "true" "Store has $count workflow(s)"
    
    # Verify entries have required fields
    local valid
    valid=$(python3 -c "
import json
d = json.load(open('$store'))
for wf in d:
    for k in ['workflowId', 'sessionId', 'status', 'startedAt']:
        if k not in wf:
            print('false'); exit()
print('true')
" 2>/dev/null)
    if [ "$valid" = "true" ]; then
      record "E2E-7.3" "true" "All entries have required fields"
    else
      record "E2E-7.3" "false" "Some entries missing required fields"
    fi
  else
    record "E2E-7.1" "skip" "No workflow store (Bridge plugin not loaded or no workflows)"
    record "E2E-7.2" "skip" "Depends on E2E-7.1"
    record "E2E-7.3" "skip" "Depends on E2E-7.1"
  fi
}

# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════
echo -e "\n\033[1m╔══════════════════════════════════════════════════╗"
echo "║  Aristotle E2E — opencode run Test Suite         ║"
echo "╚══════════════════════════════════════════════════╝\033[0m"

echo -e "\n${CYAN}Prerequisites check:${RESET}"
if command -v opencode &>/dev/null; then
  echo -e "  ${GREEN}✓${RESET} opencode CLI found"
else
  echo -e "  ${RED}✗${RESET} opencode CLI not found. Install: https://opencode.ai"
  exit 1
fi

# Run tests
test_skill_loads
test_sessions
test_learn
test_reflect_trigger
test_snapshot_artifact
test_bridge_marker
test_workflow_store

# Summary
TOTAL=$((PASS + FAIL + SKIP))
echo -e "\n\033[1m===================================================="
echo -e "  🦉 E2E Test Results"
echo -e "====================================================\033[0m"
echo -e "  ${GREEN}PASS${RESET}: $PASS"
echo -e "  ${RED}FAIL${RESET}: $FAIL"
echo -e "  ${YELLOW}SKIP${RESET}: $SKIP"
echo -e "  Total: $TOTAL"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n  ${RED}Failed tests:${RESET}"
  for r in "${RESULTS[@]}"; do
    if echo "$r" | grep -q "FAIL"; then
      echo -e "    ✗ $r"
    fi
  done
fi

echo -e "\n  $([ $FAIL -eq 0 ] && echo "${GREEN}✅ All passed!${RESET}" || echo "${RED}❌ Some tests failed.${RESET}")"
echo

exit $FAIL
