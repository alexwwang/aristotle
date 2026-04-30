"""Tests for aristotle_mcp.server + evolution — Δ decision integration."""

from __future__ import annotations

from pathlib import Path


class TestDeltaDecision:
    def test_get_audit_decision_auto(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()
        w = write_rule(
            content="auto test",
            category="PATTERN_VIOLATION",
            confidence=0.95,
        )
        stage_rule(w["file_path"])
        r = get_audit_decision(w["file_path"])
        assert r["success"]
        assert r["audit_level"] == "auto"
        assert r["delta"] > 0.7

    def test_get_audit_decision_semi(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()
        w = write_rule(
            content="semi test",
            category="INCOMPLETE_ANALYSIS",
            confidence=0.7,
        )
        stage_rule(w["file_path"])
        r = get_audit_decision(w["file_path"])
        assert r["success"]
        assert r["audit_level"] == "semi"

    def test_get_audit_decision_manual(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()
        w = write_rule(
            content="manual test",
            category="HALLUCINATION",
            confidence=0.3,
        )
        stage_rule(w["file_path"])
        r = get_audit_decision(w["file_path"])
        assert r["success"]
        assert r["audit_level"] == "manual"
        assert r["delta"] <= 0.4

    def test_get_audit_decision_file_not_found(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, get_audit_decision

        init_repo_tool()
        r = get_audit_decision("nonexistent.md")
        assert not r["success"]
        assert "not found" in r["message"].lower()

    def test_get_audit_decision_includes_thresholds(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()
        w = write_rule(content="thresholds test", category="TEST", confidence=0.5)
        stage_rule(w["file_path"])
        r = get_audit_decision(w["file_path"])
        assert r["success"]
        assert "thresholds" in r
        assert r["thresholds"]["auto"] == 0.7
        assert r["thresholds"]["semi"] == 0.4

    def test_write_rule_default_confidence(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(content="default confidence", category="TEST")
        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm["confidence"] == 0.7

    def test_write_rule_custom_confidence(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(content="custom confidence", category="TEST", confidence=0.95)
        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm["confidence"] == 0.95

    def test_write_rule_confidence_affects_delta(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()

        w_high = write_rule(content="high conf", category="PATTERN_VIOLATION", confidence=0.95)
        stage_rule(w_high["file_path"])
        r_high = get_audit_decision(w_high["file_path"])
        assert r_high["audit_level"] == "auto"

        w_low = write_rule(content="low conf", category="HALLUCINATION", confidence=0.3)
        stage_rule(w_low["file_path"])
        r_low = get_audit_decision(w_low["file_path"])
        assert r_low["audit_level"] == "manual"

        assert r_high["delta"] > r_low["delta"]
