# Test Plan: Enhanced Review Phase UX

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (US/AC) | Derived Functional Points | Test Cases |
|---|--------------|----------------|--------------------------|------------|
| 1 | Inspect a specific rule's full content | US-1 / AC-1 (Core) | inspect branch (Key) | happy path, invalid index (0/-1/>S), file deleted, empty body, missing staging_rule_paths (old workflow) |
| 2 | See confidence and risk level per rule | US-2 / AC-2 (Core) | `_format_review_output` (Key), `_enrich_rules_metadata` (Key) | confidence=0.55+HIGH, missing confidence→0.7, non-numeric confidence→0.7, confidence=0.0/1.0, missing risk_level |
| 3 | See per-rule conflict warnings | US-3 / AC-3 (Core) | `_format_review_output` (Key) | 2 conflicts shown, >3 conflicts→"+N more", empty conflicts→no line, invalid JSON→skip, deleted rule IDs shown as-is |
| 4 | See Δ and audit level in header | US-4 / AC-4 (Core) | `_enrich_rules_metadata` (Key), `_format_review_output` (Key) | 2 rules with different deltas→min+worst level, 1 staging rule, all audit_decisions None→omit Δ, exact label mapping (auto/semi/manual) |
| 5 | DRAFT as scannable summary | US-5 / AC-5 (Core) | `_parse_draft_summary` (Key) | Key Findings with 3 items, no Key Findings→fallback, empty DRAFT, 1 finding, non-list paragraph terminates collection |
| 6 | Full DRAFT on demand | US-6 / AC-6 (Core) | show_draft branch (Key) | happy path, file deleted, empty content→"(empty DRAFT)" |
| 7 | Staging vs verified split display | US-7 /AC-7 (Secondary→Core scenarios for completeness) | `_enrich_rules_metadata` (Key), `_format_review_output` (Key) | 2 staging+1 verified, 0 staging, 0 verified, 0 total |

### Secondary Scenarios (from Phase 1 — priority: secondary)

| # | Secondary Scenario | Source (US/AC) | Derived Functional Points | Test Cases |
|---|--------------------|----------------|--------------------------|------------|
| 1 | Staging vs verified split display | US-7 / AC-7 (Secondary) | `_enrich_rules_metadata` (Key), `_format_review_output` (Key) | Covered in Core Scenarios — this is a display-level concern served by Key components |

> **Note**: AC-7 is classified Secondary in Phase 1 but appears in Core Scenarios because it is served entirely by Key components (`_enrich_rules_metadata`, `_format_review_output`). The test depth is standard (happy + primary error).

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source | Test Cases |
|---|---------------------|--------|------------|
| K1 | `_parse_draft_summary` — extract Key Findings | Component (Key) | happy path (3 items), no Key Findings section→fallback, empty DRAFT, 1 finding only, paragraph between items terminates, blank lines between items OK |
| K2 | `_enrich_rules_metadata` — split + audit decisions | Component (Key) | 2 staging + 1 verified, interleaved order [verified, staging, verified, staging]→correct partition, all staging, all verified, 0 rules, get_audit_decision succeeds, get_audit_decision returns error→None, compute_delta raises→None, positional index correspondence |
| K3 | `_format_review_output` — full formatter | Component (Key) | header with Δ, header without Δ (all None), per-rule confidence/risk, per-rule conflicts, DRAFT summary, staging/verified sections, action menu includes inspect+show draft, 10+ rules (no cap) |
| K4 | inspect action branch | Component (Key) | valid index, invalid index (0/-1/>S), file not found, empty body, missing staging_rule_paths |
| K5 | show draft action branch | Component (Key) | happy path, file not found, empty content |
| K6 | revise action — staging_rule_paths indexing | Component (Key) | valid index (resolves from staging_rule_paths), backward compat shim (displayed_rules fallback) |
| K7 | `RuleMetadata.rule_summary` data model | Component (Key) | serialization round-trip, None default, legacy rules without field |
| K7b | `orchestrate_start` (review branch) — enriched data flow | Component (Key) | stores staging_rule_paths in workflow, calls _enrich_rules_metadata before formatter, passes split results to _format_review_output |
| K8 | `write_rule` — rule_summary parameter | Component (Key) | with rule_summary, without rule_summary (backward compat) |
| K9 | `_enrich_rules_metadata` — header audit level logic | Failure Mode (Key) | min delta→worst level, all None→omit, single rule |
| K10 | `audit_decisions[i]` is None fallback | Failure Mode (Key) | rule still displayed, confidence=0.7, per-rule Δ omitted |
| K11 | `_parse_conflicts_with` direct unit test | Failure Mode (Key) | None→[], list→list, valid JSON string→list, invalid JSON string→[] |
| K11b | `_format_review_output` — conflicts truncation | Failure Mode (Key) | >3 conflicts → "+N more" display format |
| K12 | inspect — file deleted between display and action | Failure Mode (Key) | returns "Rule file not found" |
| K13 | CHECKER.md C5 — rule_summary persistence | Component (Key) | write_rule called with rule_summary, frontmatter contains field, rule body contains ### Rule Summary |

### Peripheral Functional Points (from Phase 2 — priority: peripheral)

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| P1 | `_parse_draft_summary` — empty DRAFT | Failure Mode (Peripheral) | returns (["DRAFT report is empty"], 0) |
| P2 | `_parse_draft_summary` — no Key Findings section | Failure Mode (Peripheral) | fallback to first 3 non-empty lines |
| P3 | missing confidence→default 0.7 | Failure Mode (Peripheral) | get_audit_decision defaults internally |
| P4 | missing conflicts_with→skip line | Failure Mode (Peripheral) | metadata.get returns None |
| P5 | rule_summary missing from legacy rules | Failure Mode (Peripheral) | formatter skips display, no crash |
| P6 | REFLECTOR.md — Key Findings format | Component (Peripheral) | text verification only, no code test |
| P7 | 0 rules total | Failure Mode (Peripheral) | "No associated rules found." + action menu |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | US | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|----|-----------|-----------|-----------|-------------|
| 1 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_full_rule_body_on_inspect` | `inspect 2` returns complete rule body via load_rule_file |
| 2 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_invalid_index_error_for_zero` | `inspect 0` → "Invalid rule index" |
| 3 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_invalid_index_error_for_negative` | `inspect -1` → "Invalid rule index" |
| 4 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_invalid_index_error_for_over_count` | `inspect N` where N > staging count → error |
| 5 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_file_not_found_for_deleted_rule` | Rule path points to deleted file |
| 6 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_empty_body_message_for_empty_rule` | load_rule_file returns empty content |
| 7 | Core | US-1 | AC-1 | Unit | `test_review_ux.py` | `should_return_not_available_for_old_workflow` | staging_rule_paths missing from workflow |
| 8 | Core | US-2 | AC-2 | Unit | `test_review_ux.py` | `should_display_confidence_and_risk_level_per_rule` | Output contains "conf 0.55" and "HIGH" |
| 9 | Core | US-2 | AC-2 | Unit | `test_review_ux.py` | `should_display_default_confidence_when_missing` | Missing confidence → shows 0.7 |
| 10 | Core | US-2 | AC-2 | Unit | `test_review_ux.py` | `should_display_default_confidence_when_non_numeric` | confidence="high" → shows 0.7 |
| 11 | Core | US-2 | AC-2 | Unit | `test_review_ux.py` | `should_display_confidence_at_boundaries` | confidence=0.0 and confidence=1.0 |
| 12 | Core | US-2 | AC-2 | Unit | `test_review_ux.py` | `should_omit_risk_indicator_when_missing` | No risk_level in frontmatter |
| 13 | Core | US-3 | AC-3 | Unit | `test_review_ux.py` | `should_display_conflict_line_below_rule_summary` | Output shows "Conflicts with: id1, id2" |
| 14 | Core | US-3 | AC-3 | Unit | `test_review_ux.py` | `should_truncate_conflicts_over_three` | 5 conflicts → shows first 3 + "+2 more" |
| 15 | Core | US-3 | AC-3 | Unit | `test_review_ux.py` | `should_skip_conflict_line_when_empty` | No conflicts_with → no conflict line |
| 16 | Core | US-3 | AC-3 | Unit | `test_review_ux.py` | `should_skip_conflict_line_when_invalid_json` | conflicts_with is not valid JSON list |
| 17 | Core | US-3 | AC-3 | Unit | `test_review_ux.py` | `should_show_deleted_rule_ids_as_is` | Conflict IDs reference deleted rules |
| 18 | Core | US-4 | AC-4 | Unit | `test_review_ux.py` | `should_display_min_delta_and_audit_label_in_header` | 2 rules → shows min delta + exact label |
| 19 | Core | US-4 | AC-4 | Unit | `test_review_ux.py` | `should_omit_delta_line_when_no_staging_rules` | 0 staging → no Δ line |
| 20 | Core | US-4 | AC-4 | Unit | `test_review_ux.py` | `should_omit_delta_line_when_all_audit_decisions_none` | All get_audit_decision fail → no Δ line |
| 21 | Core | US-4 | AC-4 | Unit | `test_review_ux.py` | `should_map_audit_level_to_exact_labels` | auto→automatic, semi→review suggested, manual→manual review required |
| 22 | Core | US-5 | AC-5 | Unit | `test_review_ux.py` | `should_extract_key_findings_items` | DRAFT with ## Key Findings → list items shown |
| 23 | Core | US-5 | AC-5 | Unit | `test_review_ux.py` | `should_show_char_count_and_show_draft_hint` | Output includes "(N chars — use 'show draft' for full report)" |
| 24 | Core | US-5 | AC-5 | Unit | `test_review_ux.py` | `should_fallback_to_first_3_lines_without_key_findings` | No ## Key Findings → first 3 non-empty lines |
| 25 | Core | US-5 | AC-5 | Unit | `test_review_ux.py` | `should_show_draft_report_is_empty_for_empty_content` | Empty DRAFT → "DRAFT report is empty" |
| 26 | Core | US-5 | AC-5 | Unit | `test_review_ux.py` | `should_show_single_finding_when_only_one` | 1 list item → show that 1 |
| 27 | Core | US-6 | AC-6 | Unit | `test_review_ux.py` | `should_return_full_draft_on_show_draft` | show draft → full content |
| 28 | Core | US-6 | AC-6 | Unit | `test_review_ux.py` | `should_return_not_found_for_deleted_draft` | DRAFT file deleted → "DRAFT file not found" |
| 29 | Core | US-6 | AC-6 | Unit | `test_review_ux.py` | `should_return_empty_draft_message_for_empty_file` | DRAFT file empty → "(empty DRAFT)" |
| 30 | Sec | US-7 | AC-7 | Unit | `test_review_ux.py` | `should_show_staging_numbered_and_verified_unnumbered` | 2 staging (numbered) + 1 verified (unnumbered) in separate sections |
| 31 | Sec | US-7 | AC-7 | Unit | `test_review_ux.py` | `should_show_no_review_needed_when_zero_staging` | 0 staging → "No rules require review" + auto-committed section |
| 32 | Sec | US-7 | AC-7 | Unit | `test_review_ux.py` | `should_omit_auto_committed_section_when_zero_verified` | 0 verified → no auto-committed section |
| 33 | Sec | US-7 | AC-7 | Unit | `test_review_ux.py` | `should_show_no_rules_when_zero_total` | 0 rules → "No associated rules found." + action menu |

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Type | Test Type | Test File | Test Name | Description |
|---|----------|---------------|------|-----------|-----------|-----------|-------------|
| 1 | Key | `_parse_draft_summary` | Component | Unit | `test_review_ux.py` | `should_extract_key_findings_items` | Happy path with 3 list items |
| 2 | Key | `_parse_draft_summary` | Component | Unit | `test_review_ux.py` | `should_fallback_to_first_3_lines_without_key_findings` | No ## Key Findings section |
| 3 | Key | `_parse_draft_summary` | Component | Unit | `test_review_ux.py` | `should_show_empty_message_for_empty_draft` | Empty input |
| 4 | Key | `_parse_draft_summary` | Component | Unit | `test_review_ux.py` | `should_show_single_finding_when_only_one` | 1 finding |
| 5 | Key | `_parse_draft_summary` | Component | Unit | `test_review_ux.py` | `should_terminate_collection_on_non_list_paragraph` | Paragraph between list items terminates |
| 6 | Key | `_parse_draft_summary` | Component | Unit | `test_review_ux.py` | `should_allow_blank_lines_between_findings` | Blank lines between items OK |
| 7 | Key | `_enrich_rules_metadata` | Component | Unit | `test_review_ux.py` | `should_split_staging_and_verified` | 2 staging + 1 verified → correct partition |
| 8 | Key | `_enrich_rules_metadata` | Component | Unit | `test_review_ux.py` | `should_return_empty_for_zero_rules` | 0 rules → ([], [], []) |
| 9 | Key | `_enrich_rules_metadata` | Component | Unit | `test_review_ux.py` | `should_map_audit_error_to_none` | get_audit_decision returns error → None |
| 10 | Key | `_enrich_rules_metadata` | Component | Unit | `test_review_ux.py` | `should_map_audit_exception_to_none` | compute_delta raises → None |
| 11 | Key | `_enrich_rules_metadata` | Component | Unit | `test_review_ux.py` | `should_maintain_positional_correspondence` | audit_decisions[i] ↔ staging_rules[i] |
| 12 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_display_min_delta_and_audit_label_in_header` | Header Δ line |
| 13 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_display_confidence_and_risk_level_per_rule` | Per-rule confidence/risk |
| 14 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_display_conflict_line_below_rule_summary` | Per-rule conflicts |
| 15 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_show_staging_numbered_and_verified_unnumbered` | Split sections |
| 16 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_include_inspect_and_show_draft_in_action_menu` | Action menu includes new actions |
| 17 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_show_all_rules_without_cap` | 15 staging rules → all numbered |
| 18 | Key | `_format_review_output` | Component | Unit | `test_review_ux.py` | `should_use_default_confidence_when_audit_decision_none` | audit_decisions[i]=None → conf 0.7 |
| 19 | Key | inspect branch | Component | Unit | `test_review_ux.py` | `should_return_full_rule_body_on_inspect` | Happy path |
| 20 | Key | inspect branch — index 0 | Component | Unit | `test_review_ux.py` | `should_return_invalid_index_error_for_zero` | `inspect 0` → error |
| 21 | Key | inspect branch — negative index | Component | Unit | `test_review_ux.py` | `should_return_invalid_index_error_for_negative` | `inspect -1` → error |
| 22 | Key | inspect branch — over count | Component | Unit | `test_review_ux.py` | `should_return_invalid_index_error_for_over_count` | N > staging count → error |
| 23 | Key | inspect branch — file deleted | Component | Unit | `test_review_ux.py` | `should_return_file_not_found_for_deleted_rule` | File deleted |
| 24 | Key | inspect branch — old workflow | Component | Unit | `test_review_ux.py` | `should_return_not_available_for_old_workflow` | Missing staging_rule_paths |
| 25 | Key | show_draft branch | Component | Unit | `test_review_ux.py` | `should_return_full_draft_on_show_draft` | Happy path |
| 26 | Key | show_draft branch — file deleted | Component | Unit | `test_review_ux.py` | `should_return_not_found_for_deleted_draft` | File deleted |
| 27 | Key | show_draft branch — empty | Component | Unit | `test_review_ux.py` | `should_return_empty_draft_message_for_empty_file` | Empty content |
| 28 | Key | revise — staging_rule_paths | Component | Unit | `test_review_ux.py` | `should_revise_using_staging_rule_paths_index` | Valid index resolves from staging_rule_paths |
| 29 | Key | revise — backward compat | Component | Unit | `test_review_ux.py` | `should_fallback_to_displayed_rules_for_old_workflow` | Backward compat shim |
| 30 | Key | `RuleMetadata.rule_summary` | Component | Unit | `test_review_ux.py` | `should_serialize_and_deserialize_rule_summary` | Round-trip persistence |
| 31 | Key | `write_rule` — rule_summary | Component | Unit | `test_review_ux.py` | `should_write_rule_summary_to_frontmatter` | New parameter flows through |
| 32 | Key | `write_rule` — backward compat | Component | Unit | `test_review_ux.py` | `should_write_rule_without_rule_summary` | Missing param → no field in file |
| 33 | Key | audit_decisions None fallback | Failure Mode | Unit | `test_review_ux.py` | `should_use_default_confidence_when_audit_decision_none` | Rule still displayed |
| 34 | Key | `_parse_conflicts_with` direct | Failure Mode | Unit | `test_review_ux.py` | `should_parse_conflicts_with_various_inputs` | None→[], list→list, JSON→list, invalid→[] |
| 35 | Key | `_format_review_output` — conflicts truncation | Failure Mode | Unit | `test_review_ux.py` | `should_truncate_conflicts_over_three` | >3 conflicts → "+N more" |
| 36 | Key | inspect file deleted | Failure Mode | Unit | `test_review_ux.py` | `should_return_file_not_found_for_deleted_rule` | Between display and inspect |
| 37 | Key | header audit level | Failure Mode | Unit | `test_review_ux.py` | `should_compute_min_delta_for_header` | Min delta → worst level |
| 38 | Key | CHECKER C5 persistence | Component | Unit | `test_review_ux.py` | `should_persist_rule_summary_in_checker_flow` | write→read round-trip with rule_summary |
| 39 | Key | orchestrate_start — staging_rule_paths | Component | Unit | `test_review_ux.py` | `should_store_staging_rule_paths_in_workflow` | Workflow contains staging_rule_paths after review init |
| 40 | Key | orchestrate_start — enriched data flow | Component | Unit | `test_review_ux.py` | `should_pass_enriched_data_to_formatter` | _enrich called, split results passed to _format_review_output |

## Edge Cases & Error Paths

| Category | Edge Case | Test |
|----------|-----------|------|
| null/empty inputs | Empty DRAFT content | `should_show_empty_message_for_empty_draft` |
| null/empty inputs | Empty rule body | `should_return_empty_body_message_for_empty_rule` |
| null/empty inputs | 0 rules total from list_rules | `should_show_no_rules_when_zero_total` |
| null/empty inputs | 0 staging, 0 verified | `should_show_no_rules_when_zero_total` |
| boundary values | confidence = 0.0 and 1.0 | `should_display_confidence_at_boundaries` |
| boundary values | Inspect index at exact boundary (= staging count) | `should_return_invalid_index_error_for_over_count` |
| boundary values | Exactly 3 conflicts (no truncation) | `should_display_conflict_line_below_rule_summary` |
| boundary values | 4 conflicts (truncation triggers) | `should_truncate_conflicts_over_three` |
| data corruption | conflicts_with is not valid JSON | `should_skip_conflict_line_when_invalid_json` |
| data corruption | confidence is non-numeric string | `should_display_default_confidence_when_non_numeric` |
| timing/state | Rule file deleted between display and inspect | `should_return_file_not_found_for_deleted_rule` |
| timing/state | DRAFT file deleted between display and show draft | `should_return_not_found_for_deleted_draft` |
| timing/state | In-flight workflow with old `displayed_rules` field | `should_fallback_to_displayed_rules_for_old_workflow` |
| parse boundary | Non-list paragraph between Key Findings items terminates collection | `should_terminate_collection_on_non_list_paragraph` |
| parse boundary | Blank lines between Key Findings items are preserved | `should_allow_blank_lines_between_findings` |
| legacy compat | Rule file without rule_summary frontmatter | `should_write_rule_without_rule_summary` |

## Test Data

### Fixtures (in `conftest.py` / `_orch_helpers.py`)

- **`_make_staging_rule(category, **kwargs)`** — existing helper, creates + stages a rule. Add `confidence=N` and `conflicts_with=[...]` support.
- **`_make_verified_rule(category, **kwargs)`** — existing helper. No changes needed.
- **`_create_draft_file(sequence, content=...)`** — existing helper. Extend to accept custom DRAFT content (with/without ## Key Findings).

### New helpers needed (in test file or `_orch_helpers.py`)

- **`_make_staging_rule_with_meta(category, confidence=0.7, risk_level="medium", conflicts_with=None, rule_summary=None, **kwargs)`** — creates a staging rule with specific metadata fields for testing formatter display.
- **`_create_draft_with_key_findings(findings: list[str], sequence: int)`** — creates DRAFT with `## Key Findings` section containing given list items.
- **`_create_draft_without_key_findings(lines: list[str], sequence: int)`** — creates DRAFT without Key Findings section for fallback testing.

### Mock strategy

- **`get_audit_decision`**: Monkeypatch in tests for `_enrich_rules_metadata` to control return values (success, error dict, exception). No need for filesystem-level mocks — use `tmp_repo` fixture with real files.
- **`load_rule_file`**: Use real files in `tmp_repo`. For "file deleted" tests, create then delete the file.
- **`_parse_conflicts_with`**: Test with real frontmatter containing JSON-encoded conflicts_with strings.

## Dependencies Between Tests

- No test may depend on another test passing (TDD principle: each test is independent)
- All tests use `tmp_repo` autouse fixture (fresh temp dir per test)
- `_orch_helpers.py` functions are shared utilities, not test dependencies
- **Parallelizable**: All tests in `test_review_ux.py` can run in parallel — no shared mutable state

## Open Questions

- ~~Should `_parse_conflicts_with` be tested directly or only via formatter integration?~~ → **Resolved**: Test directly in a unit test AND via formatter output. Direct test covers parsing edge cases (None, invalid JSON, list); integration test covers display format.
- ~~Should `RuleMetadata.rule_summary` tests go in `test_review_ux.py` or a separate data model test?~~ → **Resolved**: In `test_review_ux.py` — it's a small addition (2-3 tests) and keeps all review UX tests together.

## Migration Notes

- **Existing test suite impact**: `test_review_actions.py` checks `wf["displayed_rules"]` (multiple lines). Phase 2 replaces this with `staging_rule_paths`. During Phase 5 (business code), existing tests referencing `displayed_rules` must be updated to expect `staging_rule_paths` instead. This is a known breaking change.
- **Empty DRAFT char-count behavior**: When `_parse_draft_summary` returns `(["DRAFT report is empty"], 0)`, the formatter should NOT append the "(N chars — use 'show draft' for full report)" line when total_chars is 0. The "DRAFT report is empty" message is self-contained.

## Priority Downgrade Justifications

None. All Phase 1 core requirements appear in Core Scenarios with Key functional points. AC-7 (Secondary) is tested at standard depth (happy + error) since it's served by Key components.

## Priority Upgrade Review

### Secondary → Core Scenarios
- AC-7 (US-7, Secondary): Listed in Core Scenarios for completeness. Served entirely by Key components (`_enrich_rules_metadata`, `_format_review_output`). Test depth remains standard (happy + primary error) — not upgraded to comprehensive. No scope creep.

### Peripheral → Key Functional Points
- None. All peripheral functional points remain in peripheral test depth.
