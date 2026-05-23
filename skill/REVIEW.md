# Aristotle Review Protocol (Post-Hoc Review)

> Review phase only. Do NOT load during REFLECT.
> Operates on already-committed/staged rules processed by Checker.

This file defines how to load DRAFT records and committed rules, present them to the user,
and handle modifications, rejections, and re-reflections.

---

## STEP V1: LOAD & PRESENT

```
orchestrate_start("review", {sequence: N})
  internally: read state file → find N-th record → read DRAFT from draft_file_path
              (DRAFT missing? fallback: session_read(reflector_session_id))
              (still unavailable? → STEP V3)
              → read_rules(status="all", source_session=target_session_id)
                (if no results → fallback: keyword matching against session_id)
  → 404? → "🦉 Reflection #N not found. Run /aristotle sessions to list." STOP
  → ok?  → display two parts to user:
           Part A — message field: review data (header, Δ, DRAFT summary, rules)
           Part B — review_actions field: structured action menu
                    Present as a numbered list using each option's label and description.
                    Use review_actions.workflow_id for subsequent orchestrate_review_action calls.
           staging rules are numbered 1, 2, 3… — these N are used below
```

### Action Menu

```
- "confirm" / "确认"           — accept all staging rules (auto-commit; absent when no staging rules)
- "reject"                    — reject this reflection (all staging rules)
- "reject N"                  — reject specific rule #N
- "修改 N: feedback" / "revise N: feedback" — revise rule #N
- "inspect N"                 — view full rule file #N (frontmatter + body)
- "show draft"                — view full DRAFT report
- "re-reflect" / "重新反思"    → STEP V6
```

---

## STEP V2: PROCESS ACTIONS

```
loop:
  match user_input:
    "confirm" / "确认"
                  → "✅ No changes. Rules remain as committed." STOP
                  (absent from action menu when no staging rules — verified-only review)

    "inspect N"   → orchestrate_review_action(wf_id, "inspect",
                     json.dumps({"rule_index": N}))
                   display full rule file content (frontmatter + body)
                   (errors handled by backend messages)
                   → loop

    "show draft"  → orchestrate_review_action(wf_id, "show draft")
                   display result (errors handled by backend messages)
                   → loop

    "修改 N: fb" / "revise N: fb"
                   → construct revised rule content based on user feedback
                    → write_rule(updated_content)  // creates pending
                    (write_rule fails? → output error, return to V2 for alternative feedback)
                    → stage_rule()                  // staging
                   → STEP V4 (validate)
                   → pass? commit_rule() + "✅ revised"
                   → fail?  present issue → user decides force/cancel/retry
                   → loop

    "reject"      → reject_rule(file_path, reason="user rejected")
                   → "❌ Rule rejected." → STEP V5

    "reject N"    → locate rule #N by staging_rule_paths[N-1]
                   → reject_rule(file_path, reason="user rejected")
                   → "❌ Rule [rule_id] rejected." → loop

    "re-reflect" / "重新反思"
                  → STEP V6

    natural_lang  → interpret, adjust, re-present → loop
```

---

## STEP V3: SESSION UNAVAILABLE

```
DRAFT file missing AND session unavailable:
  → display:
    "🦉 Reflection #N — Session Unavailable"
    "The DRAFT file and Reflector session for this record are no longer available."
    Options:
      1. Re-reflect — fire new Reflector on same target session
         Run: /aristotle --focus full session <target_session_id>
      2. Reject — discard this record
         Say: "reject"
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
    "manual" → mandatory detailed review with full validation

  content:
    consistent with original error from DRAFT
    no logical contradiction with Incident
    specific and actionable (not "be more careful")

  outcome:
    all pass  → auto-commit, append _Revised: [DATE]_ timestamp to ALL modified rules
    schema    → auto-correct trivial, append _Revised: [DATE]_ timestamp, then commit
    content   → present issue:
                   "⚠️ [problem]"
                   options: "force" (commit anyway) / "cancel" (keep original) / "修改: feedback"
```

---

## STEP V5: UPDATE STATE

```
after modification or rejection:
  status: "revised" (if modified) or existing status (if confirmed)
  rules_count: update if rules were added/removed
  complete_reflection_record(sequence, status, rules_count)
  // do NOT display state file to user
```

---

## STEP V6: RE-REFLECT

```
re-reflect(DRAFT):
  target_session_id = DRAFT.target_session_id
  load ${SKILL_DIR}/REFLECT.md

  focus = match user_intent:
    "specific error"  → around [message_number] from DRAFT Location
    "deeper analysis" → around [scanned_range] (same window)
    "there's more"    → expand beyond original scanned_range

  fire NEW Reflector(focus)
  on completion → load NEW DRAFT → STEP V2

cross-session ("/aristotle review N --cross M"):
  load DRAFT_N + DRAFT_M (fallback to STEP V3 if unavailable)
  cross-analyze: recurring patterns, systemic repeated mistakes, same category/root cause
  check if prior rules should have prevented current errors
  generate merged draft → STEP V2
```

---

## Permissions

```
review mode allows (user explicitly requested this):
  READ   DRAFT files, MCP tools, state file
  WRITE  rules (APPEND ONLY, NO DUPLICATES — MCP handles dedup via file naming), state file
  CALL   orchestrate_review_action, write_rule, stage_rule,
         commit_rule, reject_rule, get_audit_decision
  FIRE   new Reflector (loads REFLECT.md)
  VALIDATE user modifications (C role for post-hoc changes)
  DO NOT display state file content to user
```
