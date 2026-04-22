"""Tests for orchestration tools (coroutine-O MVP): learn workflow, sessions, helpers.

Reflect/review/count tests live in separate modules:
  - test_reflect_workflow.py   (TC-1-01~07)
  - test_review_actions.py     (TC-2-01~12)
  - test_count_propagation.py  (TC-3-01~04)
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from _orch_helpers import (
    _make_verified_rule,
    _start_learn_workflow,
    _load_workflow,
    _save_workflow,
    init_repo_tool,
    write_rule,
    stage_rule,
    commit_rule,
    orchestrate_start,
    orchestrate_on_event,
)
from conftest import _NEW_APIS_AVAILABLE

if _NEW_APIS_AVAILABLE:
    from conftest import _next_sequence, _ensure_repo_initialized, _cleanup_stale_workflows


# ═══════════════════════════════════════════════════════
# TestOrchestrateStart (learn workflow)
# ═══════════════════════════════════════════════════════
class TestOrchestrateStart:

    def test_learn_with_query_returns_fire_o(self):
        result = _start_learn_workflow("How to fix Prisma connection pool timeouts?")
        assert result["action"] == "fire_o"
        assert "o_prompt" in result
        assert "workflow_id" in result
        assert result["workflow_id"].startswith("wf_")
        assert "Prisma" in result["o_prompt"]
        assert "connection pool" in result["o_prompt"]

    def test_learn_with_explicit_params_skips_o(self):
        result = _start_learn_workflow(
            "Prisma pool",
            domain="database_operations",
            goal="connection_pool_management",
        )
        assert result["action"] == "notify"
        assert "workflow_id" in result

    def test_learn_empty_query_returns_notify(self):
        result = _start_learn_workflow("")
        assert result["action"] == "notify"
        assert "workflow_id" in result
        assert "query" in result["message"].lower() or "Need" in result["message"]

    def test_unknown_command_returns_notify(self):
        result = orchestrate_start("foobar", json.dumps({}))
        assert result["action"] == "notify"
        assert "Unknown" in result["message"] or "unknown" in result["message"].lower()

    def test_workflow_state_created(self):
        result = _start_learn_workflow("test query")
        assert "workflow_id" in result
        wf = _load_workflow(result["workflow_id"])
        assert wf is not None
        assert wf["phase"] == "intent_extraction"
        assert wf["command"] == "learn"

    def test_workflow_state_persists(self):
        result = _start_learn_workflow("test query")
        wf_id = result["workflow_id"]

        loaded = _load_workflow(wf_id)
        assert loaded["phase"] == "intent_extraction"

        _save_workflow(wf_id, {**loaded, "phase": "done"})
        reloaded = _load_workflow(wf_id)
        assert reloaded["phase"] == "done"

    def test_learn_with_only_domain_falls_through_to_fire_o(self):
        result = _start_learn_workflow("test", domain="database_operations")
        assert result["action"] == "fire_o"

    def test_reflect_command_returns_placeholder(self):
        result = orchestrate_start("reflect", json.dumps({"target_session_id": "ses_test"}))
        assert "workflow_id" in result
        assert result.get("action") in ("fire_sub", "notify")

    def test_invalid_args_json_returns_error(self):
        result = orchestrate_start("learn", "not valid json {{{")
        assert result["action"] == "notify"
        assert "Invalid" in result["message"] or "invalid" in result["message"].lower()

    def test_learn_domain_and_goal_with_empty_query(self):
        result = _start_learn_workflow("", domain="db", goal="pool")
        assert result["action"] == "notify"
        assert "workflow_id" in result

    def test_orchestrate_start_latency(self):
        start = time.time()
        for _ in range(10):
            _start_learn_workflow("latency test")
        elapsed = time.time() - start
        assert elapsed < 2.0, f"10 iterations took {elapsed:.2f}s"


# ═══════════════════════════════════════════════════════
# TestOrchestrateOnEvent (learn o_done flow)
# ═══════════════════════════════════════════════════════
class TestOrchestrateOnEvent:

    def test_o_done_triggers_search(self):
        start = _start_learn_workflow("How to fix Prisma connection pool timeouts?")
        wf_id = start["workflow_id"]

        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({
                "domain": "database_operations",
                "task_goal": "connection_pool_management",
            }),
        }))

        assert result["action"] == "notify"
        assert "workflow_id" in result

    def test_o_done_with_empty_result(self):
        start = _start_learn_workflow("test query")
        wf_id = start["workflow_id"]

        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({}),
        }))

        assert result["action"] == "notify"

    def test_unknown_workflow_returns_error(self):
        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": "wf_nonexistent",
            "result": "{}",
        }))
        assert result["action"] == "notify"
        assert result["action"] == "notify"

    def test_o_done_updates_intent_in_state(self):
        start = _start_learn_workflow("Prisma pool timeout")
        wf_id = start["workflow_id"]

        orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({"domain": "db", "task_goal": "pool"}),
        }))

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_invalid_json_returns_error(self):
        result = orchestrate_on_event("o_done", "not json")
        assert result["action"] == "notify"

    def test_o_done_phase_mismatch_rejected(self):
        start = _start_learn_workflow("test query")
        wf_id = start["workflow_id"]

        wf = _load_workflow(wf_id)
        _save_workflow(wf_id, {**wf, "phase": "done"})

        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({"domain": "db"}),
        }))

        assert result["action"] == "notify"

    def test_o_done_with_string_result(self):
        start = _start_learn_workflow("test query")
        wf_id = start["workflow_id"]

        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": "This is a plain string result, not JSON",
        }))

        assert result["action"] == "notify"

    def test_o_done_missing_workflow_id(self):
        result = orchestrate_on_event("o_done", json.dumps({
            "result": json.dumps({"domain": "db"}),
        }))
        assert result["action"] == "notify"

    def test_unknown_event_type_returns_notify(self):
        result = orchestrate_on_event("unknown_event", json.dumps({"workflow_id": "wf_123"}))
        assert result["action"] == "notify"


# ═══════════════════════════════════════════════════════
# TestWorkflowStateManagement
# ═══════════════════════════════════════════════════════
class TestWorkflowStateManagement:

    def test_workflow_dir_created(self, tmp_repo):
        wf_dir = tmp_repo / ".workflows"
        assert not wf_dir.exists()
        _start_learn_workflow("test query")
        assert wf_dir.exists()

    def test_workflow_file_is_valid_json(self, tmp_repo):
        result = _start_learn_workflow("test query")
        wf_path = tmp_repo / ".workflows" / f"{result['workflow_id']}.json"
        assert wf_path.exists()
        data = json.loads(wf_path.read_text(encoding="utf-8"))
        assert "phase" in data
        assert "command" in data

    def test_workflow_has_updated_at_timestamp(self):
        result = _start_learn_workflow("test query")
        wf = _load_workflow(result["workflow_id"])
        assert "updated_at" in wf

    def test_done_workflow_phase(self):
        result = _start_learn_workflow("test query")
        wf_id = result["workflow_id"]
        wf = _load_workflow(wf_id)
        _save_workflow(wf_id, {**wf, "phase": "done"})
        loaded = _load_workflow(wf_id)
        assert loaded["phase"] == "done"

    def test_load_corrupted_workflow_returns_none(self, tmp_repo):
        wf_dir = tmp_repo / ".workflows"
        wf_dir.mkdir(parents=True)
        wf_file = wf_dir / "wf_corrupt.json"
        wf_file.write_text("NOT VALID JSON {{{", encoding="utf-8")
        assert _load_workflow("wf_corrupt") is None

    def test_load_nonexistent_workflow_returns_none(self):
        assert _load_workflow("wf_definitely_not_exists") is None


# ═══════════════════════════════════════════════════════
# TestIntegrationMockO
# ═══════════════════════════════════════════════════════
class TestIntegrationMockO:

    def test_full_learn_flow_with_rules(self):
        _make_verified_rule("HALLUCINATION", scope="user")
        _make_verified_rule("PATTERN_VIOLATION", scope="user")

        start = _start_learn_workflow("How to fix Prisma connection pool timeouts?")
        wf_id = start["workflow_id"]

        o_result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({
                "domain": "database_operations",
                "task_goal": "connection_pool_management",
            }),
        }))

        assert o_result["action"] == "notify"
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_full_learn_flow_no_results(self):
        start = _start_learn_workflow("obscure topic with no matching rules")
        wf_id = start["workflow_id"]

        o_result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({
                "domain": "unknown",
                "task_goal": "unknown",
            }),
        }))

        assert o_result["action"] == "notify"
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_explicit_params_skip_o(self):
        result = _start_learn_workflow(
            "test query",
            domain="database_operations",
            goal="connection_pool_management",
        )
        assert result["action"] == "notify"
        wf = _load_workflow(result["workflow_id"])
        assert wf["phase"] == "done"

    def test_workflow_id_unique(self):
        ids = set()
        for _ in range(10):
            result = _start_learn_workflow("test query")
            assert result["workflow_id"] not in ids
            ids.add(result["workflow_id"])

    def test_concurrent_workflows_independent(self):
        r1 = _start_learn_workflow("query 1")
        r2 = _start_learn_workflow("query 2")
        wf1_id, wf2_id = r1["workflow_id"], r2["workflow_id"]

        wf1 = _load_workflow(wf1_id)
        wf2 = _load_workflow(wf2_id)
        assert wf1["command"] == "learn"
        assert wf2["command"] == "learn"
        assert wf1_id != wf2_id


# ═══════════════════════════════════════════════════════
# TestSearchParamMapping
# ═══════════════════════════════════════════════════════
class TestSearchParamMapping:

    def test_intent_tags_passed_to_search(self):
        result = _start_learn_workflow("How to fix Prisma connection pool timeouts?")
        wf_id = result["workflow_id"]

        orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({
                "domain": "database_operations",
                "task_goal": "connection_pool_management",
                "failed_skill": "prisma_client",
            }),
        }))

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_empty_intent_still_completes(self):
        result = _start_learn_workflow("test query")
        wf_id = result["workflow_id"]

        orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": json.dumps({}),
        }))

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"


# ═══════════════════════════════════════════════════════
# TestOrchestrateStartSessions
# ═══════════════════════════════════════════════════════
class TestOrchestrateStartSessions:

    def _setup_reflection_record_with_status(self, status: str = "auto_committed", sequence: int = 1):
        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = [{
            "id": f"rec_{sequence}",
            "status": status,
            "target_label": "current",
            "target_session_id": "ses_test123",
            "reflector_session_id": "ses_r456",
            "rules_count": 2,
            "launched_at": "2026-04-22T10:00:00+08:00",
            "draft_file_path": str(resolve_repo_dir().parent / "aristotle-drafts" / f"rec_{sequence}.md"),
        }]
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(records), encoding="utf-8")

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_sessions_basic(self):
        self._setup_reflection_record_with_status("auto_committed", 1)
        result = orchestrate_start("sessions", "{}")
        assert result["action"] == "notify"
        assert "#1" in result["message"]
        assert "✅" in result["message"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_sessions_empty_state(self):
        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        if state_path.exists():
            state_path.unlink()
        result = orchestrate_start("sessions", "{}")
        assert result["action"] == "notify"
        assert "No reflection records yet" in result["message"]

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_sessions_no_workflow_created(self, tmp_repo):
        self._setup_reflection_record_with_status("auto_committed", 1)
        result = orchestrate_start("sessions", "{}")
        assert "workflow_id" not in result
        wf_dir = tmp_repo / ".workflows"
        assert not wf_dir.exists()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    @pytest.mark.parametrize("status,icon", [
        ("auto_committed", "✅"),
        ("partial_commit", "📋"),
        ("processing", "⏳"),
        ("checker_failed", "❌"),
        ("rejected", "❌"),
    ])
    def test_sessions_format_status_icons(self, status, icon):
        self._setup_reflection_record_with_status(status, 1)
        result = orchestrate_start("sessions", "{}")
        assert icon in result["message"]


# ═══════════════════════════════════════════════════════
# TestHelperFunctions
# ═══════════════════════════════════════════════════════
class TestHelperFunctions:

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_next_sequence_increments(self):
        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps([]), encoding="utf-8")

        assert _next_sequence() == 1
        state_path.write_text(json.dumps([{"id": "rec_1"}]), encoding="utf-8")
        assert _next_sequence() == 2
        state_path.write_text(json.dumps([{"id": "rec_1"}, {"id": "rec_2"}]), encoding="utf-8")
        assert _next_sequence() == 3

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_next_sequence_first(self):
        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps([]), encoding="utf-8")
        assert _next_sequence() == 1

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_ensure_repo_initialized(self, tmp_repo):
        git_dir = tmp_repo / ".git"
        if git_dir.exists():
            import shutil
            shutil.rmtree(git_dir)
        assert not git_dir.exists()

        _ensure_repo_initialized()
        assert git_dir.exists()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_ensure_repo_already_initialized(self, tmp_repo):
        git_dir = tmp_repo / ".git"
        assert git_dir.exists()
        _ensure_repo_initialized()
        assert git_dir.exists()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    def test_cleanup_stale_workflows_done(self, tmp_repo):
        from datetime import datetime, timezone, timedelta
        wf_dir = tmp_repo / ".workflows"
        wf_dir.mkdir(parents=True)
        old_time = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        wf_file = wf_dir / "wf_old123.json"
        wf_file.write_text(json.dumps({"phase": "done", "updated_at": old_time}), encoding="utf-8")

        _cleanup_stale_workflows(max_age_hours=24)
        assert not wf_file.exists()

    @pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="New APIs not yet implemented")
    @pytest.mark.parametrize("phase", ["reflecting", "checking", "review", "intent_extraction", "search", "init"])
    def test_cleanup_stale_workflows_stuck(self, tmp_repo, phase):
        from datetime import datetime, timezone, timedelta
        wf_dir = tmp_repo / ".workflows"
        wf_dir.mkdir(parents=True)
        old_time = (datetime.now(timezone.utc) - timedelta(hours=49)).isoformat()
        wf_file = wf_dir / f"wf_stuck_{phase}.json"
        wf_file.write_text(json.dumps({"phase": phase, "updated_at": old_time}), encoding="utf-8")

        _cleanup_stale_workflows(max_age_hours=24)
        assert not wf_file.exists()
