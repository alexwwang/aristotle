"""Module 1: Reflect workflow state machine transitions (TC-1-01 through TC-1-07).

Tests: TestOrchestrateStartReflect (4) + TestOrchestrateOnEventReflect (4)
Acceptance: A4 (R→C auto-chaining), A8 (auto-init)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import _NEW_APIS_AVAILABLE
from _orch_helpers import (
    _start_reflect_workflow,
    _fire_r_done_event,
    _fire_c_done_event,
    _load_workflow,
    orchestrate_start,
)


# ═══════════════════════════════════════════════════════
# TestOrchestrateStartReflect — TC-1-04, TC-1-05, TC-1-07, basic
# ═══════════════════════════════════════════════════════
class TestOrchestrateStartReflect:

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_basic(self):
        result = _start_reflect_workflow("ses_target1")
        assert result["action"] == "fire_sub"
        assert result["sub_role"] == "R"
        assert result["workflow_id"].startswith("wf_")
        assert "notify_message" in result
        assert "Reflector launched" in result["notify_message"]

        wf = _load_workflow(result["workflow_id"])
        assert wf["phase"] == "reflecting"
        assert wf["command"] == "reflect"
        assert wf["pending_role"] == "R"
        assert wf["record_created"] is False
        assert wf["sequence"] == 1
        assert wf["target_session_id"] == "ses_target1"

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_sequence_incremented(self):
        r1 = _start_reflect_workflow("ses_1")
        wf1_id = r1["workflow_id"]
        wf1 = _load_workflow(wf1_id)
        assert wf1["sequence"] == 1

        _fire_r_done_event(wf1_id, "ses_r1")
        _fire_c_done_event(wf1_id, "Committed: 0, Staged: 0")

        r2 = _start_reflect_workflow("ses_2")
        wf2_id = r2["workflow_id"]
        wf2 = _load_workflow(wf2_id)
        assert wf2["sequence"] == 2

        assert wf1_id != wf2_id

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_no_target_session_id(self):
        result = orchestrate_start("reflect", json.dumps({}))
        assert result["action"] == "notify"
        assert "Need" in result["message"]
        assert "target_session_id" in result["message"].lower()

        from aristotle_mcp.config import resolve_repo_dir
        wf_dir = resolve_repo_dir() / ".workflows"
        if wf_dir.exists():
            assert len(list(wf_dir.glob("*.json"))) == 0

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_focus_hint_in_prompt(self):
        result = _start_reflect_workflow("ses_1", focus="error")
        assert result["action"] == "fire_sub"
        assert "FOCUS_HINT: error" in result["sub_prompt"]

        long_focus = "x" * 300
        result2 = _start_reflect_workflow("ses_2", focus=long_focus)
        assert result2["action"] == "fire_sub"
        prompt = result2["sub_prompt"]
        focus_line = [l for l in prompt.split("\n") if l.startswith("FOCUS_HINT:")][0]
        assert len(focus_line.split("FOCUS_HINT: ")[1]) <= 200

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_auto_init(self):
        from aristotle_mcp.config import resolve_repo_dir
        import shutil
        repo = resolve_repo_dir()
        git_dir = repo / ".git"
        if git_dir.exists():
            shutil.rmtree(git_dir)

        result = _start_reflect_workflow("ses_auto_init")
        assert result["action"] == "fire_sub"
        assert git_dir.exists()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_invalid_args_json(self):
        result = orchestrate_start("reflect", "not valid json {{{")
        assert result["action"] == "notify"
        assert "Invalid" in result["message"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_with_explicit_session(self):
        result = _start_reflect_workflow("ses_explicit_abc")
        assert result["action"] == "fire_sub"

        wf = _load_workflow(result["workflow_id"])
        assert wf["target_session_id"] == "ses_explicit_abc"

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_reflect_workflow_state_saved(self):
        result = _start_reflect_workflow("ses_state_check")
        assert result["action"] == "fire_sub"

        from aristotle_mcp.config import resolve_repo_dir
        wf_dir = resolve_repo_dir() / ".workflows"
        wf_id = result["workflow_id"]
        wf_file = wf_dir / f"{wf_id}.json"
        assert wf_file.exists()

        wf_data = json.loads(wf_file.read_text(encoding="utf-8"))
        assert wf_data["phase"] == "reflecting"
        assert wf_data["command"] == "reflect"
        assert "updated_at" in wf_data


# ═══════════════════════════════════════════════════════
# TestOrchestrateOnEventReflect — TC-1-01, TC-1-02, TC-1-03, TC-1-06
# ═══════════════════════════════════════════════════════
class TestOrchestrateOnEventReflect:

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_full_reflect_flow(self):
        start = _start_reflect_workflow("ses_target1")
        assert start["action"] == "fire_sub"
        assert start["sub_role"] == "R"
        assert start["workflow_id"].startswith("wf_")
        assert "notify_message" in start
        assert "Reflector launched" in start["notify_message"]
        wf_id = start["workflow_id"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "reflecting"
        assert wf["command"] == "reflect"
        assert wf["pending_role"] == "R"
        assert wf["record_created"] is False
        assert wf["sequence"] == 1
        assert wf["target_session_id"] == "ses_target1"

        r_done = _fire_r_done_event(wf_id, session_id="ses_r_reflector")
        assert r_done["action"] == "fire_sub"
        assert r_done["sub_role"] == "C"
        assert r_done["workflow_id"] == wf_id

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "checking"
        assert wf["pending_role"] == "C"
        assert wf["record_created"] is True

        c_done = _fire_c_done_event(wf_id, "Committed: 2, Staged: 0")
        assert c_done["action"] == "notify"
        assert "committed" in c_done["message"]
        assert "/aristotle review" in c_done["message"]
        assert "2 rules committed" in c_done["message"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_r_done_creates_reflection_record(self):
        start = _start_reflect_workflow("ses_tgt")
        wf_id = start["workflow_id"]

        wf_before = _load_workflow(wf_id)
        assert wf_before["record_created"] is False

        result = _fire_r_done_event(wf_id, session_id="ses_r_special")

        wf_after = _load_workflow(wf_id)
        assert wf_after["record_created"] is True

        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        assert state_path.exists()
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) >= 1
        assert records[-1]["reflector_session_id"] == "ses_r_special"
        assert records[-1]["target_session_id"] == "ses_tgt"
        assert records[-1]["status"] == "processing"

        assert result["action"] == "fire_sub"
        assert result["sub_role"] == "C"

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_r_done_draft_file_path_uses_parent(self):
        start = _start_reflect_workflow("ses_tgt")
        wf_id = start["workflow_id"]
        sequence = _load_workflow(wf_id)["sequence"]

        result = _fire_r_done_event(wf_id, "ses_r1")

        from aristotle_mcp.config import resolve_repo_dir
        expected_draft = str(resolve_repo_dir().parent / "aristotle-drafts" / f"rec_{sequence}.md")
        assert expected_draft in result["sub_prompt"]

        repo_dir = resolve_repo_dir()
        assert "aristotle-repo" not in expected_draft.split("aristotle-drafts")[0].split("/")[-2:]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 reflect/review APIs not yet implemented")
    def test_c_done_partial_commit_status(self):
        start = _start_reflect_workflow("ses_tgt")
        wf_id = start["workflow_id"]
        _fire_r_done_event(wf_id)

        result = _fire_c_done_event(wf_id, "Committed: 1\nStaged: 2")

        assert result["action"] == "notify"
        assert "1 rules committed" in result["message"]
        assert "2 staged" in result["message"]

        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[-1]["status"] == "partial_commit"
        assert records[-1]["rules_count"] == 3

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"
