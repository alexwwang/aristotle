"""Module 2: Review actions — confirm, reject, revise, re_reflect (TC-2-01 through TC-2-12).

Tests: TestOrchestrateReviewAction (15 tests)
Acceptance: A5 (Review cross-session)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import _NEW_APIS_AVAILABLE
from _orch_helpers import (
    _load_workflow,
    _start_reflect_workflow,
    _setup_reflection_record,
    _create_draft_file,
    _start_review_workflow,
    _make_staging_rule,
    init_repo_tool,
    orchestrate_start,
    orchestrate_on_event,
)

# Conditional import — may not be available yet
if _NEW_APIS_AVAILABLE:
    from conftest import orchestrate_review_action


# ═══════════════════════════════════════════════════════
# TestOrchestrateReviewAction
# ═══════════════════════════════════════════════════════
class TestOrchestrateReviewAction:
    """Module 2: Review actions (confirm, reject, revise, re_reflect)."""

    # ── Confirm (TC-2-01, TC-2-02) ─────────────────────

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_confirm_commits_staging_rules(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "confirm")

        assert result["action"] == "notify"
        assert "committed" in result["message"].lower()
        assert "confirmed" in result["message"].lower()

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(rule_path))
        assert fm.get("status") == "verified"

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

        from aristotle_mcp.config import resolve_repo_dir

        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "auto_committed"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_confirm_no_staging_rules(self):
        review_result = _start_review_workflow(1)
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "confirm")

        assert result["action"] == "notify"
        assert "0 rules committed" in result["message"]
        assert "confirmed" in result["message"].lower()

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    # ── Reject (TC-2-03) ───────────────────────────────

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_reject_rejects_rules_and_updates_state(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule(
            "PATTERN_VIOLATION", source_session="ses_test123"
        )

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "reject")

        assert result["action"] == "notify"
        assert "rejected" in result["message"].lower()
        assert "#1" in result["message"]

        from aristotle_mcp.config import resolve_repo_dir

        rejected_path = resolve_repo_dir() / "rejected" / "user" / Path(rule_path).name
        assert rejected_path.exists() and not Path(rule_path).exists()

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "rejected"

    # ── Revise (TC-2-04 through TC-2-07, TC-2-10, TC-2-11) ──

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_fires_o_with_revise_prompt(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        wf = _load_workflow(wf_id)
        assert len(wf["displayed_rules"]) > 0

        result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="Remove the hallucinated API call",
            data_json=json.dumps({"rule_index": 1}),
        )

        assert result["action"] == "fire_o"
        assert "o_prompt" in result
        assert "ORIGINAL RULE FILE" in result["o_prompt"]
        assert "USER FEEDBACK" in result["o_prompt"]
        assert "Remove the hallucinated API call" in result["o_prompt"]
        assert result["workflow_id"] == wf_id

        wf = _load_workflow(wf_id)
        assert wf["pending_role"] == "O"
        assert wf.get("revise_rule_path") is not None

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_rule_index_resolved_correctly(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        for i in range(3):
            _make_staging_rule(f"CAT_{i}", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]
        wf = _load_workflow(wf_id)

        result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix",
            data_json=json.dumps({"rule_index": 2}),
        )

        assert result["action"] == "fire_o"
        displayed = wf["displayed_rules"]
        target_path = displayed[1] if len(displayed) > 1 else displayed[0]
        assert target_path in result["o_prompt"]

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_o_done_parse_failure(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        revise_result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix it",
            data_json=json.dumps({"rule_index": 1}),
        )
        assert revise_result["action"] == "fire_o"

        o_done = orchestrate_on_event(
            "o_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "result": "I cannot revise this rule because it's too complex.",
                }
            ),
        )

        assert o_done["action"] == "notify"
        assert "Could not parse" in o_done["message"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_o_done_auto_commits(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule(
            "PATTERN_VIOLATION", confidence=0.9, source_session="ses_test123"
        )

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        orchestrate_review_action(
            wf_id,
            "revise",
            feedback="improve",
            data_json=json.dumps({"rule_index": 1}),
        )

        revised_content = (
            f"FILE: {rule_path}\n"
            "---\n"
            'id: "rec_test"\n'
            'status: "staging"\n'
            'scope: "user"\n'
            'category: "PATTERN_VIOLATION"\n'
            "confidence: 0.9\n"
            'risk_level: "low"\n'
            'created_at: "2026-04-22T10:00:00+08:00"\n'
            "---\n"
            "## Revised Rule\n"
            "**Rule**: Improved pattern check"
        )

        o_done = orchestrate_on_event(
            "o_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "result": revised_content,
                }
            ),
        )

        assert o_done["action"] == "notify"
        assert "revised" in o_done["message"].lower()

        updated_content = Path(rule_path).read_text(encoding="utf-8")
        assert "Improved pattern check" in updated_content

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_no_rules_available(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        wf = _load_workflow(wf_id)
        assert wf["displayed_rules"] == []

        result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix it",
            data_json=json.dumps({"rule_index": 1}),
        )

        assert result["action"] == "notify"
        assert "No rules" in result["message"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "review"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_invalid_rule_index(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        for i in range(2):
            _make_staging_rule(f"CAT_{i}", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]
        wf = _load_workflow(wf_id)
        n_rules = len(wf["displayed_rules"])
        assert n_rules > 0

        result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix",
            data_json=json.dumps({"rule_index": n_rules + 5}),
        )

        assert result["action"] == "notify"
        assert "Invalid rule index" in result["message"]

    # ── Re-reflect (TC-2-08, TC-2-09, TC-2-12) ────────

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_re_reflect_creates_new_workflow(self):
        review_result = _start_review_workflow(1)
        wf_id = review_result["workflow_id"]

        result = orchestrate_review_action(wf_id, "re_reflect")

        assert result["action"] == "fire_sub"
        assert result["sub_role"] == "R"
        new_wf_id = result["workflow_id"]
        assert new_wf_id != wf_id
        assert "Re-reflecting" in result["notify_message"]
        assert "#1/3" in result["notify_message"]

        wf_old = _load_workflow(wf_id)
        assert wf_old["phase"] == "done"

        wf_new = _load_workflow(new_wf_id)
        assert wf_new["phase"] == "reflecting"
        assert wf_new["command"] == "reflect"
        assert wf_new["re_reflect_count"] == 1
        assert wf_new["parent_review_sequence"] == 1
        assert wf_new["parent_workflow_id"] == wf_id
        assert wf_new["pending_role"] == "R"
        assert wf_new["record_created"] is False

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_re_reflect_max_count_blocked(self):
        review_result = _start_review_workflow(1, re_reflect_count=3)
        wf_id = review_result["workflow_id"]

        wf = _load_workflow(wf_id)
        assert wf["re_reflect_count"] == 3

        result = orchestrate_review_action(wf_id, "re_reflect")

        assert result["action"] == "notify"
        assert "Max re-reflect" in result["message"]
        assert "3" in result["message"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "review"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_review_action_wrong_phase(self):
        start = _start_reflect_workflow("ses_tgt")
        wf_id = start["workflow_id"]

        result = orchestrate_review_action(wf_id, "confirm")

        assert result["action"] == "notify"
        assert "not in review" in result["message"].lower()

    # ── Exception paths (§3.8.1) ──────────────────────

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_confirm_commit_rule_exception(self):
        """confirm 时 commit_rule 抛异常 → failed count 递增，不中断流程。"""
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        import unittest.mock

        with unittest.mock.patch(
            "aristotle_mcp._orch_review.commit_rule",
            side_effect=RuntimeError("git error"),
        ):
            result = orchestrate_review_action(wf_id, "confirm")

        assert result["action"] == "notify"
        assert "failed" in result["message"].lower()
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_reject_reject_rule_exception(self):
        """reject 时 reject_rule 抛异常 → 静默继续（不崩溃）。"""
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("PATTERN_VIOLATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        import unittest.mock

        with unittest.mock.patch(
            "aristotle_mcp._orch_review.reject_rule",
            side_effect=RuntimeError("fs error"),
        ):
            result = orchestrate_review_action(wf_id, "reject")

        assert result["action"] == "notify"
        assert "rejected" in result["message"].lower()
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"


# ═══════════════════════════════════════════════════════
# TestExceptionRevise — Revise flow exception paths (§3.8.5)
# ═══════════════════════════════════════════════════════
class TestExceptionRevise:
    """Revise 流异常路径：stage_rule 和 commit_rule 异常处理。"""

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_stage_rule_exception(self):
        """revise 后 stage_rule 抛异常 → 静默 pass，不崩溃。"""
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule(
            "HALLUCINATION", confidence=0.3, source_session="ses_test123"
        )

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        orchestrate_review_action(
            wf_id,
            "revise",
            feedback="fix it",
            data_json=json.dumps({"rule_index": 1}),
        )

        revised_content = (
            f"FILE: {rule_path}\n"
            "---\n"
            'id: "rec_test"\n'
            'status: "staging"\n'
            'scope: "user"\n'
            'category: "HALLUCINATION"\n'
            "confidence: 0.3\n"
            'risk_level: "medium"\n'
            'created_at: "2026-04-22T10:00:00+08:00"\n'
            "---\n"
            "## Revised Rule\n"
            "**Rule**: Improved check\n"
        )

        import unittest.mock

        with unittest.mock.patch(
            "aristotle_mcp._orch_event.stage_rule",
            side_effect=RuntimeError("stage error"),
        ):
            o_done = orchestrate_on_event(
                "o_done",
                json.dumps(
                    {
                        "workflow_id": wf_id,
                        "result": revised_content,
                    }
                ),
            )

        assert o_done["action"] == "notify"
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_revise_commit_rule_exception(self):
        """revise 后 commit_rule 抛异常 → message 含 'failed'。"""
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        rule_path = _make_staging_rule(
            "PATTERN_VIOLATION", confidence=0.9, source_session="ses_test123"
        )

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        orchestrate_review_action(
            wf_id,
            "revise",
            feedback="improve",
            data_json=json.dumps({"rule_index": 1}),
        )

        revised_content = (
            f"FILE: {rule_path}\n"
            "---\n"
            'id: "rec_test"\n'
            'status: "staging"\n'
            'scope: "user"\n'
            'category: "PATTERN_VIOLATION"\n'
            "confidence: 0.9\n"
            'risk_level: "low"\n'
            'created_at: "2026-04-22T10:00:00+08:00"\n'
            "---\n"
            "## Revised Rule\n"
            "**Rule**: Always check return values\n"
        )

        import unittest.mock

        with unittest.mock.patch(
            "aristotle_mcp._orch_event.commit_rule",
            side_effect=RuntimeError("commit error"),
        ):
            o_done = orchestrate_on_event(
                "o_done",
                json.dumps(
                    {
                        "workflow_id": wf_id,
                        "result": revised_content,
                    }
                ),
            )

        assert o_done["action"] == "notify"
        assert "failed" in o_done["message"].lower()
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"


# ═══════════════════════════════════════════════════════
# TestIntegrationReview — End-to-end review flows
# ═══════════════════════════════════════════════════════
class TestIntegrationReview:
    """End-to-end: reflect → review → confirm, and reflect → review → revise → o_done."""

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_full_review_confirm_flow(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1, "## DRAFT Report\nFound hallucination in API call.")
        rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        assert review_result["action"] == "notify"
        wf_id = review_result["workflow_id"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "review"
        assert len(wf["displayed_rules"]) > 0
        assert "DRAFT Report" in review_result["message"]

        confirm_result = orchestrate_review_action(wf_id, "confirm")
        assert confirm_result["action"] == "notify"
        assert "confirmed" in confirm_result["message"].lower()
        assert "committed" in confirm_result["message"].lower()

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(rule_path))
        assert fm.get("status") == "verified"

        from aristotle_mcp.config import resolve_repo_dir

        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "auto_committed"

    @pytest.mark.skipif(
        not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented"
    )
    def test_full_review_revise_flow(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1, "## DRAFT Report\nPattern violation in error handling.")
        rule_path = _make_staging_rule(
            "PATTERN_VIOLATION", source_session="ses_test123"
        )

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        revise_result = orchestrate_review_action(
            wf_id,
            "revise",
            feedback="Add specific pattern example",
            data_json=json.dumps({"rule_index": 1}),
        )
        assert revise_result["action"] == "fire_o"
        assert (
            "USER FEEDBACK: Add specific pattern example" in revise_result["o_prompt"]
        )
        assert "ORIGINAL RULE FILE" in revise_result["o_prompt"]

        revised_content = (
            f"FILE: {rule_path}\n"
            "---\n"
            'id: "rec_revised"\n'
            'status: "staging"\n'
            'scope: "user"\n'
            'category: "PATTERN_VIOLATION"\n'
            "confidence: 0.85\n"
            'risk_level: "low"\n'
            'created_at: "2026-04-22T10:00:00+08:00"\n'
            "---\n"
            "## Revised Rule\n"
            "**Rule**: Always check return values before propagating"
        )

        o_done = orchestrate_on_event(
            "o_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "result": revised_content,
                }
            ),
        )
        assert o_done["action"] == "notify"
        assert "revised" in o_done["message"].lower()

        updated_content = Path(rule_path).read_text(encoding="utf-8")
        assert "Always check return values" in updated_content

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"
