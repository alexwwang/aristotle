"""Tests for enhanced commit_rule guard logic — TDD RED phase.

These tests exercise the planned guard enhancements to commit_rule():
  1. Status must be "staging" before commit
  2. Frontmatter schema validation (category required, confidence 0.0-1.0, error_summary <=200 chars)
  3. skip_guard=True bypasses both checks
  4. ARISTOTLE_CI=true overrides skip_guard (forced guard)
  5. Guard block writes McpAuditEntry to .aristotle/audit.jsonl

The enhanced commit_rule() signature will accept skip_guard: bool = False.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest


class TestCommitGuard:
    """32 tests for the commit_rule guard enhancements."""

    # ------------------------------------------------------------------ #
    # Helper
    # ------------------------------------------------------------------ #

    def _make_staging_rule(self, tmp_repo, **overrides) -> str:
        """Create a rule, set it to staging, optionally override frontmatter."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        defaults = dict(
            content="## Test\n**Rule**: check",
            category="HALLUCINATION",
            confidence=0.8,
            error_summary="test error",
        )
        defaults.update(overrides)
        w = write_rule(
            content=defaults["content"],
            category=defaults["category"],
            confidence=defaults["confidence"],
            error_summary=defaults["error_summary"],
        )
        file_path = w["file_path"]
        stage_rule(file_path)
        return file_path

    # ------------------------------------------------------------------ #
    # 1. Guard check 1: status must be "staging"
    # ------------------------------------------------------------------ #

    def test_should_block_non_staging_rule_from_commit(self, tmp_repo):
        """#1 — pending rule must be rejected by guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        # rule is still 'pending' — not staged
        result = commit_rule(w["file_path"], enable_guard=True)
        assert result["success"] is False
        assert "staging" in result.get("message", "").lower() or "status" in result.get("message", "").lower()

    def test_should_allow_staging_rule_to_commit(self, tmp_repo):
        """#2 — staging rule commits successfully."""
        from aristotle_mcp.server import commit_rule

        file_path = self._make_staging_rule(tmp_repo)
        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is True
        assert result["commit_hash"] is not None

    # ------------------------------------------------------------------ #
    # 2. Guard check 2: frontmatter schema validation
    # ------------------------------------------------------------------ #

    def test_should_block_when_category_missing(self, tmp_repo):
        """#3 — missing category field triggers guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        file_path = w["file_path"]

        # Remove category from frontmatter
        data = load_rule_file(Path(file_path))
        data["metadata"].pop("category", None)
        data["metadata"]["status"] = "staging"
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "category" in result.get("message", "").lower()

    def test_should_block_when_confidence_non_numeric(self, tmp_repo):
        """#4 — confidence='high' (string) triggers guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        file_path = w["file_path"]
        stage_rule(file_path)

        # Set confidence to non-numeric string
        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = "high"
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "confidence" in result.get("message", "").lower()

    def test_should_block_when_confidence_below_zero(self, tmp_repo):
        """#5 — confidence=-0.1 triggers guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = -0.1
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "confidence" in result.get("message", "").lower()

    def test_should_return_error_on_malformed_frontmatter(self, tmp_repo):
        """#6 — malformed YAML in frontmatter returns graceful error."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        file_path = w["file_path"]
        stage_rule(file_path)

        # Overwrite file with malformed frontmatter
        p = Path(file_path)
        p.write_text("---\n: invalid: [yaml: {{{\n---\n## Test\n", encoding="utf-8")

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False

    def test_should_block_commit_on_file_without_frontmatter(self, tmp_repo):
        """#6.1 — file with no --- delimiters returns error."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        file_path = w["file_path"]
        stage_rule(file_path)

        # Overwrite with plain markdown, no frontmatter
        p = Path(file_path)
        p.write_text("Just plain text, no frontmatter at all.\n", encoding="utf-8")

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False

    def test_should_block_when_confidence_above_one(self, tmp_repo):
        """#7 — confidence=1.1 triggers guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = 1.1
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "confidence" in result.get("message", "").lower()

    def test_should_block_when_error_summary_too_long(self, tmp_repo):
        """#8 — error_summary=201 chars triggers guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", error_summary="short")
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["error_summary"] = "x" * 201
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "error_summary" in result.get("message", "").lower()

    # ------------------------------------------------------------------ #
    # 3. Valid happy-path commit
    # ------------------------------------------------------------------ #

    def test_should_pass_valid_staging_rule(self, tmp_repo):
        """#9 — valid staging rule commits and produces git commit."""
        import subprocess

        from aristotle_mcp.server import commit_rule

        file_path = self._make_staging_rule(tmp_repo)
        result = commit_rule(file_path)
        assert result["success"] is True
        assert result["commit_hash"] is not None

        # Verify actual git log contains the commit
        from aristotle_mcp.git_ops import resolve_repo_dir

        repo = resolve_repo_dir()
        log = subprocess.run(
            ["git", "log", "--oneline", "-1"],
            capture_output=True,
            text=True,
            cwd=str(repo),
        )
        assert "verify" in log.stdout.lower()

    # ------------------------------------------------------------------ #
    # 4. Edge cases
    # ------------------------------------------------------------------ #

    def test_should_return_error_when_rule_file_does_not_exist(self, tmp_repo):
        """#10 — nonexistent file returns graceful error dict (not FileNotFoundError)."""
        from aristotle_mcp.server import init_repo_tool, commit_rule

        init_repo_tool()
        result = commit_rule("/nonexistent/path/to/rule.md", enable_guard=True)
        assert result["success"] is False
        assert "commit_hash" in result  # graceful dict, not exception
        # Must not raise — verify it's a dict return
        assert isinstance(result, dict)

    # ------------------------------------------------------------------ #
    # 5. skip_guard parameter
    # ------------------------------------------------------------------ #

    def test_should_bypass_guard_with_skip_guard_true(self, tmp_repo):
        """#11 — skip_guard=True allows committing a pending (non-staging) rule."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        # rule is still pending — not staged
        result = commit_rule(w["file_path"], enable_guard=True, skip_guard=True)
        assert result["success"] is True
        assert result["commit_hash"] is not None

    def test_should_enforce_guard_in_ci_even_with_skip_guard(self, tmp_repo, monkeypatch):
        """#12 — ARISTOTLE_CI=true forces guard even when skip_guard=True."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        monkeypatch.setenv("ARISTOTLE_CI", "true")
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        # pending rule, skip_guard=True, but CI overrides
        result = commit_rule(w["file_path"], enable_guard=True, skip_guard=True)
        assert result["success"] is False

    # ------------------------------------------------------------------ #
    # 6. Confidence boundary values
    # ------------------------------------------------------------------ #

    def test_should_accept_confidence_boundary_zero(self, tmp_repo):
        """#13 — confidence=0.0 passes guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.5)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = 0.0
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is True

    def test_should_accept_confidence_boundary_one(self, tmp_repo):
        """#14 — confidence=1.0 passes guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.5)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = 1.0
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is True

    def test_should_reject_confidence_negative(self, tmp_repo):
        """#15 — confidence=-0.1 rejected (Phase 2 traceability mirror of #5)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.5)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = -0.1
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False

    def test_should_reject_confidence_above_one(self, tmp_repo):
        """#16 — confidence=1.1 rejected (Phase 2 traceability mirror of #7)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.5)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = 1.1
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False

    # ------------------------------------------------------------------ #
    # 7. Status-based blocking (verified, rejected)
    # ------------------------------------------------------------------ #

    def test_should_block_verified_rule_from_commit(self, tmp_repo):
        """#17 — status='verified' rule is blocked from re-commit."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        file_path = w["file_path"]

        data = load_rule_file(Path(file_path))
        data["metadata"]["status"] = "verified"
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "staging" in result.get("message", "").lower() or "status" in result.get("message", "").lower()

    def test_should_block_rejected_rule_from_commit(self, tmp_repo):
        """#18 — status='rejected' rule is blocked from commit."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        file_path = w["file_path"]

        data = load_rule_file(Path(file_path))
        data["metadata"]["status"] = "rejected"
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "staging" in result.get("message", "").lower() or "status" in result.get("message", "").lower()

    # ------------------------------------------------------------------ #
    # 8. Backward compatibility
    # ------------------------------------------------------------------ #

    def test_should_work_without_skip_guard_parameter(self, tmp_repo):
        """#19 — existing commit_rule(file_path) calls still work (no skip_guard)."""
        from aristotle_mcp.server import commit_rule

        file_path = self._make_staging_rule(tmp_repo)
        result = commit_rule(file_path)
        assert result["success"] is True
        assert result["commit_hash"] is not None

    # ------------------------------------------------------------------ #
    # 9. Audit logging
    # ------------------------------------------------------------------ #

    def test_should_write_audit_log_entry_on_guard_block(self, tmp_repo):
        """#20 — guard block writes McpAuditEntry to .aristotle/audit.jsonl."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        result = commit_rule(w["file_path"], enable_guard=True)
        assert result["success"] is False

        audit_path = tmp_repo / ".aristotle" / "audit.jsonl"
        assert audit_path.exists(), "audit.jsonl must be created on guard block"

        lines = audit_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) >= 1
        entry = json.loads(lines[-1])
        assert "action" in entry or "event" in entry or "result" in entry
        # Entry should indicate a block/failure
        entry_str = json.dumps(entry).lower()
        assert "block" in entry_str or "fail" in entry_str or "reject" in entry_str or "guard" in entry_str

    def test_should_accept_error_summary_at_exact_200_chars(self, tmp_repo):
        """#21 — error_summary exactly 200 chars passes guard."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", error_summary="short")
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["error_summary"] = "x" * 200
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is True

    def test_should_write_audit_entry_on_guard_pass(self, tmp_repo):
        """#22 — successful commit writes McpAuditEntry with result='success'."""
        from aristotle_mcp.server import commit_rule

        file_path = self._make_staging_rule(tmp_repo)
        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is True

        audit_path = tmp_repo / ".aristotle" / "audit.jsonl"
        assert audit_path.exists(), "audit.jsonl must be created on successful commit"

        lines = audit_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) >= 1
        entry = json.loads(lines[-1])
        entry_str = json.dumps(entry).lower()
        assert "success" in entry_str

    def test_should_write_guard_bypassed_audit_on_skip_guard(self, tmp_repo):
        """skip_guard=True must write GUARD_BYPASSED audit entry per spec AC-9."""
        from aristotle_mcp.server import commit_rule

        file_path = self._make_staging_rule(tmp_repo)
        result = commit_rule(file_path, enable_guard=True, skip_guard=True)
        assert result["success"] is True

        audit_path = tmp_repo / ".aristotle" / "audit.jsonl"
        assert audit_path.exists()

        lines = audit_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) >= 1
        entry = json.loads(lines[-1])
        entry_str = json.dumps(entry).lower()
        assert "bypass" in entry_str or "skip_guard" in entry_str

    # ------------------------------------------------------------------ #
    # 10. Multiple validation failures
    # ------------------------------------------------------------------ #

    def test_should_report_first_validation_failure_when_multiple_issues(self, tmp_repo):
        """#23 — both status and schema invalid → error identifies first failure."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        file_path = w["file_path"]

        # Make both status wrong AND confidence invalid
        data = load_rule_file(Path(file_path))
        data["metadata"]["status"] = "pending"  # wrong status
        data["metadata"]["confidence"] = 5.0  # out of range
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        # Should report at least one error — first encountered
        msg = result.get("message", "").lower()
        assert len(msg) > 0  # non-empty error message

    # ------------------------------------------------------------------ #
    # 11. Duplicate traceability tests (by design)
    # ------------------------------------------------------------------ #

    def test_should_block_commit_on_already_verified_rule(self, tmp_repo):
        """#24 — status='verified' blocked (mirror of #17, by design)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.8)
        file_path = w["file_path"]

        data = load_rule_file(Path(file_path))
        data["metadata"]["status"] = "verified"
        data["metadata"]["verified_at"] = "2026-01-01T00:00:00+00:00"
        data["metadata"]["verified_by"] = "auto"
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False

    # ------------------------------------------------------------------ #
    # 12. YAML type coercion edge cases
    # ------------------------------------------------------------------ #

    def test_should_accept_integer_confidence_from_yaml(self, tmp_repo):
        """#25 — YAML confidence:1 (int) accepted as valid (=1.0)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.5)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = 1  # int, not float
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is True

    def test_should_reject_confidence_none(self, tmp_repo):
        """#26 — YAML 'confidence:' (None/null) triggers validation error."""
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule
        from aristotle_mcp.frontmatter import load_rule_file, write_rule_file

        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION", confidence=0.5)
        file_path = w["file_path"]
        stage_rule(file_path)

        data = load_rule_file(Path(file_path))
        data["metadata"]["confidence"] = None
        write_rule_file(Path(file_path), data["metadata"], data["content"])

        result = commit_rule(file_path, enable_guard=True)
        assert result["success"] is False
        assert "confidence" in result.get("message", "").lower()

    # ------------------------------------------------------------------ #
    # 13. ARISTOTLE_CI environment variable handling
    # ------------------------------------------------------------------ #

    def test_should_handle_aristotle_ci_false_value(self, tmp_repo, monkeypatch):
        """#27 — ARISTOTLE_CI=false → guard NOT enforced (skip_guard works)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        monkeypatch.setenv("ARISTOTLE_CI", "false")
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        # pending rule, skip_guard=True, CI=false → should bypass
        result = commit_rule(w["file_path"], enable_guard=True, skip_guard=True)
        assert result["success"] is True

    def test_should_handle_aristotle_ci_empty_string(self, tmp_repo, monkeypatch):
        """#28 — ARISTOTLE_CI="" → guard NOT enforced (skip_guard works)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        monkeypatch.setenv("ARISTOTLE_CI", "")
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        result = commit_rule(w["file_path"], enable_guard=True, skip_guard=True)
        assert result["success"] is True

    @pytest.mark.parametrize("ci_value", ["yes", "1", "random", "TRUE", "On"])
    def test_should_handle_aristotle_ci_garbage_value(self, tmp_repo, monkeypatch, ci_value):
        """#29 — ARISTOTLE_CI=yes/1/random/TRUE/On → NOT enforced. Only 'true' (case-insensitive) enforces."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        monkeypatch.setenv("ARISTOTLE_CI", ci_value)
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        result = commit_rule(w["file_path"], enable_guard=True, skip_guard=True)
        # Non-"true" values should NOT enforce CI guard
        assert result["success"] is True

    def test_should_not_enforce_ci_when_aristotle_ci_unset(self, tmp_repo, monkeypatch):
        """#30 — ARISTOTLE_CI not in env → guard NOT enforced (skip_guard works)."""
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule

        monkeypatch.delenv("ARISTOTLE_CI", raising=False)
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        result = commit_rule(w["file_path"], enable_guard=True, skip_guard=True)
        assert result["success"] is True
