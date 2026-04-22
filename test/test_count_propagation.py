"""Module 3: re_reflect_count cross-workflow propagation (TC-3-01 through TC-3-04).

Tests: TestReReflectCountPropagation (4 tests)
Acceptance: A4, A5
Product spec ref: §3.2.3.2 re_reflect loop prevention, R4-FIX
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import _NEW_APIS_AVAILABLE
from _orch_helpers import (
    _load_workflow,
    _start_reflect_workflow,
    _fire_r_done_event,
    _fire_c_done_event,
    _setup_reflection_record,
    _create_draft_file,
    _make_staging_rule,
    init_repo_tool,
    orchestrate_start,
)

# Conditional import — may not be available yet
if _NEW_APIS_AVAILABLE:
    from conftest import orchestrate_review_action


# ═══════════════════════════════════════════════════════
# TestReReflectCountPropagation — TC-3-01 through TC-3-04
# ═══════════════════════════════════════════════════════
class TestReReflectCountPropagation:
    """re_reflect_count cross-workflow propagation (R4 loop prevention)."""

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_re_reflect_count_increments_to_new_workflow(self):
        init_repo_tool()
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf_id = review_result["workflow_id"]

        re_result = orchestrate_review_action(wf_id, "re_reflect")
        new_wf_id = re_result["workflow_id"]

        wf_new = _load_workflow(new_wf_id)
        assert wf_new["re_reflect_count"] == 1

        r_done = _fire_r_done_event(new_wf_id, "ses_r2")

        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[-1]["re_reflect_count"] == 1
        assert r_done["action"] == "fire_sub"
        assert r_done["sub_role"] == "C"

        c_done = _fire_c_done_event(new_wf_id, "Committed: 1, Staged: 0")
        assert c_done["action"] == "notify"

        _setup_reflection_record(2)
        _create_draft_file(2)
        review2_result = orchestrate_start("review", json.dumps({"sequence": 2}))
        wf2 = _load_workflow(review2_result["workflow_id"])
        assert wf2["re_reflect_count"] == 1

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_re_reflect_count_cascades_to_max(self):
        init_repo_tool()

        # === Round 1: review → re_reflect (count 0→1) ===
        _setup_reflection_record(1)
        _create_draft_file(1)
        _make_staging_rule("HALLUCINATION", source_session="ses_test123")

        review1 = orchestrate_start("review", json.dumps({"sequence": 1}))
        wf1_id = review1["workflow_id"]
        rr1 = orchestrate_review_action(wf1_id, "re_reflect")
        assert rr1["action"] == "fire_sub"
        new_wf1_id = rr1["workflow_id"]

        wf_r1 = _load_workflow(new_wf1_id)
        assert wf_r1["re_reflect_count"] == 1

        _fire_r_done_event(new_wf1_id, "ses_r_round1")
        _fire_c_done_event(new_wf1_id, "Committed: 1, Staged: 0")

        # === Round 2: new review → re_reflect (count 1→2) ===
        _setup_reflection_record(2)
        _create_draft_file(2)
        review2 = orchestrate_start("review", json.dumps({"sequence": 2}))
        wf2_id = review2["workflow_id"]
        wf2 = _load_workflow(wf2_id)
        assert wf2["re_reflect_count"] == 1

        rr2 = orchestrate_review_action(wf2_id, "re_reflect")
        assert rr2["action"] == "fire_sub"
        assert "#2/3" in rr2["notify_message"]
        new_wf2_id = rr2["workflow_id"]

        wf_r2 = _load_workflow(new_wf2_id)
        assert wf_r2["re_reflect_count"] == 2

        _fire_r_done_event(new_wf2_id, "ses_r_round2")
        _fire_c_done_event(new_wf2_id, "Committed: 0, Staged: 0")

        # === Round 3: new review → re_reflect (count 2→3) ===
        _setup_reflection_record(3)
        _create_draft_file(3)
        review3 = orchestrate_start("review", json.dumps({"sequence": 3}))
        wf3_id = review3["workflow_id"]
        wf3 = _load_workflow(wf3_id)
        assert wf3["re_reflect_count"] == 2

        rr3 = orchestrate_review_action(wf3_id, "re_reflect")
        assert rr3["action"] == "fire_sub"
        assert "#3/3" in rr3["notify_message"]
        new_wf3_id = rr3["workflow_id"]

        wf_r3 = _load_workflow(new_wf3_id)
        assert wf_r3["re_reflect_count"] == 3

        _fire_r_done_event(new_wf3_id, "ses_r_round3")
        _fire_c_done_event(new_wf3_id, "Committed: 0, Staged: 0")

        # === Round 4: new review → re_reflect BLOCKED (count=3) ===
        _setup_reflection_record(4)
        _create_draft_file(4)
        review4 = orchestrate_start("review", json.dumps({"sequence": 4}))
        wf4_id = review4["workflow_id"]
        wf4 = _load_workflow(wf4_id)
        assert wf4["re_reflect_count"] == 3

        rr4 = orchestrate_review_action(wf4_id, "re_reflect")
        assert rr4["action"] == "notify"
        assert "Max re-reflect" in rr4["message"]
        assert "3" in rr4["message"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_re_reflect_count_inherited_from_record(self):
        init_repo_tool()
        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        records = [
            {
                "id": "rec_1",
                "status": "auto_committed",
                "target_label": "current",
                "target_session_id": "ses_1",
                "rules_count": 1,
                "launched_at": "2026-04-22T10:00:00+08:00",
                "draft_file_path": str(resolve_repo_dir().parent / "aristotle-drafts" / "rec_1.md"),
            },
            {
                "id": "rec_2",
                "status": "auto_committed",
                "target_label": "current",
                "target_session_id": "ses_1",
                "rules_count": 0,
                "launched_at": "2026-04-22T11:00:00+08:00",
                "draft_file_path": str(resolve_repo_dir().parent / "aristotle-drafts" / "rec_2.md"),
                "re_reflect_count": 2,
            },
        ]
        state_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

        _create_draft_file(2, "## DRAFT for re_reflect test")

        result = orchestrate_start("review", json.dumps({"sequence": 2}))
        wf_id = result["workflow_id"]

        wf = _load_workflow(wf_id)
        assert wf["re_reflect_count"] == 2
        assert wf["phase"] == "review"

        rr = orchestrate_review_action(wf_id, "re_reflect")
        assert rr["action"] == "fire_sub"
        new_wf = _load_workflow(rr["workflow_id"])
        assert new_wf["re_reflect_count"] == 3

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_re_reflect_count_zero_not_written_to_record(self):
        start = _start_reflect_workflow("ses_first")
        wf_id = start["workflow_id"]

        _fire_r_done_event(wf_id, "ses_r_first")

        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))

        latest = records[-1]
        assert latest.get("re_reflect_count", 0) == 0
        assert latest.get("re_reflect_count") is None or latest["re_reflect_count"] == 0
