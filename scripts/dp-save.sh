#!/usr/bin/env bash
# dp-save.sh — Sync design_plan/ between main worktree and local-assets worktree
# Usage:
#   dp-save.sh <commit message>    # main → local-assets (save)
#   dp-save.sh --restore           # local-assets → main (restore after rebase/etc)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE="$REPO_ROOT/../aristotle-local-assets"

if [ ! -d "$WORKTREE/.git" ] && [ ! -f "$WORKTREE/.git" ]; then
  echo "Error: worktree not found at $WORKTREE" >&2
  echo "Run: git worktree add ../aristotle-local-assets local-assets" >&2
  exit 1
fi

# --- Restore mode: local-assets → main ---
if [ "${1:-}" = "--restore" ]; then
  rsync -a "$WORKTREE/design_plan/" "$REPO_ROOT/design_plan/"
  echo "Restored design_plan/ from local-assets."
  exit 0
fi

# --- Save mode: main → local-assets ---
MSG="${1:-update design_plan $(date +%Y-%m-%d\ %H:%M)}"

if [ ! -d "$REPO_ROOT/design_plan" ]; then
  echo "Error: design_plan/ not found" >&2
  exit 1
fi

# Sync to worktree and commit
rsync -a --delete "$REPO_ROOT/design_plan/" "$WORKTREE/design_plan/"
git -C "$WORKTREE" add design_plan/

if git -C "$WORKTREE" diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git -C "$WORKTREE" commit -m "$MSG"
echo "Saved to local-assets: $MSG"
