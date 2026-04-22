"""Tests for aristotle_mcp.frontmatter — atomic writes, streaming search, multi-dimension filters."""

from __future__ import annotations


class TestFrontmatter:
    def test_write_and_load(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, load_rule_file

        target = tmp_path / "rule.md"
        meta = {"id": "t1", "status": "pending", "category": "TEST"}
        body = "## Test Rule\n**Context**: test"
        w = write_rule_file(target, meta, body)
        assert w["success"]
        assert target.exists()

        data = load_rule_file(target)
        assert data["metadata"]["id"] == "t1"
        assert data["metadata"]["status"] == "pending"
        assert "Test Rule" in data["content"]

    def test_write_atomic_no_residual_tmp(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file

        target = tmp_path / "clean.md"
        write_rule_file(target, {"id": "c1"}, "body")
        tmps = list(tmp_path.glob("*.tmp"))
        assert len(tmps) == 0

    def test_read_frontmatter_raw(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, read_frontmatter_raw

        target = tmp_path / "fm.md"
        write_rule_file(
            target, {"id": "r1", "status": "verified", "confidence": 0.9}, "body"
        )
        fm = read_frontmatter_raw(target)
        assert fm is not None
        assert fm["id"] == "r1"
        assert fm["status"] == "verified"
        assert fm["confidence"] == 0.9

    def test_read_frontmatter_raw_no_fm(self, tmp_path):
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        plain = tmp_path / "plain.md"
        plain.write_text("Just markdown, no frontmatter.")
        assert read_frontmatter_raw(plain) is None

    def test_update_frontmatter_field(self, tmp_path):
        from aristotle_mcp.frontmatter import (
            write_rule_file,
            update_frontmatter_field,
            read_frontmatter_raw,
        )

        target = tmp_path / "upd.md"
        write_rule_file(target, {"id": "u1", "status": "pending"}, "body")
        r = update_frontmatter_field(target, "status", "staging")
        assert r["success"]
        fm = read_frontmatter_raw(target)
        assert fm["status"] == "staging"

    def test_stream_filter_by_status(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        for i, status in enumerate(["pending", "verified", "pending"]):
            write_rule_file(
                tmp_path / f"r{i}.md",
                {"id": f"s{i}", "status": status, "category": "TEST"},
                "body",
            )
        pending = stream_filter_rules(tmp_path, status_filter="pending")
        assert len(pending) == 2
        verified = stream_filter_rules(tmp_path, status_filter="verified")
        assert len(verified) == 1

    def test_stream_filter_by_category(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "a.md",
            {"id": "a", "status": "verified", "category": "HALLUCINATION"},
            "body",
        )
        write_rule_file(
            tmp_path / "b.md",
            {"id": "b", "status": "verified", "category": "PATTERN_VIOLATION"},
            "body",
        )
        result = stream_filter_rules(
            tmp_path, status_filter="verified", category="HALLUCINATION"
        )
        assert len(result) == 1
        assert result[0].name == "a.md"

    def test_stream_filter_by_keyword(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "k1.md",
            {
                "id": "k1",
                "status": "verified",
                "category": "TEST",
                "source_session": "ses_abc123",
            },
            "body",
        )
        write_rule_file(
            tmp_path / "k2.md",
            {
                "id": "k2",
                "status": "verified",
                "category": "TEST",
                "source_session": "ses_xyz",
            },
            "body",
        )
        result = stream_filter_rules(tmp_path, status_filter="verified", keyword="abc")
        assert len(result) == 1

    def test_stream_filter_limit(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        for i in range(10):
            write_rule_file(
                tmp_path / f"lim{i}.md",
                {"id": f"lim{i}", "status": "verified", "category": "TEST"},
                "body",
            )
        result = stream_filter_rules(tmp_path, status_filter="verified", limit=3)
        assert len(result) == 3

    def test_stream_filter_skips_index_files(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        idx = tmp_path / "_index.json"
        idx.write_text('{"test": true}')
        write_rule_file(tmp_path / "real.md", {"id": "r", "status": "verified"}, "body")
        result = stream_filter_rules(tmp_path, status_filter="verified")
        assert all(p.name != "_index.json" for p in result)

    def test_write_preserves_none(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, read_frontmatter_raw

        target = tmp_path / "none.md"
        meta = {"id": "n1", "status": "pending", "project_hash": None}
        write_rule_file(target, meta, "body")
        fm = read_frontmatter_raw(target)
        assert fm["id"] == "n1"
        assert "project_hash" not in fm or fm.get("project_hash") is None

    def test_stream_filter_by_intent_domain(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "a.md",
            {
                "id": "a",
                "status": "verified",
                "category": "TEST",
                "intent_tags": {"domain": "database", "task_goal": "migration"},
            },
            "body",
        )
        write_rule_file(
            tmp_path / "b.md",
            {
                "id": "b",
                "status": "verified",
                "category": "TEST",
                "intent_tags": {"domain": "frontend", "task_goal": "rendering"},
            },
            "body",
        )
        result = stream_filter_rules(
            tmp_path, status_filter="verified", intent_domain="database"
        )
        assert len(result) == 1
        assert result[0].name == "a.md"

    def test_stream_filter_by_intent_task_goal(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "a.md",
            {
                "id": "a",
                "status": "verified",
                "category": "TEST",
                "intent_tags": {"domain": "database", "task_goal": "connection_pool"},
            },
            "body",
        )
        result = stream_filter_rules(
            tmp_path, status_filter="verified", intent_task_goal="pool"
        )
        assert len(result) == 1

    def test_stream_filter_by_failed_skill(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "a.md",
            {
                "id": "a",
                "status": "verified",
                "category": "TEST",
                "failed_skill": "prisma_client",
            },
            "body",
        )
        write_rule_file(
            tmp_path / "b.md",
            {
                "id": "b",
                "status": "verified",
                "category": "TEST",
                "failed_skill": "playwright",
            },
            "body",
        )
        result = stream_filter_rules(
            tmp_path, status_filter="verified", failed_skill="prisma"
        )
        assert len(result) == 1
        assert result[0].name == "a.md"

    def test_stream_filter_by_error_summary(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "a.md",
            {
                "id": "a",
                "status": "verified",
                "category": "TEST",
                "error_summary": "P2024 connection pool timeout",
            },
            "body",
        )
        result = stream_filter_rules(
            tmp_path, status_filter="verified", error_summary="timeout"
        )
        assert len(result) == 1

    def test_stream_filter_multi_dimension_combined(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "a.md",
            {
                "id": "a",
                "status": "verified",
                "category": "HALLUCINATION",
                "intent_tags": {"domain": "database", "task_goal": "migration"},
                "failed_skill": "prisma",
                "error_summary": "Pool exhaustion",
            },
            "body",
        )
        write_rule_file(
            tmp_path / "b.md",
            {
                "id": "b",
                "status": "verified",
                "category": "HALLUCINATION",
                "intent_tags": {"domain": "database", "task_goal": "seeding"},
                "failed_skill": "prisma",
                "error_summary": "Unique constraint",
            },
            "body",
        )
        result = stream_filter_rules(
            tmp_path,
            status_filter="verified",
            intent_domain="database",
            intent_task_goal="migration",
        )
        assert len(result) == 1
        assert result[0].name == "a.md"

    def test_stream_filter_no_intent_tags_field(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, stream_filter_rules

        write_rule_file(
            tmp_path / "legacy.md",
            {"id": "leg", "status": "verified", "category": "TEST"},
            "body",
        )
        result = stream_filter_rules(
            tmp_path, status_filter="verified", intent_domain="anything"
        )
        assert len(result) == 0

    def test_write_and_read_intent_tags_via_serialize(self, tmp_path):
        from aristotle_mcp.frontmatter import write_rule_file, read_frontmatter_raw

        target = tmp_path / "tags.md"
        meta = {
            "id": "t1",
            "status": "verified",
            "intent_tags": {"domain": "api", "task_goal": "auth"},
            "failed_skill": "jwt",
            "error_summary": "Expired token",
        }
        write_rule_file(target, meta, "body")
        fm = read_frontmatter_raw(target)
        assert fm["intent_tags"]["domain"] == "api"
        assert fm["intent_tags"]["task_goal"] == "auth"
        assert fm["failed_skill"] == "jwt"
        assert fm["error_summary"] == "Expired token"
