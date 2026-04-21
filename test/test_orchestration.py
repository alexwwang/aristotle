"""Tests for orchestration tools (coroutine-O MVP): orchestrate_start, orchestrate_on_event, workflow state."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from aristotle_mcp.server import (
    _load_workflow,
    _save_workflow,
    commit_rule,
    init_repo_tool,
    orchestrate_on_event,
    orchestrate_start,
    stage_rule,
    write_rule,
)


@pytest.fixture(autouse=True)
def tmp_repo(tmp_path, monkeypatch):
    """Redirect ARISTOTLE_REPO_DIR to a temp dir for every test."""
    monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path))
    return tmp_path


def _make_verified_rule(category: str = "HALLUCINATION", **kwargs) -> str:
    """Helper: create + stage + commit a rule, return file_path."""
    init_repo_tool()
    w = write_rule(content=f"## Test rule for {category}\n**Rule**: check", category=category, **kwargs)
    assert w["success"], f"write_rule failed: {w['message']}"
    stage_rule(w["file_path"])
    c = commit_rule(w["file_path"])
    assert c["success"], f"commit_rule failed: {c['message']}"
    return w["file_path"]


def _start_learn_workflow(query: str, **extra_args) -> dict:
    """Helper: call orchestrate_start with command=learn."""
    args = {"query": query, **extra_args}
    return orchestrate_start("learn", json.dumps(args))


# ═══════════════════════════════════════════════════════
# TestOrchestrateStart
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
        result = _start_learn_workflow("Fix my API CORS errors")
        wf = _load_workflow(result["workflow_id"])
        assert wf is not None
        assert wf["phase"] == "intent_extraction"
        assert wf["command"] == "learn"
        assert wf["query"] == "Fix my API CORS errors"

    def test_workflow_state_persists(self):
        result = _start_learn_workflow("Debug build failures")
        wf_id = result["workflow_id"]
        _save_workflow(wf_id, {"phase": "search", "command": "learn", "query": "Debug build failures", "extra": "data"})
        loaded = _load_workflow(wf_id)
        assert loaded is not None
        assert loaded["phase"] == "search"
        assert loaded["extra"] == "data"
        assert "updated_at" in loaded

    def test_learn_with_only_domain_falls_through_to_fire_o(self):
        """Only domain provided (no goal) → natural language mode, still fires O."""
        result = _start_learn_workflow("test query", domain="database_operations")
        assert result["action"] == "fire_o"
        assert "o_prompt" in result

    def test_reflect_command_returns_placeholder(self):
        """Reflect command returns not-yet-implemented placeholder."""
        result = orchestrate_start("reflect", json.dumps({}))
        assert result["action"] == "notify"
        assert "MVP" in result["message"] or "not" in result["message"].lower()

    def test_orchestrate_start_latency(self):
        """orchestrate_start completes within 50ms (engineering feasibility)."""
        start_time = time.monotonic()
        for _ in range(10):
            orchestrate_start("learn", json.dumps({"query": "test latency query"}))
        elapsed = (time.monotonic() - start_time) / 10
        assert elapsed < 0.05, f"orchestrate_start took {elapsed*1000:.1f}ms avg (expected <50ms)"


# ═══════════════════════════════════════════════════════
# TestOrchestrateOnEvent
# ═══════════════════════════════════════════════════════
class TestOrchestrateOnEvent:

    def test_o_done_triggers_search(self):
        start = _start_learn_workflow("Fix Prisma connection pool")
        wf_id = start["workflow_id"]
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {
                "intent_tags": {"domain": "database_operations", "task_goal": "connection_pool"},
                "keywords": "prisma|timeout|pool",
            },
        })
        result = orchestrate_on_event("o_done", event_data)
        assert result["action"] == "notify"
        assert result["workflow_id"] == wf_id
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_o_done_with_empty_result(self):
        start = _start_learn_workflow("Something vague")
        wf_id = start["workflow_id"]
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {},
        })
        result = orchestrate_on_event("o_done", event_data)
        assert result["action"] in ("notify", "done")

    def test_unknown_workflow_returns_error(self):
        event_data = json.dumps({"workflow_id": "wf_nonexistent", "result": {}})
        result = orchestrate_on_event("o_done", event_data)
        assert result["action"] == "notify"
        assert "Unknown" in result["message"] or "unknown" in result["message"].lower()

    def test_o_done_updates_intent_in_state(self):
        start = _start_learn_workflow("Fix build errors in webpack")
        wf_id = start["workflow_id"]
        intent = {"domain": "build_system", "task_goal": "webpack_config"}
        keywords = "webpack|build|config"
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {
                "intent_tags": intent,
                "keywords": keywords,
            },
        })
        orchestrate_on_event("o_done", event_data)
        wf = _load_workflow(wf_id)
        assert wf["intent_tags"] == intent
        assert wf["keywords"] == keywords

    def test_invalid_json_returns_error(self):
        result = orchestrate_on_event("o_done", "this is not valid json {{{{")
        assert result["action"] == "notify"
        assert "Invalid" in result["message"] or "invalid" in result["message"].lower()

    def test_o_done_phase_mismatch_rejected(self):
        """o_done event when workflow is NOT in intent_extraction → error notification."""
        result = _start_learn_workflow("test")
        wf_id = result["workflow_id"]
        _save_workflow(wf_id, {"phase": "search", "command": "learn", "query": "test"})
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {"intent_tags": {"domain": "general", "task_goal": "test"}, "keywords": "test"},
        })
        result = orchestrate_on_event("o_done", event_data)
        assert result["action"] == "notify"
        assert "phase" in result["message"].lower() or "unexpected" in result["message"].lower()

    def test_unknown_event_type_returns_done(self):
        """Unknown event_type (not o_done) → action=done (catch-all)."""
        result = _start_learn_workflow("test")
        wf_id = result["workflow_id"]
        event_data = json.dumps({"workflow_id": wf_id})
        result = orchestrate_on_event("subagent_done", event_data)
        assert result["action"] == "done"
        assert result["workflow_id"] == wf_id


# ═══════════════════════════════════════════════════════
# TestWorkflowStateManagement
# ═══════════════════════════════════════════════════════
class TestWorkflowStateManagement:

    def test_workflow_dir_created(self, tmp_repo):
        _start_learn_workflow("test query")
        wf_dir = tmp_repo / ".workflows"
        assert wf_dir.is_dir()

    def test_workflow_file_is_valid_json(self, tmp_repo):
        result = _start_learn_workflow("another query")
        wf_id = result["workflow_id"]
        wf_file = tmp_repo / ".workflows" / f"{wf_id}.json"
        assert wf_file.exists()
        data = json.loads(wf_file.read_text(encoding="utf-8"))
        assert "phase" in data
        assert "updated_at" in data

    def test_workflow_has_updated_at_timestamp(self):
        result = _start_learn_workflow("timestamp test")
        wf_id = result["workflow_id"]
        wf1 = _load_workflow(wf_id)
        ts1 = wf1["updated_at"]
        time.sleep(0.05)

        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {"intent_tags": {"domain": "general", "task_goal": "test"}, "keywords": "test"},
        })
        orchestrate_on_event("o_done", event_data)
        wf2 = _load_workflow(wf_id)
        ts2 = wf2["updated_at"]
        assert ts2 >= ts1

    def test_done_workflow_phase(self):
        start = _start_learn_workflow("Complete flow test")
        wf_id = start["workflow_id"]
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {"intent_tags": {"domain": "general", "task_goal": "test"}, "keywords": "test"},
        })
        orchestrate_on_event("o_done", event_data)
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_load_corrupted_workflow_returns_none(self, tmp_repo):
        """_load_workflow returns None for corrupted JSON file (not crash)."""
        wf_dir = tmp_repo / ".workflows"
        wf_dir.mkdir(parents=True, exist_ok=True)
        corrupt_file = wf_dir / "wf_corrupt.json"
        corrupt_file.write_text("{invalid json content!!!", encoding="utf-8")
        result = _load_workflow("wf_corrupt")
        assert result is None

    def test_load_nonexistent_workflow_returns_none(self):
        """_load_workflow returns None for missing file."""
        result = _load_workflow("wf_does_not_exist")
        assert result is None


# ═══════════════════════════════════════════════════════
# TestIntegrationMockO
# ═══════════════════════════════════════════════════════
class TestIntegrationMockO:

    def test_full_learn_flow_with_rules(self):
        # Setup: create 3 verified rules with known intent
        for i, (dom, goal, cat, skill) in enumerate([
            ("database_operations", "connection_pool", "HALLUCINATION", "prisma"),
            ("api_integration", "cors_setup", "SYNTAX_API_ERROR", "express"),
            ("build_system", "webpack_config", "PATTERN_VIOLATION", "webpack"),
        ]):
            _make_verified_rule(
                category=cat,
                intent_domain=dom,
                intent_task_goal=goal,
                failed_skill=skill,
                error_summary=f"Error with {skill}",
            )

        # Step 1: orchestrate_start with a query that matches the DB rule
        start = _start_learn_workflow("How to fix Prisma connection pool timeouts in serverless?")
        assert start["action"] == "fire_o"
        wf_id = start["workflow_id"]

        # Step 2: simulate O returning intent matching the DB rule
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {
                "intent_tags": {"domain": "database_operations", "task_goal": "connection_pool"},
                "keywords": "prisma|timeout|pool",
            },
        })
        result = orchestrate_on_event("o_done", event_data)

        assert result["action"] == "notify"
        assert result["result_count"] >= 1
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_full_learn_flow_no_results(self):
        # Setup: create rules that won't match
        _make_verified_rule(
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="connection_pool",
        )

        start = _start_learn_workflow("How to deploy to Kubernetes?")
        assert start["action"] == "fire_o"
        wf_id = start["workflow_id"]

        # O returns intent that doesn't match any rules
        event_data = json.dumps({
            "workflow_id": wf_id,
            "result": {
                "intent_tags": {"domain": "deployment", "task_goal": "kubernetes_setup"},
                "keywords": "kubernetes|deploy|cluster",
            },
        })
        result = orchestrate_on_event("o_done", event_data)

        assert result["action"] == "notify"
        assert result["result_count"] == 0

    def test_explicit_params_skip_o(self):
        init_repo_tool()
        result = _start_learn_workflow(
            "Some query",
            domain="database_operations",
            goal="connection_pool",
        )
        assert result["action"] == "notify"
        # No fire_o — direct search path
        assert "o_prompt" not in result or result.get("o_prompt") is None

    def test_workflow_id_unique(self):
        r1 = _start_learn_workflow("Query one")
        r2 = _start_learn_workflow("Query two")
        assert r1["workflow_id"] != r2["workflow_id"]

    def test_concurrent_workflows_independent(self):
        r1 = _start_learn_workflow("First workflow")
        r2 = _start_learn_workflow("Second workflow")
        wf1 = r1["workflow_id"]
        wf2 = r2["workflow_id"]

        # Complete workflow 1
        event_data = json.dumps({
            "workflow_id": wf1,
            "result": {
                "intent_tags": {"domain": "general", "task_goal": "test"},
                "keywords": "first",
            },
        })
        orchestrate_on_event("o_done", event_data)

        # Workflow 2 should still be in intent_extraction
        wf2_state = _load_workflow(wf2)
        assert wf2_state["phase"] == "intent_extraction"

        # Workflow 1 should be done
        wf1_state = _load_workflow(wf1)
        assert wf1_state["phase"] == "done"


# ═══════════════════════════════════════════════════════
# TestSearchParamMapping
# ═══════════════════════════════════════════════════════
class TestSearchParamMapping:
    """Verify O's intent extraction maps correctly to list_rules parameters."""

    def test_intent_tags_passed_to_search(self):
        """Intent tags from O result are used as list_rules filter params."""
        init_repo_tool()
        _make_verified_rule(
            category="SYNTAX_API_ERROR",
            intent_domain="database_operations",
            intent_task_goal="connection_pool_management",
            error_summary="Prisma P2024 timeout",
        )
        start = _start_learn_workflow("Prisma pool timeout")
        wf_id = start["workflow_id"]
        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": {
                "intent_tags": {"domain": "database_operations", "task_goal": "connection_pool_management"},
                "keywords": "prisma|timeout",
            },
        }))
        assert result["action"] == "notify"
        assert result["result_count"] >= 1
        wf = _load_workflow(wf_id)
        assert wf["intent_tags"]["domain"] == "database_operations"

    def test_empty_intent_still_completes(self):
        """Empty intent_tags → search with no filters, still completes."""
        init_repo_tool()
        start = _start_learn_workflow("something")
        wf_id = start["workflow_id"]
        result = orchestrate_on_event("o_done", json.dumps({
            "workflow_id": wf_id,
            "result": {"intent_tags": {}, "keywords": ""},
        }))
        assert result["action"] == "notify"
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"
