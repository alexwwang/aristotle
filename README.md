# Aristotle 🦉

[![CI](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alexwwang/aristotle?include_prereleases)](https://github.com/alexwwang/aristotle/releases)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-1008%20total-brightgreen)](./docs/testing.md)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19660780.svg)](https://doi.org/10.5281/zenodo.19660780)

English | [中文](./README.zh-CN.md)

> *Knowing yourself is the beginning of all wisdom.* — Aristotle

**Aristotle** is an [OpenCode](https://github.com/opencode-ai/opencode) skill — an error reflection and learning agent.

Activate with `/aristotle` to spawn an isolated subagent that analyzes your session for model mistakes, performs 5-Why root-cause analysis, and generates DRAFT rules. You review, confirm, or revise before anything is written to disk.

## Features

- **Progressive Disclosure Architecture** — Skill loads only what's needed: router (5.6 KB) → reflect (4.6 KB) → review (6.8 KB). Each phase loads on demand, never wasting context.
- **Isolated Reflection** — Analysis runs in a separate background session; main session context is never polluted
- **5-Why Root-Cause Analysis** — Structured error categorization across 8 categories (MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR)
- **DRAFT → Review → Confirm Workflow** — Rules are generated as DRAFTs with location metadata; user reviews in a dedicated session via `/aristotle review N`, confirms, revises, or rejects
- **Precise Error Location** — `--focus` parameter targets specific parts of a session (last exchange, around message N, after a keyword, error-only scan, or full scan)
- **Re-Reflection** — During review, user can request deeper analysis on a specific error. DRAFT metadata (session ID, message range, error excerpts) enables precise targeting without re-scanning the entire session.
- **State Tracking** — `~/.config/opencode/aristotle-state.json` tracks all reflections with status (draft → confirmed → revised), enabling `/aristotle sessions` to list and manage history
- **Bilingual** — Detects error-correction patterns in English and Chinese (zh-CN)
- **Two-Tier Output** — User-level rules (`~/.config/opencode/aristotle-learnings.md`) apply globally; project-level rules (`.opencode/aristotle-project-learnings.md`) apply per-project
- **Auto-Suggestion** — Skill description includes error-correction keywords; when detected in conversation, the AI can suggest running `/aristotle` (automatic, no configuration needed)
- **Plugin** — Assembles the Core library and Aristotle role into an OpenCode plugin entry point (`plugin/index.ts`). Provides async polling-based reflection, idle detection, and `/undo` support.
- **Dual-Package Architecture** — Phase 0 extracted a shared `packages/core/` library (logger, config, workflow store, plugin registration) and a role-specific `packages/aristotle/` package (idle handler, snapshot extractor). The plugin composes both via `assemblePlugin()`, enabling reuse across other OpenCode skills without coupling to Aristotle-specific logic.
- **State-Machine-Guarded TDD Pipeline** — When paired with the [tdd-pipeline skill](https://github.com/opencode-ai/opencode) (≥ v0.17.0), Aristotle's watchdog state machine enforces Red-Green-Refactor discipline across multi-phase project delivery. The pipeline covers Product Design → Technical Solution → Test Plan → Test Code → Business Code → Pre-Release Testing → System Quality Audit → Functional Acceptance. Given clear requirements, it can produce high-quality, fully-tested deliverables with minimal human intervention — the state machine gates each phase transition, preventing quality regressions.
- **Watchdog Intervention System** — Detects 13 TDD violation types (process, behavioral, regression, compliance) and executes SYNC-mode blocking interventions with automatic rollback, git commit safety, and KI document tracking. Includes bilingual (EN/ZH) Ralph Loop prompt validation.

## Installation

Aristotle has three components, all installed from the same repo:

1. **Skill** — Protocol files loaded by OpenCode (`SKILL.md`, `REFLECT.md`, etc.)
2. **MCP Server** — Python-based Git-backed rule management (`aristotle_mcp/`)
3. **Plugin** — TypeScript-based async reflection assembled from `packages/core/` + `packages/reflection/` (`plugin/index.ts`). Provides polling-based background reflection with idle detection.

### Prerequisites

| Component | Required | Optional |
|-----------|----------|----------|
| Skill | — | — |
| MCP Server | Python 3.10+, [uv](https://docs.astral.sh/uv/) | — |
| Plugin | [bun](https://bun.sh/) (for building from source) | — |

> The installer (`install.sh`) will skip the Plugin build if `bun` is not found and continue with Skill + MCP Server. You can install bun later and re-run the installer to add the Plugin.

### Option 1: Manual Install (macOS / Linux)

```bash
# 1. Clone the repo
git clone https://github.com/alexwwang/aristotle.git /tmp/aristotle
cd /tmp/aristotle

# 2. Run the installer (deploys SKILL.md + MCP server + Plugin)
bash scripts/install.sh

# 3. Add MCP config to opencode.json
# See "MCP Configuration" section below for the JSON snippet

# 4. Register Plugin in opencode.json
# Add to the "plugin" array: "file://$HOME/.config/opencode/aristotle-bridge/index.js"
```

### Option 2: Manual Install (Windows)

```powershell
# 1. Clone the repo
git clone https://github.com/alexwwang/aristotle.git "$env:TEMP\aristotle"

# 2. Run the installer (deploys SKILL.md + MCP server + Plugin)
cd "$env:TEMP\aristotle"
powershell -ExecutionPolicy Bypass -File install.ps1

# 3. Add MCP config to opencode.json
# See "MCP Configuration" section below for the JSON snippet

# 4. Register Plugin in opencode.json
# Add to the "plugin" array: "file://$env:USERPROFILE\.config\opencode\aristotle-bridge\index.js"
```

### Option 3: One-Line Clone (skill only, no MCP)

OpenCode discovers skills from paths configured in `opencode.json` (`skills.paths`):

```bash
mkdir -p ~/.config/opencode/skills/aristotle
curl -sL https://raw.githubusercontent.com/alexwwang/aristotle/main/SKILL.md -o ~/.config/opencode/skills/aristotle/SKILL.md
```

> **Note:** This gives you the basic skill without MCP server. You won't get Git version control, Δ audit decisions, or rule status management. Run the installer (`install.sh` or `install.ps1`) to deploy the full feature set. The learnings file will be auto-created on first run.

### Option 4: Self-Guided Install (paste into OpenCode)

Copy and paste this prompt into any OpenCode session — it will install Aristotle for you:

```
Install the Aristotle skill with MCP server from https://github.com/alexwwang/aristotle.git:
1. Clone to /tmp/aristotle
2. cd into the cloned directory, run `bash scripts/install.sh` (macOS/Linux) or `powershell -File install.ps1` (Windows)
3. Verify: run `bash scripts/test.sh` — all assertions must pass
4. Add MCP config to opencode.json: { "mcp": { "aristotle": { "type": "local", "command": ["uv", "run", "--project", "$HOME/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"], "enabled": true } } }
5. Register Plugin: add `"file://$HOME/.config/opencode/aristotle-bridge/index.js"` to the `"plugin"` array in opencode.json
6. Verify MCP: run `uv run --project ~/.config/opencode/aristotle python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools), 'tools loaded')"` — should print "20 tools loaded"
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

### Option 5: Docker (Linux/macOS with Colima/Docker Desktop)

Run Aristotle in a container with OpenCode pre-installed. All configuration and data are mounted from the host, keeping the container stateless.

**Prerequisites:** Docker + [Colima](https://github.com/abiosoft/colima) (macOS) or Docker Desktop (Linux/Windows)

```bash
# 1. Start Colima (macOS example)
colima start --cpu 2 --memory 4 --arch x86_64

# 2. Build image
docker compose build

# 3. Run container
docker compose run opencode-aristotle
```

**Volumes mounted:**

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `~/.config/opencode` | `/root/.config/opencode` | OpenCode config, skills, plugins, MCP server |
| `~/.local/share/opencode` | `/root/.local/share/opencode` | Session data, history, state |
| `~/workspace` | `/workspace` | Working directory for projects |

**Dockerfile design:**
- Base image: `ghcr.io/anomalyco/opencode` (Alpine + opencode CLI)
- Runtime only: Python 3.12 + uv + bun + git
- **No Aristotle components baked in** — all injected via bind mounts at runtime
- Entrypoint: `opencode` (TUI mode)

### MCP Configuration

Add this to your `opencode.json` to enable the MCP server (replace `$HOME` with your actual home path):

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "$HOME/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"],
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
| `/aristotle last` | Reflect on the **previous** session (see Target Resolution below) *(pending)* |
| `/aristotle session ses_xxx` | Reflect on a specific session by **OpenCode session ID** *(pending)* |
| `/aristotle recent N` | Reflect on the **Nth** most recent session (N=1 is most recent, not current) *(pending)* |
| `/aristotle --focus <hint>` | Target a specific area (see Focus Options below) *(pending)* |
| `/aristotle --model <model>` | Override model for the Reflector *(pending — will use config instead, see below)* |
| `/aristotle sessions` | List all reflection records with status and sequence numbers |
| `/aristotle review N` | Load DRAFT **#N** into current session for review (N is sequence number from `sessions`) |

> **Note:** Commands marked *(pending)* are documented specifications not yet implemented. Currently, `/aristotle` always reflects on the current session with `focus: "last"`.

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
2. **Pick one**: `/aristotle review 2` → loads enriched review with Δ audit score, per-rule confidence/risk, conflict warnings, and DRAFT summary
3. **Decide**: `confirm` / `revise 1: feedback` / `reject` / `re-reflect` / `inspect N` / `show draft`
4. **Iterate**: repeat for other reflections, or request re-reflection with deeper analysis

> The sequence number (`N`) in `/aristotle review N` comes from the `#` column in `/aristotle sessions` output. It's **not** an OpenCode session ID — it's the position in the reflection records list.

```
Reflect Phase                    Review Phase
─────────────                    ────────────
/aristotle                       /aristotle review 1
  │                                │
  ├─ Load REFLECT.md               ├─ Load REVIEW.md
  │  (4.6 KB)                       │  (6.8 KB)
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

### Execution Modes: Bridge vs. Blocking

Aristotle supports two execution paths for the Reflect→Check (R→C) chain, selected automatically:

```
Both paths are non-blocking — the main session is never frozen.
The difference is WHO drives the R→C chain transitions.
```

| | **Bridge Plugin** (recommended) | **Blocking Path** (fallback) |
|---|---|---|
| Activation | `.bridge-active` marker exists | `.bridge-active` missing |
| Sub-session creation | `promptAsync()` | `task(run_in_background=true)` |
| R→C chain driver | Bridge Plugin idle handler (automatic) | Main session LLM (manual) |
| Main session involvement | Zero — fire and forget | Each transition requires LLM call |
| Token cost to main session | None | One LLM call per chain step |
| Requires OMO? | No | No (works with or without OMO) |

```
Bridge path:  Main → aristotle_fire_o(R) → STOP
              Bridge → [R done] → auto start C → [C done] → notifyParent()

Blocking path: Main → task(R) → [R done, notify Main] → Main LLM calls MCP → task(C) → [C done, notify Main] → ...
                         ↑ Main session LLM participates at each step ↑
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

# GEAR intent tags (retrieval dimensions)
intent_tags:
  domain: "database_operations"
  task_goal: "connection_pool_management"
failed_skill: "prisma_client"
error_summary: "P2024 connection pool timeout in serverless"

# Standard fields
source_session: "ses_abc123"
reflection_sequence: 3
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
| `write_rule` | Create a new rule file (status: `pending`) with YAML frontmatter, intent tags, and confidence score |
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

### Configuration

Create `~/.config/opencode/aristotle-config.json` to customize behavior:

```jsonc
{
  // Reflector prompt mode: "full" | "compact" | "auto"
  // "auto" selects compact if any model has output limit ≤ 8192 tokens
  "prompt_mode": "auto"
}
```

Priority: `ARISTOTLE_PROMPT_MODE` env var → `aristotle-config.json` → default `"full"`.

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

## GEAR Protocol

Aristotle is an implementation of **[GEAR (Git-backed Error Analysis & Reflection)](./docs/GEAR.md)** — a protocol for AI agent error reflection, learning, and prevention. Instead of a flat append-only file, rules flow through a state machine with schema validation, intent-driven retrieval, and evolution-based audit levels.

**GEAR role → Aristotle mapping:**

| GEAR Role | Aristotle Implementation | Status |
|-----------|-------------------------|--------|
| **O** (Orchestrator) | `SKILL.md` + `REFLECT.md` + `REVIEW.md` + `LEARN.md` | ✅ Active |
| **R** (Resource Creator) | `REFLECTOR.md` (subagent) | ✅ Active |
| **C** (Checker) | `REVIEW.md` STEP V2b (schema validation) | ✅ Active |
| **L** (Learner) | `LEARN.md` | ✅ Active |
| **S** (Searcher) | Function within O (LEARN.md STEP L3) | ✅ Active |

GEAR protocol operations map to Aristotle's MCP tools: `produce` → `write_rule`, `stage` → `stage_rule`, `verify` → `commit_rule`, `reject` → `reject_rule`, `restore` → `restore_rule`, `search` → `read_rules`, `sync` → `check_sync_status` + `sync_rules`, `audit_decision` → `get_audit_decision`.

The full protocol specification — state machine, frontmatter schema, Δ decision factor, and conformance requirements — is documented in **[GEAR.md](./docs/GEAR.md)**.

## Testing

> **Full test documentation:** See **[TESTING.md](./docs/testing.md)** for detailed test suites, coverage breakdowns, and manual test plans.

| Suite | Command | Count |
|-------|---------|-------|
| Static | `bash scripts/test.sh` | 103 |
| Unit/Integration (Python) | `uv run pytest test/ -v` | 405 |
| Core Package (TypeScript) | `cd packages/core && bunx vitest run` | 150 |
| Aristotle Package (TypeScript) | `cd packages/reflection && bunx vitest run` | 115 |
| Legacy Bridge (archived) (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 162 |
| E2E Integration | `uv run pytest test/test_e2e_bridge_integration.py -v` | 9 |
| Regression (deploy verify) | `bash test/regression/regression_b1_checks.sh` | 64 |

### Test Coverage History

> Phase 2 complete. See **[TESTING.md](./docs/testing.md)** for detailed test documentation.

| Milestone | pytest | static | vitest | e2e |
|-----------|--------|--------|--------|-----|
| Baseline (pre-remediation) | 111 | 67 | — | — |
| Post-remediation | 134 | 67 | — | — |
| Post-coroutine-O merge | 166 | 84 | — | — |
| GEAR Orchestration (M1-M4) | 218 | 98 | — | — |
| M4 Exception Path Tests | 227 | 98 | — | — |
| **Phase 2 (M1/M5-M9)** | **295** | **104** | — | **70** |
| Phase 0 Bridge (MCP ext) | 318 | 103 | — | 9 |
| Phase 1 Bridge (Plugin) | 325 | 103 | — | 9 + 162 vitest |
| **v1.2.0 Review UX** | **382** | **103** | — | **9 + 162 vitest** |
| **v1.3.0 Per-Rec Isolation** | **395** | **103** | — | **80 pytest + 162 vitest** |
| **Phase 0 Core Extraction** | **405** | **103** | **150 core + 115 aristotle** | **9 + 162 bridge + 64 regression** |

## Project Structure

```
.
├── skill/                 # Skill documents (copied to install dirs by install.sh)
│   ├── SKILL.md           # Router — argument parsing, phase routing (5.6 KB)
│   ├── REFLECTOR.md       # Subagent protocol — error analysis, DRAFT generation
│   ├── REFLECT.md         # Coordinator reflect phase — fire subagent, state tracking, passive trigger
│   ├── REVIEW.md          # Coordinator review phase — DRAFT review, rule writing, revision
│   ├── CHECKER.md         # Checker protocol — schema + content validation (loaded on confirm only)
│   └── LEARN.md           # Coordinator learn phase — intent extraction, query construction, result filtering
├── scripts/
│   ├── install.sh             # Installer (macOS/Linux)
│   ├── install.ps1           # Installer (Windows)
│   ├── test.sh               # Static test suite (103 assertions)
│   ├── reset-runtime.sh      # Reset runtime state
│   └── uninstall.sh          # Uninstall script
├── pyproject.toml        # Python dependencies for MCP server
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
├── auto-reflection-feature/   # Watchdog Intervention System (TDD Pipeline v1.4, 243 tests)
│   ├── src/aristotle_auto_reflection/
│   │   ├── intervention_coordinator.py  # Central hub: intervene(), batch, assessment
│   │   ├── intervention_types.py        # 13 dataclasses + VIOLATION_PRIORITY
│   │   ├── watchdog.py                  # ViolationFilter (Phase 4-5)
│   │   ├── rollback_engine.py           # Git-based rollback
│   │   ├── ki_doc_manager.py            # KI document CRUD
│   │   ├── prompt_validator.py          # Bilingual forbidden pattern detection
│   │   ├── rule_generator.py            # Violation-type-specific templates
│   │   ├── committer.py                 # Frontmatter schema validation
│   │   ├── commit_guard.py              # Phase/loop auto-commit
│   │   └── reflector.py                 # Auto-reflection stub
│   ├── tests/                           # 243 pytest cases
│   └── docs/                            # Requirements, test plans, KI docs
├── packages/
│   ├── core/              # Core library — shared mechanism (logger, config, workflow-store, executor, plugin registration)
│   │   ├── src/           # 10 modules
│   │   └── test/          # 150 vitest cases
│   └── aristotle/         # Aristotle role — idle-handler, tools, snapshot-extractor, config
│       ├── src/           # 6 modules
│       └── test/          # 115 vitest cases
├── plugin/
│   ├── index.ts           # Plugin entry — assemblePlugin + createAristotleRole
│   └── dist/              # Built output (deployed to opencode plugin path)
├── plugins/
│   └── aristotle-bridge/  # Legacy Bridge Plugin — archived (old async reflect via polling)
│       ├── src/           # 9 modules (old structure)
│       ├── test/          # 8 test files, 162 vitest cases (archived)
│       ├── testing.en.md  # Bridge-specific test documentation (English)
│       └── testing.zh.md  # Bridge-specific test documentation (Chinese)
├── Dockerfile             # Stateless container image (opencode + Python/uv/bun runtime)
├── docker-compose.yml     # Bind mounts host config/data for stateless execution
└── test/
    ├── e2e/
    │   ├── e2e_opencode.sh          # E2E automation script (14 assertions)
    │   └── ...
    ├── regression/
    │   └── regression_b1_checks.sh  # Deploy verification (64 assertions)
    └── test_e2e_bridge_integration.py  # Bridge↔MCP integration (9 pytest)
```

## Architecture: Progressive Disclosure

The skill is split into six files. Only `SKILL.md` (5.6 KB) is loaded on trigger. The other files are loaded on demand:

| Scenario | Files Loaded | Size |
|----------|-------------|------|
| `/aristotle` (reflect) | SKILL.md + REFLECT.md | 10.0 KB |
| `/aristotle sessions` | SKILL.md only | 5.6 KB |
| `/aristotle review N` | SKILL.md + REVIEW.md | 12.2 KB |
| `/aristotle review N` (confirm) | SKILL.md + REVIEW.md + CHECKER.md | 20.9 KB |
| `/aristotle learn` | SKILL.md + LEARN.md | 14.4 KB |
| Review + re-reflect | SKILL.md + REVIEW.md + REFLECT.md | 16.7 KB |
| Subagent (internal) | REFLECTOR.md | 10.2 KB |

## Known Issues & Contributing

PRs welcome! Here are areas that need improvement:

### Medium Priority

- **Command parameter parsing** — `last`, `session ses_xxx`, `recent N`, and `--focus <hint>` are documented but not yet implemented. Currently `/aristotle` always reflects on the current session with `focus: "last"`. See `design_plan/pending-params-implementation.md` for the implementation plan.
- **Reflector model configuration** — The Reflector currently uses the host's default model. Adding a `reflector_model` config option in `aristotle-config.json` (with the same priority chain as `prompt_mode`) would allow users to optimize for cost or quality.
- **Subagent `session_read` access** — The Reflector subagent previously required `session_read()` to read session content, which some model/provider combinations don't expose. **Mitigated by Bridge Plugin**: the PRE-RESOLVE snapshot extractor captures error context in the main session (which has access) and passes it to the Reflector via `session_file`. Full graceful degradation (fallback to `session_list` + `session_info`) remains a nice-to-have for non-Bridge paths.

### Nice to Have

- ~~**Rule versioning and expiry**~~ — Resolved by the MCP server (Git-backed). Rules now have full commit history and can be rejected/restored. Expiry/pruning remains a nice-to-have.
- **`count_matches` cross-platform testing** — The test suite's `count_matches` helper works on GNU grep but should be tested on Alpine (BusyBox), macOS (BSD grep), and other non-GNU environments.

## Reset / Clear Data

If you want to clear all Aristotle data without uninstalling, see [RESET.md](./docs/reset.md).

## Uninstall

```bash
# Remove the skill
rm -rf ~/.config/opencode/skills/aristotle

# Remove MCP server
rm -rf ~/.config/opencode/aristotle

# Remove Bridge Plugin (optional)
rm -rf ~/.config/opencode/aristotle-bridge

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

## License

MIT
