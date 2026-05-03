#!/usr/bin/env bash
# dp-save.sh — Save design_plan/ changes to local-assets worktree
# Usage: dp-save.sh <commit message>
#   dp-save.sh "update: DP-001 review feedback"
#   dp-save.sh                  # uses default message with timestamp

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE="$REPO_ROOT/../aristotle-local-assets"
MSG="${1:-update design_plan $(date +%Y-%m-%d\ %H:%M)}"

if [ ! -d "$WORKTREE/.git" ] && [ ! -f "$WORKTREE/.git" ]; then
  echo "Error: worktree not found at $WORKTREE" >&2
  echo "Run: git worktree add ../aristotle-local-assets local-assets" >&2
  exit 1
fi

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
