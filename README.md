# Aristotle 🦉

English | [中文](./README.zh-CN.md)

> *Knowing yourself is the beginning of all wisdom.* — Aristotle

**Aristotle** is an [OpenCode](https://github.com/opencode-ai/opencode) skill — an error reflection and learning agent.

Activate with `/aristotle` to spawn an isolated subagent that analyzes your session for model mistakes, performs 5-Why root-cause analysis, and writes preventive rules to durable files. You review, confirm, or revise before anything is written.

## Features

- **Isolated Reflection** — Analysis runs in a separate background session; main session context is never polluted
- **5-Why Root-Cause Analysis** — Structured error categorization across 8 categories (MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR)
- **Draft → Confirm Workflow** — Rules are presented as DRAFTS first; user confirms, revises, or rejects before anything is written to disk
- **Bilingual** — Detects error-correction patterns in English and Chinese (zh-CN)
- **Two-Tier Output** — User-level rules (`~/.config/opencode/aristotle-learnings.md`) apply globally; project-level rules (`.opencode/aristotle-project-learnings.md`) apply per-project
- **Auto-Suggestion** — Skill description includes error-correction keywords; when detected in conversation, the AI can suggest running `/aristotle` (automatic, no configuration needed)

## Installation

### Option 1: Manual Install (macOS / Linux)

```bash
# Clone the repo
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
cd ~/.claude/skills/aristotle

# Run the installer
bash install.sh
```

### Option 2: Manual Install (Windows)

```powershell
# Clone the repo
git clone https://github.com/alexwwang/aristotle.git "$env:USERPROFILE\.claude\skills\aristotle"

# Run the installer
cd "$env:USERPROFILE\.claude\skills\aristotle"
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Option 3: One-Line Clone (no installer)

OpenCode auto-discovers skills from `~/.claude/skills/`. Just clone and it's ready:

```bash
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

> **Note:** This skips the learnings file initialization from Option 1. The file will be auto-created on first run.

## Usage

In any OpenCode session, type `/aristotle` to trigger reflection:

| Command | Description |
|---------|-------------|
| `/aristotle` | Reflect on the current session |
| `/aristotle last` | Reflect on the previous completed session |
| `/aristotle session <id>` | Reflect on a specific session |
| `/aristotle recent N` | Reflect on the last N sessions |

### What Happens

1. **Coordinator** (main session) — collects target session ID, project directory, user language, then fires a background `task()`. Immediately prints the Reflector's session ID — **you can switch over at any time**, no need to wait for a notification.
2. **Reflector** (isolated subagent) — reads the session transcript, detects error-correction patterns, performs 5-Why analysis, generates draft rules
3. **User Review** — switch to the Reflector session (`opencode -s <id>`) to confirm, revise, or reject each rule. The main session will also send a one-line reminder when the analysis finishes, but you don't have to wait for it.
4. **Persistence** — confirmed rules are appended to learnings files

```
Main Session                         Reflector Session (isolated)
─────────────                        ────────────────────────────
User: /aristotle        ──────►      Read session transcript
                                      Detect errors (5-Why)
"🦉 launched. opencode -s xxx"        Generate DRAFT rules
                                      Present to user ◄──────┐
                                      WAIT for confirm/revise │
                                      Write rules to files    │
                          ◄──────     "✅ Rules written!"     │
"🦉 done. opencode -s xxx"                                    │
                                      (user switches here) ───┘
```

## Testing

### Static Tests (no session required)

```bash
bash test.sh
```

37 assertions covering file structure, SKILL.md content, hook logic, error pattern detection (English/Chinese/threshold), and architecture guarantees.

### E2E Live Tests (requires opencode session)

```bash
bash test/live-test.sh --model <provider/model>
```

Creates a real session with known error patterns, triggers `/aristotle`, and verifies the full coordinator → reflector → rule-writing flow. 8 assertions.

## Project Structure

```
.
├── .gitignore
├── SKILL.md                          # Skill definition (prompt & protocol)
├── install.sh                        # Installer (macOS/Linux)
├── install.ps1                       # Installer (Windows)
├── test.sh                           # Static test suite (37 assertions)
└── test/
    └── live-test.sh                  # E2E live test (8 assertions)
```

## Known Issues & Contributing

PRs welcome! Here are areas that need improvement:

### High Priority

- **Model compatibility** — The skill asks the user to select a model for the Reflector via `question` tool, but `opencode run` in non-interactive mode hangs at this prompt. The Reflector should proceed with a sensible default in non-interactive contexts.
- **Subagent `session_read` access** — The Reflector subagent uses `session_read()` to read session content, but some model/provider combinations don't expose this tool. When unavailable, the skill falls back to analyzing directly in the main session (defeating isolation). Needs a graceful degradation path.
- **Rules deduplication** — No check for whether a semantically similar rule already exists in `aristotle-learnings.md` before appending. Over time, repeated reflections on similar errors accumulate near-duplicate rules.

### Medium Priority

- **`APPEND ONLY` enforcement is prompt-only** — SKILL.md Step R6c declares append-only and no-duplicates as rules for the LLM, but there's no programmatic enforcement. A post-write validation step that scans for duplicates would make this robust.
- **Multi-model E2E testing** — Live test only validates with the user-specified model. Should test across multiple providers/models to verify portability.

### Nice to Have

- **Session scope filtering** — `/aristotle recent N` pulls the N most recent sessions without filtering by date or relevance. Date-range or error-density filtering would reduce noise.
- **Rule versioning and expiry** — Rules are append-only with no versioning. Some rules may become outdated as models improve. Adding timestamps and a pruning mechanism would help long-term maintenance.
- **`count_matches` cross-platform testing** — The test suite's `count_matches` helper works on GNU grep but should be tested on Alpine (BusyBox), macOS (BSD grep), and other non-GNU environments.
- **SKILL.md schema validation** — No automated check that SKILL.md frontmatter is correct or that referenced protocol steps exist. A lint step would catch drift.

## Uninstall

```bash
# Remove the skill
rm -rf ~/.claude/skills/aristotle

# Remove user-level learnings (optional)
rm -f ~/.config/opencode/aristotle-learnings.md
```

## Why `~/.claude/skills/`? — Skill Discovery Investigation

You might wonder why this skill must be installed under `~/.claude/skills/` rather than `~/.config/opencode/skills/` or other seemingly more natural locations. Here's what we found.

### How OpenCode Discovers Skills (v1.3.15)

OpenCode's skill discovery scans directories in the following order:

1. **`EXTERNAL_DIRS`** — globally scans `~/.claude/` and `~/.agents/` (hardcoded in source as `[".claude", ".agents"]`), looking for `skills/**/SKILL.md`
2. **`EXTERNAL_DIRS` at project level** — scans `<project>/.claude/` and `<project>/.agents/`
3. **`configDirs`** — scans `~/.config/opencode/` with pattern `{skill,skills}/**/SKILL.md`
4. **`skills.paths`** — reads custom paths from `opencode.json` config
5. **`skills.urls`** — fetches skills from remote URLs

### Paths We Tested

| Path | Discovery | Notes |
|------|-----------|-------|
| `~/.claude/skills/` | ✅ Works | The only reliably working path in v1.3.15 |
| `~/.agents/skills/` | ❌ Not found | Listed in `EXTERNAL_DIRS` but does not work in practice |
| `~/.config/opencode/skills/` | ❌ Not found | `configDirs` scan should find it but has a bug |
| `skills.paths` in `opencode.json` | ❌ Not found | Configured but not picked up by discovery |

### Root Cause

The `EXTERNAL_DIRS` scanning for `.claude` is the only fully functional discovery path in OpenCode v1.3.15. The `.agents` directory scan and `configDirs` scan appear to have implementation gaps — multiple GitHub issues ([#16524](https://github.com/anomalyco/opencode/issues/16524), [#10986](https://github.com/anomalyco/opencode/issues/10986), [#12741](https://github.com/anomalyco/opencode/issues/12741)) report similar problems.

This means `~/.claude/skills/` is the only path that reliably works today, even though `.claude` is nominally a Claude Code directory. If OpenCode fixes skill discovery in a future release, we'll update the install paths accordingly.

### ⚠️ Pitfall: Don't Symlink the Skills Directory

OpenCode's internal glob traversal does **not follow directory symlinks**. If `~/.claude/skills/` (or the project-level `.claude/skills/`) is a symlink — e.g., pointing to a git submodule or a shared directory — OpenCode will silently find **zero skills**, even though `ls` shows everything is there.

This is particularly insidious in **git worktree sandbox** environments (e.g., OpenCode Desktop), where the sandbox session's skill scan operates on a copy of the repo and the symlink target may not resolve correctly.

**Do this:**
```bash
# ✅ Real directory — always works
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

**Don't do this:**
```bash
# ❌ Symlink — silently fails
ln -s /some/shared/skills ~/.claude/skills
```

See [issue #18848](https://github.com/anomalyco/opencode/issues/18848) for the full analysis.

## License

MIT
