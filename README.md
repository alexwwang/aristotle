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
git clone https://github.com/alexwwang/aristotle.git ~/.config/opencode/skills/aristotle
cd ~/.config/opencode/skills/aristotle

# Run the installer
bash install.sh
```

### Option 2: Manual Install (Windows)

```powershell
# Clone the repo
git clone https://github.com/alexwwang/aristotle.git "$env:USERPROFILE\.config\opencode\skills\aristotle"

# Run the installer
cd "$env:USERPROFILE\.config\opencode\skills\aristotle"
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Option 3: Install via opencode plugin

```bash
opencode plugin https://github.com/alexwwang/aristotle
```

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
rm -rf ~/.config/opencode/skills/aristotle

# Remove user-level learnings (optional)
rm -f ~/.config/opencode/aristotle-learnings.md
```

## License

MIT
