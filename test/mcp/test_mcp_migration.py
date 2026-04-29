"""Tests for aristotle_mcp.migration — flat Markdown parsing, repo init, auto-migration."""

from __future__ import annotations


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
        assert fm["risk_level"] == "high"

        assert learnings.with_suffix(".md.bak").exists()
