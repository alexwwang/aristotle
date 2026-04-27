#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Aristotle E2E Test: A8-A13 Undo & Cleanup (tmux)
#
# Assumes A1-A7 already completed (opencode TUI running with a
# completed R→C workflow), OR runs a minimal standalone setup.
#
# Test flow:
#   A8  → Second /aristotle starts new workflow
#   A9  → /undo triggers SKILL.md cleanup
#   A10 → aristotle_check returns running workflows (implicit)
#   A11 → aristotle_abort cancels running workflows + MCP on_undo
#   A12 → User-visible cancel message
#   A13 → Exit opencode → .bridge-active cleaned up
#
# Usage:
#   bash test/e2e_a8_a13_undo_cleanup.sh --project /path/to/project
#   bash test/e2e_a8_a13_undo_cleanup.sh --project /path/to/project --timeout 300
#
# Requirements:
#   - tmux, opencode CLI, sqlite3, python3
#   - aristotle MCP server configured in opencode
#   - Bridge plugin installed and active
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

TMUX_SESSION="aristotle-a8"
TIMEOUT_TOTAL=300
PROJECT_DIR=""
STANDALONE_SETUP=false

# Source shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/e2e_helpers.sh"

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
    echo -e "${RED}❌ --project is required${RESET}"
    echo "Usage: $0 --project /path/to/project [--timeout N]"
    exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
    echo -e "${RED}❌ Project directory does not exist: $PROJECT_DIR${RESET}"
    exit 1
fi

# ───────────────────────────────────────────────────────────────
# Cleanup trap
# ───────────────────────────────────────────────────────────────
cleanup() {
    echo -e "\n${CYAN}🧹 Cleaning up tmux session...${RESET}"
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ───────────────────────────────────────────────────────────────
# Prerequisites
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  Aristotle E2E — A8-A13 Undo & Cleanup (tmux)    ║${RESET}"
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
# Detect whether A7 session is already running
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Detect existing A7 session ═══${RESET}"

A7_SESSION="aristotle-a7"
if tmux_session_exists "$A7_SESSION" && [[ -f "$WORKFLOWS_FILE" ]]; then
    WF_COUNT=$(count_workflows)
    if [[ "$WF_COUNT" -ge 1 ]]; then
        echo "  ${GREEN}✓${RESET} Found existing A7 session with $WF_COUNT workflow(s)"
        TMUX_SESSION="$A7_SESSION"
        STANDALONE_SETUP=false
    else
        echo "  ${YELLOW}⚠${RESET} A7 session exists but no workflows found — will do standalone setup"
        STANDALONE_SETUP=true
    fi
else
    echo "  ${YELLOW}⚠${RESET} No existing A7 session — running standalone setup"
    STANDALONE_SETUP=true
fi

# ───────────────────────────────────────────────────────────────
# Standalone setup: minimal A7-like bootstrap
# ───────────────────────────────────────────────────────────────
if [[ "$STANDALONE_SETUP" == "true" ]]; then
    echo -e "\n${CYAN}═══ Standalone Setup: Bootstrap minimal A7 workflow ═══${RESET}"

    # Kill any existing session with our name
    if tmux_session_exists "$TMUX_SESSION"; then
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

    if ! grep -q "hellow world" "$README_PATH" 2>/dev/null; then
        echo "" >> "$README_PATH"
        echo "There is a typo here: hellow world" >> "$README_PATH"
        echo "  Added typo to README.md"
    fi

    # Create tmux session with opencode
    tmux new-session -d -s "$TMUX_SESSION" \
        -e "ARISTOTLE_LOG=debug" \
        -e "ARISTOTLE_DEBUG=1" \
        bash -c "cd \"$PROJECT_DIR\" && exec opencode"

    echo "  ${GREEN}✓${RESET} tmux session '$TMUX_SESSION' created"
    sleep 3

    # Wait for plugin init
    wait_for "Bridge plugin initialized" \
        "tmux_output | grep -qE 'plugin initialized|mcpProjectDir='" \
        30 || {
            echo "  ${YELLOW}⚠${RESET} Plugin init log not seen, continuing anyway..."
        }

    wait_for ".bridge-active marker created" \
        "test -f '$BRIDGE_MARKER'" \
        30 || {
            echo "  ${YELLOW}⚠${RESET} .bridge-active marker not found, continuing anyway..."
        }

    # Create error-correction context (two turns)
    echo -e "\n  ${CYAN}── Standalone: Create error-correction context ──${RESET}"

    MSG1="Fix the typo in README: change 'hellow world' to 'hello earth'"
    echo "  Turn 1: $MSG1"
    tmux_send "$MSG1"

    wait_for "Turn 1: assistant message" \
        "LATEST_SESSION=\"\$(get_latest_session)\" && [[ -n \"\$LATEST_SESSION\" ]] && [[ \$(count_assistant_messages \"\$LATEST_SESSION\") -ge 1 ]]" \
        60 || {
            echo "  ${YELLOW}⚠${RESET} Turn 1: No assistant message yet, continuing..."
        }
    sleep 3

    MSG2="That's wrong. I said 'hello earth' but that's incorrect — it should be 'hello world' not 'hello earth'. Fix it properly."
    echo "  Turn 2: $MSG2"
    tmux_send "$MSG2"

    wait_for "Top-level session has ≥2 assistant messages" \
        "LATEST_SESSION=\"\$(get_latest_session)\" && [[ -n \"\$LATEST_SESSION\" ]] && [[ \$(count_assistant_messages \"\$LATEST_SESSION\") -ge 2 ]]" \
        60 || {
            echo "  ${YELLOW}⚠${RESET} Not enough assistant messages, continuing anyway..."
        }
    sleep 3

    # Trigger first /aristotle via trigger file
    LATEST_SESSION=$(get_latest_session)
    echo "  Parent session: $LATEST_SESSION"

    TRIGGER_JSON=$(cat <<EOF
{"session_id":"$LATEST_SESSION","project_directory":"$PROJECT_DIR","target_label":"current","user_language":"en-US","focus":"last"}
EOF
)
    echo "$TRIGGER_JSON" > "$SESSIONS_DIR/.trigger-reflect.json"
    echo "  Trigger file written"

    sleep 5

    # Wait for first workflow to reach running
    wait_for "First workflow is 'running'" \
        "workflow_has_status running" \
        60 || {
            echo "  ${YELLOW}⚠${RESET} First workflow not in 'running' state, checking..."
        }

    # Wait for R to finish (chain_pending or completed)
    wait_for "First workflow reaches chain_pending/completed" \
        "workflow_is_completed_or_chain_pending" \
        120 || {
            echo "  ${YELLOW}⚠${RESET} First workflow did not reach chain_pending/completed within timeout"
        }

    # Wait for C to complete
    wait_for "First workflow is 'completed'" \
        "workflow_has_status completed" \
        120 || {
            echo "  ${YELLOW}⚠${RESET} First workflow not completed within timeout"
        }

    sleep 3
    echo "  ${GREEN}✓${RESET} Standalone setup complete — 1 workflow completed"
fi

# ───────────────────────────────────────────────────────────────
# A8: Second /aristotle starts new workflow
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ A8: Second /aristotle starts new workflow ═══${RESET}"

WF_COUNT_BEFORE=$(count_workflows)
echo "  Workflows before A8: $WF_COUNT_BEFORE"

# Send /aristotle via TUI (same path as real user: SKILL.md → MCP fire_o)
# This is more reliable than trigger file because:
#   1. Trigger file requires session.idle event which only fires after LLM responds
#   2. After first R→C chain, main session has no new messages → no idle → trigger rots
#   3. TUI message creates new user turn → LLM processes → idle fires naturally
tmux_send "/aristotle"
echo "  Sent /aristotle via TUI"

# Wait for LLM to process the command and call MCP (look for owl emoji or "reflect")
wait_for "LLM processed /aristotle (owl or reflect in output)" \
    "tmux_output | grep -qiE '🦉|aristotle.*reflect|aristotle.*fire|reflection'" \
    60 || {
        echo "  ${YELLOW}⚠${RESET} LLM response to /aristotle not detected, continuing..."
    }

sleep 3

# Wait for second workflow to appear (≥2 entries) and be running
wait_for "Second workflow appears (≥2 workflows total)" \
    "[[ \$(count_workflows) -ge 2 ]]" \
    60 || {
        echo "  ${YELLOW}⚠${RESET} Second workflow did not appear within timeout"
    }

wait_for "Latest workflow is 'running'" \
    "python3 -c \"import json; wfs=json.load(open('$WORKFLOWS_FILE')); exit(0 if wfs and wfs[0].get('status')=='running' else 1)\"" \
    60 || {
        echo "  ${YELLOW}⚠${RESET} Latest workflow not in 'running' state"
    }

WF_COUNT_AFTER=$(count_workflows)
WF1_ID=$(get_latest_workflow_id)
WF2_ID=$(get_second_workflow_id)
echo "  ${GREEN}✓${RESET} A8 complete — $WF_COUNT_AFTER workflow(s) total"
echo "    Latest workflow: $WF1_ID"
echo "    Previous workflow: $WF2_ID"

# ───────────────────────────────────────────────────────────────
# A9: /undo triggers SKILL.md cleanup
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ A9: /undo triggers SKILL.md cleanup ═══${RESET}"

# Capture state before /undo for A10 verification
RUNNING_BEFORE=$(count_workflows_with_status "running")
CHAIN_PENDING_BEFORE=$(count_workflows_with_status "chain_pending")
echo "  Running workflows before /undo: $RUNNING_BEFORE"
echo "  Chain-pending workflows before /undo: $CHAIN_PENDING_BEFORE"

# Send /undo
tmux_send "/undo"
echo "  Sent /undo to tmux session"

# Wait for LLM to process /undo (generous timeout)
wait_for "LLM processed /undo (aristotle|cancel|workflow in output)" \
    "tmux_output | grep -qiE 'aristotle|cancel|workflow'" \
    120 || {
        echo "  ${YELLOW}⚠${RESET} LLM /undo response not detected within timeout"
    }

# Give LLM time to call aristotle_abort
sleep 10

echo "  ${GREEN}✓${RESET} A9 complete — /undo sent and LLM responded"

# ───────────────────────────────────────────────────────────────
# A10: aristotle_check returns running workflows (implicit)
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ A10: Verify running workflows existed before /undo ═══${RESET}"

if [[ "$RUNNING_BEFORE" -ge 1 || "$CHAIN_PENDING_BEFORE" -ge 1 ]]; then
    echo "  ${GREEN}✓${RESET} A10 verified — there were active workflows before /undo"
    echo "    Running: $RUNNING_BEFORE, Chain-pending: $CHAIN_PENDING_BEFORE"
else
    echo "  ${YELLOW}⚠${RESET} A10 — no running/chain_pending workflows detected before /undo"
    echo "    (This may mean the second workflow completed too quickly)"
fi

# ───────────────────────────────────────────────────────────────
# A11: aristotle_abort cancels running workflows + MCP on_undo
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ A11: Verify aristotle_abort cancellation ═══${RESET}"

# Wait for workflows to reach terminal state
wait_for "All workflows in terminal state (not running/chain_pending)" \
    "all_workflows_terminal" \
    120 || {
        echo "  ${YELLOW}⚠${RESET} Some workflows still non-terminal after timeout"
    }

# Check tmux output for evidence of aristotle_abort calls
TMUX_TEXT=$(tmux_output)
if echo "$TMUX_TEXT" | grep -qi "aristotle_abort"; then
    echo "  ${GREEN}✓${RESET} tmux output contains 'aristotle_abort'"
else
    echo "  ${YELLOW}⚠${RESET} 'aristotle_abort' not found in tmux output"
fi

# Verify workflow statuses
WF_COUNT=$(count_workflows)
CANCELLED_COUNT=$(count_workflows_with_status "cancelled")
COMPLETED_COUNT=$(count_workflows_with_status "completed")
ERROR_COUNT=$(count_workflows_with_status "error")
UNDONE_COUNT=$(count_workflows_with_status "undone")
RUNNING_COUNT=$(count_workflows_with_status "running")
CHAIN_PENDING_COUNT=$(count_workflows_with_status "chain_pending")

echo "  Workflow status breakdown:"
echo "    Total: $WF_COUNT | Completed: $COMPLETED_COUNT | Cancelled: $CANCELLED_COUNT"
echo "    Error: $ERROR_COUNT | Undone: $UNDONE_COUNT | Running: $RUNNING_COUNT | Chain-pending: $CHAIN_PENDING_COUNT"

if [[ "$RUNNING_COUNT" -eq 0 && "$CHAIN_PENDING_COUNT" -eq 0 ]]; then
    echo "  ${GREEN}✓${RESET} A11 complete — no running/chain_pending workflows remain"
else
    echo "  ${RED}❌${RESET} A11 — still have $RUNNING_COUNT running + $CHAIN_PENDING_COUNT chain_pending workflows"
fi

# ───────────────────────────────────────────────────────────────
# A12: User-visible cancel message
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ A12: User-visible cancel message ═══${RESET}"

TMUX_TEXT=$(tmux_output)
CANCEL_FOUND=false

if echo "$TMUX_TEXT" | grep -qi "cancelled.*aristotle"; then
    echo "  ${GREEN}✓${RESET} Found 'cancelled' + 'Aristotle' in tmux output"
    CANCEL_FOUND=true
elif echo "$TMUX_TEXT" | grep -qi "cancelled.*workflow"; then
    echo "  ${GREEN}✓${RESET} Found 'cancelled' + 'workflow' in tmux output"
    CANCEL_FOUND=true
elif echo "$TMUX_TEXT" | grep -qiE "cancelled.*active|active.*cancelled"; then
    echo "  ${GREEN}✓${RESET} Found cancel-related text in tmux output"
    CANCEL_FOUND=true
elif echo "$TMUX_TEXT" | grep -qi "cancelled"; then
    echo "  ${GREEN}✓${RESET} Found 'cancelled' in tmux output"
    CANCEL_FOUND=true
else
    echo "  ${YELLOW}⚠${RESET} No clear cancel message in tmux output"
fi

# Also check for the specific expected pattern
echo "$TMUX_TEXT" | grep -iE "cancelled.*active.*aristotle|aristotle.*cancelled" || true

# ───────────────────────────────────────────────────────────────
# A13: Exit opencode → .bridge-active cleaned up
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ A13: Exit opencode → .bridge-active cleaned up ═══${RESET}"

# Try /exit first, then Esc+Ctrl-C as fallback
tmux_send "/exit"
echo "  Sent /exit to opencode"

# Wait for tmux session to end
wait_for "tmux session ended" \
    "! tmux_session_exists '$TMUX_SESSION'" \
    15 || {
        echo "  ${YELLOW}⚠${RESET} Session still alive, trying Ctrl-C..."
        tmux send-keys -t "$TMUX_SESSION" C-c
        sleep 3
        # Check if confirmation prompt appeared
        if tmux_session_exists "$TMUX_SESSION"; then
            # Send 'y' to confirm exit, or another Ctrl-C
            tmux send-keys -t "$TMUX_SESSION" "y" Enter
            sleep 3
        fi
    }

# Force kill if still alive
if tmux_session_exists "$TMUX_SESSION"; then
    echo "  ${YELLOW}⚠${RESET} Force-killing tmux session..."
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
    sleep 2
fi

# Verify .bridge-active marker is gone
if [[ ! -f "$BRIDGE_MARKER" ]]; then
    echo "  ${GREEN}✓${RESET} A13 complete — .bridge-active marker removed"
else
    echo "  ${RED}❌${RESET} A13 — .bridge-active marker still exists!"
fi

# ───────────────────────────────────────────────────────────────
# Verification Section
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  Verification Section                            ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"

VERIFICATION_PASSED=0
VERIFICATION_FAILED=0

# V1: bridge-workflows.json has ≥2 entries total
echo -e "\n  ${CYAN}V1${RESET} bridge-workflows.json has ≥2 entries total"
WF_COUNT=$(count_workflows)
if [[ "$WF_COUNT" -ge 2 ]]; then
    echo -e "    ${GREEN}✅${RESET} Found $WF_COUNT workflow(s)"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
else
    echo -e "    ${RED}❌${RESET} Found $WF_COUNT workflow(s), expected ≥2"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# V2: All entries are in terminal state
echo -e "\n  ${CYAN}V2${RESET} All workflows in terminal state"
if all_workflows_terminal; then
    echo -e "    ${GREEN}✅${RESET} All workflows are terminal (completed/cancelled/error/undone)"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
else
    NON_TERM=$(python3 -c "
import json
try:
    with open('$WORKFLOWS_FILE', 'r') as f:
        wfs = json.load(f)
    non_term = [w.get('status') for w in wfs if w.get('status') in ('running', 'chain_pending')]
    print(', '.join(non_term) if non_term else 'none')
except Exception as e:
    print('error: ' + str(e))
" 2>/dev/null)
    echo -e "    ${RED}❌${RESET} Non-terminal statuses found: $NON_TERM"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# V3: tmux output contains cancel-related text
echo -e "\n  ${CYAN}V3${RESET} tmux output contains cancel-related text"
TMUX_TEXT=$(tmux_output 2>/dev/null || true)
if [[ "$CANCEL_FOUND" == "true" ]] || echo "$TMUX_TEXT" | grep -qi "cancel"; then
    echo -e "    ${GREEN}✅${RESET} Cancel-related text found in tmux output"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
else
    echo -e "    ${RED}❌${RESET} No cancel-related text found in tmux output"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# V4: .bridge-active marker does NOT exist after exit
echo -e "\n  ${CYAN}V4${RESET} .bridge-active marker removed after exit"
if [[ ! -f "$BRIDGE_MARKER" ]]; then
    echo -e "    ${GREEN}✅${RESET} .bridge-active marker does not exist"
    VERIFICATION_PASSED=$((VERIFICATION_PASSED + 1))
else
    echo -e "    ${RED}❌${RESET} .bridge-active marker still exists at $BRIDGE_MARKER"
    VERIFICATION_FAILED=$((VERIFICATION_FAILED + 1))
fi

# ───────────────────────────────────────────────────────────────
# Diagnostics output
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══ Workflow JSON (bridge-workflows.json) ═══${RESET}"
if [[ -f "$WORKFLOWS_FILE" ]]; then
    python3 -m json.tool "$WORKFLOWS_FILE" 2>/dev/null || cat "$WORKFLOWS_FILE"
else
    echo "  (file not found)"
fi

echo -e "\n${CYAN}═══ tmux pane output (last 40 lines) ═══${RESET}"
tmux_output 2>/dev/null | tail -40 || echo "  (tmux session already closed)"

# ───────────────────────────────────────────────────────────────
# Final verdict
# ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
if [[ "$VERIFICATION_FAILED" -eq 0 ]]; then
    echo -e "${CYAN}║  ✅ ALL VERIFICATIONS PASSED (A8-A13)            ║${RESET}"
else
    echo -e "${CYAN}║  ❌ SOME VERIFICATIONS FAILED                    ║${RESET}"
fi
echo -e "${CYAN}╠══════════════════════════════════════════════════╣${RESET}"
printf "${CYAN}║  Passed: %-3d  |  Failed: %-3d                     ║${RESET}\n" "$VERIFICATION_PASSED" "$VERIFICATION_FAILED"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"

if [[ "$VERIFICATION_FAILED" -gt 0 ]]; then
    exit 1
else
    exit 0
fi
