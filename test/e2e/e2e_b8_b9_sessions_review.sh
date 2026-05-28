#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Aristotle B8-B9 Test: sessions + review commands (tmux)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

TMUX_SESSION="aristotle-b8b9"
PROJECT_DIR=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/e2e_helpers.sh"

while [[ $# -gt 0 ]]; do
    case $1 in
        --project) PROJECT_DIR="$2"; shift 2 ;;
        *) echo "Usage: $0 --project /path"; exit 1 ;;
    esac
done

[[ -z "$PROJECT_DIR" ]] && { echo "--project required"; exit 1; }

cleanup() {
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
}
trap cleanup EXIT

echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  Aristotle B8-B9: sessions + review commands     ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"

# ── Standalone setup: create error context + trigger reflect ──
echo -e "\n${CYAN}═══ Setup: Create context and trigger reflection ═══${RESET}"

# Kill existing
if tmux_session_exists "$TMUX_SESSION"; then
    tmux kill-session -t "$TMUX_SESSION"
fi

README_PATH="$PROJECT_DIR/README.md"
if [[ ! -f "$README_PATH" ]]; then
    echo "# Hello World" > "$README_PATH"
fi
if ! grep -q "hellow world" "$README_PATH" 2>/dev/null; then
    echo "" >> "$README_PATH"
    echo "There is a typo here: hellow world" >> "$README_PATH"
fi

tmux new-session -d -s "$TMUX_SESSION" -e "ARISTOTLE_LOG=debug" bash -c "cd \"$PROJECT_DIR\" && exec opencode"
sleep 3

wait_for "Bridge plugin initialized" \
    "tmux_output | grep -qE 'plugin initialized|mcpProjectDir='" 30 || true

# Create error context
MSG1="Fix the typo: change 'hellow world' to 'hello earth'"
tmux_send "$MSG1"
wait_for "Turn 1 assistant message" \
    "LATEST_SESSION=\"\$(get_latest_session)\" && [[ -n \"\$LATEST_SESSION\" ]] && [[ \$(count_assistant_messages \"\$LATEST_SESSION\") -ge 1 ]]" 60 || true
sleep 2

MSG2="That's wrong. It should be 'hello world' not 'hello earth'."
tmux_send "$MSG2"
wait_for "Turn 2 assistant message" \
    "LATEST_SESSION=\"\$(get_latest_session)\" && [[ \$(count_assistant_messages \"\$LATEST_SESSION\") -ge 2 ]]" 60 || true
sleep 2

# Trigger reflection via trigger file
LATEST_SESSION=$(get_latest_session)
TRIGGER_JSON=$(cat <<EOF
{"session_id":"$LATEST_SESSION","project_directory":"$PROJECT_DIR","target_label":"current","user_language":"en-US","focus":"last"}
EOF
)
echo "$TRIGGER_JSON" > "$SESSIONS_DIR/.trigger-reflect.json"
echo "  Trigger file written"
tmux_send "ok"
sleep 5

# Wait for first workflow to complete
wait_for "First workflow completed" \
    "workflow_has_status completed" 180 || {
        echo "  ${YELLOW}⚠${RESET} Workflow not completed, checking status..."
        get_workflow_status
    }

echo "  ${GREEN}✓${RESET} Setup complete — reflection record should exist"
sleep 3

# ── B8: /aristotle sessions ──
echo -e "\n${CYAN}═══ B8: /aristotle sessions ═══${RESET}"

tmux_send "/aristotle sessions"
echo "  Sent /aristotle sessions"

# Wait for LLM to process and show output (look for "Reflection Records" or record list)
wait_for "Sessions output appears" \
    "tmux_output | grep -qiE 'Reflection Records|#[0-9]+.*rules'" 60 || {
        echo "  ${YELLOW}⚠${RESET} Sessions output not detected, checking tmux..."
    }

TMUX_TEXT=$(tmux_output)
if echo "$TMUX_TEXT" | grep -qi "Reflection Records"; then
    echo "  ${GREEN}✓${RESET} B8 — sessions list displayed"
    echo "$TMUX_TEXT" | grep -iE "Reflection Records|#[0-9]+" | tail -5
else
    echo "  ${YELLOW}⚠${RESET} B8 — 'Reflection Records' not found in output"
fi

sleep 3

# ── B9: /aristotle review 1 ──
echo -e "\n${CYAN}═══ B9: /aristotle review 1 ═══${RESET}"

tmux_send "/aristotle review 1"
echo "  Sent /aristotle review 1"

# Wait for review output
wait_for "Review output appears" \
    "tmux_output | grep -qiE 'review|reflection.*#1|rule|draft'" 60 || {
        echo "  ${YELLOW}⚠${RESET} Review output not detected"
    }

TMUX_TEXT=$(tmux_output)
if echo "$TMUX_TEXT" | grep -qiE "review|reflection|rule|draft"; then
    echo "  ${GREEN}✓${RESET} B9 — review content displayed"
else
    echo "  ${YELLOW}⚠${RESET} B9 — review content not found"
fi

# ── Check state file ──
echo -e "\n${CYAN}═══ State file verification ═══${RESET}"
STATE_FILE="$HOME/.config/opencode/aristotle-repo/../aristotle-state.json"
if [[ -f "$HOME/.config/opencode/aristotle-state.json" ]]; then
    RECORDS=$(python3 -c "import json; print(len(json.load(open('$HOME/.config/opencode/aristotle-state.json'))))")
    echo "  ${GREEN}✓${RESET} State file exists with $RECORDS record(s)"
else
    echo "  ${YELLOW}⚠${RESET} State file not found at expected path"
fi

echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  B8-B9 Test Complete                             ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"
