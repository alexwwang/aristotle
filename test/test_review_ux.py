"""Module: Enhanced Review Phase UX (Phase 4 TDD Red).

Tests: TestParseDraftSummary, TestEnrichRulesMetadata,
       TestFormatReviewOutput, TestInspectAction,
       TestShowDraftAction, TestReviseAction,
       TestRuleSummaryDataModel, TestParseConflicts,
       TestAuditDecisionsNoneFallback,
       TestOrchestrateStartReviewBranch

All tests target stub functions or unimplemented enhancement branches.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

from conftest import _NEW_APIS_AVAILABLE
from _orch_helpers import (
    _load_workflow,
    _make_staging_rule,
    _make_verified_rule,
    _create_draft_file,
    _setup_reflection_record,
    init_repo_tool,
    orchestrate_start,
)

from aristotle_mcp._orch_parsers import (
    _parse_draft_summary,
    _enrich_rules_metadata,
    _format_review_output,
    _AUDIT_LABELS,
)
try:
    from aristotle_mcp._orch_parsers import _build_review_actions
except ImportError:
    _build_review_actions = None  # Will fail tests in Phase 0a (Red)
from aristotle_mcp.models import (
    RuleMetadata,
    _parse_conflicts_with,
    to_frontmatter_string,
    from_frontmatter_dict,
)
from aristotle_mcp._tools_rules import write_rule

if _NEW_APIS_AVAILABLE:
    from conftest import orchestrate_review_action


# ═══════════════════════════════════════════════════════
# TestParseDraftSummary
# ═══════════════════════════════════════════════════════
class TestParseDraftSummary:
    """_parse_draft_summary — extract Key Findings or fallback."""

    def test_should_extract_key_findings_items(self):
        draft = "## Key Findings\n- Finding one\n- Finding two\n- Finding three\n\n## Other section\nMore text here."
        findings, total_chars = _parse_draft_summary(draft)
        assert findings == ["Finding one", "Finding two", "Finding three"]
        assert total_chars == len(draft)

    def test_should_fallback_to_first_3_lines_without_key_findings(self):
        draft = "Line one\nLine two\nLine three\nLine four"
        findings, total_chars = _parse_draft_summary(draft)
        assert findings == ["Line one", "Line two", "Line three"]
        assert total_chars == len(draft)

    def test_should_show_draft_report_is_empty_for_empty_content(self):
        findings, total_chars = _parse_draft_summary("")
        assert findings == ["DRAFT report is empty"]
        assert total_chars == 0

    def test_should_show_single_finding_when_only_one(self):
        draft = "## Key Findings\n- Only one finding"
        findings, total_chars = _parse_draft_summary(draft)
        assert findings == ["Only one finding"]
        assert total_chars == len(draft)

    def test_should_terminate_collection_on_non_list_paragraph(self):
        draft = "## Key Findings\n- First item\n\nThis is a paragraph\n- Second item"
        findings, total_chars = _parse_draft_summary(draft)
        assert findings == ["First item"]
        assert total_chars == len(draft)

    def test_should_allow_blank_lines_between_findings(self):
        draft = "## Key Findings\n- First item\n\n\n- Second item\n\n- Third item"
        findings, total_chars = _parse_draft_summary(draft)
        assert findings == ["First item", "Second item", "Third item"]
        assert total_chars == len(draft)


# ═══════════════════════════════════════════════════════
# TestEnrichRulesMetadata
# ═══════════════════════════════════════════════════════
class TestEnrichRulesMetadata:
    """_enrich_rules_metadata — split staging/verified + audit decisions."""

    def test_should_split_staging_and_verified(self):
        rules_result = {
            "rules": [
                {"metadata": {"status": "staging", "path": "/a"}, "path": "/a"},
                {"metadata": {"status": "staging", "path": "/b"}, "path": "/b"},
                {"metadata": {"status": "verified", "path": "/c"}, "path": "/c"},
            ]
        }
        staging, verified, audit_decisions = _enrich_rules_metadata(rules_result)
        assert len(staging) == 2
        assert len(verified) == 1
        assert len(audit_decisions) == 2

    def test_should_return_empty_for_zero_rules(self):
        rules_result = {"rules": []}
        staging, verified, audit_decisions = _enrich_rules_metadata(rules_result)
        assert staging == []
        assert verified == []
        assert audit_decisions == []

    def test_should_map_audit_error_to_none(self, monkeypatch):
        """D9: get_audit_decision returns error dict → None in audit_decisions."""
        import aristotle_mcp._orch_parsers as parsers

        monkeypatch.setattr(
            parsers,
            "_get_audit_decision",
            lambda path: {"success": False, "message": "File not found"},
        )
        rules_result = {"rules": [{"path": "/a", "metadata": {"status": "staging"}}]}
        staging, verified, audit_decisions = _enrich_rules_metadata(rules_result)
        assert audit_decisions[0] is None

    def test_should_map_audit_exception_to_none(self, monkeypatch):
        """D10: get_audit_decision raises ValueError → None in audit_decisions."""
        import aristotle_mcp._orch_parsers as parsers

        def _raise(path):
            raise ValueError("Invalid confidence value")

        monkeypatch.setattr(parsers, "_get_audit_decision", _raise)
        rules_result = {"rules": [{"path": "/a", "metadata": {"status": "staging"}}]}
        staging, verified, audit_decisions = _enrich_rules_metadata(rules_result)
        assert audit_decisions[0] is None

    def test_should_maintain_positional_correspondence(self):
        rules_result = {
            "rules": [
                {"metadata": {"status": "staging", "path": "/first"}, "path": "/first"},
                {
                    "metadata": {"status": "staging", "path": "/second"},
                    "path": "/second",
                },
            ]
        }
        staging, verified, audit_decisions = _enrich_rules_metadata(rules_result)
        assert staging[0]["path"] == "/first"
        assert staging[1]["path"] == "/second"
        assert len(audit_decisions) == len(staging)

    def test_should_partition_interleaved_rules(self):
        """K2: Interleaved [verified, staging, verified, staging] → correct partition."""
        rules_result = {
            "rules": [
                {"metadata": {"status": "verified"}, "path": "/v1"},
                {"metadata": {"status": "staging"}, "path": "/s1"},
                {"metadata": {"status": "verified"}, "path": "/v2"},
                {"metadata": {"status": "staging"}, "path": "/s2"},
            ]
        }
        staging, verified, audit_decisions = _enrich_rules_metadata(rules_result)
        assert len(staging) == 2
        assert len(verified) == 2
        assert staging[0]["path"] == "/s1"
        assert staging[1]["path"] == "/s2"
        assert verified[0]["path"] == "/v1"
        assert verified[1]["path"] == "/v2"


# ═══════════════════════════════════════════════════════
# TestFormatReviewOutput
# ═══════════════════════════════════════════════════════
class TestFormatReviewOutput:
    """_format_review_output — enhanced formatter (delta, confidence, conflicts)."""

    def _target(self) -> dict:
        return {
            "status": "auto_committed",
            "target_label": "test",
            "launched_at": "2026-04-22T10:00:00+08:00",
        }

    def test_should_display_min_delta_and_audit_label_in_header(self):
        rules_result = {
            "rules": [
                {
                    "metadata": {
                        "status": "staging",
                        "category": "A",
                        "confidence": 0.8,
                        "risk_level": "low",
                    },
                    "path": "/a",
                },
                {
                    "metadata": {
                        "status": "staging",
                        "category": "B",
                        "confidence": 0.5,
                        "risk_level": "high",
                    },
                    "path": "/b",
                },
            ]
        }
        staging_rules = [r for r in rules_result.get("rules", []) if r["metadata"].get("status") == "staging"]
        verified_rules = []
        audit_decisions = [
            {
                "delta": 0.55,
                "audit_level": "semi",
                "confidence": 0.8,
                "risk_level": "low",
            },
            {
                "delta": 0.35,
                "audit_level": "manual",
                "confidence": 0.5,
                "risk_level": "high",
            },
        ]
        output = _format_review_output(1, self._target(), "", staging_rules, verified_rules, audit_decisions)
        assert "0.35" in output  # min delta
        assert _AUDIT_LABELS["manual"] in output  # exact label for min delta's level

    def test_should_omit_delta_line_when_no_staging_rules(self):
        # First, verify delta IS present when staging rules exist
        staging_rules = [{"metadata": {"status": "staging", "category": "A"}, "path": "/a"}]
        output_with = _format_review_output(
            1,
            self._target(),
            "",
            staging_rules,
            [],
            [
                {
                    "delta": 0.5,
                    "audit_level": "semi",
                    "confidence": 0.5,
                    "risk_level": "medium",
                }
            ],
        )
        assert "Δ" in output_with

        # Then verify delta is absent when only verified rules exist
        verified_rules_only = [{"metadata": {"status": "verified", "category": "A"}, "path": "/a"}]
        output_without = _format_review_output(
            1,
            self._target(),
            "",
            [],
            verified_rules_only,
            [],
        )
        assert "Δ" not in output_without

    def test_should_display_confidence_and_risk_level_per_rule(self):
        staging_rules = [
            {
                "metadata": {
                    "status": "staging",
                    "category": "A",
                    "confidence": 0.55,
                    "risk_level": "high",
                },
                "path": "/a",
            }
        ]
        verified_rules = []
        audit_decisions = [
            {
                "delta": 0.3,
                "audit_level": "manual",
                "confidence": 0.55,
                "risk_level": "high",
            }
        ]
        output = _format_review_output(1, self._target(), "", staging_rules, verified_rules, audit_decisions)
        assert "0.55" in output
        assert "HIGH" in output

    def test_should_display_conflict_line_below_rule_summary(self):
        staging_rules = [
            {
                "metadata": {
                    "status": "staging",
                    "category": "A",
                    "conflicts_with": '["id1", "id2"]',
                },
                "path": "/a",
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, self._target(), "", staging_rules, verified_rules, audit_decisions)
        assert "Conflicts with:" in output

    def test_should_show_staging_numbered_and_verified_unnumbered(self):
        staging_rules = [
            {
                "metadata": {
                    "status": "staging",
                    "category": "S1",
                    "error_summary": "staging_error_1",
                },
                "path": "/s1",
            },
        ]
        verified_rules = [
            {
                "metadata": {
                    "status": "verified",
                    "category": "V1",
                    "error_summary": "verified_error_1",
                },
                "path": "/v1",
            },
        ]
        output = _format_review_output(1, self._target(), "", staging_rules, verified_rules, [None])
        # Verify staging rule appears in output (in numbered section)
        assert "staging_error_1" in output, "Expected staging rule in output"
        # And that verified rule appears in auto-committed section (unnumbered)
        assert "verified_error_1" in output, "Expected verified rule in output"
        assert "auto-committed" in output.lower() or "verified" in output.lower()

    def test_should_include_inspect_and_show_draft_in_action_menu(self):
        """After DP-001: inspect/show_draft are in _build_review_actions, not in message."""
        output = _format_review_output(1, self._target(), "", [], [], [])
        # Message should NOT contain Action Menu items anymore
        assert "1. confirm" not in output
        # Verify _build_review_actions provides these options instead
        if _build_review_actions is not None:
            actions = _build_review_actions("wf_test")
            action_names = [o["action"] for o in actions["options"]]
            assert "inspect N" in action_names
            assert "show draft" in action_names

    def test_should_show_all_rules_without_cap(self):
        staging_rules = [
            {
                "metadata": {"status": "staging", "category": f"CAT_{i}"},
                "path": f"/r{i}",
            }
            for i in range(15)
        ]
        output = _format_review_output(1, self._target(), "", staging_rules, [], [None] * len(staging_rules))
        for i in range(15):
            assert f"CAT_{i}" in output, f"Rule CAT_{i} missing from output (no cap expected)"

    def test_should_display_default_confidence_when_missing(self):
        """AC-2: Missing confidence field → display default 0.7."""
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "error_summary": "test",
                    "category": "HALLUCINATION",
                    "confidence": 0.3,
                },
            }
        ]
        verified_rules = []
        audit_decisions = [None]  # None → formatter should show 0.7
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert re.search(r"0\.7(?!0)", output), "Expected confidence 0.7 in output"

    def test_should_display_default_confidence_when_non_numeric(self):
        """AC-2: Non-numeric confidence → display default 0.7."""
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "confidence": "high",
                    "error_summary": "test",
                },
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert re.search(r"0\.7(?!0)", output), "Expected confidence 0.7 in output"

    def test_should_display_confidence_at_boundaries(self):
        """AC-2: confidence=0.0 and confidence=1.0 both displayed."""
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "confidence": 0.0,
                    "risk_level": "high",
                },
            },
            {
                "path": "/r2",
                "metadata": {
                    "status": "staging",
                    "confidence": 1.0,
                    "risk_level": "low",
                },
            },
        ]
        verified_rules = []
        audit_decisions = [
            {
                "delta": 0.0,
                "audit_level": "manual",
                "confidence": 0.0,
                "risk_level": "high",
            },
            {
                "delta": 0.8,
                "audit_level": "auto",
                "confidence": 1.0,
                "risk_level": "low",
            },
        ]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert "0.0" in output
        assert "1.0" in output

    def test_should_omit_risk_indicator_when_missing(self):
        """AC-2: audit_decisions[i] is None (failed audit) → no risk indicator."""
        staging_rules = [{"path": "/r1", "metadata": {"status": "staging", "confidence": 0.5}}]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        # Should NOT contain HIGH/MEDIUM/LOW text labels from rule metadata
        # After DP-001: no Action Menu to split around, entire output is review data
        assert "HIGH" not in output

    def test_should_truncate_conflicts_over_three(self):
        """AC-3: >3 conflicts → show first 3 + '+N more'."""
        conflicts = json.dumps(["id1", "id2", "id3", "id4", "id5"])
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "conflicts_with": conflicts,
                    "error_summary": "test",
                },
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert "+2 more" in output

    def test_should_skip_conflict_line_when_empty(self):
        """AC-3: Empty conflicts_with → no conflict line."""
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "conflicts_with": None,
                    "error_summary": "test",
                },
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert "Conflicts with" not in output

    def test_should_skip_conflict_line_when_invalid_json(self):
        """AC-3: Invalid JSON in conflicts_with → no conflict line."""
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "conflicts_with": "not-json",
                    "error_summary": "test",
                },
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert "Conflicts with" not in output

    def test_should_show_deleted_rule_ids_as_is(self):
        """AC-3: Conflict IDs referencing deleted rules shown as-is."""
        conflicts = json.dumps(["deleted_rule_xyz"])
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "conflicts_with": conflicts,
                    "error_summary": "test",
                },
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert "deleted_rule_xyz" in output

    def test_should_omit_delta_line_when_all_audit_decisions_none(self):
        """AC-4: All audit decisions None → omit Δ line entirely."""
        staging_rules = [{"path": "/r1", "metadata": {"status": "staging", "error_summary": "test"}}]
        verified_rules = []
        audit_decisions = [None]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, verified_rules, audit_decisions)
        assert "Δ" not in output

    def test_should_map_audit_level_to_exact_labels(self):
        """AC-4: Verify exact label mapping for all 3 levels."""
        # Test "auto" level
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "confidence": 0.8,
                    "risk_level": "low",
                },
            }
        ]
        output_auto = _format_review_output(
            1,
            {},
            "## DRAFT",
            staging_rules,
            [],
            [
                {
                    "delta": 0.8,
                    "audit_level": "auto",
                    "confidence": 0.8,
                    "risk_level": "low",
                }
            ],
        )
        assert _AUDIT_LABELS["auto"] in output_auto
        # Verify "auto" label appears in the Δ header line specifically
        if "Δ" in output_auto:
            delta_section = output_auto.split("Δ", 1)[1].split("\n")[0]
            assert _AUDIT_LABELS["auto"] in delta_section

        # Test "semi" level
        output_semi = _format_review_output(
            1,
            {},
            "## DRAFT",
            staging_rules,
            [],
            [
                {
                    "delta": 0.5,
                    "audit_level": "semi",
                    "confidence": 0.5,
                    "risk_level": "medium",
                }
            ],
        )
        assert _AUDIT_LABELS["semi"] in output_semi

        # Test "manual" level
        output_manual = _format_review_output(
            1,
            {},
            "## DRAFT",
            staging_rules,
            [],
            [
                {
                    "delta": 0.2,
                    "audit_level": "manual",
                    "confidence": 0.2,
                    "risk_level": "high",
                }
            ],
        )
        assert _AUDIT_LABELS["manual"] in output_manual

    def test_should_show_char_count_and_show_draft_hint(self):
        """AC-5: Output includes char count and 'show draft' hint in DRAFT summary."""
        draft = "## Key Findings\n- Finding 1: test rule summary\n- Finding 2: another finding"
        staging_rules = [{"path": "/r1", "metadata": {"status": "staging", "error_summary": "test"}}]
        output = _format_review_output(1, {}, draft, staging_rules, [], [None])
        # "show draft" hint comes from the DRAFT summary line (not Action Menu)
        assert "chars — use 'show draft'" in output, "Expected 'N chars — use show draft' hint in DRAFT summary"
        assert re.search(r"\d+\s*chars", output), "Expected 'N chars' in output"

    def test_should_show_no_review_needed_when_zero_staging(self):
        """AC-7: 0 staging → 'No rules require review' + auto-committed section."""
        verified_rules = [
            {
                "path": "/v1",
                "metadata": {"status": "verified", "error_summary": "verified rule"},
            }
        ]
        output = _format_review_output(1, {}, "## DRAFT", [], verified_rules, [])
        assert "No rules require review" in output or "auto-committed" in output.lower()

    def test_should_omit_auto_committed_section_when_zero_verified(self):
        """AC-7: 0 verified → no auto-committed section."""
        staging_rules = [{"path": "/r1", "metadata": {"status": "staging", "error_summary": "test"}}]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, [], [None])
        assert "auto-committed" not in output.lower()

    def test_should_show_no_rules_when_zero_total(self):
        """AC-7: 0 rules total → 'No associated rules found.'."""
        output = _format_review_output(1, {}, "## DRAFT", [], [], [])
        assert "No associated rules found" in output or "No rules require review" in output

    def test_should_compute_min_delta_for_header(self):
        """K9: Min delta → worst (most restrictive) audit level."""
        staging_rules = [
            {
                "path": "/r1",
                "metadata": {
                    "status": "staging",
                    "confidence": 0.8,
                    "risk_level": "low",
                },
            },
            {
                "path": "/r2",
                "metadata": {
                    "status": "staging",
                    "confidence": 0.3,
                    "risk_level": "high",
                },
            },
        ]
        audit_decisions = [
            {
                "delta": 0.64,
                "audit_level": "auto",
                "confidence": 0.8,
                "risk_level": "low",
            },
            {
                "delta": 0.06,
                "audit_level": "manual",
                "confidence": 0.3,
                "risk_level": "high",
            },
        ]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, [], audit_decisions)
        assert "0.06" in output  # min delta displayed
        assert _AUDIT_LABELS["manual"] in output  # worst level


# ═══════════════════════════════════════════════════════
# TestInspectAction
# ═══════════════════════════════════════════════════════
class TestInspectAction:
    """inspect branch in orchestrate_review_action."""

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_full_rule_body_on_inspect(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "inspect", data_json=json.dumps({"rule_index": 1}))
        assert result["action"] == "notify"
        assert "check" in result["message"].lower()
        assert Path(rule_path).read_text(encoding="utf-8") in result["message"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_invalid_index_error_for_zero(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "inspect", data_json=json.dumps({"rule_index": 0}))
        assert result["action"] == "notify"
        assert "invalid" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_invalid_index_error_for_negative(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "inspect", data_json=json.dumps({"rule_index": -1}))
        assert result["action"] == "notify"
        assert "invalid" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_invalid_index_error_for_over_count(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]
        wf = _load_workflow(wf_id)
        staging_count = len(wf.get("staging_rule_paths", wf.get("displayed_rules", [])))

        result = orchestrate_review_action(
            wf_id,
            "inspect",
            data_json=json.dumps({"rule_index": staging_count + 5}),
        )
        assert result["action"] == "notify"
        assert "invalid" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_file_not_found_for_deleted_rule(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        Path(rule_path).unlink()

        result = orchestrate_review_action(wf_id, "inspect", data_json=json.dumps({"rule_index": 1}))
        assert result["action"] == "notify"
        assert "not found" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_empty_body_message_for_empty_rule(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        # Create a rule with empty body content
        w = write_rule(content="", category="HALLUCINATION", source_session="ses_test123")
        from aristotle_mcp._tools_rules import stage_rule

        stage_rule(w["file_path"])

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "inspect", data_json=json.dumps({"rule_index": 1}))
        assert result["action"] == "notify"
        assert "empty" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_not_available_for_old_workflow(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        # Simulate old workflow without staging_rule_paths
        wf = _load_workflow(wf_id)
        if "staging_rule_paths" in wf:
            del wf["staging_rule_paths"]
        from _orch_helpers import _save_workflow

        _save_workflow(wf_id, wf)

        result = orchestrate_review_action(wf_id, "inspect", data_json=json.dumps({"rule_index": 1}))
        assert result["action"] == "notify"
        assert "not available" in result["message"].lower() or "old" in result["message"].lower()


# ═══════════════════════════════════════════════════════
# TestShowDraftAction
# ═══════════════════════════════════════════════════════
class TestShowDraftAction:
    """show_draft branch in orchestrate_review_action."""

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_full_draft_on_show_draft(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1, "## Full DRAFT\nThis is the complete draft.")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "show draft")
        assert result["action"] == "notify"
        assert "Full DRAFT" in result["message"]
        assert "complete draft" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_not_found_for_deleted_draft(self):
        init_repo_tool()
        _setup_reflection_record(1)
        draft_path = _create_draft_file(1, "## DRAFT")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        draft_path.unlink()

        result = orchestrate_review_action(wf_id, "show draft")
        assert result["action"] == "notify"
        assert "not found" in result["message"].lower()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_return_empty_draft_message_for_empty_file(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1, "")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "show draft")
        assert result["action"] == "notify"
        assert "empty" in result["message"].lower()


# ═══════════════════════════════════════════════════════
# TestReviseAction
# ═══════════════════════════════════════════════════════
class TestReviseAction:
    """revise action — staging_rule_paths indexing vs fallback."""

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_revise_using_staging_rule_paths_index(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_a = _make_staging_rule("CAT_A", source_session="ses_test123")
        rule_b = _make_staging_rule("CAT_B", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        # Manually set staging_rule_paths in reverse order to verify indexing
        wf = _load_workflow(wf_id)
        wf["staging_rule_paths"] = [rule_b, rule_a]
        from _orch_helpers import _save_workflow

        _save_workflow(wf_id, wf)

        result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix",
            data_json=json.dumps({"rule_index": 1}),
        )
        assert result["action"] == "fire_o"
        # Index 1 should resolve to staging_rule_paths[0] = rule_b
        assert rule_b in result["o_prompt"]
        assert rule_a not in result["o_prompt"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_fallback_to_displayed_rules_for_old_workflow(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        # Remove staging_rule_paths and set displayed_rules to simulate old workflow
        wf = _load_workflow(wf_id)
        old_paths = wf.get("staging_rule_paths", [])
        if "staging_rule_paths" in wf:
            del wf["staging_rule_paths"]
        wf["displayed_rules"] = old_paths
        from _orch_helpers import _save_workflow

        _save_workflow(wf_id, wf)

        result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix",
            data_json=json.dumps({"rule_index": 1}),
        )
        assert result["action"] == "fire_o"
        assert rule_path in result["o_prompt"]


# ═══════════════════════════════════════════════════════
# TestRuleSummaryDataModel
# ═══════════════════════════════════════════════════════
class TestRuleSummaryDataModel:
    """RuleMetadata.rule_summary serialization and write_rule integration."""

    def test_should_serialize_and_deserialize_rule_summary(self):
        original = RuleMetadata(id="t1", rule_summary="test summary")
        fm_str = to_frontmatter_string(original)
        # Parse the YAML frontmatter block
        fm_text = fm_str.split("---")[1].strip()
        data = yaml.safe_load(fm_text)
        restored = from_frontmatter_dict(data)
        assert restored.rule_summary == "test summary"

    def test_should_write_rule_summary_to_frontmatter(self):
        init_repo_tool()
        result = write_rule(
            content="## Rule\nBody",
            category="HALLUCINATION",
            rule_summary="my summary",
        )
        assert result["success"]
        path = Path(result["file_path"])
        text = path.read_text(encoding="utf-8")
        assert "rule_summary" in text
        assert "my summary" in text

    def test_should_write_rule_without_rule_summary(self):
        init_repo_tool()
        result = write_rule(content="## Rule\nBody", category="HALLUCINATION")
        assert result["success"]
        path = Path(result["file_path"])
        text = path.read_text(encoding="utf-8")
        # rule_summary absent or null — backward compat: no crash, field may be "null" or absent
        assert "rule_summary" not in text or "rule_summary: null" in text

    def test_should_persist_rule_summary_in_checker_flow(self):
        """K13: write_rule with rule_summary → read back from file."""
        init_repo_tool()
        result = write_rule(
            content="## Test\n**Rule**: check",
            category="HALLUCINATION",
            rule_summary="Always verify file paths before editing",
        )
        assert result["success"]
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        from pathlib import Path

        fm = read_frontmatter_raw(Path(result["file_path"]))
        assert fm is not None
        assert fm.get("rule_summary") == "Always verify file paths before editing"


# ═══════════════════════════════════════════════════════
# TestParseConflicts
# ═══════════════════════════════════════════════════════
class TestParseConflicts:
    """_parse_conflicts_with direct unit tests."""

    @pytest.mark.parametrize(
        "input_value,expected",
        [
            (None, []),
            (["a", "b"], ["a", "b"]),
            ('["x", "y"]', ["x", "y"]),
            ("not-json", []),
        ],
    )
    def test_should_parse_conflicts_with_various_inputs(self, input_value, expected):
        result = _parse_conflicts_with(input_value)
        assert result == expected


# ═══════════════════════════════════════════════════════
# TestAuditDecisionsNoneFallback
# ═══════════════════════════════════════════════════════
class TestAuditDecisionsNoneFallback:
    """When audit_decisions[i] is None, formatter uses defaults."""

    def test_should_use_default_confidence_when_audit_decision_none(self):
        staging_rules = [
            {
                "metadata": {
                    "status": "staging",
                    "category": "A",
                    # confidence omitted — should default to 0.7
                },
                "path": "/a",
            }
        ]
        verified_rules = []
        audit_decisions = [None]
        target_record = {
            "status": "auto_committed",
            "target_label": "test",
            "launched_at": "2026-04-22T10:00:00+08:00",
        }
        output = _format_review_output(1, target_record, "", staging_rules, verified_rules, audit_decisions)
        assert re.search(r"0\.7(?!0)", output), "Expected confidence 0.7 in output"


# ═══════════════════════════════════════════════════════
# TestOrchestrateStartReviewBranch
# ═══════════════════════════════════════════════════════
class TestOrchestrateStartReviewBranch:
    """orchestrate_start review command — enriched data flow."""

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_store_staging_rule_paths_in_workflow(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")
        _make_verified_rule("PATTERN_VIOLATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]
        wf = _load_workflow(wf_id)

        assert "staging_rule_paths" in wf
        assert isinstance(wf["staging_rule_paths"], list)
        assert len(wf["staging_rule_paths"]) >= 1

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_should_pass_enriched_data_to_formatter(self, monkeypatch):
        """K7b: _enrich called and split results passed to _format_review_output."""
        import aristotle_mcp._orch_start as start_mod

        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        called = {"enrich": False, "formatter_args": None}

        def _mock_enrich(rules_result):
            called["enrich"] = True
            return [], [], []

        monkeypatch.setattr("aristotle_mcp._orch_parsers._enrich_rules_metadata", _mock_enrich)
        monkeypatch.setattr(start_mod, "_enrich_rules_metadata", _mock_enrich)

        def mock_formatter(*args, **kwargs):
            called["formatter_args"] = args
            return "formatted output"

        monkeypatch.setattr(start_mod, "_format_review_output", mock_formatter)

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        assert review_result["action"] == "notify"
        assert called["enrich"], "_enrich_rules_metadata was not called"
        # Verify formatter received 6 positional args (new signature)
        assert called["formatter_args"] is not None, "Formatter was not called"
        assert len(called["formatter_args"]) == 6, f"Expected 6 args, got {len(called['formatter_args'])}"


# ═══════════════════════════════════════════════════════
# TestBuildReviewActions (DP-001 Phase 0a)
# ═══════════════════════════════════════════════════════
class TestBuildReviewActions:
    """_build_review_actions — structured action menu builder."""

    @pytest.mark.skipif(_build_review_actions is None, reason="_build_review_actions not yet implemented")
    def test_ut01_returns_dict_with_workflow_id_and_options(self):
        result = _build_review_actions("wf_test")
        assert result["workflow_id"] == "wf_test"
        assert "options" in result

    @pytest.mark.skipif(_build_review_actions is None, reason="_build_review_actions not yet implemented")
    def test_ut02_returns_six_options_with_staging_rules(self):
        result = _build_review_actions("wf_test", has_staging_rules=True)
        assert len(result["options"]) == 6

    @pytest.mark.skipif(_build_review_actions is None, reason="_build_review_actions not yet implemented")
    def test_ut03_each_option_has_action_label_description(self):
        result = _build_review_actions("wf_test")
        for opt in result["options"]:
            assert "action" in opt
            assert "label" in opt
            assert "description" in opt

    @pytest.mark.skipif(_build_review_actions is None, reason="_build_review_actions not yet implemented")
    def test_ut04_options_match_review_md_spec(self):
        result = _build_review_actions("wf_test", has_staging_rules=True)
        action_names = [o["action"] for o in result["options"]]
        assert action_names == ["confirm", "reject", "revise N", "re-reflect", "inspect N", "show draft"]

    @pytest.mark.skipif(_build_review_actions is None, reason="_build_review_actions not yet implemented")
    def test_ut04b_no_confirm_when_no_staging_rules(self):
        result = _build_review_actions("wf_test", has_staging_rules=False)
        assert len(result["options"]) == 5
        assert "confirm" not in [o["action"] for o in result["options"]]


# ═══════════════════════════════════════════════════════
# TestFormatReviewOutputNoActionMenu (DP-001 Phase 0b)
# ═══════════════════════════════════════════════════════
class TestFormatReviewOutputNoActionMenu:
    """After DP-001: _format_review_output no longer includes Action Menu."""

    def test_ut05_no_action_menu_items_in_output(self):
        staging_rules = [{"path": "/r1", "metadata": {"status": "staging", "error_summary": "test"}}]
        output = _format_review_output(1, {}, "## DRAFT", staging_rules, [], [None])
        assert "1. confirm" not in output
        assert "Choose an action" not in output

    def test_ut06_review_data_sections_still_present(self):
        draft = "## Key Findings\n- Finding A"
        staging_rules = [{"path": "/r1", "metadata": {"status": "staging", "error_summary": "test"}}]
        output = _format_review_output(1, {}, draft, staging_rules, [], [None])
        assert "## DRAFT Summary" in output
        assert "## Rules for Review" in output


# ═══════════════════════════════════════════════════════
# TestReviewActionsInOrchestrateStart (DP-001 Phase 0c)
# ═══════════════════════════════════════════════════════
class TestReviewActionsInOrchestrateStart:
    """orchestrate_start review — review_actions field in return value."""

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_ut07_return_includes_review_actions(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        result = orchestrate_start("review", json.dumps({"sequence": 1}))
        assert "review_actions" in result, "Expected review_actions in return dict"

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_ut08_review_actions_workflow_id_matches_top_level(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        result = orchestrate_start("review", json.dumps({"sequence": 1}))
        assert result["review_actions"]["workflow_id"] == result["workflow_id"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_ut09_no_staging_rules_omits_confirm(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        # No staging rules created — only verified
        _make_verified_rule("PATTERN_VIOLATION", source_session="ses_test123")

        result = orchestrate_start("review", json.dumps({"sequence": 1}))
        action_names = [o["action"] for o in result["review_actions"]["options"]]
        assert "confirm" not in action_names, "confirm should be absent when no staging rules"

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_ut10_message_valid_without_review_actions(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        result = orchestrate_start("review", json.dumps({"sequence": 1}))
        # Consumer ignoring review_actions still gets valid message
        assert "## Rules for Review" in result["message"] or "No rules" in result["message"]
