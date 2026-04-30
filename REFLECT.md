# Aristotle Reflect Protocol

> Reflect phase only. Do NOT load during REVIEW.

Fire Reflector subagent and handle completion.

---

## STEP F1: COLLECT CONTEXT (do NOT read session content yourself)

```
target_session_id:
  no argument      → current session
  "last"           → session_list(limit=2), first non-current
  "session ses_xxx" → use ses_xxx (target session's OpenCode ID, not the Reflector's)
  "recent N"       → session_list(limit=N+1), exclude current, take Nth
  passive trigger  → current session, focus_hint="last", target_label="passive-trigger"

project_directory = cwd
user_language     = detect from messages (zh-CN / en-US)
focus_hint:
  "last" (default) | 'after "text"' | "around N" | "error" | "full"
```

---

## STEP F2: BUILD TARGET LABEL

```
current session  → "current"
last session     → "last"
specific session → "ses_xxx" (last 4 chars)
recent N         → "recent #i/N"
```

---

## STEP F3: FIRE REFLECTOR

```
task(category="unspecified-low", load_skills=[], run_in_background=true,
     description="Aristotle: ${target_label}",
     prompt="""
       You are Aristotle's Reflector subagent.
       Read and execute: ${SKILL_DIR}/REFLECTOR.md
       TARGET_SESSION_ID: ${target_session_id}
       PROJECT_DIRECTORY: ${project_directory}
       USER_LANGUAGE: ${user_language}
       FOCUS_HINT: ${focus_hint}
       DRAFT_SEQUENCE: ${sequence_number from F4}
     """)
→ proceed to F4 immediately. Do NOT explain what you are about to do.
```

---

## STEP F4: CREATE STATE RECORD

```
aristotle_create_reflection_record(
    target_session_id, target_label,
    reflector_session_id="<from task() result>")
→ persists to ~/.config/opencode/aristotle-state.json
→ handles sequence numbering, JSON read/write, 50-record pruning
→ store returned review_index and id
→ do NOT display state file to user
```

---

## STEP F5: NOTIFY USER

```
🦉 Aristotle Reflector launched [${target_label}].
   task_id: bg_xxxxx | session_id: ses_xxxxx
Checker will validate automatically when done.
STOP. Wait for completion.
```

---

## STEP F5.5: FIRE CHECKER

```
on Reflector completion:
task(category="unspecified-low", load_skills=[] (do NOT load aristotle recursively), run_in_background=true,
       description="Aristotle Checker: validate + commit",
       prompt="""
         You are Aristotle's Checker subagent.
         Read and execute: ${SKILL_DIR}/CHECKER.md
         DRAFT_SEQUENCE: ${sequence_number}
         DRAFT_FILE: ~/.config/opencode/aristotle-drafts/rec_${seq}.md
         PROJECT_DIRECTORY: ${project_directory}
       """)
  do NOT output intermediate info → wait for C completion
```

---

## STEP F6: HANDLE CHECKER COMPLETION

```
aristotle_complete_reflection_record(
    sequence=sequence_number,
    status=<auto_committed|partial_commit|checker_failed>,
    rules_count=<from C result>)

output ONE-LINE notification:
  🦉 Aristotle done [${target_label}]. ${committed} committed, ${staged} staged.
     Review: /aristotle review N

passive-trigger variant:
  🦉 Aristotle done [auto-detected error]. ...

do NOT output DRAFT content, rule details, or intermediate data
```
