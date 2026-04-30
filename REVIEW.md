# Aristotle Review Protocol

> Review phase only. Do NOT load during REFLECT.
> Operates on already-committed/staged rules processed by Checker.

---

## STEP V1: LOAD & PRESENT

```
orchestrate_start("review", {sequence: N})
  → 404? → "🦉 Reflection #N not found. Run /aristotle sessions to list." STOP
  → ok?  → display enriched notification to user
           (includes Δ, audit_level, per-rule confidence/risk, conflicts, DRAFT summary)
           staging rules are numbered 1, 2, 3… — these N are used below
```

### Action Menu

```
- "confirm"                 — accept all staging rules (auto-commit)
- "reject"                  — reject this reflection
- "修改 N: feedback"         — revise rule #N
- "inspect N"               — view full rule file #N (frontmatter + body)
- "show draft"              — view full DRAFT report
- "re-reflect"              → STEP V6
```

---

## STEP V2: PROCESS ACTIONS

```
loop:
  match user_input:
    "confirm"     → "✅ No changes. Rules remain as committed." STOP

    "inspect N"   → orchestrate_review_action(wf_id, "inspect",
                     json.dumps({"rule_index": N}))
                   display result (errors handled by backend messages)
                   → loop

    "show draft"  → orchestrate_review_action(wf_id, "show draft")
                   display result (errors handled by backend messages)
                   → loop

    "修改 N: fb"   → write_rule(updated_content)  // creates pending
                   → stage_rule()                  // staging
                   → STEP V4 (validate)
                   → pass? commit_rule() + "✅ revised"
                   → fail?  present issue → user decides force/cancel/retry
                   → loop

    "reject"      → reject_rule(file_path, reason="user rejected")
                   → "❌ Rule rejected." → STEP V5

    "re-reflect"  → STEP V6

    natural_lang  → interpret, adjust, re-present → loop
```

---

## STEP V3: SESSION UNAVAILABLE

```
DRAFT file missing AND session unavailable:
  → offer: "re-reflect" (fire new Reflector on same target session)
           "reject"     (discard this record)
```

---

## STEP V4: POST-HOC VALIDATION

Applies when user modifies a committed rule.

```
validate(rule):
  schema:
    category ∈ 8 valid categories
    intent_tags.domain + task_goal non-empty
    error_summary ≤ 200 chars

  delta_audit:
    get_audit_decision(file_path) → audit_level
    "auto"   → commit without confirmation
    "semi"   → present diff, wait for user
    "manual" → mandatory detailed review

  content:
    consistent with original error from DRAFT
    no logical contradiction with Incident
    specific and actionable (not "be more careful")

  outcome:
    all pass  → auto-commit, append "Revised: [DATE]" timestamp
    schema    → auto-correct trivial, then commit
    content   → present issue:
                  "⚠️ [problem]"
                  options: "force" / "cancel" / "修改: feedback"
```

---

## STEP V5: UPDATE STATE

```
after modification or rejection:
  complete_reflection_record(sequence, status, rules_count)
  // do NOT display state file to user
```

---

## STEP V6: RE-REFLECT

```
re-reflect(DRAFT):
  target_session_id = DRAFT.target_session_id
  load REFLECT.md

  focus = match user_intent:
    "specific error"  → around [message_number] from DRAFT Location
    "deeper analysis" → around [scanned_range] (same window)
    "there's more"    → expand beyond original scanned_range

  fire NEW Reflector(focus)
  on completion → load NEW DRAFT → STEP V2

cross-session ("/aristotle review N --cross M"):
  load DRAFT_N + DRAFT_M (fallback to STEP V3 if unavailable)
  cross-analyze: recurring patterns, systemic mistakes, same root cause
  check if prior rules should have prevented current errors
  generate merged draft → STEP V2
```

---

## Permissions

```
review mode allows:
  READ   DRAFT files, MCP tools, state file
  WRITE  rules (append-only, MCP dedup), state file
  CALL   orchestrate_review_action, write_rule, stage_rule,
         commit_rule, reject_rule, get_audit_decision
  FIRE   new Reflector (loads REFLECT.md)
  DO NOT display state file content to user
```
