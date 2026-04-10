# Aristotle 🦉

English | [中文](./README.zh-CN.md)

> *Knowing yourself is the beginning of all wisdom.* — Aristotle

**Aristotle** is an [OpenCode](https://github.com/opencode-ai/opencode) skill — an error reflection and learning agent.

Activate with `/aristotle` to spawn an isolated subagent that analyzes your session for model mistakes, performs 5-Why root-cause analysis, and generates DRAFT rules. You review, confirm, or revise before anything is written to disk.

## Features

- **Progressive Disclosure Architecture** — Skill loads only what's needed: router (84 lines) → reflect (106 lines) → review (156 lines). Each phase loads on demand, never wasting context.
- **Isolated Reflection** — Analysis runs in a separate background session; main session context is never polluted
- **5-Why Root-Cause Analysis** — Structured error categorization across 8 categories (MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR)
- **DRAFT → Review → Confirm Workflow** — Rules are generated as DRAFTs with location metadata; user reviews in a dedicated session via `/aristotle review N`, confirms, revises, or rejects
- **Precise Error Location** — `--focus` parameter targets specific parts of a session (last exchange, around message N, after a keyword, error-only scan, or full scan)
- **Re-Reflection** — During review, user can request deeper analysis on a specific error. DRAFT metadata (session ID, message range, error excerpts) enables precise targeting without re-scanning the entire session.
- **State Tracking** — `~/.config/opencode/aristotle-state.json` tracks all reflections with status (draft → confirmed → revised), enabling `/aristotle sessions` to list and manage history
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

## Testing

### Static Tests (no session required)

```bash
bash test.sh
```

63 assertions covering file structure, progressive disclosure, SKILL.md content, hook logic, error pattern detection (English/Chinese/threshold), and architecture guarantees.

### E2E Live Tests (requires opencode session)

```bash
bash test/live-test.sh --model <provider/model>
```

Creates a real session with known error patterns, triggers `/aristotle`, and verifies the full coordinator → reflector → rule-writing flow. 8 assertions.

## Project Structure

```
.
├── SKILL.md              # Router — argument parsing, phase routing (84 lines)
├── REFLECTOR.md          # Subagent protocol — error analysis, DRAFT generation
├── REFLECT.md            # Coordinator reflect phase — fire subagent, state tracking
├── REVIEW.md             # Coordinator review phase — DRAFT review, rule writing, revision
├── install.sh            # Installer (macOS/Linux)
├── install.ps1           # Installer (Windows)
├── test.sh               # Static test suite (63 assertions)
└── test/
    └── live-test.sh      # E2E live test (8 assertions)
```

## Architecture: Progressive Disclosure

The skill is split into four files. Only `SKILL.md` (84 lines) is loaded on trigger. The other files are loaded on demand:

| Scenario | Files Loaded | Lines |
|----------|-------------|-------|
| `/aristotle` (reflect) | SKILL.md + REFLECT.md | 190 |
| `/aristotle sessions` | SKILL.md only | 84 |
| `/aristotle review N` | SKILL.md + REVIEW.md | 240 |
| Review + re-reflect | SKILL.md + REVIEW.md + REFLECT.md | 346 |
| Subagent (internal) | REFLECTOR.md | ~170 |

## Known Issues & Contributing

PRs welcome! Here are areas that need improvement:

### Medium Priority

- **Subagent `session_read` access** — The Reflector subagent uses `session_read()` to read session content, but some model/provider combinations don't expose this tool. Needs a graceful degradation path.
- **Multi-model E2E testing** — Live test only validates with the user-specified model. Should test across multiple providers/models.

### Nice to Have

- **Rule versioning and expiry** — Rules are append-only with no versioning. Some rules may become outdated as models improve. Adding timestamps and a pruning mechanism would help long-term maintenance.
- **`count_matches` cross-platform testing** — The test suite's `count_matches` helper works on GNU grep but should be tested on Alpine (BusyBox), macOS (BSD grep), and other non-GNU environments.

## Uninstall

```bash
# Remove the skill
rm -rf ~/.claude/skills/aristotle

# Remove user-level learnings (optional)
rm -f ~/.config/opencode/aristotle-learnings.md

# Remove state file (optional)
rm -f ~/.config/opencode/aristotle-state.json
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

## License

MIT
