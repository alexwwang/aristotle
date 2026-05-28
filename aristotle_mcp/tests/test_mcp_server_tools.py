"""Tests for aristotle_mcp.server — CRUD tools, sync tools, path traversal security."""

from __future__ import annotations

from pathlib import Path


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
        from aristotle_mcp.server import write_rule

        assert not (tmp_repo / ".git").is_dir()
        r = write_rule(content="auto init test", category="HALLUCINATION")
        assert r["success"]
        assert (tmp_repo / ".git").is_dir()
        assert r["rule_id"].startswith("rec_")

    def test_write_rule_auto_init_already_initialized(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool, write_rule

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
