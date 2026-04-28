# Aristotle Review Protocol (Post-Hoc Review)

> Loaded only during the REVIEW phase. Do NOT load during REFLECT.
> Review operates on already-committed rules. Rules were processed (auto-committed or staged) by the Checker subagent.

This file defines how to load DRAFT records and committed rules, present them to the user, and handle modifications, rejections, and re-reflections.

---

## STEP V1: LOAD DRAFT AND RULES

When the user runs `/aristotle review N`:

1. Read `~/.config/opencode/aristotle-state.json`, find the N-th record (1-indexed)
2. If not found: output `"🦉 Reflection #N not found. Run /aristotle sessions to list."` and STOP
3. Read the DRAFT file from the record's `draft_file_path` field
4. If draft file not found:
   a. Fallback: try `session_read(session_id=<reflector_session_id>)` to extract DRAFT from session
   b. If session also unavailable: go to STEP V3
5. Read committed rules by querying MCP: `read_rules(status="all", source_session=<target_session_id>)` or keyword matching against session ID
6. Present both DRAFT and rules to the user

### Presentation Format

```
🦉 Aristotle Review #N — [target_label]
════════════════════════════════════════

## DRAFT (Original Reflection Record)
[Full DRAFT report from file]

## Committed Rules
[For each rule found:]
  • Rule [rule_id]: [SHORT_TITLE]
    Status: ✅ verified / 📋 staging / ❌ rejected
    Scope: user / project
    Δ: [delta value]
    File: [file_path]

## Options
- "修改 N: feedback" — Revise rule N
- "reject N" — Reject rule N
- "confirm" — No changes needed
- "re-reflect" — Fire new Reflector for deeper analysis
```

---

## STEP V2: PROCESS USER FEEDBACK

**If "confirm" / "确认":**
No operation needed. Rules are already committed.
Output: "✅ No changes. Rules remain as committed."

**If "修改 N: feedback" / "revise N: feedback":**
1. Locate the target rule by N (1-indexed from the displayed list)
2. Construct revised rule content based on user feedback
3. Write revised rule via MCP:
   a. Call `write_rule()` with updated content (creates new pending file)
      - If `write_rule` fails → output error, return to STEP V2 for alternative feedback
   b. Call `stage_rule()` (moves to staging)
   c. Execute content validation (STEP V4 below)
   d. If validation passes → call `commit_rule()` → output success
   e. If validation finds issues → present issues to user for decision

**If "reject N":**
1. Locate the target rule
2. Call `reject_rule(file_path, reason="user rejected")`
3. Output: "❌ Rule [rule_id] rejected."

**If "re-reflect" / "重新反思":**
1. Extract from DRAFT: target_session_id, scanned_range
2. Read `${SKILL_DIR}/REFLECT.md` to load reflect protocol
3. Fire NEW Reflector subagent with focus based on user's instruction
4. Return to REFLECT.md flow

**If natural language feedback:**
Interpret, adjust, re-present → loop back to STEP V2

---

## STEP V3: HANDLE SESSION UNAVAILABLE

If both DRAFT file and Reflector session are unavailable:

```
🦉 Reflection #N — Session Unavailable

The DRAFT file and Reflector session for this record are no longer available.

Options:
1. Re-reflect — Fire a new Reflector on the same target session
   Run: /aristotle --focus full session <target_session_id>
2. Reject — Mark this record as discarded
   Say: "reject"
```

---

## STEP V4: POST-HOC VALIDATION (C Role for User Modifications)

When the user modifies an already-committed rule, validate the modification:

### Schema Validation
- category is one of the 8 valid categories
- intent_tags.domain and intent_tags.task_goal are non-empty
- error_summary ≤ 200 characters

### Δ Audit Decision
Call `get_audit_decision(file_path)` → returns `{delta, audit_level, thresholds}`.
- `audit_level` "auto" → auto-commit without user confirmation
- `audit_level` "semi" → present diff, wait for user commit/reject
- `audit_level` "manual" → mandatory detailed review with full validation

### Content Validation
1. **Consistency with original error** — Does the modified rule still address the error from the DRAFT?
2. **No logical contradiction** — Does the proposed rule contradict the Incident?
3. **Rule quality** — Is the modified rule specific and actionable (not "be more careful")?

### Outcome
- ALL checks pass → auto-commit, output: "✅ Rule revised and committed."
- Schema failure → auto-correct trivial issues, then commit
- Content issue detected → present specific problem to user:
  ```
  ⚠️ Validation issue with revision:
  - [specific problem description]

  Options: "force" (commit anyway) / "cancel" (keep original) / "修改: feedback"
  ```

Append `_Revised: [DATE]_` timestamp to modified rules.

---

## STEP V5: UPDATE STATE FILE

After any modification or rejection:

1. Read current state file
2. Find the matching record
3. Update:
   - status: "revised" (if modified) or the existing status (if confirmed)
   - rules_count: update if rules were added/removed
4. Write back to state file
5. Do NOT display state file content to user

---

## STEP V6: CROSS-SESSION REFLECTION AND RE-REFLECT

When user requests cross-session analysis (`/aristotle review N --cross M`):

1. Load both DRAFT reports from records N and M. If either DRAFT is unavailable → fall back to STEP V3 for that record
2. Cross-analyze: recurring patterns, systemic repeated mistakes, same category/root cause
3. Check if rules from a previous reflection should have prevented the current errors
4. Generate merged draft rules → return to STEP V2 for confirm/revise/reject

When user says "re-reflect" during review:

1. Extract from DRAFT: target_session_id, scanned_range
2. Read `${SKILL_DIR}/REFLECT.md` to load reflect protocol
3. Fire NEW Reflector subagent with **enhanced focus**:
   - User mentions a specific error → `around [message_number]` from that error's Location field
   - User says "deeper analysis" → `around [scanned_range]` (re-analyze same window)
   - User says "I think there's more" → expand beyond original `scanned_range`
4. After completion, load NEW DRAFT report (replacing current one)
5. Return to STEP V2 for user feedback

---

## Review Mode Permissions

In Review mode, the Coordinator IS allowed to:
- ✅ Read DRAFT files from disk
- ✅ Call MCP tools (read_rules, write_rule, stage_rule, commit_rule, reject_rule)
- ✅ Present DRAFT and rules to user (user explicitly requested this)
- ✅ Validate user modifications (C role for post-hoc changes)
- ✅ Update state file
- ✅ Fire new Reflector for re-reflect
- ✅ Write rules (APPEND ONLY, NO DUPLICATES — MCP handles dedup via file naming)
- ✅ Re-reflect with deeper analysis (loading REFLECT.md)
