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
- `focus_hint` (optional) — User-specified focus area. Can be:
  - `last` — Focus on the most recent exchange (default)
  - `after "some text"` — Focus on messages after the quoted text appears
  - `around N` — Focus on messages around message number N
  - `error` — Focus on error-correction patterns only (skip clean sections)
  - `full` — Scan entire session (for short sessions or comprehensive review)
  - Unspecified → defaults to `last`

### Passive Trigger (P3.3)

When Aristotle is activated by multi-agent error detection (not an explicit `/aristotle` command):

1. `target_session_id` = current session (the session containing the detected error)
2. `focus_hint` = `"last"` (focus on the most recent exchange where the error was detected)
3. `target_label` = `"passive-trigger"`
4. Proceed to F3 as normal — the Reflector will analyze the error context

This handles the scenario where agent B reviews agent A's work and detects errors. Aristotle auto-activates to capture the mistake.

### How to Determine focus_hint

1. If user provided explicit hint in command (e.g. `/aristotle --focus after "refactor"`) → use that
2. If user said something like "reflect on the API error just now" → `focus_hint: "API error"`
3. If no hint given → default to `last`

## STEP F2: BUILD TARGET LABEL

Create a short human-readable label for the target session:

```
current session     → "current"
last session        → "last"
specific session    → "ses_xxx" (last 4 chars of ID)
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
```

If the user specified `--model`, include it in the task() call. Otherwise, do NOT specify a model parameter — the framework will use the current session's model.

## STEP F4: UPDATE STATE FILE

After firing the task, update `~/.config/opencode/aristotle-state.json`:

1. Read the existing file (or start with `[]`)
2. Append a new record:
```json
{
  "id": "rec_$(date +%s)",
  "reflector_session_id": "<from task() result>",
  "target_session_id": "${target_session_id}",
  "target_label": "${target_label}",
  "launched_at": "<ISO 8601 timestamp>",
  "status": "draft",
  "rules_count": null
}
```
3. Write the updated file back
4. Keep at most the 50 most recent records (prune oldest if exceeded)

## STEP F5: NOTIFY USER

After firing the background task, immediately tell the user:

```
🦉 Aristotle Reflector launched [${target_label}].
   task_id: bg_xxxxx | session_id: ses_xxxxx

When the analysis is complete, you'll be notified here.
Then review the DRAFT report:

  /aristotle review N
```

**Then STOP.** Do not wait for the result. Do not do any analysis in this session.

## STEP F6: HANDLE COMPLETION NOTIFICATION

When the system sends a background task completion notification, output a ONE-LINE reminder:

```
🦉 Aristotle done [${target_label}]. Review: /aristotle review N
```

If `target_label` is `"passive-trigger"`, use this format instead:

```
🦉 Aristotle done [auto-detected error]. Review: /aristotle review N
```

**That's it.** Do NOT call `background_output`. Do NOT dump any analysis content.
