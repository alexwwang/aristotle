# Aristotle Data Reset Guide

> Complete inventory of reflection data artifacts and reset procedures.

## Directory Layout

```
~/.config/opencode/
├── aristotle-sessions/              # Bridge plugin data
│   ├── .bridge-active               # Plugin active marker (auto-cleaned on exit)
│   ├── bridge-workflows.json        # Workflow state (LRU 50)
│   ├── {sessionId}_snapshot.json    # Session snapshots (7-day auto-cleanup)
│   ├── .trigger-reflect.json        # Reflect trigger (auto-deleted after processing)
│   └── .trigger-abort.json          # Abort trigger (auto-deleted after processing)
├── aristotle-repo/                  # Rule repository (git-managed)
│   ├── user/                        # Global rules
│   ├── projects/{hash}/             # Project-specific rules
│   ├── rejected/                    # Rejected rules
│   └── .workflows/                  # MCP workflow state (24h/48h auto-cleanup)
├── aristotle-state.json             # Reflection records (max 50)
└── aristotle-drafts/                # DRAFT reports (max 50)
    └── rec_{N}.md
```

## Per-Artifact Reset

| # | Artifact | Path | Reset Command | Notes |
|---|----------|------|---------------|-------|
| 1 | Snapshots | `aristotle-sessions/*_snapshot.json` | `rm ~/.config/opencode/aristotle-sessions/*_snapshot.json` | Auto-cleaned after 7 days; safe to delete manually |
| 2 | DRAFT files | `aristotle-drafts/rec_*.md` | `rm -rf ~/.config/opencode/aristotle-drafts/` | Auto-pruned at 50 entries |
| 3 | Reflection state + counter | `aristotle-state.json` | `rm ~/.config/opencode/aristotle-state.json` | Counter resets to rec_1 on next reflection |
| 4 | Workflow state | `aristotle-sessions/bridge-workflows.json` | `rm ~/.config/opencode/aristotle-sessions/bridge-workflows.json` | Rebuilt on plugin startup |
| 5 | MCP workflows | `aristotle-repo/.workflows/` | `rm -rf ~/.config/opencode/aristotle-repo/.workflows/` | Auto-cleaned after 24h/48h |
| 6 | Bridge marker | `aristotle-sessions/.bridge-active` | `rm ~/.config/opencode/aristotle-sessions/.bridge-active` | Auto-cleaned on exit; deletion causes MCP to degrade to non-Bridge mode |
| 7 | Trigger files | `aristotle-sessions/.trigger-*.json` | `rm ~/.config/opencode/aristotle-sessions/.trigger-*.json` | Auto-deleted after processing; safe to clean stale files |
| 8 | Verified rules | `aristotle-repo/user/*.md` | `cd ~/.config/opencode/aristotle-repo && git rm user/*.md && git commit -m "reset: clear rules"` | Git-managed, requires git operations |
| 9 | Rejected rules | `aristotle-repo/rejected/` | `cd ~/.config/opencode/aristotle-repo && rm -rf rejected/ && git add -A && git commit` | Git-managed |
| 10 | Project rules | `aristotle-repo/projects/{hash}/` | Same as above, `git rm -rf projects/` | Per-project subdirectories |

## Full Reset (Runtime Data Only)

```bash
# Clear all runtime data (does NOT affect rule repository)
rm -f ~/.config/opencode/aristotle-sessions/bridge-workflows.json
rm -f ~/.config/opencode/aristotle-sessions/.bridge-active
rm -f ~/.config/opencode/aristotle-sessions/*_snapshot.json
rm -f ~/.config/opencode/aristotle-sessions/.trigger-*.json
rm -f ~/.config/opencode/aristotle-state.json
rm -rf ~/.config/opencode/aristotle-drafts/
rm -rf ~/.config/opencode/aristotle-repo/.workflows/
```

## Full Reset (Including Rules)

```bash
# Same as above, plus clear the rule repository
cd ~/.config/opencode/aristotle-repo
git rm -rf user/ rejected/ projects/
git commit -m "reset: clear all rules and rejected rules"
```

## Reset Counter Only (Keep Rules)

```bash
# Reflection sequence counter lives in aristotle-state.json
# Deleting it resets the counter — next reflection starts at rec_1
rm ~/.config/opencode/aristotle-state.json
rm -rf ~/.config/opencode/aristotle-drafts/
```

## Reset Rules Only (Keep Runtime Data)

```bash
cd ~/.config/opencode/aristotle-repo
git rm -rf user/ rejected/ projects/
git commit -m "reset: clear all rules"
```

## Inspect Current Data

```bash
# Reflection record count
cat ~/.config/opencode/aristotle-state.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} records')"

# DRAFT file count
ls ~/.config/opencode/aristotle-drafts/ 2>/dev/null | wc -l

# Snapshot count
ls ~/.config/opencode/aristotle-sessions/*_snapshot.json 2>/dev/null | wc -l

# Rule count (pending + staging + verified)
cd ~/.config/opencode/aristotle-repo && git ls-files user/ projects/ | wc -l

# Workflow state
cat ~/.config/opencode/aristotle-sessions/bridge-workflows.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} workflows')"
```
