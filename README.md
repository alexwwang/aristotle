# Aristotle 🦉

[![CI](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alexwwang/aristotle?include_prereleases)](https://github.com/alexwwang/aristotle/releases)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-318%20pytest%20%2B%20100%20vitest%20%2B%20104%20static-brightgreen)](./TESTING.md)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19660780.svg)](https://doi.org/10.5281/zenodo.19660780)

English | [中文](./README.zh-CN.md)

> *Knowing yourself is the beginning of all wisdom.* — Aristotle

**Aristotle** is an [OpenCode](https://github.com/opencode-ai/opencode) skill — an error reflection and learning agent.

Activate with `/aristotle` to spawn an isolated subagent that analyzes your session for model mistakes, performs 5-Why root-cause analysis, and generates DRAFT rules. You review, confirm, or revise before anything is written to disk.

## Features

- **Progressive Disclosure Architecture** — Skill loads only what's needed: router (60 lines) → reflect (106 lines) → review (156 lines). Each phase loads on demand, never wasting context.
- **Isolated Reflection** — Analysis runs in a separate background session; main session context is never polluted
- **5-Why Root-Cause Analysis** — Structured error categorization across 8 categories (MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR)
- **DRAFT → Review → Confirm Workflow** — Rules are generated as DRAFTs with location metadata; user reviews in a dedicated session via `/aristotle review N`, confirms, revises, or rejects
- **Precise Error Location** — `--focus` parameter targets specific parts of a session (last exchange, around message N, after a keyword, error-only scan, or full scan)
- **Re-Reflection** — During review, user can request deeper analysis on a specific error. DRAFT metadata (session ID, message range, error excerpts) enables precise targeting without re-scanning the entire session.
- **State Tracking** — `~/.config/opencode/aristotle-state.json` tracks all reflections with status (draft → confirmed → revised), enabling `/aristotle sessions` to list and manage history
- **Bilingual** — Detects error-correction patterns in English and Chinese (zh-CN)
- **Two-Tier Output** — User-level rules (`~/.config/opencode/aristotle-learnings.md`) apply globally; project-level rules (`.opencode/aristotle-project-learnings.md`) apply per-project
- **Auto-Suggestion** — Skill description includes error-correction keywords; when detected in conversation, the AI can suggest running `/aristotle` (automatic, no configuration needed)
- **Bridge Plugin (optional)** — Async polling-based reflection for environments without OMO support. Captures error context via PRE-RESOLVE snapshot extraction, runs Reflector in background, signals completion via idle detection. Supports `/undo` to cancel in-flight reflections.

## Installation

Aristotle has three components, all installed from the same repo:

1. **Skill** — Protocol files loaded by OpenCode (`SKILL.md`, `REFLECT.md`, etc.)
2. **MCP Server** — Python-based Git-backed rule management (`aristotle_mcp/`)
3. **Bridge Plugin** (optional) — TypeScript-based async reflection for environments without OMO support (`plugins/aristotle-bridge/`). Only needed if you want polling-based background reflection.

### Option 1: Manual Install (macOS / Linux)

```bash
# 1. Clone the repo
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
cd ~/.claude/skills/aristotle

# 2. Run the installer (initializes learnings file)
bash install.sh

# 3. Install MCP server dependencies
uv sync

# 4. (Optional) Install Bridge Plugin dependencies
cd plugins/aristotle-bridge && bun install && cd ../..

# 5. Add MCP config to opencode.json
# See "MCP Configuration" section below for the JSON snippet
```

### Option 2: Manual Install (Windows)

```powershell
# 1. Clone the repo
git clone https://github.com/alexwwang/aristotle.git "$env:USERPROFILE\.claude\skills\aristotle"

# 2. Run the installer
cd "$env:USERPROFILE\.claude\skills\aristotle"
powershell -ExecutionPolicy Bypass -File install.ps1

# 3. Install MCP server dependencies
uv sync

# 4. (Optional) Install Bridge Plugin dependencies
cd plugins/aristotle-bridge; bun install; cd ..\..

# 5. Add MCP config to opencode.json
# See "MCP Configuration" section below for the JSON snippet
```

### Option 3: One-Line Clone (skill only, no MCP)

OpenCode auto-discovers skills from `~/.claude/skills/`. Just clone and it's ready:

```bash
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

> **Note:** This gives you the basic skill without MCP server. You won't get Git version control, Δ audit decisions, or rule status management. Run `uv sync` and add the MCP config (see below) to enable the full feature set. The learnings file will be auto-created on first run.

### Option 4: Self-Guided Install (paste into OpenCode)

Copy and paste this prompt into any OpenCode session — it will install Aristotle for you:

```
Install the Aristotle skill with MCP server from https://github.com/alexwwang/aristotle.git:
1. Clone to ~/.claude/skills/aristotle
2. cd into the cloned directory, run `bash install.sh` (macOS/Linux) or `powershell -File install.ps1` (Windows)
3. Run `uv sync` to install Python dependencies for the MCP server
4. (Optional) Run `cd plugins/aristotle-bridge && bun install` to enable the Bridge Plugin for async reflection
5. Verify: run `bash test.sh` — all assertions must pass
6. Add MCP config to opencode.json: { "mcp": { "aristotle": { "type": "local", "command": ["uv", "run", "--project", "~/.claude/skills/aristotle", "python", "-m", "aristotle_mcp.server"], "enabled": true } } }
7. Verify MCP: run `uv run python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools), 'tools loaded')"` — should print "20 tools loaded"
```

> **Tip:** You can also install the skill via `opencode.json` without cloning manually. Add the repo URL to `skills.urls`:
> ```jsonc
> {
>   "skills": {
>     "urls": ["https://github.com/alexwwang/aristotle.git"]
>   }
> }
> ```
> Then restart OpenCode. The skill will be fetched automatically. You still need to run `uv sync` and add the MCP config separately.

### MCP Configuration

Add this to your `opencode.json` to enable the MCP server:

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "~/.claude/skills/aristotle", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

Or with absolute path:

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "/path/to/aristotle", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

Customize the rule repo location with the `ARISTOTLE_REPO_DIR` environment variable (default: `~/.config/opencode/aristotle-repo/`).

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/aristotle` | Reflect on the **current** session (focus on last exchange) |
| `/aristotle last` | Reflect on the **previous** session (see Target Resolution below) |
| `/aristotle session ses_xxx` | Reflect on a specific session by **OpenCode session ID** |
| `/aristotle recent N` | Reflect on the **Nth** most recent session (N=1 is most recent, not current) |
| `/aristotle --focus <hint>` | Target a specific area (see Focus Options below) |
| `/aristotle --model <model>` | Override model for the Reflector |
| `/aristotle sessions` | List all reflection records with status and sequence numbers |
| `/aristotle review N` | Load DRAFT **#N** into current session for review (N is sequence number from `sessions`) |

### Target Resolution

Aristotle uses `session_list` to resolve session targets. The rules are:

| Target | How It's Resolved |
|--------|-------------------|
| *(none)* | Current session — the session where `/aristotle` is running |
| `last` | The session immediately before the current one in `session_list` output, regardless of whether it's "open" or "closed". OpenCode sessions don't have a completed/closed state — they're ordered by last activity time. |
| `session ses_xxx` | Direct lookup by OpenCode session ID (format: `ses_` prefix + alphanumeric). This is the **target session's ID** (the session containing the errors), not the Reflector's session ID. |
| `recent N` | The Nth entry from `session_list`, excluding the current session. `recent 1` = the session right before current, `recent 3` = the 3rd most recent. Fires **one** Reflector for that single session. |

> **Note:** If you have multiple OpenCode instances open, all sessions appear in `session_list` sorted by last activity time. `last` and `recent N` simply pick from this list — they don't skip "open" sessions. If you want to reflect on a specific session regardless of ordering, use `session <id>`.

### Focus Options

Limit the Reflector's scan range within the target session:

| Focus Hint | Behavior |
|------------|----------|
| `last` (default) | Last 50 messages in the target session |
| `after "text"` | From first occurrence of "text" to end of session |
| `around N` | Messages N-10 to N+10 (20-message window) |
| `error` | Scan entire session, but only extract error-correction patterns (skip clean sections) |
| `full` | Scan entire session (useful for short sessions or comprehensive review) |

### Review Workflow

1. **List reflections**: `/aristotle sessions` → shows numbered list with status
2. **Pick one**: `/aristotle review 2` → loads DRAFT #2 into current session
3. **Decide**: `confirm` / `revise 1: feedback` / `reject` / `re-reflect`
4. **Iterate**: repeat for other reflections, or request re-reflection with deeper analysis

> The sequence number (`N`) in `/aristotle review N` comes from the `#` column in `/aristotle sessions` output. It's **not** an OpenCode session ID — it's the position in the reflection records list.

```
Reflect Phase                    Review Phase
─────────────                    ────────────
/aristotle                       /aristotle review 1
  │                                │
  ├─ Load REFLECT.md               ├─ Load REVIEW.md
  │  (106 lines)                   │  (156 lines)
  │                                │
  ├─ Fire Reflector ──────►        ├─ Read Reflector session
  │  (background task)      DRAFT   │  Extract DRAFT report
  │                         ──────► │
  ├─ Update state file              ├─ Present DRAFT to user
  ├─ One-line notification          ├─ Handle confirm/revise/reject
  └─ STOP                          ├─ Write rules on confirm
                                   └─ Re-reflect if requested
                                      (loads REFLECT.md)
```

## Aristotle MCP Server

Aristotle ships with an optional MCP (Model Context Protocol) server that adds **Git-backed version control** to your learning rules. Without it, rules are flat Markdown files with no history, no rollback, and no cross-machine sync. With it, every rule gets YAML frontmatter, status tracking, and full git history.

### Why Git?

The flat `aristotle-learnings.md` is append-only. No versioning. If a rule turns out to be wrong, your only option is to delete it manually and hope you remember what it said. The MCP server fixes this:

- **Status lifecycle** — Rules flow through `pending → staging → verified` (or `rejected`). Nothing lands in "production" without an explicit commit.
- **Atomic reads** — Consumers (future Agent L) read via `git show HEAD:`, never touching half-written drafts on disk.
- **Self-healing** — If a file exists physically but wasn't committed, the system detects the gap and re-triggers the commit pipeline.
- **Rejected rules are recoverable** — Rejected files move to `rejected/{scope}/` with their original metadata intact, ready to be restored.

### Architecture

```
┌──────────────────────────────────────────────────┐
│  OpenCode (Host)                                  │
│                                                   │
│  ┌───────────┐     MCP (stdio)    ┌────────────┐ │
│  │ Aristotle  │ ◄──────────────► │ aristotle   │ │
│  │ Skill      │    JSON-RPC       │ -mcp        │ │
│  └───────────┘                   └──────┬─────┘ │
│                                         │        │
│                              ┌──────────▼──────┐ │
│                              │ Git Repository   │ │
│                              │                  │ │
│                              │ user/*.md        │ │
│                              │ projects/H/*.md  │ │
│                              │ rejected/*/      │ │
│                              └──────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Storage Layout

```
~/.config/opencode/aristotle-repo/     ← Git repo (source of truth)
├── .git/
├── .gitignore
├── user/                               ← Global rules
│   └── 2026-04-10_hallucination.md
├── projects/                           ← Project-specific rules
│   └── a1b2c3d4/                       ← SHA256(project_path)[:8]
│       └── 2026-04-12_pattern_violation.md
└── rejected/                           ← Mirror of above structure
    ├── user/
    └── projects/a1b2c3d4/
```

Each rule file has YAML frontmatter:

```yaml
---
id: "rec_1712743800"
status: "verified"
scope: "user"
category: "HALLUCINATION"
confidence: 0.85
risk_level: "high"

# GEAR 2.0 retrieval dimensions
intent_tags:
  domain: "database_operations"
  task_goal: "connection_pool_management"
failed_skill: "prisma_client"
error_summary: "P2024 connection pool timeout in serverless"

# Standard fields
source_session: "ses_abc123"
created_at: "2026-04-10T22:30:00+08:00"
verified_at: "2026-04-10T22:35:00+08:00"
verified_by: "auto"
---

## [2026-04-10] HALLUCINATION — Fabricated API Method
**Context**: ...
**Rule**: ...
```

### Rule Status Lifecycle

```
write_rule()
     │
     ▼
┌──────────┐
│ pending  │  Untracked file on disk
└────┬─────┘
     │ stage_rule()
     ▼
┌──────────┐
│ staging  │  Locked for review
└────┬─────┘
   ┌─┴─┐
   │   │
commit   reject_rule()
_rule()      │
   │         ▼
   ▼   ┌──────────┐
verified rejected/  (preserves scope + metadata)
```

### 20 MCP Tools

| Tool | Purpose |
|------|---------|
| `init_repo` | Initialize the Git repo, create directory structure, migrate existing flat rules |
| `write_rule` | Create a new rule file (status: `pending`) with YAML frontmatter, GEAR 2.0 fields, and confidence score |
| `read_rules` | Query rules by status, category, scope, or multi-dimension regex against frontmatter |
| `stage_rule` | Mark a rule as `staging` (under review) |
| `commit_rule` | Set status to `verified`, record timestamp, `git add && commit` |
| `reject_rule` | Move to `rejected/{scope}/` with reason, delete original, commit |
| `restore_rule` | Restore a rejected rule back to active directory with new status |
| `list_rules` | Lightweight metadata-only listing with full search dimensions (no rule bodies loaded). Used for relevance scoring before selective content read |
| `detect_conflicts` | Detect verified rules sharing the same (domain, task_goal, failed_skill) triple |
| `check_sync_status` | Detect verified rules on disk that are not committed to git |
| `sync_rules` | Commit unsynced verified rules to git (auto-detect or specify files) |
| `get_audit_decision` | Compute Δ = confidence × (1 − risk_weight) for a staging rule, return audit level (auto/semi/manual) |
| `persist_draft` | Persist a DRAFT report to disk for later review and re-reflect (atomic write to `aristotle-drafts/`) |
| `create_reflection_record` | Append a new reflection record to state file, auto-generate sequence, handle 50-record pruning |
| `complete_reflection_record` | Update reflection record status after Checker completes |
| `orchestrate_start` | Initialize workflow for learn/reflect/review/sessions commands, return first action |
| `orchestrate_on_event` | Receive subagent completion events, update state machine, return next action |
| `orchestrate_review_action` | Handle user review actions (confirm/reject/revise/re_reflect) |
| `on_undo` | Handle undo signaling from Bridge Plugin — mark workflow as undone |
| `report_feedback` | Report feedback for rules and optionally trigger reflection workflow |

### Streaming Frontmatter Search

`read_rules` uses a two-phase search optimized for hundreds of rule files:

1. **Phase 1 (fast)** — Read only the first 50 lines of each file, regex-match frontmatter KV pairs. Skip files that don't match. No YAML parsing.
2. **Phase 2 (full)** — For matching files only, parse the complete frontmatter and load the Markdown body.

For ~500 files, Phase 1 completes in ~80ms. Total search with 20 matches: ~180ms.

### Two-Round Query Architecture (Learn Phase)

The Learn phase (`/aristotle learn`) uses a context-efficient two-round query to avoid flooding O's context with rule content:

```
Round 1: list_rules(params) → candidate paths + metadata (no content)
                ↓
Round 2: O spawns N parallel scoring subagents
          subagent_i(query, rule_path) → reads 1 rule → scores 1-10 → returns {score, reason}
                ↓
O collects scores → sorts → takes Top MAX_LEARN_RESULTS (default: 5)
                ↓
O compresses Top-N into minimal summaries → injects into L's context
```

- **O never reads rule content directly** — only orchestrates scoring and compression
- **Each subagent has minimal context** — one query + one rule file
- **Scoring depends on full markdown body** — Context, Rule, and Example sections all participate in relevance evaluation
- **`list_rules` and `read_rules` share the same search engine** — `stream_filter_rules()` — but return different result weights

### MCP Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip/mamba

> The MCP configuration JSON is shown in the top-level "Installation" section above. This section covers technical details only.

### Migration

When `init_repo` runs for the first time, it automatically detects existing `aristotle-learnings.md` files and migrates their rules into the Git repo. Migration defaults:

| Field | Value | Rationale |
|-------|-------|-----------|
| `id` | `mig_N` (sequential) | Distinguishes migrated rules from new ones |
| `status` | `verified` | Existing rules were human-confirmed by nature |
| `confidence` | `0.7` | Conservative default |
| `risk_level` | Derived from category | `HALLUCINATION` → high, `SYNTAX_API_ERROR` → medium, others → low |
| `verified_by` | `"migration"` | Marks the source |
| `verified_at` | Same as `created_at` | Parsed from the Markdown heading |

After migration, the original file is renamed to `.bak`.

## Design: GEAR 2.0

Aristotle is an implementation of **[GEAR (Git-backed Error Analysis & Reflection)](./GEAR.md)** — a protocol for AI agent error reflection, learning, and prevention. Instead of a flat append-only file, rules flow through a state machine with schema validation, intent-driven retrieval, and evolution-based audit levels.

**GEAR role → Aristotle mapping:**

| GEAR Role | Aristotle Implementation | Status |
|-----------|-------------------------|--------|
| **O** (Orchestrator) | `SKILL.md` + `REFLECT.md` + `REVIEW.md` + `LEARN.md` | ✅ Active |
| **R** (Resource Creator) | `REFLECTOR.md` (subagent) | ✅ Active |
| **C** (Checker) | `REVIEW.md` STEP V2b (schema validation) | ✅ Active |
| **L** (Learner) | `LEARN.md` | ✅ Active |
| **S** (Searcher) | Function within O (LEARN.md STEP L3) | ✅ Active |

GEAR protocol operations map to Aristotle's MCP tools: `produce` → `write_rule`, `stage` → `stage_rule`, `verify` → `commit_rule`, `reject` → `reject_rule`, `restore` → `restore_rule`, `search` → `read_rules`, `sync` → `check_sync_status` + `sync_rules`, `audit_decision` → `get_audit_decision`.

The full protocol specification — state machine, frontmatter schema, Δ decision factor, and conformance requirements — is documented in **[GEAR.md](./GEAR.md)**.

## Testing

> **Full test documentation:** See **[TESTING.md](./TESTING.md)** for detailed test suites, coverage breakdowns, and manual test plans.

| Suite | Command | Count |
|-------|---------|-------|
| Static | `bash test.sh` | 104 |
| Unit/Integration (Python) | `uv run pytest test/ -v` | 318 |
| Bridge Plugin (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 100 |
| E2E Integration | `uv run pytest test/test_e2e_bridge_integration.py -v` | 9 |
| E2E Live | `bash test/live-test.sh --model <provider/model>` | 8 |

## Project Structure

```
.
├── SKILL.md              # Router — argument parsing, phase routing (90 lines)
├── REFLECTOR.md          # Subagent protocol — error analysis, DRAFT generation
├── REFLECT.md            # Coordinator reflect phase — fire subagent, state tracking, passive trigger
├── REVIEW.md             # Coordinator review phase — DRAFT review, rule writing, revision
├── CHECKER.md            # Checker protocol — schema + content validation (loaded on confirm only)
├── LEARN.md              # Coordinator learn phase — intent extraction, query construction, result filtering
├── install.sh            # Installer (macOS/Linux)
├── install.ps1           # Installer (Windows)
├── pyproject.toml        # Python dependencies for MCP server
├── test.sh               # Static test suite (104 assertions)
├── aristotle_mcp/        # MCP server (Git-backed rule management + workflow orchestration)
│   ├── __init__.py
│   ├── config.py         # Paths, constants, env vars, RISK_WEIGHTS, AUDIT_THRESHOLDS, SKILL_DIR
│   ├── models.py         # RuleMetadata dataclass, YAML serialization
│   ├── git_ops.py        # Git abstraction (init, add+commit, show, log, status, show_exists)
│   ├── frontmatter.py    # Streaming frontmatter search, atomic writes
│   ├── evolution.py      # Δ decision engine (compute_delta, decide_audit_level)
│   ├── migration.py      # Flat Markdown → Git repo migration
│   ├── server.py         # FastMCP entry point, re-exports, tool registration
│   ├── _utils.py         # Shared utility functions
│   ├── _tools_rules.py   # 10 rule lifecycle tools (includes detect_conflicts, get_audit_decision)
│   ├── _tools_sync.py    # 2 sync tools
│   ├── _tools_reflection.py  # 3 reflection state tools
│   ├── _tools_undo.py    # on_undo tool (bridge undo signaling)
│   ├── _tools_feedback.py    # report_feedback tool (rule feedback + auto-reflect)
│   ├── _orch_prompts.py  # Prompt templates + builders
│   ├── _orch_state.py    # Workflow persistence + state management
│   ├── _orch_parsers.py  # Parsers + formatters
│   ├── _orch_start.py    # orchestrate_start tool (session_file + use_bridge)
│   ├── _orch_event.py    # orchestrate_on_event tool
│   └── _orch_review.py   # orchestrate_review_action tool
├── plugins/
│   └── aristotle-bridge/ # Bridge Plugin — async reflect via polling (no OMO dependency)
│       ├── src/          # 7 modules (types/utils/api-probe/snapshot-extractor/workflow-store/idle-handler/executor)
│       ├── test/         # 7 test files, 100 vitest cases
│       ├── testing.en.md # Bridge-specific test documentation (English)
│       └── testing.zh.md # Bridge-specific test documentation (Chinese)
└── test/
    ├── live-test.sh      # E2E live test (8 assertions)
    ├── e2e_opencode.sh   # E2E automation script (14 assertions)
    └── test_e2e_bridge_integration.py  # Bridge↔MCP integration (9 pytest)
```

## Architecture: Progressive Disclosure

The skill is split into six files. Only `SKILL.md` (60 lines) is loaded on trigger. The other files are loaded on demand:

| Scenario | Files Loaded | Lines |
|----------|-------------|-------|
| `/aristotle` (reflect) | SKILL.md + REFLECT.md | 194 |
| `/aristotle sessions` | SKILL.md only | 60 |
| `/aristotle review N` | SKILL.md + REVIEW.md | 244 |
| `/aristotle review N` (confirm) | SKILL.md + REVIEW.md + CHECKER.md | 308 |
| `/aristotle learn` | SKILL.md + LEARN.md | 312 |
| Review + re-reflect | SKILL.md + REVIEW.md + REFLECT.md | 372 |
| Subagent (internal) | REFLECTOR.md | ~195 |

## Known Issues & Contributing

PRs welcome! Here are areas that need improvement:

### Medium Priority

- **Subagent `session_read` access** — The Reflector subagent previously required `session_read()` to read session content, which some model/provider combinations don't expose. **Mitigated by Bridge Plugin**: the PRE-RESOLVE snapshot extractor captures error context in the main session (which has access) and passes it to the Reflector via `session_file`. Full graceful degradation (fallback to `session_list` + `session_info`) remains a nice-to-have for non-Bridge paths.
- **Multi-model E2E testing** — Live test only validates with the user-specified model. Should test across multiple providers/models.

### Nice to Have

- ~~**Rule versioning and expiry**~~ — Resolved by the MCP server (Git-backed). Rules now have full commit history and can be rejected/restored. Expiry/pruning remains a nice-to-have.
- **`count_matches` cross-platform testing** — The test suite's `count_matches` helper works on GNU grep but should be tested on Alpine (BusyBox), macOS (BSD grep), and other non-GNU environments.

## Uninstall

```bash
# Remove the skill
rm -rf ~/.claude/skills/aristotle

# Remove user-level learnings (optional)
rm -f ~/.config/opencode/aristotle-learnings.md
rm -f ~/.config/opencode/aristotle-learnings.md.bak

# Remove state file (optional)
rm -f ~/.config/opencode/aristotle-state.json

# Remove MCP rule repository (optional)
rm -rf ~/.config/opencode/aristotle-repo

# Remove MCP config from opencode.json (manual edit)
# Delete the "aristotle" entry from the "mcp" section
```

## Why `~/.claude/skills/`? — Skill Discovery Investigation

You might wonder why this skill must be installed under `~/.claude/skills/` rather than `~/.config/opencode/skills/` or other seemingly more natural locations. Here's what we found.

### How OpenCode Discovers Skills (v1.3.15)

OpenCode's skill discovery scans directories in the following order:

1. **`EXTERNAL_DIRS`** — globally scans `~/.claude/` and `~/.agents/` (hardcoded in source as `[".claude", ".agents"]`), looking for `skills/**/SKILL.md`
2. **`EXTERNAL_DIRS`** at project level — scans `<project>/.claude/` and `<project>/.agents/`
3. **`configDirs`** — scans `~/.config/opencode/` with pattern `{skill,skills}/**/SKILL.md`
4. **`skills.paths`** — reads custom paths from `opencode.json` config
5. **`skills.urls`** — fetches skills from remote URLs

### Root Cause

The `EXTERNAL_DIRS` scanning for `.claude` is the only fully functional discovery path in OpenCode v1.3.15. See [GitHub issues](https://github.com/anomalyco/opencode/issues/16524) for details.

### ⚠️ Pitfall: Don't Symlink the Skills Directory

OpenCode's internal glob traversal does **not follow directory symlinks**. Use a real directory:

```bash
# ✅ Real directory — always works
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

## Branch Status: `test-coverage`

> Phase 2 complete. See **[TESTING.md](./TESTING.md)** for detailed test documentation.

### Test Coverage History

| Milestone | pytest | static | e2e | Commit |
|-----------|--------|--------|-----|--------|
| Baseline (pre-remediation) | 111 | 67 | — | `35cc613` (main) |
| Post-remediation | 134 | 67 | — | `96eed0d` |
| Post-coroutine-O merge | 166 | 84 | — | `c0ffee5` |
| GEAR Orchestration (M1-M4) | 218 | 98 | — | `a3ab41a` |
| M4 Exception Path Tests | 227 | 98 | — | `3e8f94b` |
| **Phase 2 (M1/M5-M9)** | **295** | **104** | **70** | `7da8269` |
| Phase 0 Bridge (MCP ext) | 318 | 104 | 9 | — |
| Phase 1 Bridge (Plugin) | 318 | 104 | 9 + 100 vitest | — |

## License

MIT
