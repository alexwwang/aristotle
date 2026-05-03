#!/usr/bin/env bash
# dp-save.sh — Save design_plan/ changes to local-assets branch
# Usage: dp-save.sh <commit message>
#   dp-save.sh "update: DP-001 review feedback"
#   dp-save.sh                  # uses default message with timestamp

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
MSG="${1:-update design_plan $(date +%Y-%m-%d\ %H:%M)}"
TMP_DIR=$(mktemp -d)

restore_and_exit() {
  git -C "$REPO_ROOT" checkout main
  git -C "$REPO_ROOT" checkout local-assets -- design_plan/
  rm -rf "$TMP_DIR"
  exit "${1:-0}"
}
trap 'restore_and_exit 1' ERR

if [ "$BRANCH" != "main" ]; then
  echo "Error: must run from main branch, current: $BRANCH" >&2
  exit 1
fi

if [ ! -d "$REPO_ROOT/design_plan" ]; then
  echo "Error: design_plan/ not found" >&2
  exit 1
fi

# 1. Snapshot current design_plan/ to temp
rsync -a "$REPO_ROOT/design_plan/" "$TMP_DIR/design_plan/"

# 2. Switch to local-assets, overlay snapshot
git -C "$REPO_ROOT" checkout local-assets
rsync -a --delete "$TMP_DIR/design_plan/" "$REPO_ROOT/design_plan/"
git -C "$REPO_ROOT" add design_plan/

if git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "No changes to commit."
  restore_and_exit 0
fi

git -C "$REPO_ROOT" commit -m "$MSG"

# 3. Back to main, restore design_plan/ from local-assets
restore_and_exit 0

echo "Saved to local-assets: $MSG"
