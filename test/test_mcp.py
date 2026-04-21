"""Unit tests for aristotle_mcp — config, models, git_ops, frontmatter, migration, server."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def tmp_repo(tmp_path, monkeypatch):
    """Redirect ARISTOTLE_REPO_DIR to a temp dir for every test."""
    monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path))
    return tmp_path


# ═══════════════════════════════════════════════════════
# config
# ═══════════════════════════════════════════════════════
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


# ═══════════════════════════════════════════════════════
# evolution
# ═══════════════════════════════════════════════════════
class TestEvolution:
    def test_compute_delta_high_risk(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(1.0, "high") == pytest.approx(0.2)
        assert compute_delta(0.5, "high") == pytest.approx(0.1)

    def test_compute_delta_medium_risk(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(1.0, "medium") == pytest.approx(0.5)
        assert compute_delta(0.8, "medium") == pytest.approx(0.4)

    def test_compute_delta_low_risk(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(1.0, "low") == pytest.approx(0.8)
        assert compute_delta(0.5, "low") == pytest.approx(0.4)

    def test_compute_delta_zero_confidence(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(0.0, "high") == 0.0
        assert compute_delta(0.0, "low") == 0.0

    def test_compute_delta_invalid_risk_level(self):
        from aristotle_mcp.evolution import compute_delta

        with pytest.raises(ValueError, match="Unknown risk_level"):
            compute_delta(0.5, "critical")

    def test_compute_delta_invalid_confidence(self):
        from aristotle_mcp.evolution import compute_delta

        with pytest.raises(ValueError, match="confidence must be between"):
            compute_delta(1.5, "high")
        with pytest.raises(ValueError, match="confidence must be between"):
            compute_delta(-0.1, "low")

    def test_decide_audit_level_auto(self):
        from aristotle_mcp.evolution import decide_audit_level

        assert decide_audit_level(0.75) == "auto"
        assert decide_audit_level(0.7 + 0.001) == "auto"
        assert decide_audit_level(1.0) == "auto"

    def test_decide_audit_level_semi(self):
        from aristotle_mcp.evolution import decide_audit_level

        assert decide_audit_level(0.5) == "semi"
        assert decide_audit_level(0.7) == "semi"
        assert decide_audit_level(0.4 + 0.001) == "semi"

    def test_decide_audit_level_manual(self):
        from aristotle_mcp.evolution import decide_audit_level

        assert decide_audit_level(0.4) == "manual"
        assert decide_audit_level(0.3) == "manual"
        assert decide_audit_level(0.0) == "manual"

    def test_delta_audit_integration(self):
        """End-to-end: confidence + risk → Δ → audit level."""
        from aristotle_mcp.evolution import compute_delta, decide_audit_level

        # Low risk, high confidence → auto
        d = compute_delta(0.95, "low")
        assert decide_audit_level(d) == "auto"

        # High risk, moderate confidence → manual
        d = compute_delta(0.4, "high")
        assert decide_audit_level(d) == "manual"

        # Medium risk, high confidence → semi
        d = compute_delta(0.9, "medium")
        assert decide_audit_level(d) == "semi"


# ═══════════════════════════════════════════════════════
# models
# ═══════════════════════════════════════════════════════
class TestModels:
    def test_rule_metadata_defaults(self):
        from aristotle_mcp.models import RuleMetadata

        m = RuleMetadata(id="t1")
        assert m.status == "pending"
        assert m.scope == "user"
        assert m.confidence == 0.7
        assert m.project_hash is None
        assert m.verified_at is None

    def test_to_frontmatter_string_basic(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="fm_test", status="verified", category="HALLUCINATION")
        s = to_frontmatter_string(m)
        assert s.startswith("---\n")
        assert s.endswith("\n---")
        assert "id: fm_test" in s
        assert "status: verified" in s
        assert "category: HALLUCINATION" in s
        assert "project_hash" not in s  # None values omitted

    def test_to_frontmatter_string_special_chars(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="special: test", category="has'quote")
        s = to_frontmatter_string(m)
        assert "id:" in s  # quoted because of ':'

    def test_from_frontmatter_dict_full(self):
        from aristotle_mcp.models import from_frontmatter_dict

        data = {
            "id": "rec_123",
            "status": "verified",
            "scope": "project",
            "category": "HALLUCINATION",
            "confidence": 0.9,
        }
        m = from_frontmatter_dict(data)
        assert m.id == "rec_123"
        assert m.scope == "project"
        assert m.confidence == 0.9

    def test_from_frontmatter_dict_defaults(self):
        from aristotle_mcp.models import from_frontmatter_dict

        m = from_frontmatter_dict({"id": "x"})
        assert m.status == "pending"
        assert m.confidence == 0.7
        assert m.source_session is None

    def test_roundtrip_frontmatter(self):
        from aristotle_mcp.models import (
            RuleMetadata,
            to_frontmatter_string,
            from_frontmatter_dict,
        )
        import yaml

        original = RuleMetadata(
            id="rt1",
            status="verified",
            category="PATTERN_VIOLATION",
            confidence=0.85,
            risk_level="low",
            verified_by="human",
        )
        fm_str = to_frontmatter_string(original)
        inner = fm_str.split("\n", 1)[1].rsplit("\n---", 1)[0]
        parsed = yaml.safe_load(inner)
        restored = from_frontmatter_dict(parsed)
        assert restored.id == original.id
        assert restored.status == original.status
        assert restored.category == original.category
        assert restored.confidence == original.confidence

    def test_rule_metadata_gear2_fields(self):
        from aristotle_mcp.models import RuleMetadata

        m = RuleMetadata(
            id="g1",
            intent_tags={"domain": "text_analysis", "task_goal": "extract_entity"},
            failed_skill="pdf_parser_v2",
            error_summary="Unable to identify tables in multi-column layout",
        )
        assert m.intent_tags == {
            "domain": "text_analysis",
            "task_goal": "extract_entity",
        }
        assert m.failed_skill == "pdf_parser_v2"
        assert m.error_summary is not None
        assert len(m.error_summary) > 0

    def test_to_frontmatter_intent_tags_nested(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(
            id="fm_intent",
            intent_tags={"domain": "database", "task_goal": "connection_pool"},
            failed_skill="prisma",
            error_summary="P2024 connection timeout",
        )
        s = to_frontmatter_string(m)
        assert "intent_tags:" in s
        assert "domain:" in s
        assert "database" in s
        assert "task_goal:" in s
        assert "connection_pool" in s
        assert "failed_skill: prisma" in s
        assert "error_summary:" in s
        assert "P2024" in s

    def test_to_frontmatter_intent_tags_null(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="no_intent")
        s = to_frontmatter_string(m)
        assert "intent_tags" not in s  # None values omitted

    def test_to_frontmatter_intent_tags_empty_dict(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="empty_intent", intent_tags={})
        s = to_frontmatter_string(m)
        assert "intent_tags: null" in s

    def test_from_frontmatter_gear2_fields(self):
        from aristotle_mcp.models import from_frontmatter_dict

        data = {
            "id": "g2",
            "intent_tags": {"domain": "api", "task_goal": "auth"},
            "failed_skill": "jwt_lib",
            "error_summary": "Token expired without refresh",
        }
        m = from_frontmatter_dict(data)
        assert m.intent_tags == {"domain": "api", "task_goal": "auth"}
        assert m.failed_skill == "jwt_lib"
        assert m.error_summary == "Token expired without refresh"

    def test_roundtrip_with_gear2_fields(self):
        from aristotle_mcp.models import (
            RuleMetadata,
            to_frontmatter_string,
            from_frontmatter_dict,
        )
        import yaml

        original = RuleMetadata(
            id="rt_gear",
            status="verified",
            category="HALLUCINATION",
            intent_tags={"domain": "file_ops", "task_goal": "atomic_write"},
            failed_skill="pathlib",
            error_summary="Race condition on rename",
        )
        fm_str = to_frontmatter_string(original)
        inner = fm_str.split("\n", 1)[1].rsplit("\n---", 1)[0]
        parsed = yaml.safe_load(inner)
        restored = from_frontmatter_dict(parsed)
        assert restored.intent_tags == original.intent_tags
        assert restored.failed_skill == original.failed_skill
        assert restored.error_summary == original.error_summary

    def test_tool_return(self):
        from aristotle_mcp.models import ToolReturn

        t = ToolReturn(success=True, message="ok")
        assert t.success
        assert t.data is None


# ═══════════════════════════════════════════════════════
# git_ops
# ═══════════════════════════════════════════════════════
class TestGitOps:
    def test_git_init_creates_repo(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init

        r = git_init(tmp_repo)
        assert r["success"]
        assert (tmp_repo / ".git").is_dir()

    def test_git_init_idempotent(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init

        git_init(tmp_repo)
        r = git_init(tmp_repo)
        assert r["success"]
        assert "Already" in r["message"]

    def test_git_add_and_commit(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_add_and_commit

        git_init(tmp_repo)
        (tmp_repo / "hello.txt").write_text("hi")
        r = git_add_and_commit(tmp_repo, "hello.txt", "add hello")
        assert r["success"]
        assert r["commit_hash"] is not None
        assert len(r["commit_hash"]) == 7

    def test_git_add_and_commit_nothing(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_add_and_commit

        git_init(tmp_repo)
        r = git_add_and_commit(tmp_repo, ".", "empty commit")
        assert not r["success"]

    def test_git_show(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_add_and_commit, git_show

        git_init(tmp_repo)
        (tmp_repo / "f.txt").write_text("content")
        git_add_and_commit(tmp_repo, "f.txt", "add f")
        r = git_show(tmp_repo, "HEAD", "f.txt")
        assert r["success"]
        assert r["content"] == "content"

    def test_git_show_missing_file(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_show

        git_init(tmp_repo)
        r = git_show(tmp_repo, "HEAD", "nonexistent.txt")
        assert not r["success"]

    def test_git_log(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_add_and_commit, git_log

        git_init(tmp_repo)
        (tmp_repo / "a.txt").write_text("a")
        git_add_and_commit(tmp_repo, "a.txt", "first")
        log = git_log(tmp_repo)
        assert log["success"]
        assert len(log["commits"]) >= 1
        assert log["commits"][0]["message"] == "first"

    def test_git_status(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_status

        git_init(tmp_repo)
        (tmp_repo / "new.txt").write_text("x")
        s = git_status(tmp_repo)
        assert s["success"]
        assert "new.txt" in s["untracked"]


# ═══════════════════════════════════════════════════════
# frontmatter
# ═══════════════════════════════════════════════════════
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


# ═══════════════════════════════════════════════════════
# migration
# ═══════════════════════════════════════════════════════
class TestMigration:
    def test_parse_learnings_file_basic(self, tmp_path):
        from aristotle_mcp.migration import parse_learnings_file

        md = tmp_path / "learnings.md"
        md.write_text(
            "# Header\n\n"
            "## [2026-04-10] HALLUCINATION — Fabricated Method\n"
            "**Context**: test\n**Rule**: verify\n**Why**: trust\n"
            "**Example**: ✅ check ❌ assume\n---\n",
            encoding="utf-8",
        )
        entries = parse_learnings_file(md)
        assert len(entries) == 1
        assert entries[0]["date"] == "2026-04-10"
        assert entries[0]["category"] == "HALLUCINATION"
        assert entries[0]["title"] == "Fabricated Method"
        assert "**Context**" in entries[0]["body"]

    def test_parse_learnings_multiple_entries(self, tmp_path):
        from aristotle_mcp.migration import parse_learnings_file

        md = tmp_path / "multi.md"
        md.write_text(
            "# Header\n"
            "## [2026-01-01] PATTERN_VIOLATION — First\n**Ctx**: a\n---\n"
            "## [2026-02-02] SYNTAX_API_ERROR — Second\n**Ctx**: b\n---\n",
            encoding="utf-8",
        )
        entries = parse_learnings_file(md)
        assert len(entries) == 2
        assert entries[0]["category"] == "PATTERN_VIOLATION"
        assert entries[1]["category"] == "SYNTAX_API_ERROR"

    def test_parse_learnings_missing_file(self, tmp_path):
        from aristotle_mcp.migration import parse_learnings_file

        assert parse_learnings_file(tmp_path / "nope.md") == []

    def test_parse_learnings_empty_file(self, tmp_path):
        from aristotle_mcp.migration import parse_learnings_file

        md = tmp_path / "empty.md"
        md.write_text("# Header\n<!-- nothing -->\n", encoding="utf-8")
        assert parse_learnings_file(md) == []

    def test_init_repo_creates_structure(self, tmp_repo):
        from aristotle_mcp.migration import init_repo

        r = init_repo(tmp_repo)
        assert r["success"]
        assert (tmp_repo / ".git").is_dir()
        assert (tmp_repo / ".gitignore").exists()
        assert (tmp_repo / "user").is_dir()
        assert (tmp_repo / "projects").is_dir()
        assert (tmp_repo / "rejected" / "user").is_dir()
        assert (tmp_repo / "rejected" / "projects").is_dir()

    def test_init_repo_gitignore_content(self, tmp_repo):
        from aristotle_mcp.migration import init_repo

        init_repo(tmp_repo)
        content = (tmp_repo / ".gitignore").read_text()
        assert "*.tmp" in content
        assert "*.signal" in content

    def test_migrate_learnings_no_file(self, tmp_repo, monkeypatch, tmp_path):
        from aristotle_mcp.migration import migrate_learnings

        monkeypatch.setattr(
            "aristotle_mcp.config.resolve_learnings_file",
            lambda scope, pp=None: tmp_path / "nonexistent.md",
        )
        r = migrate_learnings(tmp_repo)
        assert r["success"]
        assert r["migrated_count"] == 0

    def test_migrate_learnings_with_rules(self, tmp_repo, monkeypatch, tmp_path):
        from aristotle_mcp.migration import init_repo, migrate_learnings

        init_repo(tmp_repo)

        learnings = tmp_path / "aristotle-learnings.md"
        learnings.write_text(
            "# Header\n"
            "## [2026-03-01] HALLUCINATION — Fake API\n"
            "**Context**: test\n**Rule**: verify\n---\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(
            "aristotle_mcp.migration.resolve_learnings_file",
            lambda scope, pp=None: learnings,
        )

        r = migrate_learnings(tmp_repo)
        assert r["success"]
        assert r["migrated_count"] == 1
        assert r["scope"] == "user"

        rule_files = list((tmp_repo / "user").glob("*.md"))
        assert len(rule_files) == 1

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(rule_files[0])
        assert fm["id"] == "mig_1"
        assert fm["status"] == "verified"
        assert fm["verified_by"] == "migration"
        assert fm["risk_level"] == "high"  # HALLUCINATION → high

        assert learnings.with_suffix(".md.bak").exists()


# ═══════════════════════════════════════════════════════
# server (tool-level integration tests via direct calls)
# ═══════════════════════════════════════════════════════
class TestServerTools:
    def _bootstrap(self, tmp_repo):
        from aristotle_mcp.migration import init_repo

        return init_repo(tmp_repo)

    def test_init_repo_tool(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool

        r = init_repo_tool()
        assert r["success"]
        assert "repo_path" in r

    def test_write_rule_and_read_back(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, read_rules

        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        assert w["success"]
        assert w["rule_id"].startswith("rec_")

        r = read_rules(status="pending", category="HALLUCINATION")
        assert r["success"]
        assert r["count"] == 1
        assert "Test" in r["rules"][0]["content"]

    def test_write_rule_invalid_scope(self, tmp_repo):
        from aristotle_mcp.server import write_rule

        r = write_rule(content="x", scope="invalid")
        assert not r["success"]
        assert "Invalid scope" in r["message"]

    def test_write_rule_project_requires_path(self, tmp_repo):
        from aristotle_mcp.server import write_rule

        r = write_rule(content="x", scope="project")
        assert not r["success"]
        assert "project_path" in r["message"]

    def test_write_rule_auto_init_repo(self, tmp_repo):
        """write_rule auto-initializes repo when .git doesn't exist"""
        from aristotle_mcp.server import write_rule
        from pathlib import Path

        assert not (tmp_repo / ".git").is_dir()
        r = write_rule(content="auto init test", category="HALLUCINATION")
        assert r["success"]
        assert (tmp_repo / ".git").is_dir()
        assert r["rule_id"].startswith("rec_")

    def test_write_rule_auto_init_already_initialized(self, tmp_repo):
        """write_rule skips auto-init when repo already exists"""
        from aristotle_mcp.server import init_repo_tool, write_rule
        from pathlib import Path

        init_repo_tool()
        git_dir = tmp_repo / ".git"
        assert git_dir.is_dir()
        r = write_rule(content="already init test", category="HALLUCINATION")
        assert r["success"]

    def test_stage_rule(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule

        init_repo_tool()
        w = write_rule(content="staging test", category="TEST")
        file_path = w["file_path"]
        s = stage_rule(file_path)
        assert s["success"]

        from aristotle_mcp.frontmatter import read_frontmatter_raw

        fm = read_frontmatter_raw(Path(file_path))
        assert fm["status"] == "staging"

    def test_commit_rule(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, commit_rule
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(content="commit test", category="PATTERN_VIOLATION")
        c = commit_rule(w["file_path"])
        assert c["success"]
        assert c["commit_hash"] is not None

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm["status"] == "verified"
        assert fm["verified_by"] == "auto"
        assert fm["verified_at"] is not None

    def test_reject_rule(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, reject_rule
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(content="reject test", category="HALLUCINATION")
        r = reject_rule(w["file_path"], reason="too vague")
        assert r["success"]
        assert "rejected" in r["new_path"]

        assert not Path(w["file_path"]).exists()
        new_fm = read_frontmatter_raw(Path(r["new_path"]))
        assert new_fm["status"] == "rejected"
        assert new_fm["rejected_reason"] == "too vague"

    def test_list_rules(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, list_rules

        init_repo_tool()
        write_rule(content="r1", category="HALLUCINATION")
        write_rule(content="r2", category="PATTERN_VIOLATION")
        result = list_rules(status_filter="all")
        assert result["success"]
        assert result["count"] == 2

    def test_list_rules_multi_dimension_search(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, list_rules

        init_repo_tool()
        write_rule(
            content="db rule",
            category="HALLUCINATION",
            intent_domain="database",
            intent_task_goal="connection_pool",
            failed_skill="prisma",
            error_summary="pool exhaustion",
        )
        write_rule(
            content="api rule",
            category="SYNTAX_API_ERROR",
            intent_domain="api",
            intent_task_goal="cors_setup",
            failed_skill="express",
            error_summary="CORS blocked",
        )
        write_rule(
            content="build rule",
            category="PATTERN_VIOLATION",
            intent_domain="build_system",
            intent_task_goal="webpack_config",
        )

        r1 = list_rules(status_filter="pending", intent_domain="database")
        assert r1["count"] == 1
        assert r1["rules"][0]["metadata"]["intent_tags"]["domain"] == "database"

        r2 = list_rules(status_filter="pending", failed_skill="express")
        assert r2["count"] == 1
        assert "api rule" not in r2["rules"][0].get("content", "")

        r3 = list_rules(status_filter="pending", error_summary="pool")
        assert r3["count"] == 1

        r4 = list_rules(status_filter="pending", intent_domain="nonexistent")
        assert r4["count"] == 0

    def test_list_rules_returns_no_content(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, list_rules

        init_repo_tool()
        write_rule(
            content="This is a long rule body that should NOT appear in list_rules results",
            category="HALLUCINATION",
            intent_domain="database",
        )
        result = list_rules(status_filter="pending", intent_domain="database")
        assert result["count"] == 1
        assert "content" not in result["rules"][0]
        assert "long rule body" not in str(result["rules"][0])

    def test_read_rules_keyword(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, read_rules

        init_repo_tool()
        write_rule(content="r1", category="HALLUCINATION", source_session="ses_abc")
        write_rule(content="r2", category="PATTERN_VIOLATION")
        r = read_rules(status="pending", keyword="ses_abc")
        assert r["count"] == 1

    def test_full_lifecycle(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            commit_rule,
            read_rules,
        )

        init_repo_tool()
        w = write_rule(content="lifecycle", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        r = read_rules(status="verified", category="HALLUCINATION")
        assert r["count"] == 1
        assert r["rules"][0]["metadata"]["status"] == "verified"

    def test_write_rule_with_gear2_fields(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, read_rules
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(
            content="GEAR2 test",
            category="HALLUCINATION",
            intent_domain="database",
            intent_task_goal="connection_pool",
            failed_skill="prisma",
            error_summary="P2024 pool timeout",
        )
        assert w["success"]

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm["intent_tags"]["domain"] == "database"
        assert fm["intent_tags"]["task_goal"] == "connection_pool"
        assert fm["failed_skill"] == "prisma"
        assert fm["error_summary"] == "P2024 pool timeout"

        r = read_rules(status="pending", intent_domain="database")
        assert r["count"] == 1

    def test_write_rule_with_intent_domain_only(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(content="partial intent", intent_domain="file_ops")
        assert w["success"]

        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm["intent_tags"]["domain"] == "file_ops"
        assert "task_goal" not in fm["intent_tags"]

    def test_read_rules_multi_dimension_search(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, read_rules

        init_repo_tool()
        write_rule(
            content="db error",
            category="HALLUCINATION",
            intent_domain="database",
            failed_skill="prisma",
            error_summary="pool exhaustion",
        )
        write_rule(
            content="api error",
            category="SYNTAX_API_ERROR",
            intent_domain="api",
            failed_skill="express",
            error_summary="CORS blocked",
        )

        r1 = read_rules(status="pending", intent_domain="database")
        assert r1["count"] == 1
        assert "db error" in r1["rules"][0]["content"]

        r2 = read_rules(status="pending", failed_skill="express")
        assert r2["count"] == 1
        assert "api error" in r2["rules"][0]["content"]

        r3 = read_rules(status="pending", error_summary="pool")
        assert r3["count"] == 1

        r4 = read_rules(status="pending", intent_domain="nonexistent")
        assert r4["count"] == 0

    def test_restore_rule(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            reject_rule,
            restore_rule,
        )
        from aristotle_mcp.frontmatter import read_frontmatter_raw

        init_repo_tool()
        w = write_rule(content="restore me", category="HALLUCINATION")
        rej = reject_rule(w["file_path"], reason="test rejection")
        assert rej["success"]
        rejected_path = rej["new_path"]

        rest = restore_rule(rejected_path)
        assert rest["success"]
        assert "user" in rest["new_path"]
        assert "rejected" not in rest["new_path"]

        assert not Path(rejected_path).exists()

        fm = read_frontmatter_raw(Path(rest["new_path"]))
        assert fm["status"] == "pending"
        assert fm["rejected_at"] is None
        assert fm["rejected_reason"] is None
        assert fm["rejected_at"] is None or fm.get("rejected_at") is None

    def test_restore_rule_not_in_rejected(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, restore_rule

        init_repo_tool()
        w = write_rule(content="not rejected", category="TEST")
        r = restore_rule(w["file_path"])
        assert not r["success"]
        assert "not in the rejected directory" in r["message"]

    def test_restore_rule_nonexistent(self, tmp_repo):
        from aristotle_mcp.server import restore_rule

        r = restore_rule("/nonexistent/path.md")
        assert not r["success"]

    def test_check_git_available(self):
        from aristotle_mcp.migration import check_git_available

        r = check_git_available()
        assert r["success"]
        assert "git" in r["version"].lower()

    def test_init_repo_git_check_passes(self, tmp_repo):
        from aristotle_mcp.migration import init_repo

        r = init_repo(tmp_repo)
        assert r["success"]


# ═══════════════════════════════════════════════════════
# sync tools (P3.4)
# ═══════════════════════════════════════════════════════
class TestSyncTools:
    def test_check_sync_status_clean(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            commit_rule,
            check_sync_status,
        )

        init_repo_tool()
        w = write_rule(content="sync test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        status = check_sync_status()
        assert status["success"]
        assert status["total_verified"] == 1
        assert status["unsynced_count"] == 0
        assert status["unsynced_files"] == []

    def test_check_sync_status_dirty(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            check_sync_status,
        )
        from aristotle_mcp.frontmatter import update_frontmatter_field
        from pathlib import Path

        init_repo_tool()
        w = write_rule(content="unsynced rule", category="HALLUCINATION")
        update_frontmatter_field(Path(w["file_path"]), "status", "verified")

        status = check_sync_status()
        assert status["success"]
        assert status["unsynced_count"] == 1
        assert status["unsynced_files"][0]["rule_id"] == w["rule_id"]

    def test_sync_rules_auto(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            check_sync_status,
            sync_rules,
        )
        from aristotle_mcp.frontmatter import update_frontmatter_field

        init_repo_tool()
        w = write_rule(content="auto sync rule", category="PATTERN_VIOLATION")
        update_frontmatter_field(Path(w["file_path"]), "status", "verified")

        before = check_sync_status()
        assert before["unsynced_count"] == 1

        result = sync_rules()
        assert result["success"]
        assert result["synced_count"] == 1
        assert result["commit_hash"] is not None

        after = check_sync_status()
        assert after["unsynced_count"] == 0

    def test_sync_rules_specific_files(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            sync_rules,
            check_sync_status,
        )
        from aristotle_mcp.frontmatter import update_frontmatter_field
        from pathlib import Path

        init_repo_tool()
        w1 = write_rule(content="rule A", category="HALLUCINATION")
        w2 = write_rule(content="rule B", category="PATTERN_VIOLATION")
        update_frontmatter_field(Path(w1["file_path"]), "status", "verified")
        update_frontmatter_field(Path(w2["file_path"]), "status", "verified")

        rel1 = str(Path(w1["file_path"]).relative_to(tmp_repo))
        result = sync_rules(file_paths=[rel1])
        assert result["success"]
        assert result["synced_count"] == 1

        status = check_sync_status()
        assert status["unsynced_count"] == 1

    def test_sync_rules_nothing_to_sync(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            sync_rules,
        )

        init_repo_tool()
        result = sync_rules()
        assert result["success"]
        assert result["synced_count"] == 0

    def test_check_sync_status_no_repo(self, tmp_repo):
        from aristotle_mcp.server import check_sync_status

        status = check_sync_status()
        assert not status["success"]
        assert "not initialized" in status["message"]

    def test_git_show_exists(self, tmp_repo):
        from aristotle_mcp.git_ops import git_init, git_add_and_commit, git_show_exists

        git_init(tmp_repo)
        (tmp_repo / "user").mkdir()
        (tmp_repo / "user" / "test.md").write_text("hello")
        git_add_and_commit(tmp_repo, "user/test.md", "add test")

        assert git_show_exists(tmp_repo, "user/test.md") is True
        assert git_show_exists(tmp_repo, "user/nonexistent.md") is False


# ═══════════════════════════════════════════════════════
# persist_draft
# ═══════════════════════════════════════════════════════
class TestPersistDraft:
    def test_persist_draft_creates_file(self, tmp_path, monkeypatch):
        """persist_draft creates file in aristotle-drafts directory"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        result = persist_draft(sequence=1, content="# Test DRAFT")
        assert result["success"] is True
        assert "rec_1.md" in result["file_path"]
        content = Path(result["file_path"]).read_text()
        assert content == "# Test DRAFT"

    def test_persist_draft_overwrite(self, tmp_path, monkeypatch):
        """persist_draft overwrites existing file"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        persist_draft(sequence=1, content="# Original")
        result = persist_draft(sequence=1, content="# Updated")
        assert result["success"] is True
        assert Path(result["file_path"]).read_text() == "# Updated"

    def test_persist_draft_creates_directory(self, tmp_path, monkeypatch):
        """persist_draft creates aristotle-drafts directory if needed"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        result = persist_draft(sequence=1, content="# Test")
        assert result["success"] is True
        drafts_dir = tmp_path / "repo" / ".." / "aristotle-drafts"
        assert drafts_dir.resolve().exists()

    def test_persist_draft_atomic_write(self, tmp_path, monkeypatch):
        """No .tmp file left after successful write"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        persist_draft(sequence=1, content="# Test")
        drafts_dir = (tmp_path / "repo").parent / "aristotle-drafts"
        tmp_files = list(drafts_dir.glob("*.tmp"))
        assert len(tmp_files) == 0


# ═══════════════════════════════════════════════════════
# Reflection Records (create_reflection_record, complete_reflection_record)
# ═══════════════════════════════════════════════════════
class TestCreateReflectionRecord:
    def test_create_first_record(self, tmp_path, monkeypatch):
        """Create first reflection record with all expected fields"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        result = create_reflection_record(
            target_session_id="ses_current",
            target_label="current",
            reflector_session_id="ses_reflector_001",
        )

        assert result["success"] is True
        assert result["id"] == "rec_1"
        assert result["sequence"] == 1
        assert result["review_index"] == 1
        assert result["total_records"] == 1

        # Read state file from disk
        state_path = tmp_path / "aristotle-state.json"
        import json

        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1

        record = records[0]
        assert record["target_session_id"] == "ses_current"
        assert record["target_label"] == "current"
        assert record["reflector_session_id"] == "ses_reflector_001"
        assert record["status"] == "processing"
        assert record["rules_count"] is None
        assert "launched_at" in record
        assert "aristotle-drafts/rec_1.md" in record["draft_file_path"]

    def test_create_multiple_records_sequential_ids(self, tmp_path, monkeypatch):
        """Create multiple records, verify sequential IDs and review_index"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        r1 = create_reflection_record("ses_1", "session 1", "ref_1")
        r2 = create_reflection_record("ses_2", "session 2", "ref_2")
        r3 = create_reflection_record("ses_3", "session 3", "ref_3")

        assert r1["id"] == "rec_1"
        assert r1["sequence"] == 1
        assert r1["review_index"] == 1

        assert r2["id"] == "rec_2"
        assert r2["sequence"] == 2
        assert r2["review_index"] == 2

        assert r3["id"] == "rec_3"
        assert r3["sequence"] == 3
        assert r3["review_index"] == 3

        assert r3["total_records"] == 3

        # Read state file
        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 3
        assert [r["id"] for r in records] == ["rec_1", "rec_2", "rec_3"]

    def test_create_state_file_corrupted_recovers(self, tmp_path, monkeypatch):
        """Recover gracefully from corrupted state file"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        # Write garbage to state file
        state_path = tmp_path / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text("not valid json {{{")

        result = create_reflection_record("ses_1", "test", "ref_1")
        assert result["success"] is True
        assert result["id"] == "rec_1"

        # Verify state file now has 1 valid record
        import json

        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1
        assert records[0]["id"] == "rec_1"

    def test_create_state_file_not_json_array_recovers(self, tmp_path, monkeypatch):
        """Treat non-array state file as empty and recover"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        # Write a non-array JSON object
        state_path = tmp_path / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text('{"key": "value"}')

        result = create_reflection_record("ses_1", "test", "ref_1")
        assert result["success"] is True
        assert result["id"] == "rec_1"

        # Verify state file now has 1 valid record
        import json

        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1
        assert records[0]["id"] == "rec_1"

    def test_pruning_at_50_records(self, tmp_path, monkeypatch):
        """Prune to max 50 records when exceeding limit"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        # Create 51 records
        for i in range(51):
            result = create_reflection_record(
                target_session_id=f"ses_{i}",
                target_label=f"label_{i}",
                reflector_session_id=f"ref_{i}",
            )

        assert result["total_records"] == 50

        # Verify state file has exactly 50 records
        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 50

        # Verify rec_1 is gone, rec_2 through rec_51 remain
        record_ids = [r["id"] for r in records]
        assert "rec_1" not in record_ids
        assert record_ids[0] == "rec_2"
        assert record_ids[-1] == "rec_51"

    def test_pruning_deletes_old_draft_file(self, tmp_path, monkeypatch):
        """Pruning should delete old DRAFT files"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        # Create a record (rec_1)
        r1 = create_reflection_record("ses_1", "test", "ref_1")
        draft_path_1 = Path(r1["draft_file_path"])

        # Manually create a DRAFT file at that path
        draft_path_1.parent.mkdir(parents=True, exist_ok=True)
        draft_path_1.write_text("# DRAFT content for rec_1")
        assert draft_path_1.exists()

        # Create 50 more records (to trigger pruning of rec_1)
        for i in range(2, 52):
            create_reflection_record(f"ses_{i}", f"label_{i}", f"ref_{i}")

        # Verify the original DRAFT file no longer exists
        assert not draft_path_1.exists()

        # Verify state file has exactly 50 records
        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 50

    def test_pruning_skips_missing_draft_file(self, tmp_path, monkeypatch):
        """Pruning should handle missing DRAFT files gracefully"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        # Create a record but do NOT create its DRAFT file
        r1 = create_reflection_record("ses_1", "test", "ref_1")
        draft_path_1 = Path(r1["draft_file_path"])
        assert not draft_path_1.exists()  # No file created

        # Create 50 more records
        for i in range(2, 52):
            create_reflection_record(f"ses_{i}", f"label_{i}", f"ref_{i}")

        # Should not raise any error - pruning handles missing DRAFT gracefully
        assert True  # If we get here, no error was raised

        # Verify state file has 50 records
        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 50

    def test_review_index_correct_after_pruning(self, tmp_path, monkeypatch):
        """After pruning, review_index should reflect position in pruned array"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        # Create 51 records
        for i in range(1, 52):
            result = create_reflection_record(
                target_session_id=f"ses_{i}",
                target_label=f"label_{i}",
                reflector_session_id=f"ref_{i}",
            )

        # After pruning, the 51st record (which is now at index 49 in 0-indexed array)
        # should have review_index = 50
        assert result["id"] == "rec_51"
        assert result["review_index"] == 50
        assert result["total_records"] == 50

    def test_draft_file_path_format(self, tmp_path, monkeypatch):
        """Draft file path should be in aristotle-drafts/rec_N.md format"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        result = create_reflection_record("ses_1", "test", "ref_1")

        assert result["draft_file_path"].endswith("aristotle-drafts/rec_1.md")


class TestCompleteReflectionRecord:
    def test_complete_updates_status(self, tmp_path, monkeypatch):
        """Complete record should update status, rules_count, and completed_at"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        # Create a record
        create_reflection_record("ses_1", "test", "ref_1")

        # Complete it
        result = complete_reflection_record(
            sequence=1, status="auto_committed", rules_count=3
        )

        assert result["success"] is True
        assert "auto_committed" in result["message"]

        # Verify state file
        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1

        record = records[0]
        assert record["status"] == "auto_committed"
        assert record["rules_count"] == 3
        assert "completed_at" in record

    def test_complete_partial_commit(self, tmp_path, monkeypatch):
        """Partial commit should set status and rules_count correctly"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(
            sequence=1, status="partial_commit", rules_count=1
        )

        assert result["success"] is True

        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "partial_commit"
        assert records[0]["rules_count"] == 1

    def test_complete_checker_failed(self, tmp_path, monkeypatch):
        """Checker failed status should be set correctly"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(
            sequence=1, status="checker_failed", rules_count=0
        )

        assert result["success"] is True

        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "checker_failed"
        assert records[0]["rules_count"] == 0

    def test_complete_without_rules_count(self, tmp_path, monkeypatch):
        """Completing without rules_count should leave it as None"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(sequence=1, status="auto_committed")

        assert result["success"] is True

        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "auto_committed"
        assert records[0]["rules_count"] is None

    def test_complete_nonexistent_record(self, tmp_path, monkeypatch):
        """Attempting to complete non-existent record should fail"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(sequence=99, status="auto_committed")

        assert result["success"] is False
        assert "not found" in result["message"]

    def test_complete_no_state_file(self, tmp_path, monkeypatch):
        """Completing without any state file should fail"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import complete_reflection_record

        # Don't create any records - state file doesn't exist
        result = complete_reflection_record(sequence=1, status="auto_committed")

        assert result["success"] is False
        assert "not found" in result["message"]

    def test_complete_corrupted_state_file(self, tmp_path, monkeypatch):
        """Corrupted state file should be handled gracefully"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import complete_reflection_record

        # Write garbage to state file
        state_path = tmp_path / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text("corrupted {{{")

        result = complete_reflection_record(sequence=1, status="auto_committed")

        assert result["success"] is False
        assert "corrupted" in result["message"]

    def test_complete_multiple_records_only_updates_target(
        self, tmp_path, monkeypatch
    ):
        """Completing one record should not affect others"""
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        # Create 3 records
        create_reflection_record("ses_1", "test1", "ref_1")
        create_reflection_record("ses_2", "test2", "ref_2")
        create_reflection_record("ses_3", "test3", "ref_3")

        # Complete record 2 only
        result = complete_reflection_record(
            sequence=2, status="auto_committed", rules_count=3
        )

        assert result["success"] is True

        import json

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))

        # Record 1 still processing
        assert records[0]["status"] == "processing"

        # Record 2 is auto_committed
        assert records[1]["status"] == "auto_committed"
        assert records[1]["rules_count"] == 3

        # Record 3 still processing
        assert records[2]["status"] == "processing"


# ═══════════════════════════════════════════════════════
# P4: Δ decision + confidence
# ═══════════════════════════════════════════════════════
class TestDeltaDecision:
    def test_get_audit_decision_auto(self, tmp_repo):
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()
        # Low risk + high confidence → auto
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
        # Medium risk + default confidence (0.7) → semi
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
        # High risk + low confidence → manual
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
        """Same category, different confidence → different audit levels."""
        from aristotle_mcp.server import (
            init_repo_tool,
            write_rule,
            stage_rule,
            get_audit_decision,
        )

        init_repo_tool()

        w_high = write_rule(
            content="high conf", category="PATTERN_VIOLATION", confidence=0.95
        )
        stage_rule(w_high["file_path"])
        r_high = get_audit_decision(w_high["file_path"])
        assert r_high["audit_level"] == "auto"

        w_low = write_rule(content="low conf", category="HALLUCINATION", confidence=0.3)
        stage_rule(w_low["file_path"])
        r_low = get_audit_decision(w_low["file_path"])
        assert r_low["audit_level"] == "manual"

        assert r_high["delta"] > r_low["delta"]


# ═══════════════════════════════════════════════════════
# Security: path traversal
# ═══════════════════════════════════════════════════════
class TestPathTraversal:
    def test_absolute_path_outside_repo(self, tmp_repo):
        from aristotle_mcp.server import stage_rule

        r = stage_rule("/etc/passwd")
        assert not r["success"]
        assert "escapes repo" in r["message"]

    def test_relative_path_traversal(self, tmp_repo):
        from aristotle_mcp.server import stage_rule

        r = stage_rule("../../etc/passwd")
        assert not r["success"]
        assert "escapes repo" in r["message"]

    def test_commit_rule_traversal(self, tmp_repo):
        from aristotle_mcp.server import commit_rule

        r = commit_rule("/etc/shadow")
        assert not r["success"]
        assert "escapes repo" in r["message"]

    def test_reject_rule_traversal(self, tmp_repo):
        from aristotle_mcp.server import reject_rule

        r = reject_rule("/tmp/evil.md", reason="test")
        assert not r["success"]
        assert "escapes repo" in r["message"]

    def test_restore_rule_traversal(self, tmp_repo):
        from aristotle_mcp.server import restore_rule

        r = restore_rule("/etc/hosts")
        assert not r["success"]
        assert "escapes repo" in r["message"]

    def test_get_audit_decision_traversal(self, tmp_repo):
        from aristotle_mcp.server import get_audit_decision

        r = get_audit_decision("/etc/passwd")
        assert not r["success"]
        assert "escapes repo" in r["message"]

    def test_legitimate_path_still_works(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule

        init_repo_tool()
        w = write_rule(content="legit", category="TEST")
        r = stage_rule(w["file_path"])
        assert r["success"]
