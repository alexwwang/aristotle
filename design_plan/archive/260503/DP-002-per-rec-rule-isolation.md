# DP-002: Per-Rec Rule Isolation

| Field | Value |
|-------|-------|
| Status | APPROVED |
| Priority | P1 |
| Scope | MCP backend + Checker protocol |
| Depends on | None |
| Blocks | — |

## Problem Statement

`/aristotle review N` returns **all** staging rules instead of only the rules produced by reflection #N.

### Root Cause

Two issues combine to cause this bug:

1. **`target_session_id` is empty** for all existing reflection records (Bridge mode did not populate this field). The review code uses `keyword=target_session_id` to filter rules via `list_rules()`. When the keyword is empty/None, the regex filter is skipped entirely, returning all rules.

2. **Even with `target_session_id` populated**, the association would still be wrong. `target_session_id` is the session being *analyzed* (N recs can analyze the same session). Rule `source_session` matches `target_session_id`, not the rec's `reflector_session_id`. Multiple recs analyzing the same session would share the same `target_session_id`, so `review rec_3` would show rules from `rec_3` AND `rec_5` if they both analyzed the same session.

3. **No 1:1 binding exists** between a rule and the reflection record (sequence number) that produced it.

### Evidence

```
rec_1..rec_6: target_session_id = '' or None  (all empty)
rules:         source_session ∈ {ses_221a492e..., ses_22cd4344..., ses_21a0afbf...}
rec_1..rec_6: reflector_session_id ∈ {ses_22c4dd33..., ses_220ce8d9..., ses_2209746c...}

# reflector_session_ids ≠ rule source_sessions (different sessions)
# recs and rules have NO join key
```

## Proposed Solution

Add a `reflection_sequence` integer field to rule frontmatter. This provides a **direct 1:1 foreign key** from each rule to the reflection record (`rec_N`) that produced it.

### Data Flow

```
R completes → workflow.sequence = N
           → C launched with DRAFT_SEQUENCE: N
           → C calls write_rule(..., reflection_sequence=N)
           → rule frontmatter: reflection_sequence: N

review rec_N → list_rules(reflection_sequence=N)
            → returns only rules where reflection_sequence == N
```

## Changes

### Phase 1: Data Model

**`models.py` — `RuleMetadata` dataclass**

Add field:
```python
reflection_sequence: int | None = None  # rec_N that produced this rule
```

Update `to_frontmatter_string()`:
```python
"reflection_sequence": metadata.reflection_sequence,
```
Note: `to_frontmatter_string()` is test-only code. The production write path uses `metadata.__dict__` → `write_rule_file()`. Update both for consistency.

Update `from_frontmatter_dict()`:
```python
reflection_sequence=int(data["reflection_sequence"]) if data.get("reflection_sequence") is not None else None,
```

**`frontmatter.py` — `write_rule_file()` None-skip list**

Add `"reflection_sequence"` to the None-skip tuple at `frontmatter.py:138` (alongside `sample_size`, `feedback_count`) to prevent `reflection_sequence: null` clutter in rule frontmatter for non-C callers.

**`frontmatter.py` — `stream_filter_rules()`**

Add `reflection_sequence` parameter:
```python
def stream_filter_rules(
    ...
    reflection_sequence: int | None = None,
) -> list[Path]:
```

Add exact-match filter (cheap — read from first-line frontmatter, no YAML parse needed):
```python
if reflection_sequence is not None:
    if reflection_sequence < 1:
        raise ValueError(f"reflection_sequence must be >= 1, got {reflection_sequence}")
    m = _REFLECTION_SEQ_RE.search(fm_text)
    if not m or int(m.group(1)) != reflection_sequence:
        continue
```

Design notes:
- Guard uses `is not None` (not truthiness) to avoid silently skipping `reflection_sequence=0`. Input validation rejects `0` explicitly.
- Rules with `reflection_sequence: null` or missing the field entirely: regex won't match → excluded. This is correct — unlinked rules should not appear in filtered reviews.
- `write_rule_file` serializes `None` as `reflection_sequence: null`. The regex only matches positive integers, so `null` is treated as "no field." For cleaner frontmatter, add `reflection_sequence` to the `None`-skip list in `write_rule_file` (alongside `sample_size`, `feedback_count`).

Pre-compile regex: `_REFLECTION_SEQ_RE = re.compile(r'^reflection_sequence:\s*(\d+)', re.MULTILINE)`

### Phase 2: Write Path

**`_tools_rules.py` — `write_rule()`**

Add parameter:
```python
def write_rule(
    ...
    reflection_sequence: int | None = None,
) -> dict:
```

Pass to `RuleMetadata(reflection_sequence=reflection_sequence, ...)`.

Note: Default `None` is critical — existing callers (conflict detection, feedback, learn flow) do not pass this parameter and must continue working unchanged. `write_rule()` passes `metadata.__dict__` to `write_rule_file()` which iterates all dict keys — so `reflection_sequence` will be included automatically. No separate serialization change needed in `_tools_rules.py`.

**`CHECKER.md` — STEP C5**

Update the write_rule call in STEP C5 to include `reflection_sequence=DRAFT_SEQUENCE`:

```
for each validated Reflection:
  1. aristotle_write_rule(
       content, scope, category, source_session, message_range,
       reflection_sequence=DRAFT_SEQUENCE,
       intent_domain, intent_task_goal, failed_skill, error_summary,
       rule_summary=<Proposed Rule text from DRAFT Reflection>,
       project_path, confidence=0.7)
     → returns file_path, rule_id

  2. aristotle_stage_rule(file_path)

### Phase 3: Read Path (Review)

**`_orch_start.py` — `orchestrate_start("review")` record lookup**

Current code uses array index (`i + 1 == sequence`) which breaks after 50-record FIFO pruning — same bug as Phase 4.5. Fix first, before the rules query:

```python
# Replace (lines 172-176):
target_record = None
for i, r in enumerate(records):
    if i + 1 == sequence:
        target_record = r
        break

# With ID-based lookup:
target_id = f"rec_{sequence}"
target_record = next((r for r in records if r.get("id") == target_id), None)
```

**`_orch_start.py` — `orchestrate_start("review")` rules query**

Replace:
```python
target_session = target_record.get("target_session_id", "")
rules_result = list_rules(
    status_filter="all",
    keyword=target_session,
    limit=0,
)
```

With:
```python
rules_result = list_rules(
    status_filter="all",
    reflection_sequence=sequence,
    limit=0,
)
```

Note: `limit=0` means no limit. After `reflection_sequence` filtering, typical result is 2-5 rules. Setting `limit=0` prevents silent data loss if a rec produces >20 rules.

**⚠️ Guard fix required**: Current code treats `limit=0` as "return nothing" (`if remaining <= 0: break`). Three guard points must be changed to use truthiness check:

`frontmatter.py` `stream_filter_rules` line 122:
```python
# Before:
if len(results) >= limit:
    break
# After:
if limit and len(results) >= limit:
    break
```

`_tools_rules.py` `list_rules` line 650 and `read_rules` line 283:
```python
# Before:
if remaining <= 0:
    break
# After:
if limit and remaining <= 0:
    break
```

All existing callers pass positive integers, so they are unaffected.

**`_tools_rules.py` — `list_rules()`**

Add parameter and pass through:
```python
def list_rules(
    ...
    reflection_sequence: int | None = None,
) -> dict:
```

Pass to `stream_filter_rules(reflection_sequence=reflection_sequence, ...)`.

**`_tools_rules.py` — `read_rules()`**

`read_rules()` is a public MCP tool that also calls `stream_filter_rules()`. Add `reflection_sequence` parameter for API consistency. Currently only used by `learn` flow (which doesn't need it), but future consumers may benefit.

Add same parameter signature as `list_rules()`, pass through identically.

### Phase 4: Confirm/Reject Paths

**`_orch_event.py` — revise rule preservation**

When a rule is revised via `orchestrate_review_action("revise")`, the O subagent produces new rule content. The event handler preserves selected frontmatter keys from the original file. `reflection_sequence` is a **system-controlled integrity field** — it must be force-restored unconditionally, not via the guarded `key not in new_fm` check (O may write `reflection_sequence: null`, which passes the guard but drops the binding):

```python
# Force-restore system-controlled field BEFORE the guarded loop:
if "reflection_sequence" in original_fm:
    update_frontmatter_field(resolved, "reflection_sequence", original_fm["reflection_sequence"])

for key in ("created_at", "source_session", "scope", "project_hash"):
    if key in original_fm and key not in new_fm:
        update_frontmatter_field(resolved, key, original_fm[key])
```

**`_orch_review.py` — `confirm` action**

The confirm action uses `workflow["committed_rule_paths"]` (pre-recorded paths from the review workflow). **However**, when C produces 0 valid rules, `committed_rule_paths = []` and `if rule_paths:` evaluates to `False`, routing to the legacy `keyword=target_session` path which is broken (returns all rules when `target_session_id` is empty).

Fix: Replace the legacy fallback with `reflection_sequence` filtering:
```python
# Legacy fallback replacement (line 68-80):
else:
    rules_result = list_rules(status_filter="all", reflection_sequence=sequence, limit=0)
    for r in rules_result.get("rules", []):
        meta = r.get("metadata", {})
        if meta.get("status") == "staging":
            try:
                commit_rule(file_path=r.get("path", ""))
                committed += 1
            except Exception:
                failed += 1
        elif meta.get("status") == "verified":
            committed += 1
```

This ensures post-DP-002 confirm always scopes to rec_N rules, even when `committed_rule_paths` is empty.

**`_orch_review.py` — `reject` action**

Current code uses `keyword=target_session` to find all staging rules. After DP-002, reject should use `reflection_sequence`:

```python
# Before:
rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)

# After:
rules_result = list_rules(status_filter="all", reflection_sequence=sequence, limit=0)
```

**`_orch_event.py` — checker completion (subagent_done + checking)**

Current code at line 298-305:
```python
target_session = workflow.get("target_session_id", "")
rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)
...
if meta_r.get("source_session") == target_session and r.get("path"):
```

After DP-002:
```python
sequence = workflow.get("sequence")
rules_result = list_rules(status_filter="all", reflection_sequence=sequence, limit=0)
...
# stream_filter_rules already guarantees reflection_sequence == sequence
# Simplified: no secondary filter needed beyond path existence check
if r.get("path"):
```

### Phase 4.5: Fix Pre-existing Bug — `_update_record_field` Index Corruption

**`_tools_reflection.py` — `_update_record_field()`**

Current code uses array indexing (`records[sequence - 1]`) which breaks after the 50-record FIFO pruning in `create_reflection_record()`. After pruning, index 0 ≠ rec_1.

Fix: Use ID-based lookup (same pattern as `complete_reflection_record()`):
```python
# Before (line 169):
idx = sequence - 1

# After:
target_id = f"rec_{sequence}"
idx = next((i for i, r in enumerate(records) if r.get("id") == target_id), -1)
```

**Why this matters for DP-002**: `_orch_event.py:317` calls `_update_record_field(sequence, "committed_rule_paths", rule_paths)` after checker completion. Corrupted indexing would write rule paths to the wrong record, breaking confirm's `committed_rule_paths` path.

### Phase 5: Backfill Migration

**`migration.py` — new function `_backfill_reflection_sequence()`**

For existing rules without `reflection_sequence`:
1. For each rec with non-empty `committed_rule_paths`, set `reflection_sequence` on those rule files
2. For remaining unassigned staging/rejected rules: match `rule.source_session` against `rec.target_session_id` (NOT `reflector_session_id` — that's R's own session, not the analyzed one). Multiple recs may share the same `target_session_id`; pick the chronologically nearest match by comparing `rule.created_at` to `rec.launched_at`. If no match found, leave as `null`.
3. Rules that can't be correlated get `reflection_sequence: null` — they won't appear in filtered `review rec_N` calls. Acceptable edge case for historical data.

This is a **one-time migration**, run manually via `aristotle_mcp.migration._backfill_reflection_sequence()`.

## Files Changed

| File | Change | Risk |
|------|--------|------|
| `aristotle_mcp/models.py` | Add `reflection_sequence` field + serialize/deserialize | Low |
| `aristotle_mcp/frontmatter.py` | Add `reflection_sequence` filter + fix `limit=0` guard in `stream_filter_rules` | Low |
| `aristotle_mcp/_tools_rules.py` | Add `reflection_sequence` param to `write_rule` + `list_rules` + `read_rules` + fix `limit=0` guards | Low |
| `aristotle_mcp/_orch_start.py` | Review branch: ID-based record lookup + `reflection_sequence` filter | Medium |
| `aristotle_mcp/_orch_review.py` | Confirm/reject: use `reflection_sequence` fallback | Medium |
| `aristotle_mcp/_orch_event.py` | Checker completion: `reflection_sequence` + unconditional preserve in revise | Medium |
| `aristotle_mcp/_tools_reflection.py` | Fix `_update_record_field` ID-based lookup (Phase 4.5) | Medium |
| `aristotle_mcp/migration.py` | Backfill function | Low |
| `CHECKER.md` | Update STEP C5 write_rule call with `reflection_sequence=DRAFT_SEQUENCE` | Low |
| `test/test_review_ux.py` | 12 new tests for per-rec isolation | — |

## Non-affected Callers

The following callers of `list_rules()` / `stream_filter_rules()` / `read_rules()` intentionally do NOT need `reflection_sequence` filtering. Documented to prevent over-application:

| Caller | File | Why excluded |
|--------|------|-------------|
| `commit_rule` conflict detection | `_tools_rules.py:416` | Searches by rule ID keyword |
| `detect_conflicts` | `_tools_rules.py:717` | Intent-tag based search |
| `report_feedback` | `_tools_feedback.py:43` | Keyword search by rule ID |
| Learn flow scoring | `_orch_parsers.py:283` | Searches verified rules by intent |
| `check_sync_status` | `_tools_sync.py:60` | Scans all verified rules |
| Feedback-triggered reflection | `_tools_feedback.py` | Goes through full C pipeline; gets `reflection_sequence` via `DRAFT_SEQUENCE` naturally |

## Test Plan

### UT-01: write_rule stores reflection_sequence
- Call `write_rule(content=..., reflection_sequence=3)`
- Read the rule file
- Assert frontmatter contains `reflection_sequence: 3`

### UT-02: list_rules filters by reflection_sequence
- Create rules with `reflection_sequence=1` and `reflection_sequence=2`
- Call `list_rules(reflection_sequence=1)`
- Assert only rec-1 rules returned

### UT-03: review rec_N returns only rec_N rules
- Create rec_1 with 2 rules (reflection_sequence=1)
- Create rec_2 with 3 rules (reflection_sequence=2)
- Call `orchestrate_start("review", {"sequence": 1})`
- Assert staging_rules count == 2, all have reflection_sequence=1

### UT-04: review rec with no rules shows "no rules"
- Create rec_5 with no rules (reflection_sequence=5)
- Call `orchestrate_start("review", {"sequence": 5})`
- Assert "no rules" or "No rules require review" in output

### UT-05: reject rec_N only rejects rec_N rules
- Create rec_1 with 2 staging rules, rec_2 with 2 staging rules
- Start review for rec_1, call `orchestrate_review_action(wf_id, "reject")`
- Assert rec_1 rules are rejected, rec_2 rules still staging

### UT-06: confirm rec_N only commits rec_N rules
- Create rec_1 with 2 staging rules, rec_2 with 2 staging rules
- Start review for rec_1, call `orchestrate_review_action(wf_id, "confirm")`
- Assert rec_1 rules are committed, rec_2 rules still staging

### UT-07: rules without reflection_sequence are excluded from filtered review
- Create 1 rule WITHOUT reflection_sequence
- Create rec_3 with 1 rule WITH reflection_sequence=3
- Review rec_3
- Assert only 1 rule shown (the one with reflection_sequence=3)

### UT-08: backward compatibility — old workflow confirm still works
- Create review workflow with `committed_rule_paths` (pre-DP-002 style)
- Confirm should use paths directly, not list_rules

### UT-09: checker completion collects only reflection_sequence=N rules
- Create 2 rules with reflection_sequence=3 and 1 rule with reflection_sequence=4
- Simulate checker completion for sequence=3
- Assert `committed_rule_paths` contains only the 2 rules with reflection_sequence=3

### UT-10: revise preserves reflection_sequence
- Create a rule with reflection_sequence=3
- Simulate revise action (O subagent writes new content with `reflection_sequence: null`)
- Assert the rule file still has `reflection_sequence: 3` after revise (force-restored)

### UT-11: review after 50-record pruning still finds correct rec
- Create 60 records (triggers pruning to 50)
- Create rules with reflection_sequence=42
- Call `orchestrate_start("review", {"sequence": 42})`
- Assert review finds rec_42 (not "not found")

### UT-12: confirm after pruning commits correct rules
- Create 60 records, 2 staging rules with reflection_sequence=55
- Review rec_55, confirm
- Assert only rec_55 rules committed

## Alternatives Considered

### A1: Use source_session + target_session_id matching
Rejected: same session can be analyzed by multiple recs. N:1 relationship doesn't guarantee isolation.

### A2: Use reflector_session_id as join key
Rejected: Rules are written by Checker, not Reflector. `source_session` in rules = target session, not reflector session. Mismatch.

### A3: Store rule_paths in rec at write time
Rejected: Requires real-time updates to `aristotle-state.json` as Checker writes each rule. Fragile — if C crashes mid-write, partial state. The `committed_rule_paths` pattern works for post-hoc collection, but pre-staging path collection is unreliable.

### A4: Add reflection_sequence to workflow, filter at review time only
Rejected: Doesn't help with reject/confirm actions that also use `list_rules()` to find rules by session. The field needs to be on the rule itself.

## Success Checklist

- [ ] All 12 unit tests pass
- [ ] Existing 68 tests still pass (no regression)
- [ ] `review rec_N` returns only rules with `reflection_sequence=N`
- [ ] `confirm` only commits rec_N rules
- [ ] `reject` only rejects rec_N rules
- [ ] `revise` preserves `reflection_sequence` in rule frontmatter
- [ ] Checker completion collects only `reflection_sequence=N` rules
- [ ] Old workflows (pre-DP-002) still work via `committed_rule_paths` fallback
- [ ] CHECKER.md updated with `reflection_sequence=DRAFT_SEQUENCE` in STEP C5
- [ ] Backfill migration tested on existing data

## Review History

### R1: Oracle (ora-2)
Result: REQUEST_CHANGES (3C + 5M + 3L)

| ID | Sev | Issue | Resolution |
|----|-----|-------|------------|
| C1 | C | Filter guard `if reflection_sequence:` falsy on 0 | Fixed: `is not None` + input validation |
| C2 | C | `write_rule_file` null handling undocumented | Fixed: explicit design note added |
| C3 | C | Revise path loses `reflection_sequence` | Fixed: added to preservation tuple |
| M1 | M | `read_rules()` not updated | Fixed: added to Phase 3 scope |
| M2 | M | Confirm legacy fallback mischaracterized | Fixed: documented as pre-existing bug |
| M3 | M | `write_rule_file` dict iteration not documented | Fixed: added note in Phase 2 |
| M4 | M | CHECKER.md update underspecified | Fixed: full STEP C5 code block shown |
| M5 | M | Redundant secondary filter in checker completion | Fixed: simplified to `if r.get("path"):` |
| L1 | L | Migration algorithm underspecified | Fixed: committed_rule_paths first, source_session fallback |
| L2 | L | No test for checker completion path | Fixed: added UT-09, UT-10 |
| L3 | L | limit 20→50 without justification | Fixed: reverted to 20 |

### R2: Oracle (ora-2)
Result: APPROVE (0C + 0M + 1L)

| ID | Sev | Issue | Resolution |
|----|-----|-------|------------|
| L1 | L | Stale formatting artifact at lines 130-134 | Fixed: removed duplicate code block |

### R3: Council (cnc-2)
Result: APPROVE (0C + 2M + 4L)

| ID | Sev | Issue | Resolution |
|----|-----|-------|------------|
| M1 | M | `from_frontmatter_dict` needs explicit int conversion | Fixed: added `int(...) if ... is not None else None` |
| M2 | M | Default `None` not explicitly stated for backward compat | Fixed: added note about existing callers |
| L3 | L | 6 non-affected callers undocumented | Fixed: added "Non-affected Callers" section |
| L4 | L | Feedback-triggered reflection path not acknowledged | Fixed: covered in Non-affected Callers table |
| L5 | L | Regex matches `0` which validation rejects | Not adopted: no functional impact |
| L6 | L | None-skip list cosmetic recommendation | Adopted: added to Phase 1 |

### R4: Oracle-ds4p (ora-ds4p-1)
Result: REQUEST_CHANGES (0C + 3M + 6L)

| ID | Sev | Issue | Resolution |
|----|-----|-------|------------|
| M1 | M | Confirm fallback triggers on `committed_rule_paths = []` (0-rule recs) | Fixed: legacy fallback now uses `reflection_sequence=sequence` |
| M2 | M | `_update_record_field` array-indexing breaks after 50-record pruning | Fixed: new Phase 4.5 with ID-based lookup |
| M3 | M | Migration algorithm references wrong field (`reflector_session_id` vs `target_session_id`) | Fixed: corrected to `target_session_id` + multi-match disambiguation |
| L1 | L | `to_frontmatter_string` is dead code in write path | Adopted: added note |
| L2 | L | `reflection_sequence: null` written for non-C callers | Adopted: added to None-skip list in Phase 1 |
| L3 | L | No schema documentation for `reflection_sequence` | Deferred: can be added during implementation |
| L4 | L | `_next_sequence()` not concurrency-safe | Noted: single-user CLI, theoretical risk |
| L5 | L | Negative sequence numbers pass initial validation | Noted: pre-existing, not DP-002 scope |
| L6 | L | Regex matches digit `0` | Not adopted: consistent with R3 L5 |

### R5: Oracle-ds4f (ora-ds4f-1)
Result: REQUEST_CHANGES (1C + 2M + 4L)

| ID | Sev | Issue | Resolution |
|----|-----|-------|------------|
| C1 | C | `_orch_start.py:172-176` same array-index bug as R4 M2, corrupts entire review pipeline | Fixed: Phase 3 now includes ID-based lookup |
| M2 | M | Revise preservation guard `key not in new_fm` drops `reflection_sequence` when O writes null | Fixed: unconditional force-restore before guarded loop |
| M3 | M | `limit=20` silently ignores rules >20 per rec | Adopted: all `limit` changed to `limit=0` (no limit) |
| L1 | L | Sessions display uses array index not rec ID | Deferred: UX improvement, not DP-002 scope |
| L2 | L | No pruning-boundary tests | Adopted: added UT-11, UT-12 |
| L3 | L | No defensive guard for `sequence=None` | Noted: all workflow creation paths set sequence |
| L4 | L | Wrong record's `target_session_id` used in pre-DP-002 code | Not applicable: replaced by `reflection_sequence` |

### R6: Oracle-ds4f (ora-ds4f-1, resumed)
Result: REQUEST_CHANGES (1C + 1L)

| ID | Sev | Issue | Resolution |
|----|-----|-------|------------|
| C1 | C | `limit=0` silently returns 0 rules — guard `remaining <= 0` breaks immediately | Fixed: added guard fix (`if limit and ...`) for 3 locations in Phase 3 note |
| L1 | L | `_orch_event.py:227` `records[-1]` uses implicit position | Noted: correct due to append-before-prune order, but fragile |
