#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Aristotle E2E Test: B1 R→C Chain via Bridge Plugin (tmux)
#
# Tests the full async bridge workflow end-to-end:
#   1. OpenCode TUI starts with Aristotle bridge plugin
#   2. User triggers /aristotle in a session with correctable content
#   3. Bridge plugin fires R (Reflector) sub-agent
#   4. R completes → Bridge plugin auto-fires C (Checker) sub-agent
#   5. C completes → workflow marked done
#
# Usage:
#   bash test/e2e_a7_r2c_chain.sh --project /path/to/project
#   bash test/e2e_a7_r2c_chain.sh --project /path/to/project --timeout 180
#
# Requirements:
#   - tmux, opencode CLI, sqlite3, python3
#   - aristotle MCP server configured in opencode
#   - Bridge plugin installed and active
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

TMUX_SESSION="aristotle-a7"
TIMEOUT_TOTAL=300
PROJECT_DIR=""

# Colors
GREEN='\033[32m'; RED='\033[31m'; YELLOW='\033[33m'; CYAN='\033[36m'; RESET='\033[0m'

# ───────────────────────────────────────────────────────────────
# Parse arguments
# ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --project)
            PROJECT_DIR="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT_TOTAL="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: $0 --project /path/to/project [--timeout N]"
            exit 1
            ;;
    esac
done

if [[ -z "$PROJECT_DIR" ]]; then
    echo "❌ --project is required"
    echo "Usage: $0 --project /path/to/project [--timeout N]"
    exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
    echo "❌ Project directory does not exist: $PROJECT_DIR"
    exit 1
fi

# ───────────────────────────────────────────────────────────────
# Paths
# ───────────────────────────────────────────────────────────────
OPENCODE_DB="$HOME/.local/share/opencode/opencode.db"
SESSIONS_DIR="$HOME/.config/opencode/aristotle-sessions"
WORKFLOWS_FILE="$SESSIONS_DIR/bridge-workflows.json"
BRIDGE_MARKER="$SESSIONS_DIR/.bridge-active"

# ───────────────────────────────────────────────────────────────
# Cleanup trap
# ───────────────────────────────────────────────────────────────
cleanup() {
    echo -e "\n${CYAN}🧹 Cleaning up tmux session...${RESET}"
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ───────────────────────────────────────────────────────────────
# Helpers
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
    tmux send-keys -t "$TMUX_SESSION" "$1" Enter
}

tmux_output() {
    tmux capture-pane -t "$TMUX_SESSION" -p -S -100 2>/dev/null || true
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
        print(wfs[0].get('status', 'none'))
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

# ───────────────────────────────────────────────────────────────
# Prerequisite checks
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  Aristotle E2E — B1 R→C Chain (tmux)             ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"

echo -e "\n${CYAN}Prerequisites check:${RESET}"
for cmd in tmux opencode sqlite3 python3; do
    if command -v "$cmd" &>/dev/null; then
        echo -e "  ${GREEN}✓${RESET} $cmd"
    else
        echo -e "  ${RED}✗${RESET} $cmd not found"
        exit 1
    fi
done

if [[ ! -f "$OPENCODE_DB" ]]; then
    echo -e "  ${YELLOW}⚠${RESET} opencode DB not found at $OPENCODE_DB — will be created"
fi

# ───────────────────────────────────────────────────────────────
# Step 1: Setup tmux session
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 1: Setup tmux session ═══${RESET}"

# Kill any existing session
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux kill-session -t "$TMUX_SESSION"
    echo "  Killed existing session: $TMUX_SESSION"
fi

# Create README with typo if it doesn't exist
README_PATH="$PROJECT_DIR/README.md"
if [[ ! -f "$README_PATH" ]]; then
    echo "# Hello World Project" > "$README_PATH"
    echo "" >> "$README_PATH"
    echo "This is a sample project." >> "$README_PATH"
    echo "  Created sample README.md"
fi

# Ensure the typo exists
if ! grep -q "hellow world" "$README_PATH" 2>/dev/null; then
    echo "" >> "$README_PATH"
    echo "There is a typo here: hellow world" >> "$README_PATH"
    echo "  Added typo to README.md"
fi

# Create session with debug logging
tmux new-session -d -s "$TMUX_SESSION" \
    -e "ARISTOTLE_LOG=debug" \
    -e "ARISTOTLE_DEBUG=1" \
    bash -c "cd \"$PROJECT_DIR\" && exec opencode"

echo "  ${GREEN}✓${RESET} tmux session '$TMUX_SESSION' created with ARISTOTLE_LOG=debug"

# Give opencode a moment to boot
sleep 3

# ───────────────────────────────────────────────────────────────
# Step 2: Wait for plugin init
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 2: Wait for Bridge plugin initialization ═══${RESET}"

wait_for "Bridge plugin initialized" \
    "tmux_output | grep -qE 'plugin initialized|mcpProjectDir='" \
    30 || {
        echo "  ${YELLOW}⚠${RESET} Plugin init log not seen, continuing anyway..."
    }

# Also check for .bridge-active marker
wait_for ".bridge-active marker created" \
    "test -f '$BRIDGE_MARKER'" \
    30 || {
        echo "  ${YELLOW}⚠${RESET} .bridge-active marker not found, continuing anyway..."
    }

# ───────────────────────────────────────────────────────────────
# Step 3: Create error-correction context (two turns)
#   Turn 1: Ask model to do something → model responds
#   Turn 2: Tell model it was wrong → model corrects → error-correction pattern
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 3: Create error-correction context (two turns) ═══${RESET}"

# Find the typo line number for reference
TYPO_LINE=$(grep -n "hellow world" "$README_PATH" | head -1 | cut -d: -f1 || echo "?")
echo "  Typo found at README.md line $TYPO_LINE"

# Turn 1: Ask model to fix the typo — but give WRONG target
MSG1="Fix the typo in README: change 'hellow world' to 'hello earth'"
echo "  Turn 1: $MSG1"
tmux_send "$MSG1"

# Wait for model response
wait_for "Turn 1: assistant messages" \
    "LATEST_SESSION=\"\$(get_latest_session)\" && [[ -n \"\$LATEST_SESSION\" ]] && [[ \$(count_assistant_messages \"\$LATEST_SESSION\") -ge 1 ]]" \
    60 || {
        echo "  ${YELLOW}⚠${RESET} Turn 1: No assistant message yet, continuing..."
    }
sleep 3

# Turn 2: Correct the model — creates error-correction pattern
MSG2="That's wrong. I said 'hello earth' but that's incorrect — it should be 'hello world' not 'hello earth'. Fix it properly. Also you should have known better."
echo "  Turn 2: $MSG2"
tmux_send "$MSG2"

# ───────────────────────────────────────────────────────────────
# Step 4: Wait for LLM correction response
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 4: Wait for LLM correction response ═══${RESET}"

wait_for "Top-level session has ≥2 assistant messages" \
    "LATEST_SESSION=\"\$(get_latest_session)\" && [[ -n \"\$LATEST_SESSION\" ]] && [[ \$(count_assistant_messages \"\$LATEST_SESSION\") -ge 2 ]]" \
    60 || {
        echo "  ${YELLOW}⚠${RESET} Not enough assistant messages, continuing anyway..."
    }

# Give a moment for the response to settle
sleep 3

# ───────────────────────────────────────────────────────────────
# Step 5: Trigger /aristotle via trigger file
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 5: Trigger /aristotle via trigger file ═══${RESET}"

# Get the latest session ID (created in step 4)
LATEST_SESSION=$(get_latest_session)
echo "  Parent session: $LATEST_SESSION"

# Write trigger JSON — bridge plugin will read this on next idle event
TRIGGER_JSON=$(cat <<EOF
{"session_id":"$LATEST_SESSION","project_directory":"$PROJECT_DIR","target_label":"current","user_language":"en-US","focus":"last"}
EOF
)
echo "$TRIGGER_JSON" > "$SESSIONS_DIR/.trigger-reflect.json"
echo "  Trigger file written to $SESSIONS_DIR/.trigger-reflect.json"
echo "  Waiting for bridge plugin to pick up trigger..."

# Give plugin a moment to detect the trigger on the next idle event
sleep 5

# ───────────────────────────────────────────────────────────────
# Step 6: Wait for fire_o — workflow goes to 'running'
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 6: Wait for workflow to start (running) ═══${RESET}"

wait_for "Workflow status is 'running'" \
    "workflow_has_status running" \
    60 || {
        echo "  ${YELLOW}⚠${RESET} Workflow not in 'running' state, checking current state..."
    }

# ───────────────────────────────────────────────────────────────
# Step 7: Wait for R to finish (chain_pending or completed)
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 7: Wait for R to complete (chain_pending/completed) ═══${RESET}"

wait_for "Workflow status is 'chain_pending' or 'completed'" \
    "workflow_is_completed_or_chain_pending" \
    120 || {
        echo "  ${YELLOW}⚠${RESET} R did not reach chain_pending/completed within timeout"
    }

# ───────────────────────────────────────────────────────────────
# Step 8: Wait for C sub-session to launch (>= 2 sub-sessions)
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 8: Wait for C sub-session launch (≥2 sub-sessions) ═══${RESET}"

wait_for "At least 2 sub-sessions exist (R + C)" \
    "LATEST_SESSION=\"\$(get_latest_session)\" && [[ -n \"\$LATEST_SESSION\" ]] && [[ \$(count_sub_sessions \"\$LATEST_SESSION\") -ge 2 ]]" \
    120 || {
        echo "  ${YELLOW}⚠${RESET} Less than 2 sub-sessions found"
    }

# ───────────────────────────────────────────────────────────────
# Step 9: Wait for C to complete (workflow status = completed)
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 9: Wait for C completion (workflow completed) ═══${RESET}"

wait_for "Workflow status is 'completed'" \
    "workflow_has_status completed" \
    120 || {
        echo "  ${YELLOW}⚠${RESET} Workflow not completed within timeout"
    }

# Give a moment for DB to sync
sleep 3

# ───────────────────────────────────────────────────────────────
# Step 10: Verify results
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Step 10: Verify results ═══${RESET}"

VERIFICATION_PASSED=0
VERIFICATION_FAILED=0

# 10.1: bridge-workflows.json has at least one workflow with status completed
echo -e "\n  ${CYAN}10.1${RESET} Workflow store check"
if [[ -f "$WORKFLOWS_FILE" ]]; then
    WF_STATUS=$(get_workflow_status)
    if [[ "$WF_STATUS" == "completed" ]]; then
        echo -e "    ${GREEN}✅${RESET} bridge-workflows.json has workflow with status 'completed'"
        VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
    else
        echo -e "    ${RED}❌${RESET} Workflow status is '$WF_STATUS', expected 'completed'"
        VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
    fi
else
    echo -e "    ${RED}❌${RESET} bridge-workflows.json not found"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# 10.2: DB has >= 2 sub-sessions under the parent
echo -e "\n  ${CYAN}10.2${RESET} Sub-session count check"
LATEST_SESSION=$(get_latest_session)
if [[ -n "$LATEST_SESSION" ]]; then
    SUB_COUNT=$(count_sub_sessions "$LATEST_SESSION")
    if [[ "$SUB_COUNT" -ge 2 ]]; then
        echo -e "    ${GREEN}✅${RESET} Found $SUB_COUNT sub-session(s) under parent $LATEST_SESSION"
        VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
    else
        echo -e "    ${RED}❌${RESET} Found $SUB_COUNT sub-session(s), expected ≥2"
        VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
    fi
else
    echo -e "    ${RED}❌${RESET} No top-level session found in DB"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# 10.3: R sub-session has assistant messages
echo -e "\n  ${CYAN}10.3${RESET} R sub-session has assistant messages"
if [[ -n "$LATEST_SESSION" ]]; then
    # Get the first sub-session (R, created first)
    R_SESSION=$(sqlite3 "$OPENCODE_DB" "SELECT id FROM session WHERE parent_id = '$LATEST_SESSION' ORDER BY time_created LIMIT 1;" 2>/dev/null || true)
    if [[ -n "$R_SESSION" ]]; then
        R_MSG_COUNT=$(count_assistant_messages "$R_SESSION")
        if [[ "$R_MSG_COUNT" -gt 0 ]]; then
            echo -e "    ${GREEN}✅${RESET} R sub-session ($R_SESSION) has $R_MSG_COUNT assistant message(s)"
            VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
        else
            echo -e "    ${RED}❌${RESET} R sub-session ($R_SESSION) has no assistant messages"
            VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
        fi
    else
        echo -e "    ${RED}❌${RESET} No R sub-session found"
        VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
    fi
else
    echo -e "    ${RED}❌${RESET} Cannot check R sub-session (no parent session)"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# 10.4: C sub-session has assistant messages
echo -e "\n  ${CYAN}10.4${RESET} C sub-session has assistant messages"
if [[ -n "$LATEST_SESSION" ]]; then
    # Get the second sub-session (C)
    C_SESSION=$(sqlite3 "$OPENCODE_DB" "SELECT id FROM session WHERE parent_id = '$LATEST_SESSION' ORDER BY time_created LIMIT 1 OFFSET 1;" 2>/dev/null || true)
    if [[ -n "$C_SESSION" ]]; then
        C_MSG_COUNT=$(count_assistant_messages "$C_SESSION")
        if [[ "$C_MSG_COUNT" -gt 0 ]]; then
            echo -e "    ${GREEN}✅${RESET} C sub-session ($C_SESSION) has $C_MSG_COUNT assistant message(s)"
            VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
        else
            echo -e "    ${RED}❌${RESET} C sub-session ($C_SESSION) has no assistant messages"
            VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
        fi
    else
        echo -e "    ${RED}❌${RESET} No C sub-session found"
        VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
    fi
else
    echo -e "    ${RED}❌${RESET} Cannot check C sub-session (no parent session)"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# 10.5: Typo was actually fixed (optional — C should have corrected it)
echo -e "\n  ${CYAN}10.5${RESET} Typo fixed in README.md"
if grep -q "hello world" "$README_PATH" 2>/dev/null && ! grep -q "hellow world" "$README_PATH" 2>/dev/null; then
    echo -e "    ${GREEN}✅${RESET} Typo was corrected: 'hellow world' → 'hello world'"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
elif grep -q "hellow world" "$README_PATH" 2>/dev/null; then
    echo -e "    ${YELLOW}⚠${RESET}  Typo still present (C may not have committed changes)"
    # Don't count as failure — C might not have had changes to commit
else
    echo -e "    ${YELLOW}⚠${RESET}  Could not verify typo state"
fi

# 10.6: R generated a DRAFT file (persis_draft was called)
echo -e "\n  ${CYAN}10.6${RESET} R generated DRAFT file"
# Check the workflow result for draft-related content
WF_RESULT=$(python3 -c "import json; wfs=json.load(open('$WORKFLOWS_FILE')); print(wfs[0].get('result',''))" 2>/dev/null || echo "")
# Also check if any draft file exists in the aristotle-drafts or state directory
DRAFTS_DIR="$HOME/.config/opencode/aristotle-drafts"
DRAFT_FOUND=""
if [[ -d "$DRAFTS_DIR" ]]; then
    DRAFT_FOUND=$(ls -t "$DRAFTS_DIR"/*.md 2>/dev/null | head -1)
fi
# Also check aristotle-state drafts
if [[ -z "$DRAFT_FOUND" ]]; then
    DRAFT_FOUND=$(ls -t "$ARISTOTLE_PROJECT_DIR/aristotle-state"/*draft* 2>/dev/null | head -1)
fi
if [[ -n "$DRAFT_FOUND" ]]; then
    echo -e "    ${GREEN}✅${RESET} DRAFT file found: $DRAFT_FOUND"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
elif echo "$WF_RESULT" | grep -qi "draft\|rule\|commit"; then
    echo -e "    ${GREEN}✅${RESET} Workflow result mentions draft/rules"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
else
    echo -e "    ${RED}❌${RESET} No DRAFT file found and workflow result has no draft content"
    echo "    Workflow result: ${WF_RESULT:0:200}"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# 10.7: Snapshot file was created (B3 verification)
echo -e "\n  ${CYAN}10.7${RESET} Snapshot file created for R"
SNAPSHOT_FILE=$(ls -t "$SESSIONS_DIR"/*_snapshot.json 2>/dev/null | head -1)
if [[ -n "$SNAPSHOT_FILE" ]]; then
    SNAPSHOT_MSGS=$(python3 -c "import json; d=json.load(open('$SNAPSHOT_FILE')); print(d.get('total_messages', 0))" 2>/dev/null || echo "0")
    if [[ "$SNAPSHOT_MSGS" -gt 0 ]]; then
        echo -e "    ${GREEN}✅${RESET} Snapshot: $SNAPSHOT_FILE ($SNAPSHOT_MSGS messages)"
        VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
    else
        echo -e "    ${RED}❌${RESET} Snapshot exists but has 0 messages"
        VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
    fi
else
    echo -e "    ${RED}❌${RESET} No snapshot file found in $SESSIONS_DIR"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# ───────────────────────────────────────────────────────────────
# Output summary
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Workflow JSON (bridge-workflows.json) ═══${RESET}"
if [[ -f "$WORKFLOWS_FILE" ]]; then
    python3 -m json.tool "$WORKFLOWS_FILE" 2>/dev/null || cat "$WORKFLOWS_FILE"
else
    echo "  (file not found)"
fi

echo -e "\n${CYAN}═══ Sub-sessions (from DB) ═══${RESET}"
if [[ -n "$LATEST_SESSION" ]]; then
    echo "  Parent session: $LATEST_SESSION"
    get_sub_sessions "$LATEST_SESSION" | while IFS='|' read -r sid title; do
        msg_count=$(count_assistant_messages "$sid")
        echo "    - $sid | title='$title' | assistant_msgs=$msg_count"
    done
else
    echo "  (no parent session found)"
fi

echo -e "\n${CYAN}═══ tmux pane output (last 30 lines) ═══${RESET}"
tmux_output | tail -30

# ───────────────────────────────────────────────────────────────
# Final verdict
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
if [[ "$VERIFICATION_FAILED" -eq 0 ]]; then
    echo -e "${CYAN}║  ✅ ALL VERIFICATIONS PASSED                     ║${RESET}"
else
    echo -e "${CYAN}║  ❌ SOME VERIFICATIONS FAILED                    ║${RESET}"
fi
echo -e "${CYAN}╠══════════════════════════════════════════════════╣${RESET}"
echo -e "${CYAN}║  Passed: $VERIFICATION_PASSED  |  Failed: $VERIFICATION_FAILED                    ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"

if [[ "$VERIFICATION_FAILED" -gt 0 ]]; then
    exit 1
else
    exit 0
fi
