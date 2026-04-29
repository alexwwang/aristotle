"""Shared fixtures and conditional imports for orchestration tests."""

from __future__ import annotations

import json

import pytest


@pytest.fixture(autouse=True)
def tmp_repo(tmp_path, monkeypatch):
    """Redirect ARISTOTLE_REPO_DIR to a temp dir for every test."""
    monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path))
    # Clean the shared state file to prevent cross-test sequence leakage
    state_path = tmp_path.parent / "aristotle-state.json"
    if state_path.exists():
        state_path.unlink()
    return tmp_path


try:
    from aristotle_mcp import server as _server
    _has_orchestrate_review_action = hasattr(_server, 'orchestrate_review_action')
    _has_next_sequence = hasattr(_server, '_next_sequence')
    _has_ensure_repo_initialized = hasattr(_server, '_ensure_repo_initialized')
    _has_cleanup_stale_workflows = hasattr(_server, '_cleanup_stale_workflows')
    _NEW_APIS_AVAILABLE = (
        _has_orchestrate_review_action
        and _has_next_sequence
        and _has_ensure_repo_initialized
        and _has_cleanup_stale_workflows
    )
    if _NEW_APIS_AVAILABLE:
        from aristotle_mcp.server import (
            orchestrate_review_action,
            _next_sequence,
            _ensure_repo_initialized,
            _cleanup_stale_workflows,
        )
except (ImportError, AttributeError):
    _NEW_APIS_AVAILABLE = False
