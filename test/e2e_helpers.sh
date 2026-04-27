#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Aristotle E2E Test Helpers (shared)
# ═══════════════════════════════════════════════════════════════
# Source this file from e2e test scripts:
#   source "$(dirname "$0")/e2e_helpers.sh"
# ═══════════════════════════════════════════════════════════════

# Colors
GREEN='\033[32m'; RED='\033[31m'; YELLOW='\033[33m'; CYAN='\033[36m'; RESET='\033[0m'

# Default paths (override before sourcing if needed)
OPENCODE_DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
SESSIONS_DIR="${SESSIONS_DIR:-$HOME/.config/opencode/aristotle-sessions}"
WORKFLOWS_FILE="${WORKFLOWS_FILE:-$SESSIONS_DIR/bridge-workflows.json}"
BRIDGE_MARKER="${BRIDGE_MARKER:-$SESSIONS_DIR/.bridge-active}"

# ───────────────────────────────────────────────────────────────
# Tmux helpers
# ───────────────────────────────────────────────────────────────
wait_for() {
    local desc="$1" check_cmd="$2" timeout="${3:-60}"
    local elapsed=0
    echo -e "  ${YELLOW}⏳${RESET} Waiting: $desc (timeout ${timeout}s)"
    while [ $elapsed -lt $timeout ]; do
        if eval "$check_cmd" >/dev/null 2>&1; then
            echo -e "  ${GREEN}✅${RESET} $desc (waited ${elapsed}s)"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    echo -e "  ${RED}❌ TIMEOUT${RESET}: $desc (${timeout}s)"
    return 1
}

tmux_send() {
    local msg="$1"
    tmux send-keys -t "$TMUX_SESSION" "$msg" Enter
}

tmux_output() {
    tmux capture-pane -t "$TMUX_SESSION" -p -S -100 2>/dev/null || true
}

tmux_session_exists() {
    local session="$1"
    tmux has-session -t "$session" 2>/dev/null
}

# ───────────────────────────────────────────────────────────────
# DB Helpers
# ───────────────────────────────────────────────────────────────
get_latest_session() {
    sqlite3 "$OPENCODE_DB" "SELECT id FROM session WHERE parent_id IS NULL ORDER BY time_created DESC LIMIT 1;" 2>/dev/null || true
}

count_sub_sessions() {
    local parent_id="$1"
    sqlite3 "$OPENCODE_DB" "SELECT COUNT(*) FROM session WHERE parent_id = '$parent_id';" 2>/dev/null || echo "0"
}

count_assistant_messages() {
    local session_id="$1"
    sqlite3 "$OPENCODE_DB" "SELECT COUNT(*) FROM message WHERE session_id = '$session_id' AND json_extract(data, '$.role') = 'assistant';" 2>/dev/null || echo "0"
}

get_sub_sessions() {
    local parent_id="$1"
    sqlite3 "$OPENCODE_DB" "SELECT id, title FROM session WHERE parent_id = '$parent_id' ORDER BY time_created;" 2>/dev/null || true
}

# ───────────────────────────────────────────────────────────────
# Workflow Helpers
# ───────────────────────────────────────────────────────────────
get_workflow_status() {
    python3 -c "
import json, sys
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    if wfs:
        print(wfs[-1].get('status', 'none'))
    else:
        print('none')
except Exception:
    print('none')
" 2>/dev/null || echo "none"
}

get_workflow_json() {
    cat "$WORKFLOWS_FILE" 2>/dev/null || echo "[]"
}

workflow_has_status() {
    local want_status="$1"
    local status
    status=$(get_workflow_status)
    [[ "$status" == "$want_status" ]]
}

workflow_is_completed_or_chain_pending() {
    local status
    status=$(get_workflow_status)
    [[ "$status" == "completed" || "$status" == "chain_pending" ]]
}

count_workflows() {
    python3 -c "
import json, sys
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    print(len(wfs))
except Exception:
    print('0')
" 2>/dev/null || echo "0"
}

count_workflows_with_status() {
    local want_status="$1"
    python3 -c "
import json, sys
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    count = sum(1 for w in wfs if w.get('status') == '$want_status')
    print(count)
except Exception:
    print('0')
" 2>/dev/null || echo "0"
}

# Return true if all workflows are in a terminal state (not running/chain_pending)
all_workflows_terminal() {
    python3 -c "
import json, sys
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    non_terminal = [w for w in wfs if w.get('status') in ('running', 'chain_pending')]
    sys.exit(0 if len(non_terminal) == 0 else 1)
except Exception:
    sys.exit(0)
" 2>/dev/null
}

# Get the most recent workflow ID (last element = newest)
get_latest_workflow_id() {
    python3 -c "
import json, sys
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    if wfs:
        print(wfs[-1].get('workflowId', ''))
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null || echo ""
}

# Get the second most recent workflow ID (second-to-last = penultimate)
get_second_workflow_id() {
    python3 -c "
import json, sys
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    if len(wfs) >= 2:
        print(wfs[-2].get('workflowId', ''))
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null || echo ""
}
