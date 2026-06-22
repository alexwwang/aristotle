#!/usr/bin/env bash
# install.sh — Install Aristotle error reflection agent
# Usage: bash install.sh [options]
# Options:
#   -f, --force     Skip confirmation prompts (non-interactive)
#   -n, --dry-run   Show what would be installed without making changes
#   -h, --help      Show this help message

set -euo pipefail

# Parse arguments
FORCE=false
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force) FORCE=true; shift ;;
    -n|--dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: bash install.sh [options]"
      echo "Options:"
      echo "  -f, --force     Skip confirmation prompts"
      echo "  -n, --dry-run   Show what would be installed"
      echo "  -h, --help      Show help"
      echo ""
      echo "Environment:"
      echo "  DESTDIR=path    Install to custom directory instead of ~/.config/opencode/"
      echo "                  (Use for testing: DESTDIR=/tmp/test bash install.sh)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"

# OpenCode discovers skills via skills.paths in opencode.json (~/.config/opencode/skills/).
OPENCODE_CONFIG="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Destination paths
SKILL_DEST="$OPENCODE_CONFIG/skills/aristotle"
MCP_DEST="$OPENCODE_CONFIG/aristotle"
PLUGIN_DEST="$OPENCODE_CONFIG/aristotle-bridge"
LEARNINGS_FILE="$OPENCODE_CONFIG/aristotle-learnings.md"
CONFIG_FILE="$OPENCODE_CONFIG/aristotle-config.json"
SESSIONS_DIR="$OPENCODE_CONFIG/aristotle-sessions"

echo ""
echo "🦉 Aristotle — Error Reflection & Learning Agent"
echo "══════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════
# Step 0: Pre-flight checks
# ═══════════════════════════════════════════════════
echo -e "${BLUE}[0/10]${NC} Running pre-flight checks..."

ERRORS=0
WARNINGS=0

# Check Python version (need 3.10+)
PYTHON_OK=false
if command -v python3 &>/dev/null; then
  PYTHON_VERSION=$(python3 --version 2>&1 | sed 's/Python //')
  PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
  PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
  if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 10 ]; then
    echo -e "  ${GREEN}✓${NC} Python $PYTHON_VERSION"
    PYTHON_OK=true
  else
    echo -e "  ${YELLOW}⚠${NC} Python $PYTHON_VERSION (need ≥ 3.10)"
    ERRORS=$((ERRORS+1))
  fi
else
  echo -e "  ${YELLOW}✗${NC} Python 3 not found (need ≥ 3.10)"
  ERRORS=$((ERRORS+1))
fi

# Check uv
if command -v uv &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} uv $(uv --version 2>&1 | head -1)"
else
  echo -e "  ${YELLOW}⚠${NC} uv not found — MCP server install will be skipped"
  WARNINGS=$((WARNINGS+1))
fi

# Check bun (optional, for Plugin)
if command -v bun &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} bun $(bun --version 2>&1 | head -1)"
else
  echo -e "  ${YELLOW}⚠${NC} bun not found — Plugin build will be skipped"
  WARNINGS=$((WARNINGS+1))
fi

# Check if existing installation detected
EXISTING_INSTALL=false
if [ -d "$SKILL_DEST" ] || [ -d "$MCP_DEST" ] || [ -d "$PLUGIN_DEST" ]; then
  EXISTING_INSTALL=true
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo -e "${RED}✗ $ERRORS critical issue(s) found. Install aborted.${NC}"
  echo "  Please install the missing prerequisites and try again."
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  echo -e "  ${YELLOW}→${NC} $WARNINGS warning(s) — some features will be unavailable"
fi

# ═══════════════════════════════════════════════════
# Step 1: Interactive confirmation (if existing install)
# ═══════════════════════════════════════════════════
if [ "$EXISTING_INSTALL" = true ] && [ "$FORCE" = false ] && [ "$DRY_RUN" = false ]; then
  echo ""
  echo -e "${YELLOW}⚠ Existing Aristotle installation detected:${NC}"
  [ -d "$SKILL_DEST" ] && echo "  • $SKILL_DEST"
  [ -d "$MCP_DEST" ] && echo "  • $MCP_DEST"
  [ -d "$PLUGIN_DEST" ] && echo "  • $PLUGIN_DEST"
  echo ""
  echo "The installer will BACK UP existing files, then OVERWRITE them."
  echo "Your learnings, config, and rule repository will be PRESERVED."
  echo ""
  read -p "Continue? [Y/n] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]] && [ -n "$REPLY" ]; then
    echo -e "${YELLOW}Install cancelled by user.${NC}"
    exit 0
  fi
fi

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${BLUE}━━ DRY RUN MODE ━━${NC}"
  echo "The following would be installed (no changes made):"
  echo "  • Skill:        $SKILL_DEST/SKILL.md"
  echo "  • MCP Server:   $MCP_DEST/ (aristotle_mcp/, protocol docs, pyproject.toml)"
  echo "  • Plugin:       $PLUGIN_DEST/index.js (if bun available)"
  echo "  • Config:       $CONFIG_FILE (if not exists)"
  echo "  • Learnings:    $LEARNINGS_FILE (if not exists)"
  echo "  • Repo:         $OPENCODE_CONFIG/aristotle-repo/ (via init_repo)"
  exit 0
fi

# ═══════════════════════════════════════════════════
# Step 2: Backup existing installation
# ═══════════════════════════════════════════════════
BACKUP_DIR="$OPENCODE_CONFIG/aristotle-backup-$(date +%Y%m%d_%H%M%S)"
BACKUP_CREATED=false

if [ "$EXISTING_INSTALL" = true ]; then
  echo -e "${BLUE}[2/10]${NC} Backing up existing installation to $BACKUP_DIR..."
  mkdir -p "$BACKUP_DIR"

  if [ -d "$SKILL_DEST" ]; then
    cp -r "$SKILL_DEST" "$BACKUP_DIR/skills-aristotle"
    echo -e "  ${GREEN}✓${NC} Backed up skill files"
  fi

  if [ -d "$MCP_DEST" ]; then
    cp -r "$MCP_DEST" "$BACKUP_DIR/aristotle-mcp"
    echo -e "  ${GREEN}✓${NC} Backed up MCP server"
  fi

  if [ -d "$PLUGIN_DEST" ]; then
    cp -r "$PLUGIN_DEST" "$BACKUP_DIR/aristotle-bridge"
    echo -e "  ${GREEN}✓${NC} Backed up plugin"
  fi

  if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$BACKUP_DIR/aristotle-config.json"
    echo -e "  ${GREEN}✓${NC} Backed up config"
  fi

  BACKUP_CREATED=true
  echo -e "${GREEN}✓${NC} Backup complete."
else
  echo -e "${BLUE}[2/10]${NC} No existing installation found — fresh install."
fi

# ═══════════════════════════════════════════════════
# Step 3: Install skill files (SKILL.md + docs)
# ═══════════════════════════════════════════════════
echo -e "${BLUE}[3/10]${NC} Installing Aristotle skill to $SKILL_DEST..."

mkdir -p "$SKILL_DEST"
cp "$SKILL_SRC/skill/SKILL.md" "$SKILL_DEST/SKILL.md"

# Protocol files go to MCP dir (SKILL_DIR resolves to MCP install dir at runtime)
mkdir -p "$MCP_DEST"
cp "$SKILL_SRC/skill/REFLECTOR.md" "$MCP_DEST/REFLECTOR.md"
cp "$SKILL_SRC/skill/REFLECT.md" "$MCP_DEST/REFLECT.md"
cp "$SKILL_SRC/skill/REVIEW.md" "$MCP_DEST/REVIEW.md"
cp "$SKILL_SRC/skill/CHECKER.md" "$MCP_DEST/CHECKER.md"
cp "$SKILL_SRC/skill/LEARN.md" "$MCP_DEST/LEARN.md"
echo -e "${GREEN}✓${NC} Skill files installed."

# ═══════════════════════════════════════════════════
# Step 4: Deploy MCP server files
# ═══════════════════════════════════════════════════
echo -e "${BLUE}[4/10]${NC} Deploying MCP server to $MCP_DEST..."

mkdir -p "$MCP_DEST/aristotle_mcp"
cp -r "$SKILL_SRC/aristotle_mcp/"* "$MCP_DEST/aristotle_mcp/"
rm -rf "$MCP_DEST/aristotle_mcp/__pycache__"
cp "$SKILL_SRC/pyproject.toml" "$MCP_DEST/pyproject.toml"
cp "$SKILL_SRC/uv.lock" "$MCP_DEST/uv.lock"
cd "$MCP_DEST" && uv sync
echo -e "${GREEN}✓${NC} MCP server deployed."

# ═══════════════════════════════════════════════════
# Step 5: Detect and optionally install tdd-pipeline skill
# ═══════════════════════════════════════════════════
echo -e "${BLUE}[5/10]${NC} Checking for tdd-pipeline skill..."
TDD_DEST="${TDD_DEST:-"$OPENCODE_CONFIG/skills/tdd-pipeline"}"

if [ -d "$TDD_DEST" ]; then
  echo -e "${GREEN}✓${NC} tdd-pipeline skill detected."
else
  echo -e "${YELLOW}⚠${NC} tdd-pipeline skill not detected."
  echo "The tdd-pipeline skill provides a 7-phase TDD development workflow (Product Design → Technical Solution → Test Plan → Test Code → Business Code → Pre-Release Testing → Acceptance Testing). Aristotle's Watchdog-Intervention Bridge integrates with it to enforce Red-Green-Refactor discipline at each phase boundary."

  if [ "$FORCE" = true ]; then
    echo "⏭ Skipping tdd-pipeline skill (non-interactive mode). You can install it later via skills.urls in opencode.json."
  else
    read -r -p "Install tdd-pipeline skill now? [y/N] " reply
    if [[ "$reply" =~ ^[Yy]$ ]]; then
      mkdir -p "$TDD_DEST"
      TDD_URL="https://raw.githubusercontent.com/opencode-ai/opencode/main/skills/tdd-pipeline"
      TDD_DOWNLOADED=0

      for file in SKILL.md phase-1.md phase-2.md phase-3.md phase-4.md phase-5.md phase-6.md phase-7.md ralph-review-loop.md dual-pass-review.md; do
        if curl -sL --fail --connect-timeout 10 "$TDD_URL/$file" -o "$TDD_DEST/$file" 2>/dev/null; then
          TDD_DOWNLOADED=$((TDD_DOWNLOADED+1))
        else
          echo -e "${YELLOW}⚠${NC} Failed to download $file"
        fi
      done

      if [ -f "$TDD_DEST/SKILL.md" ]; then
        echo -e "${GREEN}✓${NC} tdd-pipeline skill installed ($TDD_DOWNLOADED files downloaded)."
      else
        echo -e "${RED}✗${NC} tdd-pipeline skill installation failed — SKILL.md not found."
      fi
    else
      echo "⏭ Skipping tdd-pipeline skill. You can install it later via skills.urls in opencode.json."
    fi
  fi
fi

# ═══════════════════════════════════════════════════
# Step 6: Initialize the learnings file
# ═══════════════════════════════════════════════════
if [ ! -f "$LEARNINGS_FILE" ]; then
  echo -e "${BLUE}[6/10]${NC} Initializing learnings file at $LEARNINGS_FILE..."
  cat > "$LEARNINGS_FILE" << 'LEARNINGS_INIT'
# Aristotle Learnings (User-Level)

<!-- Auto-generated by Aristotle. Append-only. Do not reorganize. -->
<!-- Rules written here apply across ALL projects. -->

LEARNINGS_INIT
  echo -e "${GREEN}✓${NC} Learnings file created."
else
  echo -e "${BLUE}[6/10]${NC} Learnings file already exists at $LEARNINGS_FILE — preserving."
fi

# ═══════════════════════════════════════════════════
# Step 7: Verify installation
# ═══════════════════════════════════════════════════
echo -e "${BLUE}[7/10]${NC} Verifying installation..."

VERIFY_ERRORS=0

for file in "$SKILL_DEST/SKILL.md" "$MCP_DEST/REFLECTOR.md" "$MCP_DEST/REFLECT.md" \
            "$MCP_DEST/REVIEW.md" "$MCP_DEST/CHECKER.md" "$MCP_DEST/LEARN.md" \
            "$MCP_DEST/pyproject.toml" "$MCP_DEST/uv.lock"; do
  if [ ! -f "$file" ]; then
    echo -e "  ${YELLOW}✗${NC} Missing: $file"
    VERIFY_ERRORS=$((VERIFY_ERRORS+1))
  fi
done

if [ ! -d "$MCP_DEST/aristotle_mcp" ]; then
  echo -e "  ${YELLOW}✗${NC} Missing: $MCP_DEST/aristotle_mcp/"
  VERIFY_ERRORS=$((VERIFY_ERRORS+1))
fi

if [ ! -f "$LEARNINGS_FILE" ]; then
  echo -e "  ${YELLOW}✗${NC} Missing: $LEARNINGS_FILE"
  VERIFY_ERRORS=$((VERIFY_ERRORS+1))
fi

if [ "$VERIFY_ERRORS" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} All files verified."
else
  echo -e "${YELLOW}⚠${NC} $VERIFY_ERRORS issues found. Check the paths above."
fi

# ═══════════════════════════════════════════════════
# Step 8: Build and deploy Plugin (Phase D: new architecture)
# ═══════════════════════════════════════════════════
PLUGIN_SRC="$SKILL_SRC/plugin"
if [ -d "$PLUGIN_SRC" ] && command -v bun &>/dev/null; then
  echo -e "${BLUE}[8/10]${NC} Building Plugin..."
  cd "$SKILL_SRC" && bun install \
    && bun run --filter '@opencode-ai/core' build \
    && bun run --filter '@opencode-ai/reflection' build \
    && cd "$PLUGIN_SRC" && bun run build
  if [ -f "$PLUGIN_SRC/dist/index.js" ]; then
    mkdir -p "$PLUGIN_DEST"
    cp "$PLUGIN_SRC/dist/index.js" "$PLUGIN_DEST/index.js"
    echo -e "${GREEN}✓${NC} Plugin deployed to $PLUGIN_DEST"
  else
    echo -e "${YELLOW}⚠${NC} Plugin build failed — skipping deployment. Check bun output above."
  fi
elif [ -d "$PLUGIN_SRC" ]; then
  echo -e "${YELLOW}[8/10]${NC} Skipping Plugin (bun not found). Install bun to enable async reflection."
else
  echo -e "${BLUE}[8/10]${NC} Skipping Plugin (source not found)."
fi

# ═══════════════════════════════════════════════════
# Step 9: Write configuration file
# ═══════════════════════════════════════════════════
if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${BLUE}[9/10]${NC} Writing configuration to $CONFIG_FILE..."
  cat > "$CONFIG_FILE" << EOF
{
  "mcp_dir": "$MCP_DEST",
  "sessions_dir": "$SESSIONS_DIR"
}
EOF
  echo -e "${GREEN}✓${NC} Configuration written."
else
  echo -e "${BLUE}[9/10]${NC} Configuration already exists at $CONFIG_FILE — preserving."
fi

# ═══════════════════════════════════════════════════
# Step 10: Initialize the aristotle-repo
# ═══════════════════════════════════════════════════
echo -e "${BLUE}[10/10]${NC} Initializing rule repository..."
if command -v uv &>/dev/null; then
  uv run --project "$MCP_DEST" python -c "from aristotle_mcp.server import init_repo_tool; print(init_repo_tool())"
  echo -e "${GREEN}✓${NC} Rule repository initialized."
else
  echo -e "${YELLOW}⚠${NC} 'uv' not found — skipping rule repository initialization."
  echo -e "${YELLOW}  Install uv (https://docs.astral.sh/uv/) then run:${NC}"
  echo -e "${YELLOW}  uv run --project \"$MCP_DEST\" python -c \"from aristotle_mcp.server import init_repo_tool; print(init_repo_tool())\"${NC}"
fi

# ═══════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════"
echo -e "${GREEN}🦉 Aristotle installed successfully!${NC}"
echo ""

if [ "$BACKUP_CREATED" = true ]; then
  echo -e "${BLUE}Backup location:${NC} $BACKUP_DIR"
  echo ""
fi

echo "Usage:"
echo "  • Type /aristotle in any OpenCode session to reflect on errors"
echo "  • When error-correction patterns are detected, the AI will suggest running /aristotle"
echo "  • Learnings are written to $LEARNINGS_FILE"
echo "  • Project-level learnings go to .opencode/aristotle-project-learnings.md"
echo ""
echo "Management:"
echo "  • Uninstall:   bash uninstall.sh"
echo "  • Reset state: bash reset-runtime.sh"
echo "  • Verify:      bash test.sh"
echo ""
echo "To rollback (if something breaks):"
echo "  bash uninstall.sh && cp -r $BACKUP_DIR/* ~/.config/opencode/"
echo ""
