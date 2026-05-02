# DP-001: Action Menu Structural Separation

> Status: APPROVED (Oracle R2 + Council: 0C, 0M — all feedback addressed)
> Created: 2026-05-02
> Author: Orchestrator
> Scope: `_orch_parsers.py`, `_orch_start.py`, `server.py`, SKILL.md (Aristotle), REVIEW.md

## Problem

When `orchestrate_start("review", {sequence: N})` returns, the MCP tool's `message`
field contains the full review notification:

```
🦉 Review #N — [label] status — date

Δ 0.70 → Semi

## DRAFT Summary
  finding 1...
  finding 2...
  (NNNN chars — use 'show draft' for full report)

## Rules for Review
  1. [CATEGORY] error_summary  (conf 0.7, RISK)
  2. [CATEGORY] error_summary  (conf 0.8, RISK)

Choose an action:
  1. confirm — Accept all staging rules
  2. reject — Reject this reflection
  3. revise N — Revise rule #N
  4. re-reflect — Request deeper analysis
  5. inspect N — View full rule #N
  6. show draft — View full DRAFT report
```

The Action Menu (the "Choose an action:" block) is appended at the tail of a
~800-char message. LLMs receiving this as a tool return value tend to summarize
or truncate the content when presenting it to the user. The Action Menu — the
user's primary navigation mechanism — is the most frequently discarded section
because it appears at the end and is perceived as "formatting" rather than
"information."

Observed result: users see the DRAFT summary and rules list but receive no
prompt to confirm, reject, or take any action. The review flow stalls.

## Root Cause

The `message` field conflates two distinct concerns:

1. **Review data** — facts about the reflection (status, Δ, DRAFT summary, rules)
2. **Interaction affordance** — what the user can do next (the Action Menu)

These have different persistence requirements: review data is reference material
the user scans once; the Action Menu must remain visible throughout the review
session. Embedding both in a single text field makes the menu vulnerable to
LLM summarization heuristics.

## Alternatives Considered and Rejected

### A1: Move Action Menu to the top of `message`

**What:** Reorder `_format_review_output` so the "Choose an action:" block appears
before the DRAFT summary and rules list. One-line reorder in `_format_review_output`.

**Why rejected:** LLMs don't just truncate — they *summarize*. The Action Menu is
6 items of ~15 words each, totaling ~90 chars. In an 800-char message, even at the
top, it gets compressed into "you can confirm, reject, etc." The problem isn't
position — it's that free-text instructions embedded in a long content block are
treated as formatting, not as a persistent UI element. A structural field gets
first-class treatment from the LLM because it's a separate, named object the LLM
must process individually.

Furthermore, top-placement hurts readability: users scanning the notification
want to see "what happened" (DRAFT summary, rules) before "what can I do"
(actions). Putting actions first inverts the information hierarchy for the sake
of a workaround.

### A2: Shorten the Action Menu to a single line

**What:** Replace the 6-item numbered list with `Actions: confirm | reject | revise N | re-reflect | inspect N | show draft`.

**Why rejected:** Compression alone doesn't solve the fundamental issue: the menu
is still a text fragment inside a long string, vulnerable to the same summarization.
A single line is also harder for the LLM to parse back into actionable tool calls —
the structured `review_actions.options[].action` format maps directly to
`orchestrate_review_action(action=...)` parameters.

### A3: Belt-and-suspenders — keep menu in `message` AND add `review_actions`

**What:** Add the structured `review_actions` field without removing the Action
Menu text from `message`.

**Why rejected:** Dual-source truth. If the LLM reads both, it may present the
menu twice (once from `message`, once from `review_actions`). If a consumer parses
the text version, it will drift out of sync with the structured version whenever
one is updated but not the other. Removing the text version eliminates this
synchronization risk. The `message` field becomes pure data; `review_actions`
becomes pure interaction — clean separation of concerns.

## Solution

Separate the Action Menu into an independent top-level field in the return value.

### Current return structure

```python
{
    "action": "notify",
    "workflow_id": "wf_xxx",
    "message": "<header>\n<DRAFT summary>\n<rules list>\n<Action Menu>"
}
```

### Proposed return structure

```python
{
    "action": "notify",
    "workflow_id": "wf_xxx",
    "message": "<header>\n<DRAFT summary>\n<rules list>",
    "review_actions": {
        "workflow_id": "wf_xxx",
        "options": [
            {"action": "confirm",   "label": "confirm",   "description": "Accept all staging rules"},
            {"action": "reject",    "label": "reject",    "description": "Reject this reflection"},
            {"action": "revise N",  "label": "revise N",  "description": "Revise rule #N (append feedback after colon)"},
            {"action": "re-reflect","label": "re-reflect","description": "Request deeper analysis"},
            {"action": "inspect N", "label": "inspect N", "description": "View full rule #N"},
            {"action": "show draft","label": "show draft","description": "View full DRAFT report"}
        ]
    }
}
```

**Key properties:**

- `message` is shortened — no longer contains the Action Menu
- `review_actions` is a structured object, not free text
- `review_actions.workflow_id` is intentionally duplicated. Rationale: LLMs
  frequently fail to extract top-level fields from multi-field tool returns
  when composing subsequent tool calls. Embedding `workflow_id` inside
  `review_actions` ensures it's available in the same context the LLM uses to
  decide its next action, reducing the chance of a lost reference.
- Backward compatible for consumers that only read review **data** (status, Δ,
  DRAFT summary, rules). Consumers that parse the Action Menu text from
  `message` will need updates — see §Affected Existing Tests.

## Implementation Plan (TDD-ordered)

### Phase 0: Red — Write failing tests FIRST

Tests are written before any production code changes. All tests below MUST fail
at this phase.

#### 0a. New function tests (test `_build_review_actions`)

| Test ID | Description | Asserts |
|---------|-------------|---------|
| UT-01 | `_build_review_actions` returns dict with `workflow_id` and `options` | `result["workflow_id"] == "wf_test"` and `"options" in result` |
| UT-02 | `_build_review_actions` returns 6 options | `len(result["options"]) == 6` |
| UT-03 | `_build_review_actions` each option has action, label, description | `all(k in opt for k in ("action", "label", "description") for opt in result["options"])` |
| UT-04 | `_build_review_actions` options match REVIEW.md Action Menu spec (with staging rules) | Verify option actions == `["confirm", "reject", "revise N", "re-reflect", "inspect N", "show draft"]` |
| UT-04b | `_build_review_actions("wf_test", has_staging_rules=False)` returns 5 options, no "confirm" | `len(result["options"]) == 5` and `"confirm" not in [o["action"] for o in result["options"]]` |

These tests fail at import — `_build_review_actions` does not exist yet.

#### 0b. Existing function regression tests

| Test ID | Description | Asserts |
|---------|-------------|---------|
| UT-05 | `_format_review_output` output no longer contains Action Menu items | `"1. confirm" not in result` and `"Choose an action" not in result` |
| UT-06 | `_format_review_output` output still contains review data sections | `"## DRAFT Summary" in result` and `"## Rules for Review" in result` |

UT-05 fails because the Action Menu is still in `_format_review_output`.
UT-06 passes now and must continue to pass.

#### 0c. Integration tests (via `orchestrate_start`)

| Test ID | Description | Asserts |
|---------|-------------|---------|
| UT-07 | `orchestrate_start("review")` return includes `review_actions` | `"review_actions" in result` |
| UT-08 | `review_actions.workflow_id` matches top-level `workflow_id` | `result["review_actions"]["workflow_id"] == result["workflow_id"]` |
| UT-09 | `orchestrate_start("review")` with 0 staging rules omits confirm from `review_actions` | `"confirm" not in [o["action"] for o in result["review_actions"]["options"]]` |
| UT-10 | Consumer ignoring `review_actions` still gets valid `message` with all review data | `"## Rules for Review" in result["message"]` and `"review_actions" not required for message validity` |

These fail because `review_actions` is not in the return dict yet.

#### 0d. Update affected existing tests

These existing tests in `test/test_review_ux.py` implicitly depend on Action Menu
text being in `_format_review_output` output. They must be updated to test the
new structure instead:

| Existing Test | Current Dependency | Update |
|---------------|-------------------|--------|
| `test_should_include_inspect_and_show_draft_in_action_menu` | Asserts `"inspect" in output.lower()` and `"show draft" in output.lower()` — these strings only appear in Action Menu | Move assertion to test `_build_review_actions` instead |
| `test_should_omit_risk_indicator_when_missing` | Used `output.split("inspect")[0]` to strip Action Menu tail | After Action Menu removal, the split is unnecessary — entire output IS review data. Simplify to `assert "HIGH" not in output` |
| `test_should_show_char_count_and_show_draft_hint` | Asserts `"show draft" in output.lower()` — currently passes via both Action Menu and DRAFT summary hint; won't break after removal, but decouple to test DRAFT section explicitly for robustness | Change assertion to target DRAFT summary hint specifically: `"(chars — use 'show draft'" in output` |
| All other `test_review_ux.py` call sites (~27 tests) | May have implicit Action Menu dependencies | Audit each; most only test header/rules/delta and are unaffected |

#### 0e. E2E tests

| Test ID | Description | Asserts |
|---------|-------------|---------|
| ET-01 | Full reflect → checker → review cycle; verify `review_actions` present | `"review_actions" in orchestrate_start("review") result` |
| ET-02 | Smoke test: confirm via `orchestrate_review_action` still completes after return structure change | Returns `"✅ Review confirmed"` — verifies workflow still completes end-to-end |

### Phase 1: Green — Backend `_orch_parsers.py`

**File:** `aristotle_mcp/_orch_parsers.py`

**Change:** Split `_format_review_output`:

1. Remove the Action Menu block (currently the last ~10 lines of the function —
   the `"Choose an action:"` section and the six numbered items)
2. Add `_build_review_actions(workflow_id, has_staging_rules)`:

```python
def _build_review_actions(workflow_id: str, has_staging_rules: bool = True) -> dict:
    """Build structured action menu for review flow.

    Options must stay in sync with REVIEW.md STEP V1 Action Menu section.
    When has_staging_rules is False, 'confirm' is omitted (nothing to confirm).
    """
    options = [
        {"action": "reject",     "label": "reject",     "description": "Reject this reflection"},
        {"action": "revise N",   "label": "revise N",   "description": "Revise rule #N (append feedback after colon)"},
        {"action": "re-reflect", "label": "re-reflect", "description": "Request deeper analysis"},
        {"action": "inspect N",  "label": "inspect N",  "description": "View full rule #N"},
        {"action": "show draft", "label": "show draft", "description": "View full DRAFT report"},
    ]
    if has_staging_rules:
        options.insert(0, {"action": "confirm", "label": "confirm", "description": "Accept all staging rules"})
    return {
        "workflow_id": workflow_id,
        "options": options,
    }
```

### Phase 2: Green — Backend `_orch_start.py` + `server.py`

**File:** `aristotle_mcp/_orch_start.py`

In the `command == "review"` branch, add `review_actions` to the return dict:

```python
staging_rule_paths = [r.get("path", "") for r in staging_rules]
has_staging = len(staging_rules) > 0

message = _format_review_output(...)
review_actions = _build_review_actions(workflow_id, has_staging_rules=has_staging)

return {
    "action": "notify",
    "workflow_id": workflow_id,
    "message": message,
    "review_actions": review_actions,
}
```

**File:** `aristotle_mcp/server.py`

Update re-export list to include `_build_review_actions` alongside
`_format_review_output` (this is a test-access re-export; no runtime impact).

### Phase 3: Green — REVIEW.md protocol update

**File:** `REVIEW.md`

Update STEP V1 to document the new return structure:

```
orchestrate_start("review", {sequence: N})
  ...
  → ok?  → display two parts to user:
           Part A — message field: review data (header, Δ, DRAFT summary, rules)
           Part B — review_actions field: structured action menu
                    Present as a numbered list using each option's label and description.
                    Use review_actions.workflow_id for subsequent orchestrate_review_action calls.
```

Update STEP V2 action matching to note that `confirm` may be absent when
`has_staging_rules` is false.

### Phase 4: Green — SKILL.md

**File:** `~/.config/opencode/skills/aristotle/SKILL.md`

Add review-actions presentation instructions:

1. Present the `message` field as the review notification body
2. Present the `review_actions` field as the action menu — format as numbered list
3. Keep the action menu visible until the user completes their review
4. Use `review_actions.workflow_id` for all `orchestrate_review_action` calls

## Affected Existing Tests

| Test File | Tests Affected | Nature of Change |
|-----------|---------------|-----------------|
| `test/test_review_ux.py` | ~3-4 tests directly asserting Action Menu text | Move assertions to `_build_review_actions` tests |
| `test/test_review_ux.py` | ~27 tests using `_format_review_output` fixtures | Audit for implicit dependencies; most unaffected |

## Impact Analysis

| Component | Impact | Change Required |
|-----------|--------|-----------------|
| `_orch_parsers.py` | **Modified** | Remove Action Menu from `_format_review_output`; add `_build_review_actions` |
| `_orch_start.py` | **Modified** | Add `review_actions` to review return dict; pass `has_staging_rules` |
| `server.py` | **Modified** | Add `_build_review_actions` to re-export list |
| `test/test_review_ux.py` | **Modified** | Update ~3-4 tests that assert Action Menu text |
| SKILL.md (Aristotle) | **Modified** | Add `review_actions` presentation instructions |
| REVIEW.md | **Modified** | STEP V1 and V2 updated for split return structure |
| `_orch_review.py` | **None** | `orchestrate_review_action` has independent return format |
| Bridge Plugin | **None** | `idle-handler.ts` does not process review returns |
| `_orch_event.py` | **None** | Event handler for `o_done` in review phase does not use `_format_review_output` |
| Existing rules | **None** | No rule files affected |

## Edge Cases

1. **LLM ignores `review_actions` field entirely** — Falls back to current
   behavior (no Action Menu). Not worse than today. SKILL.md instructions are
   the mitigation.

2. **LLM reads `review_actions` but still summarizes** — The field is structured
   (5-6 key-value items), much shorter than a text block, and higher signal-to-noise.
   Truncation probability is significantly lower.

3. **Consumer expects Action Menu in `message`** — The `message` field still
   contains all review **data** (status, Δ, DRAFT summary, rules). Only the
   Action Menu text is removed. Known affected consumers: `test/test_review_ux.py`
   (see §Affected Existing Tests).

4. **Empty review (no staging rules)** — `_build_review_actions` omits `confirm`
   from the options list (nothing to confirm). Remaining options (reject, show
   draft, etc.) are still available.

## Success Criteria

- [ ] All UT-01 through UT-10 pass (new tests)
- [ ] All existing `test_review_ux.py` tests pass (updated tests)
- [ ] All ET-01, ET-02 pass
- [ ] Manual test: `/aristotle review N` shows both review data AND action menu
- [ ] No regression in `orchestrate_review_action` confirm/reject/revise/inspect/show-draft flows
