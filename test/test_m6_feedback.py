"""Tests for M6: Error Feedback loop — signal updates, depth guard, workflow creation."""

from __future__ import annotations

from pathlib import Path

import pytest

# Conditional import — report_feedback does not exist yet in the codebase
try:
    from aristotle_mcp._tools_feedback import report_feedback

    _M6_AVAILABLE = True
except ImportError:
    _M6_AVAILABLE = False

from aristotle_mcp._orch_state import _load_workflow
from aristotle_mcp.server import read_rules

from _orch_helpers import (
    commit_rule,
    init_repo_tool,
    stage_rule,
    write_rule,
)


# ──────────────────────────────────────────────────────────────────────
# TC-M6-01: report_feedback updates feedback signal
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not _M6_AVAILABLE, reason="M6 feedback APIs not yet implemented")
class TestFeedbackSignalUpdate:
    """M6: report_feedback updates sample_size / failure_rate / success_rate."""

    def test_signal_update_on_feedback(self):
        """First feedback: sample_size=0→1, failure_rate=0→1.0."""
        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        rule_id = w.get("rule_id", "")

        result = report_feedback(
            rule_ids=[rule_id],
            error_description="Still getting timeout",
            auto_reflect=False,
        )

        assert result["action"] == "notify"
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 1
        assert fm.get("failure_rate") == 1.0
        assert fm.get("success_rate") == 0.0

    def test_incremental_signal_update(self):
        """Second feedback: sample_size=1→2, failure_rate updated."""
        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        rule_id = w.get("rule_id", "")

        # First feedback
        report_feedback(rule_ids=[rule_id], error_description="err1", auto_reflect=False)
        # Second feedback
        report_feedback(rule_ids=[rule_id], error_description="err2", auto_reflect=False)

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 2
        assert fm.get("failure_rate") == 1.0  # 2/2
        assert fm.get("success_rate") == 0.0

    def test_mixed_rule_ids_updates_only_existing(self):
        """Mixed existing / non-existing rule_ids: only update existing rule signals."""
        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        rule_id = w.get("rule_id", "")

        result = report_feedback(
            rule_ids=[rule_id, "rec_nonexistent_xyz"],
            error_description="error",
            auto_reflect=False,
        )

        assert result["action"] == "notify"
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 1

    # ── TC-M6-02: auto_reflect=False does not create workflow ─────────

    def test_no_reflect_no_workflow(self):
        """auto_reflect=False → only update signal, no workflow created."""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=False,
        )

        assert result["action"] == "notify"
        assert "workflow_id" not in result
        assert result.get("sub_role") is None

    # ── TC-M6-03: auto_reflect=True creates workflow ──────────────────

    def test_auto_reflect_creates_workflow(self):
        """auto_reflect=True → fire_sub + workflow state."""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=True,
            session_id="ses_m6_test",
            project_directory="/tmp/project",
        )

        assert result["action"] == "fire_sub"
        assert result["sub_role"] == "R"
        assert "workflow_id" in result

        # Verify workflow state
        wf = _load_workflow(result["workflow_id"])
        assert wf["phase"] == "reflecting"
        assert wf["source"] == "feedback"
        assert wf["project_directory"] == "/tmp/project"
        assert wf["feedback_rule_ids"] == [w.get("rule_id", "")]


# ──────────────────────────────────────────────────────────────────────
# TC-M6-04: Recursive depth guard
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not _M6_AVAILABLE, reason="M6 feedback APIs not yet implemented")
class TestFeedbackDepthGuard:
    """M6: Recursive depth protection."""

    def test_depth_limit_blocks_reflect(self):
        """feedback_count >= MAX_FEEDBACK_REFLECT → reject reflect."""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        # Manually set feedback_count=3
        from aristotle_mcp.frontmatter import update_frontmatter_field

        update_frontmatter_field(Path(w["file_path"]), "feedback_count", "3")

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=True,
        )

        # Should be rejected (but signal already updated)
        assert result["action"] == "notify"
        assert "max" in result["message"].lower() or "Max" in result["message"]

    def test_signal_updated_even_when_depth_exceeded(self):
        """Signal still updates when depth is exceeded (not discarded)."""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        from aristotle_mcp.frontmatter import update_frontmatter_field

        update_frontmatter_field(Path(w["file_path"]), "feedback_count", "3")

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=True,
        )

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 1  # signal updated

    # ── TC-M6-05: feedback_count increment condition ──────────────────

    def test_feedback_count_only_increments_on_auto_reflect(self):
        """feedback_count only increments when auto_reflect=True."""
        init_repo_tool()

        # True case
        w1 = write_rule(content="## Test1", category="HALLUCINATION")
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        report_feedback(
            rule_ids=[w1.get("rule_id", "")],
            error_description="err",
            auto_reflect=True,
        )

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm1 = read_frontmatter_raw(Path(w1["file_path"]))
        assert fm1.get("feedback_count", 0) == 1

        # False case
        w2 = write_rule(content="## Test2", category="SYNTAX_API_ERROR")
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        report_feedback(
            rule_ids=[w2.get("rule_id", "")],
            error_description="err",
            auto_reflect=False,
        )

        fm2 = read_frontmatter_raw(Path(w2["file_path"]))
        assert fm2.get("feedback_count", 0) == 0  # not incremented

    # ── TC-M6-06: Non-existent rule_ids are rejected ──────────────────

    def test_nonexistent_rule_ids_rejected(self):
        """rule_ids with no matching rules → early return notification."""
        result = report_feedback(
            rule_ids=["rec_nonexistent_xyz"],
            error_description="error",
            auto_reflect=True,
        )

        assert result["action"] == "notify"
        assert (
            "no verified rules" in result["message"].lower()
            or "not found" in result["message"].lower()
        )


# ──────────────────────────────────────────────────────────────────────
# TC-M6-07: RuleMetadata new field serialization
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not _M6_AVAILABLE, reason="M6 feedback APIs not yet implemented")
class TestM6Models:
    """M6: RuleMetadata new field serialization / deserialization."""

    def test_feedback_fields_roundtrip(self):
        """Feedback signal fields write→read roundtrip."""
        init_repo_tool()
        w = write_rule(content="## Roundtrip test", category="HALLUCINATION")
        path = w["file_path"]

        # Manually write feedback fields
        from aristotle_mcp.frontmatter import update_frontmatter_field

        update_frontmatter_field(Path(path), "sample_size", "5")
        update_frontmatter_field(Path(path), "failure_rate", "0.4")
        update_frontmatter_field(Path(path), "success_rate", "0.6")
        update_frontmatter_field(Path(path), "feedback_count", "2")

        # Read and verify
        r = read_rules(status="pending", keyword="Roundtrip", limit=1)
        assert r["count"] >= 1
        meta = r["rules"][0]["metadata"]
        assert meta.get("sample_size") == 5
        assert meta.get("failure_rate") == 0.4
        assert meta.get("feedback_count") == 2

    def test_default_zero_not_written(self):
        """sample_size=0 and feedback_count=0 are not written to frontmatter."""
        init_repo_tool()
        w = write_rule(content="## Zero default test", category="HALLUCINATION")
        path = w["file_path"]

        # Read raw file content
        content = Path(path).read_text(encoding="utf-8")
        assert "sample_size" not in content
        assert "feedback_count" not in content

    def test_type_coercion_in_from_frontmatter(self):
        """from_frontmatter_dict correctly handles string-typed sample_size."""
        from aristotle_mcp.models import from_frontmatter_dict

        meta = from_frontmatter_dict({
            "id": "rec_test",
            "sample_size": "5",       # string, not int
            "feedback_count": "2",     # string, not int
        })
        assert isinstance(meta.sample_size, int)
        assert meta.sample_size == 5
        assert isinstance(meta.feedback_count, int)
        assert meta.feedback_count == 2

    def test_non_numeric_sample_size_handled(self):
        """report_feedback gracefully handles non-numeric sample_size."""
        init_repo_tool()
        w = write_rule(content="## Non-numeric test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        path = w["file_path"]

        # Write non-numeric sample_size
        from aristotle_mcp.frontmatter import update_frontmatter_field

        update_frontmatter_field(Path(path), "sample_size", "abc")

        # report_feedback should handle gracefully
        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=False,
        )
        assert result["action"] == "notify"
