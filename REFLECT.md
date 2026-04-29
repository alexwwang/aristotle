# Aristotle Reflect Protocol

> Loaded only during the REFLECT phase. Do NOT load during REVIEW.

This file defines how to fire the Reflector subagent and handle completion.

---

## STEP F1: COLLECT MINIMAL CONTEXT

Gather what the subagent needs — do NOT read session content yourself:

- `target_session_id` — The session to analyze. Resolved via `session_list`:
  - No argument → current session ID
  - `last` → `session_list(limit=2)`, take the first one that isn't the current session
  - `session ses_xxx` → use `ses_xxx` directly (this is the target session's OpenCode ID, not the Reflector's)
  - `recent N` → `session_list(limit=N+1)`, exclude current session, take the Nth entry
  - **Passive trigger (P3.3)** → current session ID, `focus_hint: "last"`, `target_label: "passive-trigger"`
- `project_directory` — Current working directory (for project-level rules)
- `user_language` — Detect from user's messages (zh-CN / en-US)
- `focus_hint` (optional) — User-specified focus area:
  - `last` — Focus on the most recent exchange (default)
  - `after "some text"` — Focus on messages after the quoted text
  - `around N` — Focus on messages around message number N
  - `error` — Focus on error-correction patterns only
  - `full` — Scan entire session
  - Unspecified → defaults to `last`

### Passive Trigger (P3.3)

When Aristotle is activated by multi-agent error detection (not an explicit `/aristotle` command):

1. `target_session_id` = current session
2. `focus_hint` = `"last"`
3. `target_label` = `"passive-trigger"`
4. Proceed to F3 as normal

## STEP F2: BUILD TARGET LABEL

```
current session     → "current"
last session        → "last"
specific session    → "ses_xxx" (last 4 chars)
recent N            → "recent #i/N"
```

## STEP F3: FIRE THE REFLECTOR SUBAGENT

Call `task()` with:
- `category`: `"unspecified-low"`
- `load_skills`: `[]` (empty — do NOT load aristotle recursively)
- `run_in_background`: `true`
- `description`: `"Aristotle: ${target_label} session"`
- `prompt`:

```
You are Aristotle's Reflector subagent. Read and execute the full protocol at
${SKILL_DIR}/REFLECTOR.md (read the file first, then follow it step by step).

TARGET_SESSION_ID: ${target_session_id}
PROJECT_DIRECTORY: ${project_directory}
USER_LANGUAGE: ${user_language}
FOCUS_HINT: ${focus_hint}
DRAFT_SEQUENCE: ${sequence_number}
```

Where `${sequence_number}` comes from STEP F4 result.

After calling task(), immediately proceed to STEP F4. Do NOT explain what you are about to do.

## STEP F4: CREATE STATE RECORD

Call `aristotle_create_reflection_record()` to create a record in
`~/.config/opencode/aristotle-state.json`:

```
aristotle_create_reflection_record(
    target_session_id="${target_session_id}",
    target_label="${target_label}",
    reflector_session_id="<from task() result>"
)
```

This handles sequence numbering, JSON read/write, and 50-record pruning automatically.
Store the returned `review_index` and `id` for later steps.

**Do NOT display the state file content to the user.**

## STEP F5: NOTIFY USER

```
🦉 Aristotle Reflector launched [${target_label}].
   task_id: bg_xxxxx | session_id: ses_xxxxx

Checker will validate automatically when done.
```

**Then STOP.** Wait for Reflector completion notification.

## STEP F5.5: FIRE CHECKER SUBAGENT

When Reflector completes:

1. Get `sequence_number` from STEP F4 result
2. Fire C subagent via task():
   - category: "unspecified-low", load_skills: [], run_in_background: true
   - description: "Aristotle Checker: validate + commit"
   - prompt:
     ```
     You are Aristotle's Checker subagent. Read and execute the full protocol at
     ${SKILL_DIR}/CHECKER.md (read the file first, then follow it step by step).

     DRAFT_SEQUENCE: ${sequence_number}
     DRAFT_FILE: ~/.config/opencode/aristotle-drafts/rec_${sequence_number}.md
     PROJECT_DIRECTORY: ${project_directory}
     ```
3. Do NOT output intermediate information. Wait for C's completion notification.

## STEP F6: HANDLE CHECKER COMPLETION

1. Call `aristotle_complete_reflection_record(
       sequence=${sequence_number},
       status=<auto_committed/partial_commit/checker_failed>,
       rules_count=<from C result>
    )`
2. Output ONE-LINE notification:

```
🦉 Aristotle done [${target_label}]. ${committed} rules committed, ${staged} staged.
   Review: /aristotle review N
```

For passive-trigger: `🦉 Aristotle done [auto-detected error]. ...`

**That's it.** Do NOT output DRAFT content, rule details, or any intermediate data.
