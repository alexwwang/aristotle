"""Shared helper functions for orchestration tests.

Imported by test_reflect_workflow.py, test_review_actions.py, test_count_propagation.py.
"""

from __future__ import annotations

import json
from pathlib import Path

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


# ── General helpers ──────────────────────────────────────────────────

def _make_verified_rule(category: str = "HALLUCINATION", **kwargs) -> str:
    """Create + stage + commit a rule, return file_path."""
    init_repo_tool()
    w = write_rule(content=f"## Test rule for {category}\n**Rule**: check", category=category, **kwargs)
    assert w["success"], f"write_rule failed: {w['message']}"
    stage_rule(w["file_path"])
    c = commit_rule(w["file_path"])
    assert c["success"], f"commit_rule failed: {c['message']}"
    return w["file_path"]


def _make_staging_rule(category: str = "HALLUCINATION", **kwargs) -> str:
    """Create + stage a rule (no commit), return file_path."""
    init_repo_tool()
    w = write_rule(content=f"## Test rule for {category}\n**Rule**: check", category=category, **kwargs)
    stage_rule(w["file_path"])
    return w["file_path"]


def _start_learn_workflow(query: str, **extra_args) -> dict:
    """Call orchestrate_start with command=learn."""
    args = {"query": query, **extra_args}
    return orchestrate_start("learn", json.dumps(args))


# ── Reflect workflow helpers ─────────────────────────────────────────

def _start_reflect_workflow(target_session_id="ses_test123", **extra) -> dict:
    args = {"target_session_id": target_session_id, **extra}
    return orchestrate_start("reflect", json.dumps(args))


def _fire_r_done_event(workflow_id: str, session_id: str = "ses_r123", result: str = "DRAFT persisted.") -> dict:
    # When R finishes successfully, it creates a DRAFT file.
    # Simulate this by auto-creating the DRAFT for the workflow's sequence,
    # but only if the result indicates success (contains "DRAFT" or doesn't
    # indicate early termination).
    w = _load_workflow(workflow_id)
    if w and w.get("sequence"):
        no_draft_signals = ["No actionable errors", "No session data", "Session was clean"]
        if not any(sig in result for sig in no_draft_signals):
            _create_draft_file(w["sequence"])

    return orchestrate_on_event("subagent_done", json.dumps({
        "workflow_id": workflow_id,
        "session_id": session_id,
        "result": result,
    }))


def _fire_c_done_event(workflow_id: str, result: str = "Committed: 2, Staged: 0") -> dict:
    return orchestrate_on_event("subagent_done", json.dumps({
        "workflow_id": workflow_id,
        "session_id": "ses_c456",
        "result": result,
    }))


# ── Review workflow helpers ──────────────────────────────────────────

def _setup_reflection_record(sequence: int = 1, status: str = "auto_committed", **extra) -> None:
    from aristotle_mcp.config import resolve_repo_dir
    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)

    if state_path.exists():
        try:
            records = json.loads(state_path.read_text(encoding="utf-8"))
            if not isinstance(records, list):
                records = []
        except (json.JSONDecodeError, ValueError):
            records = []
    else:
        records = []

    target_record = {
        "id": f"rec_{sequence}",
        "status": status,
        "target_label": extra.get("target_label", "current"),
        "target_session_id": extra.get("target_session_id", "ses_test123"),
        "reflector_session_id": extra.get("reflector_session_id", "ses_r456"),
        "rules_count": extra.get("rules_count", 2),
        "launched_at": extra.get("launched_at", "2026-04-22T10:00:00+08:00"),
        "draft_file_path": str(resolve_repo_dir().parent / "aristotle-drafts" / f"rec_{sequence}.md"),
    }
    if "re_reflect_count" in extra:
        target_record["re_reflect_count"] = extra["re_reflect_count"]

    while len(records) < sequence:
        records.append({})

    existing = records[sequence - 1] if isinstance(records[sequence - 1], dict) else {}
    if "re_reflect_count" in existing and "re_reflect_count" not in extra:
        target_record["re_reflect_count"] = existing["re_reflect_count"]

    records[sequence - 1] = target_record
    state_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_draft_file(sequence: int, content: str = "## DRAFT Report\nTest content") -> Path:
    """Create a DRAFT file on disk."""
    from aristotle_mcp.config import resolve_repo_dir
    drafts_dir = resolve_repo_dir().parent / "aristotle-drafts"
    drafts_dir.mkdir(parents=True, exist_ok=True)
    path = drafts_dir / f"rec_{sequence}.md"
    path.write_text(content, encoding="utf-8")
    return path


def _start_review_workflow(sequence: int = 1, **record_extra) -> dict:
    """Setup record + draft + repo, then start review workflow."""
    _setup_reflection_record(sequence, **record_extra)
    _create_draft_file(sequence)
    init_repo_tool()
    return orchestrate_start("review", json.dumps({"sequence": sequence}))
