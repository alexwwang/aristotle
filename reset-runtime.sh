#!/usr/bin/env bash
# reset-runtime.sh — Reset Aristotle runtime state without removing rules
# Usage: bash reset-runtime.sh [-f]
#   -f, --force   Skip confirmation

set -euo pipefail

FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force) FORCE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

OPENCODE_CONFIG="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

SESSIONS_DIR="$OPENCODE_CONFIG/aristotle-sessions"
STATE_FILE="$OPENCODE_CONFIG/aristotle-state.json"
DRAFTS_DIR="$OPENCODE_CONFIG/aristotle-drafts"

echo ""
echo "🦉 Aristotle Runtime Reset"
echo "══════════════════════════════════════════════════"
echo ""

echo "This will clear:"
echo "  • Active workflows and bridge state"
echo "  • Session snapshots and trigger files"
echo "  • Reflection state file"
echo "  • DRAFT documents"
echo ""
echo "This will NOT touch:"
echo "  • Your rules (in aristotle-repo/)"
echo "  • Your learnings (aristotle-learnings.md)"
echo "  • Your config (aristotle-config.json)"
echo "  • Skill files, MCP server, or Plugin"
echo ""

if [ "$FORCE" = false ]; then
  read -p "Continue? [Y/n] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]] && [ -n "$REPLY" ]; then
    echo "Reset cancelled."
    exit 0
  fi
fi

REMOVED=0

if [ -f "$SESSIONS_DIR/bridge-workflows.json" ]; then
  rm -f "$SESSIONS_DIR/bridge-workflows.json"
  echo -e "  ${GREEN}✓${NC} Cleared bridge-workflows.json"
  REMOVED=$((REMOVED+1))
fi

if [ -f "$SESSIONS_DIR/.bridge-active" ]; then
  rm -f "$SESSIONS_DIR/.bridge-active"
  echo -e "  ${GREEN}✓${NC} Cleared .bridge-active marker"
  REMOVED=$((REMOVED+1))
fi

shopt -s nullglob
for f in "$SESSIONS_DIR"/*_snapshot.json; do
  [ -f "$f" ] && rm -f "$f" && echo -e "  ${GREEN}✓${NC} Removed snapshot: $(basename "$f")" && REMOVED=$((REMOVED+1))
done

for f in "$SESSIONS_DIR"/.trigger-*.json; do
  [ -f "$f" ] && rm -f "$f" && echo -e "  ${GREEN}✓${NC} Removed trigger: $(basename "$f")" && REMOVED=$((REMOVED+1))
done
shopt -u nullglob

if [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  echo -e "  ${GREEN}✓${NC} Cleared state file"
  REMOVED=$((REMOVED+1))
fi

if [ -d "$DRAFTS_DIR" ]; then
  rm -rf "$DRAFTS_DIR"
  echo -e "  ${GREEN}✓${NC} Cleared drafts directory"
  REMOVED=$((REMOVED+1))
fi

if [ "$REMOVED" -eq 0 ]; then
  echo "  No runtime state found — nothing to reset."
else
  echo ""
  echo -e "${GREEN}✓ Reset complete ($REMOVED items cleared).${NC}"
  echo ""
  echo "Your rules and learnings are preserved."
  echo "Restart OpenCode for changes to take effect."
fi
