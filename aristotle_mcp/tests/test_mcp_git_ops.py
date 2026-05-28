"""Tests for aristotle_mcp.git_ops — init, add+commit, show, log, status."""

from __future__ import annotations


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
