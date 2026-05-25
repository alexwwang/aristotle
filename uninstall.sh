#!/usr/bin/env bash
# uninstall.sh — Remove Aristotle installation
# Usage: bash uninstall.sh [-f]
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

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SKILL_DEST="$OPENCODE_CONFIG/skills/aristotle"
MCP_DEST="$OPENCODE_CONFIG/aristotle"
PLUGIN_DEST="$OPENCODE_CONFIG/aristotle-bridge"
LEARNINGS_FILE="$OPENCODE_CONFIG/aristotle-learnings.md"
CONFIG_FILE="$OPENCODE_CONFIG/aristotle-config.json"
STATE_FILE="$OPENCODE_CONFIG/aristotle-state.json"
REPO_DIR="$OPENCODE_CONFIG/aristotle-repo"
SESSIONS_DIR="$OPENCODE_CONFIG/aristotle-sessions"
DRAFTS_DIR="$OPENCODE_CONFIG/aristotle-drafts"

echo ""
echo "🦉 Aristotle Uninstall"
echo "══════════════════════════════════════════════════"
echo ""

FOUND=false
for path in "$SKILL_DEST" "$MCP_DEST" "$PLUGIN_DEST" "$LEARNINGS_FILE" \
          "$CONFIG_FILE" "$STATE_FILE" "$REPO_DIR" "$SESSIONS_DIR" "$DRAFTS_DIR"; do
  if [ -e "$path" ]; then
    FOUND=true
    break
  fi
done

if [ "$FOUND" = false ]; then
  echo "No Aristotle installation found."
  exit 0
fi

echo "The following will be REMOVED:"
[ -d "$SKILL_DEST" ] && echo "  • $SKILL_DEST"
[ -d "$MCP_DEST" ] && echo "  • $MCP_DEST"
[ -d "$PLUGIN_DEST" ] && echo "  • $PLUGIN_DEST"
[ -f "$LEARNINGS_FILE" ] && echo "  • $LEARNINGS_FILE"
[ -f "$CONFIG_FILE" ] && echo "  • $CONFIG_FILE"
[ -f "$STATE_FILE" ] && echo "  • $STATE_FILE"
[ -d "$REPO_DIR" ] && echo "  • $REPO_DIR"
[ -d "$SESSIONS_DIR" ] && echo "  • $SESSIONS_DIR"
[ -d "$DRAFTS_DIR" ] && echo "  • $DRAFTS_DIR"
echo ""

if [ "$FORCE" = false ]; then
  echo -e "${RED}⚠ This action cannot be undone!${NC}"
  read -p "Continue? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
  fi
fi
[ -d "$SKILL_DEST" ] && rm -rf "$SKILL_DEST" && echo "  ✓ Removed $SKILL_DEST"
[ -d "$MCP_DEST" ] && rm -rf "$MCP_DEST" && echo "  ✓ Removed $MCP_DEST"
[ -d "$PLUGIN_DEST" ] && rm -rf "$PLUGIN_DEST" && echo "  ✓ Removed $PLUGIN_DEST"
[ -f "$LEARNINGS_FILE" ] && rm -f "$LEARNINGS_FILE" && echo "  ✓ Removed $LEARNINGS_FILE"
[ -f "$CONFIG_FILE" ] && rm -f "$CONFIG_FILE" && echo "  ✓ Removed $CONFIG_FILE"
[ -f "$STATE_FILE" ] && rm -f "$STATE_FILE" && echo "  ✓ Removed $STATE_FILE"
[ -d "$REPO_DIR" ] && rm -rf "$REPO_DIR" && echo "  ✓ Removed $REPO_DIR"
[ -d "$SESSIONS_DIR" ] && rm -rf "$SESSIONS_DIR" && echo "  ✓ Removed $SESSIONS_DIR"
[ -d "$DRAFTS_DIR" ] && rm -rf "$DRAFTS_DIR" && echo "  ✓ Removed $DRAFTS_DIR"

echo ""
echo "══════════════════════════════════════════════════"
echo "Aristotle has been uninstalled."
echo ""
echo "Note: You may also want to remove the MCP config from opencode.json"
echo "      (delete the \"aristotle\" entry from the \"mcp\" section)"
