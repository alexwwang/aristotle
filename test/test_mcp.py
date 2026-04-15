"""Unit tests for aristotle_mcp — config, models, git_ops, frontmatter, migration, server."""

from __future__ import annotations

import os
import shutil
import tempfile
import time
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
