"""Tests for aristotle_mcp.config — path resolution, constants, env override."""

from __future__ import annotations

from pathlib import Path

import pytest


class TestConfig:
    def test_resolve_repo_dir_env_override(self, tmp_repo):
        from aristotle_mcp.config import resolve_repo_dir

        assert resolve_repo_dir() == tmp_repo

    def test_resolve_repo_dir_default(self, monkeypatch):
        monkeypatch.delenv("ARISTOTLE_REPO_DIR", raising=False)
        from aristotle_mcp.config import resolve_repo_dir, DEFAULT_REPO_DIR

        assert resolve_repo_dir() == DEFAULT_REPO_DIR

    def test_resolve_state_file(self):
        from aristotle_mcp.config import resolve_state_file

        p = resolve_state_file()
        assert p.name == "aristotle-state.json"
        assert "opencode" in str(p)

    def test_resolve_learnings_user(self):
        from aristotle_mcp.config import resolve_learnings_file

        p = resolve_learnings_file("user")
        assert p.name == "aristotle-learnings.md"

    def test_resolve_learnings_project_requires_path(self):
        from aristotle_mcp.config import resolve_learnings_file

        with pytest.raises(ValueError, match="project_path required"):
            resolve_learnings_file("project")

    def test_resolve_learnings_project(self):
        from aristotle_mcp.config import resolve_learnings_file

        p = resolve_learnings_file("project", "/tmp/myproject")
        assert p == Path("/tmp/myproject/.opencode/aristotle-project-learnings.md")

    def test_project_hash_deterministic(self):
        from aristotle_mcp.config import project_hash

        h1 = project_hash("/foo/bar")
        h2 = project_hash("/foo/bar")
        assert h1 == h2
        assert len(h1) == 8

    def test_project_hash_different_paths(self):
        from aristotle_mcp.config import project_hash

        assert project_hash("/a") != project_hash("/b")

    def test_risk_map_coverage(self):
        from aristotle_mcp.config import RISK_MAP

        assert RISK_MAP["HALLUCINATION"] == "high"
        assert RISK_MAP["PATTERN_VIOLATION"] == "low"
        assert len(RISK_MAP) == 8

    def test_valid_statuses(self):
        from aristotle_mcp.config import VALID_STATUSES

        assert set(VALID_STATUSES) == {"pending", "staging", "verified", "rejected"}

    def test_risk_weights(self):
        from aristotle_mcp.config import RISK_WEIGHTS

        assert RISK_WEIGHTS == {"high": 0.8, "medium": 0.5, "low": 0.2}

    def test_audit_thresholds(self):
        from aristotle_mcp.config import AUDIT_THRESHOLDS

        assert AUDIT_THRESHOLDS["auto"] == 0.7
        assert AUDIT_THRESHOLDS["semi"] == 0.4
        assert AUDIT_THRESHOLDS["auto"] > AUDIT_THRESHOLDS["semi"]
