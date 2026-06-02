# Technical Design: Enhanced Review Phase UX

## Architecture Overview

This is a **presentation-layer enhancement** with a minor data model extension to the Aristotle review flow. The change touches 4 files in `aristotle_mcp/`, 2 prompt template files, and 1 data model, with no new MCP tool endpoints and no new dependencies.

### Data Flow

```
R (Reflector):
  └─ DRAFT now includes ## Key Findings with error→rule pairings

C (Checker) [UNCHANGED by this design — spec update only]:
  └─ Extracts proposed_rule_summary from DRAFT → passes to write_rule(rule_summary=...)
  └─ Appends ### Rule Summary to rule body

Rule file on disk:
  ├─ frontmatter: rule_summary = "proposed_rule_summary text"
  └─ body: ### Incident / ### Rule Summary / ### Context / ### Rule / ...

orchestrate_start("review")
  │
  ├─ list_rules(keyword=target_session)  ← existing call, returns metadata incl. confidence, risk_level, conflicts_with
  │
  ├─ [NEW] get_audit_decision(rule_path) for each staging rule  ← file-read only, no LLM
  │
  ├─ [NEW] _enrich_rules_metadata(rules_result) → (staging_rules, verified_rules, audit_decisions)
  │
  ├─ [NEW] parse DRAFT for Key Findings summary  ← string parsing, no LLM
  │
  ├─ [REWRITTEN] _format_review_output(sequence, target_record, draft_content, staging_rules, verified_rules, audit_decisions)
  │     │
  │     ├─ Header (Δ + audit level from audit_decisions)
  │     ├─ DRAFT summary (Key Findings or fallback)
  │     ├─ "Rules for Review" section (staging rules, numbered, with confidence/risk/conflicts)
  │     ├─ "Auto-committed" section (verified rules, unnumbered, single-line)
  │     └─ Action menu (existing 4 + 2 new: inspect N, show draft)
  │
  └─ _save_workflow (with staging_rule_paths for inspect action)

orchestrate_review_action(workflow_id, action)
  │
  ├─ [EXISTING] confirm / reject / re_reflect  ← unchanged
  ├─ [MODIFIED] revise — now indexes from staging_rule_paths (same as inspect) ← user-visible numbering is staging-only
  │
  ├─ [NEW] "inspect N" → read rule file → return body
  │
  └─ [NEW] "show draft" → read DRAFT file → return full content
```

## Component Breakdown

| Component | Priority | Responsibilities | Serves Phase 1 ACs | Interface | Dependencies |
|-----------|----------|-----------------|---------------------|-----------|-------------|
| `_format_review_output` | Key | Format the review notification with enriched data: header (Δ), DRAFT summary, split staging/verified sections, per-rule confidence/risk/conflicts | AC-2, AC-3, AC-4, AC-5, AC-7 | `(sequence, target_record, draft_content, staging_rules, verified_rules, audit_decisions) → str` | `_parse_draft_summary` (internal), `_parse_conflicts_with` (from `models.py`) |
| `_parse_draft_summary` | Key | Extract Key Findings section from DRAFT content, fallback to first 3 lines | AC-5 | `(draft_content: str) → tuple[list[str], int]` (summary_lines, total_chars) | None (pure string parsing) |
| `_enrich_rules_metadata` | Key | Compute per-rule audit_decisions and organize rules into staging vs verified groups | AC-4, AC-7 | `(rules_result: dict) → tuple[list[dict], list[dict], list[dict | None]]` (staging_rules, verified_rules, audit_decisions) | `get_audit_decision` |
| `orchestrate_review_action` (inspect branch) | Key | Handle `inspect N` action: resolve rule path, read file, return body | AC-1 | `action="inspect"`, `data_json='{"rule_index": N}'` | `workflow["staging_rule_paths"]`, `_safe_resolve`, `Path.read_text` |
| `orchestrate_review_action` (show_draft branch) | Key | Handle `show draft` action: read DRAFT file, return full content | AC-6 | `action="show draft"` | `workflow["draft_file_path"]`, `Path.read_text` |
| `orchestrate_start` (review branch) | Key | Compute audit decisions before calling formatter; store staging_rule_paths in workflow. **Call site change**: `_orch_start.py:196-197` must call `_enrich_rules_metadata(rules_result)` first, then `_format_review_output(sequence, target_record, draft_content, staging_rules, verified_rules, audit_decisions)` instead of the old signature. | AC-1, AC-4 | Modified review branch in `orchestrate_start` | `_enrich_rules_metadata`, `_format_review_output` |
| `orchestrate_review_action` (revise branch) | Key | **Semantic change**: index from `staging_rule_paths` instead of `displayed_rules`. Users can no longer revise auto-committed rules — only staging rules are numbered and revocable. **Backward compat shim**: `staging_rule_paths = workflow.get("staging_rule_paths") or workflow.get("displayed_rules", [])` to handle in-flight workflows from before this change. TODO: remove shim after one release cycle. | AC-1 (index consistency) | `_orch_review.py:123`: `displayed_rules` → `staging_rule_paths` | `workflow["staging_rule_paths"]` |
| REFLECTOR.md update | Peripheral | Add `## Key Findings` section to DRAFT template **after `## Scan Context` and before the first `### Reflection N:` block**, with error→rule pairing format: `- [error_summary]: [proposed_rule_summary]` | AC-5 (DRAFT format guarantee) | Text edit to REFLECTOR.md | None |
| `RuleMetadata.rule_summary` | Key | New frontmatter field storing proposed_rule_summary for searchability and review display | AC-2 (enrichment) | `rule_summary: str | None` in `RuleMetadata` dataclass | None (data model only) |
| CHECKER.md update | Key | Instruct Checker to extract proposed_rule_summary from DRAFT and pass to `write_rule(rule_summary=...)` as new parameter; append `### Rule Summary` line to rule body. **Critical data-path dependency** — without this, `rule_summary` is never persisted. | AC-5 (data persistence) | Text edit to CHECKER.md C5 step | REFLECTOR.md Key Findings format |

## Data Model Changes

### `RuleMetadata` — New Field: `rule_summary`

```python
# In models.py, add to RuleMetadata dataclass:
rule_summary: str | None = None  # One-line proposed rule summary (from DRAFT Key Findings)
```

**Persistence chain**:
1. `to_frontmatter_string()` — **manually constructs serialization dict** at `models.py:114-141`. Must add `"rule_summary": metadata.rule_summary` to the `md` dict explicitly. Will NOT auto-serialize from dataclass field alone.
2. `from_frontmatter_dict()` — add `rule_summary=data.get("rule_summary")` to constructor call at `models.py:155-179`
3. `list_rules()` — returns full frontmatter via `read_frontmatter_raw`; `rule_summary` will be included in metadata dict

**Rule body format** — Checker appends after `### Incident`:

```markdown
### Rule Summary

[proposed_rule_summary text]

### Context
...
```

**Source of `rule_summary`**: Two separate data flows must not be conflated:

1. **`## Key Findings` for review display** (parsed by `_parse_draft_summary`):
   - Format: `- [error_summary]: [proposed_rule_summary]`
   - Purpose: Quick-scan summary in review notification
   - Lifecycle: Ephemeral — extracted from DRAFT at display time, not persisted

2. **`**Proposed Rule**` → `rule_summary` frontmatter for persistence** (written by Checker):
   - Source: Each Reflection's `**Proposed Rule**` field in the DRAFT
   - Extraction: Checker reads the DRAFT, extracts `**Proposed Rule**` text per Reflection
   - Persistence: Passed to `write_rule(rule_summary=...)` → stored in frontmatter + appended as `### Rule Summary` in rule body
   - Purpose: Searchability via `list_rules` metadata + human readability via `inspect N`

These are **independent data paths** that happen to contain semantically related content but serve different purposes.

### `write_rule` — New Parameter

```python
# In _tools_rules.py write_rule(), add parameter:
def write_rule(
    ...,
    rule_summary: str | None = None,  # NEW
) -> dict:
    # Pass to RuleMetadata constructor at line 186:
    metadata = RuleMetadata(..., rule_summary=rule_summary)
    # write_rule_file receives metadata.__dict__ → rule_summary will be included
    # frontmatter._serialize() handles string quoting automatically
```

**Important**: `write_rule` passes `metadata.__dict__` to `write_rule_file` (line 202), NOT `to_frontmatter_string`. So `rule_summary` just needs to exist on the `RuleMetadata` dataclass — `metadata.__dict__` will include it automatically. Also update `to_frontmatter_string` for any direct callers, and `from_frontmatter_dict` for deserialization.

## Data Models / API Contracts

### `_parse_draft_summary(draft_content: str) → tuple[list[str], int]`

```python
def _parse_draft_summary(draft_content: str) -> tuple[list[str], int]:
    """Extract Key Findings from DRAFT content.

    Returns:
        (summary_lines, total_chars) where summary_lines is a list of
        lines to display and total_chars is the full DRAFT character count.

    Extraction logic:
        1. Find "## Key Findings" heading (exact match on stripped line)
        2. Collect subsequent lines where `line.lstrip().startswith("- ")` until reaching a line that starts with "##" (any heading) — stop BEFORE that line. Blank lines between list items are allowed and do not terminate collection. **Terminate on any non-blank line that is neither a list item nor a heading.**
        3. If no Key Findings section → fallback: first 3 non-empty lines (lines where `line.strip()` is truthy)
        4. If draft_content is empty → returns (["DRAFT report is empty"], 0)
        5. total_chars = len(draft_content) always
    """
```

### `_enrich_rules_metadata(rules_result: dict) → tuple[list[dict], list[dict], list[dict | None]]`

```python
def _enrich_rules_metadata(rules_result: dict) -> tuple[list[dict], list[dict], list[dict | None]]:
    """Organize rules into staging/verified and compute audit decisions.

    Input: `rules_result` is the raw return from `list_rules()` — each rule
    has structure `{path: str, metadata: dict}`. Access fields via
    `rule['metadata'].get(field)` (dict access, NOT dot notation —
    `list_rules` returns raw YAML dicts via `read_frontmatter_raw`).

    Returns:
        (staging_rules, verified_rules, audit_decisions)

    - staging_rules: rules with metadata.status == "staging"
    - verified_rules: rules with metadata.status == "verified"
    - audit_decisions: list of get_audit_decision() results for staging rules
      Each entry: {"delta": float, "audit_level": str, "confidence": float, "risk_level": str, ...} or None on error
      **audit_decisions[i] corresponds positionally to staging_rules[i]**
      **Formatter displays confidence/risk_level from this result (NOT from list_rules metadata)**
      to ensure displayed confidence and computed Δ are from a single read.

    Header audit level logic:
        For AC-4, display the delta and audit_level from the entry with the
        minimum delta value (among non-None entries). Since decide_audit_level
        is a monotonically decreasing function of delta, the minimum delta
        always yields the worst (most restrictive) audit level.
    """
```

### `_format_review_output` — New Signature

```python
# Audit level → display label mapping (AC-4 requires exact labels)
_AUDIT_LABELS: dict[str, str] = {
    "auto": "automatic",
    "semi": "review suggested",
    "manual": "manual review required",
}

def _format_review_output(
    sequence: int,
    target_record: dict,
    draft_content: str,
    staging_rules: list[dict],    # pre-split by _enrich_rules_metadata
    verified_rules: list[dict],   # pre-split by _enrich_rules_metadata
    audit_decisions: list[dict | None],  # parallel to staging_rules; None = failed audit decision
) -> str:
```

### `orchestrate_review_action` — New Branches

```python
# In orchestrate_review_action, after existing elif blocks:

elif action == "inspect":
    # Guard: if staging_rule_paths missing from workflow (old workflow), return clear error
    # staging_rule_paths = workflow.get("staging_rule_paths")
    # If missing → return "Rule inspection not available for this workflow."
    # Resolve rule index from data_json
    # Validate: 1 ≤ index ≤ len(staging_rule_paths)
    # Read file via _safe_resolve → load_rule_file(path) → return data['content']
    # (load_rule_file uses python-frontmatter library, handles edge cases correctly)
    # Return full markdown body (ALL sections: Incident, Rule Summary, Context, Rule, Why, Example)
    # If file not found → return "Rule file not found"
    # If body is empty → return "(empty rule body)"
    # Returns: {"action": "notify", "message": <full markdown body or error>}

elif action == "show draft":
    # Read from workflow["target_record"]["draft_file_path"] (nested dict in workflow state)
    # If file not found → return "DRAFT file not found"
    # If content is empty string → return "(empty DRAFT)"  (AC-6 edge case)
    # Otherwise → return full content
    # Returns: {"action": "notify", "message": <full draft or error>}
```

### Workflow State — New Fields

```python
# Added to workflow dict in orchestrate_start review branch:
"staging_rule_paths": list[str]   # replaces displayed_rules; paths of staging rules only
# "displayed_rules" is REMOVED — both inspect and revise index from staging_rule_paths
# draft_file_path is read from workflow["target_record"]["draft_file_path"] (existing path, no duplicate field)
```

**Note**: `displayed_rules` (which stored ALL rule paths in filesystem order) is replaced by `staging_rule_paths` (staging rules only). This ensures both `inspect N` and `revise N` use the same 1-based index that matches the user-visible "Rules for Review" section. Verified rules in the "Auto-committed" section are unnumbered and cannot be revised — they're already committed. The existing `revise` action in `_orch_review.py` currently indexes from `displayed_rules`; it will be updated to index from `staging_rule_paths`.

**Relationship to `committed_rule_paths`**: The `confirm` action uses `committed_rule_paths` (set during Checker flow to track auto-committed rules). `staging_rule_paths` tracks rules still in staging. These sets are **disjoint** — `confirm` commits staging rules not already in `committed_rule_paths`.

## Key Decisions

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| `inspect N` indexes staging rules only (1-based) | AC-1 explicitly states "The index N refers to numbered staging rules only (per AC-7, verified rules are unnumbered)". Mixing indices across types would confuse users. | Indexing all rules (staging+verified) — rejected because verified rules are auto-committed and unnumbered, inspecting them has no value |
| Per-rule `get_audit_decision` called at review display time | File-read operation, no LLM cost. Data is always fresh (confidence may have been updated by Checker). | Pre-computing at Checker time — rejected because confidence can be updated between staging and review; also adds coupling to Checker flow |
| DRAFT summary parsed by formatter (not by R) | Zero LLM cost. The formatter is a Python function; string parsing for `## Key Findings` is trivial. | R generates summary — rejected: unnecessary LLM call for what is a substring extraction |
| `staging_rule_paths` stored in workflow state | `inspect N` needs to resolve N → file path. The workflow already stores `displayed_rules` (all rules); adding staging-only list keeps inspect logic clean. | Re-querying `list_rules` at inspect time — rejected: unnecessary I/O; data could change between display and inspect |
| `show draft` reads from `draft_file_path` in workflow | DRAFT path is already available from `target_record.draft_file_path` stored in workflow. No need for additional lookups. | Re-reading from state file — rejected: unnecessary indirection; workflow already has the path |
| `_parse_draft_summary` as separate function | Testability. The DRAFT parsing logic has 4 edge cases (empty, no Key Findings, <3 findings, normal). Isolating it enables focused unit tests. | Inline in formatter — rejected: harder to test, mixes formatting with parsing |
| Risk indicator uses text labels (HIGH/MEDIUM/LOW) | Unicode symbols (⚠/●/○) may not render on minimal terminals. Text labels are always readable. Tests assert against text labels. | Unicode-only — rejected: terminal compatibility risk; Unicode+text — rejected: line too long |
| `staging_rule_paths` replaces `displayed_rules` entirely | Both `inspect N` and `revise N` should index the same list — the user-visible numbered rules. Having two separate path lists (`displayed_rules` for revise, `staging_rule_paths` for inspect) creates index misalignment and confusion. Verified rules are auto-committed and cannot be revised. | Keeping both — rejected: dual indexing is a bug magnet; Re-querying at action time — rejected: unnecessary I/O |
| 10-rule display cap removed | Phase 1 constraint: show all returned rules. The old `rules[:10]` slice is eliminated in the rewrite. The formatter iterates all staging and verified rules without slicing. `list_rules` already limits to 20. | Keeping cap — rejected: Phase 1 explicitly requires removal |
| `rule_summary` persisted to frontmatter + rule body | Enables searchability via `list_rules` and human readability via `inspect N`. The `error_summary` frontmatter field captures what went wrong; `rule_summary` captures the prevention rule — together they form the Key Findings pairing. | Only frontmatter — rejected: not human-readable during `inspect`; Only rule body — rejected: not searchable via `list_rules` |

## Failure Mode Handling

| Failure Scenario | Priority | Design Response |
|-----------------|----------|----------------|
| `get_audit_decision()` returns error or raises exception | Key | `get_audit_decision` returns `{"success": False, ...}` error dicts for I/O failures (bad path, missing file) via `_safe_resolve`, BUT `compute_delta` inside it **raises `ValueError`** for invalid risk_level or out-of-range confidence (`evolution.py:34-39`). Non-numeric confidence strings (e.g., `"high"`) flow from `metadata.get("confidence", 0.7)` (no float coercion) through to `compute_delta` which then raises. **`_enrich_rules_metadata` must wrap each call in `try/except (ValueError, TypeError, Exception)` AND check `result.get("success") == True`**. Map any failure to `None` in `audit_decisions`. Formatter skips Δ line entirely if ALL audit_decisions are None; otherwise computes min over non-None entries. |
| Rule file deleted between display and `inspect N` | Key | `_safe_resolve` returns error path; inspect action returns "Rule file not found" |
| DRAFT file deleted between display and `show draft` | Key | `Path.exists()` check; return "DRAFT file not found" |
| Rule frontmatter missing `confidence` field | Peripheral | `get_audit_decision` defaults to 0.7 internally. Formatter reads confidence from the `get_audit_decision` result (single source of truth), not from `list_rules` metadata. |
| Rule frontmatter `confidence` is non-numeric | Peripheral | `compute_delta` raises `TypeError` (chained float comparison on string) or `ValueError` (out-of-range numeric) → caught by try/except → entry is `None` in audit_decisions. **Formatter still displays the rule** with confidence=0.7 (AC-2 default) and omits only the Δ/risk indicator for that rule. The rule entry must appear in the "Rules for Review" section regardless. |
| `audit_decisions[i]` is None (any cause) | Key | **Formatter fallback**: display the rule with confidence=0.7, omit per-rule Δ indicator. The rule still appears numbered in "Rules for Review". Only the header Δ line uses non-None entries (if ALL are None, omit header Δ entirely). |
| Rule frontmatter missing `conflicts_with` field | Peripheral | `metadata.get("conflicts_with")` returns None → formatter skips conflict line for that rule |
| `conflicts_with` is stored as JSON string in frontmatter | Key | `commit_rule` stores `conflicts_with` as `json.dumps(list)`, so `read_frontmatter_raw` returns a Python string, not a list. **Formatter must parse via `_parse_conflicts_with()` from `models.py`** (which handles None, list, string, and invalid JSON). If parsing returns empty list, skip conflict line. |
| DRAFT content is empty | Peripheral | `_parse_draft_summary` returns `(["DRAFT report is empty"], 0)` |
| DRAFT has no `## Key Findings` section | Peripheral | Fallback: first 3 non-empty lines |
| 0 staging rules (all auto-committed) | Peripheral | Show "No rules require review" + auto-committed section; omit Δ line entirely |
| `inspect` called with invalid index (0, -1, >S) | Key | Return "Invalid rule index. Choose 1-{S}." |
| `inspect` called but rule body is empty | Peripheral | Return "(empty rule body)" |
| 0 rules total (`list_rules` returns empty) | Peripheral | Show DRAFT summary + "No associated rules found." + action menu. Confirm is harmless (commits nothing). |
| `rule_summary` missing from frontmatter (legacy rules) | Peripheral | Formatter does not display rule_summary line for rules where metadata.rule_summary is None. Old rules without this field are unaffected. |

## Non-functional Constraints

| Dimension | Requirement | Design Response |
|-----------|-------------|-----------------|
| Concurrency/blocking | Single-user CLI tool, sequential actions | No concurrency concerns |
| Operation reversibility | `inspect` and `show draft` are read-only; no state mutations | N/A — inherently safe |
| Data isolation | Rule body content is displayed to user in main session; no LLM context leakage risk | `inspect` returns to orchestrator which passes to user |
| Resource boundaries | `get_audit_decision` is file-read only (no LLM, no network); `list_rules` already returns metadata | No new resource concerns |
| Extension vectors | New actions (`inspect`, `show draft`) follow same pattern as existing `revise` (action string + data_json) | Adding future actions requires only new elif branch |
| Authentication/authorization | Not applicable — local CLI tool | N/A |
| Encryption | Not applicable — local filesystem | N/A |
| Latency targets | `get_audit_decision` per staging rule: ~1-5ms (file read + frontmatter parse). For 10 rules: <50ms total. | Acceptable; no optimization needed |
| Throughput | Single review at a time | N/A |
| Cost constraints | Zero additional LLM cost — all new logic is file I/O and string parsing | N/A |
| Compliance | Not applicable | N/A |

## Observability Design

| Signal | Metric / Log | Alert Condition | Owner |
|--------|-------------|-----------------|-------|
| Audit decision failures | Exception count in `_enrich_rules_metadata` | >50% of staging rules fail audit decision | Developer (via test suite) |
| DRAFT parsing fallback rate | Count of "no Key Findings" fallbacks | Monitored via test coverage | Developer |

**Note**: This is a presentation-layer change with no production monitoring. Observability is ensured through unit test coverage of edge cases.

## Cost Estimation

| Item | Type | Estimated Cost | Notes |
|------|------|---------------|-------|
| `get_audit_decision` per-rule calls | Recurring | ~0ms LLM, ~5ms I/O per rule | File-read only, no LLM cost |
| `_parse_draft_summary` | Recurring | ~0ms | Pure string parsing |
| Development | One-time | ~4-5 hours across Phase 2-5 | 4 Python files + 2 template files + 1 data model, ~200 LOC |

## Priority Downgrade Justifications

- **REFLECTOR.md update**: Peripheral — text edit only, no code. But its output format (`error→rule` pairing) drives downstream data persistence via CHECKER.md.
- **CHECKER.md update**: Peripheral — text edit only, no code. Adds one parameter extraction step to C5.

## Open Technical Questions

- ~~Should `inspect N` return the raw markdown or render it?~~ → **Resolved**: Return raw markdown. The user is in a CLI context; markdown rendering is the caller's responsibility.
- ~~Should `staging_rule_paths` replace `displayed_rules`?~~ → **Resolved**: `staging_rule_paths` replaces `displayed_rules` entirely. Both `inspect N` and `revise N` index from `staging_rule_paths` — the user-visible numbering (1..S) refers to staging rules only. Verified/auto-committed rules are unnumbered and cannot be revised in a review context (they're already committed). This eliminates the index misalignment where `displayed_rules` mixed staging and verified in filesystem order.
- ~~Should the DRAFT summary truncate individual finding lines?~~ → **Resolved**: No truncation on individual lines. The Key Findings items are authored by R and should be concise by design. If a finding is excessively long, that's an R prompt issue, not a formatter issue.
