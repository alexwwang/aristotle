"""Tests for aristotle_mcp._tools_rollback — rollback tools (TDD RED phase).

Tests the 3 MCP rollback tools + validate_path helper:
- create_rollback_point(name, run_id)
- rollback_to_checkpoint(name, run_id)
- cleanup_rollback_stashes(keep)
- validate_path(filepath)
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run a git command in the given repo directory."""
    return subprocess.run(
        ["git", *args],
        cwd=str(repo),
        capture_output=True,
        text=True,
    )


def _init_repo(repo: Path) -> None:
    """Initialize a git repo with an initial commit so stash works."""
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@test.com")
    _git(repo, "config", "user.name", "Test")
    (repo / "README.md").write_text("init")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "init")


def _stash_list(repo: Path) -> list[str]:
    """Return raw stash list entries."""
    r = _git(repo, "stash", "list")
    if r.returncode != 0 or not r.stdout.strip():
        return []
    return r.stdout.strip().split("\n")


def _count_prefixed_stashes(repo: Path) -> int:
    """Count stashes with the aristotle-rollback: prefix."""
    return sum(1 for s in _stash_list(repo) if "aristotle-rollback:" in s)


class TestRollbackTools:
    # ------------------------------------------------------------------
    # 1. should_create_stash_with_prefix
    # ------------------------------------------------------------------
    def test_should_create_stash_with_prefix(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)
        (tmp_repo / "dirty.txt").write_text("change")

        result = create_rollback_point("test", run_id="")
        assert result["success"] is True

        stashes = _stash_list(tmp_repo)
        assert any("aristotle-rollback:checkpoint-test" in s for s in stashes)

    # ------------------------------------------------------------------
    # 2. should_return_stash_ref_on_create
    # ------------------------------------------------------------------
    def test_should_return_stash_ref_on_create(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)
        (tmp_repo / "dirty.txt").write_text("change")

        result = create_rollback_point("test", run_id="")
        assert result["success"] is True
        assert "stash_ref" in result
        assert result["stash_ref"] is not None

    # ------------------------------------------------------------------
    # 3. should_rollback_to_named_checkpoint
    # ------------------------------------------------------------------
    def test_should_rollback_to_named_checkpoint(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "data.txt").write_text("original")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "add data")

        create_rollback_point("cp1", run_id="")

        (tmp_repo / "data.txt").write_text("modified")

        result = rollback_to_checkpoint("cp1", run_id="")
        assert result["success"] is True
        assert (tmp_repo / "data.txt").read_text() == "original"

    # ------------------------------------------------------------------
    # 4. should_verify_restored_state_matches_checkpoint
    # ------------------------------------------------------------------
    def test_should_verify_restored_state_matches_checkpoint(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "config.yml").write_text("key: value\n")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "config")

        create_rollback_point("verify-cp", run_id="")

        (tmp_repo / "config.yml").write_text("key: CHANGED\n")
        (tmp_repo / "extra.txt").write_text("new file")

        rollback_to_checkpoint("verify-cp", run_id="")

        assert (tmp_repo / "config.yml").read_text() == "key: value\n"

    # ------------------------------------------------------------------
    # 5. should_return_pipeline_reset_required_on_rollback
    # ------------------------------------------------------------------
    def test_should_return_pipeline_reset_required_on_rollback(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "f.txt").write_text("v1")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "v1")

        create_rollback_point("reset-test", run_id="")

        result = rollback_to_checkpoint("reset-test", run_id="")
        assert result["success"] is True
        assert result.get("pipeline_reset_required") is True

    # ------------------------------------------------------------------
    # 6. should_cleanup_oldest_stashes
    # ------------------------------------------------------------------
    def test_should_cleanup_oldest_stashes(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
        )

        _init_repo(tmp_repo)

        # Create 5 prefixed stashes
        for i in range(5):
            (tmp_repo / f"file_{i}.txt").write_text(f"content {i}")
            create_rollback_point(f"cp-{i}", run_id="")

        assert _count_prefixed_stashes(tmp_repo) == 5

        result = cleanup_rollback_stashes(keep=3)
        assert result["success"] is True
        assert _count_prefixed_stashes(tmp_repo) == 3

    # ------------------------------------------------------------------
    # 7. should_only_manage_prefixed_stashes
    # ------------------------------------------------------------------
    def test_should_only_manage_prefixed_stashes(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
        )

        _init_repo(tmp_repo)

        # Create a prefixed stash
        (tmp_repo / "prefixed.txt").write_text("p")
        create_rollback_point("prefixed", run_id="")

        # Create a non-prefixed stash
        (tmp_repo / "normal.txt").write_text("n")
        _git(tmp_repo, "stash", "--include-untracked", "-m", "manual-stash")

        total_before = len(_stash_list(tmp_repo))
        assert _count_prefixed_stashes(tmp_repo) == 1

        cleanup_rollback_stashes(keep=0)

        # Non-prefixed stash should survive
        total_after = len(_stash_list(tmp_repo))
        assert total_after == total_before - 1

        remaining = _stash_list(tmp_repo)
        assert any("manual-stash" in s for s in remaining)

    # ------------------------------------------------------------------
    # 8. should_warn_at_stash_threshold_warning
    # ------------------------------------------------------------------
    def test_should_warn_at_stash_threshold_warning(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)

        # Create 5 prefixed stashes (threshold)
        for i in range(5):
            (tmp_repo / f"w_{i}.txt").write_text(str(i))
            create_rollback_point(f"warn-{i}", run_id="")

        # 6th create should include a warning
        (tmp_repo / "w_5.txt").write_text("5")
        result = create_rollback_point("warn-5", run_id="")
        assert result["success"] is True
        assert "warning" in result

    # ------------------------------------------------------------------
    # 9. should_block_at_stash_hard_limit
    # ------------------------------------------------------------------
    def test_should_block_at_stash_hard_limit(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)

        # Create 10 prefixed stashes (hard limit)
        for i in range(10):
            (tmp_repo / f"h_{i}.txt").write_text(str(i))
            create_rollback_point(f"hard-{i}", run_id="")

        # 11th should be blocked
        (tmp_repo / "h_10.txt").write_text("10")
        result = create_rollback_point("hard-10", run_id="")
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 10. should_warn_on_large_untracked_files
    # ------------------------------------------------------------------
    def test_should_warn_on_large_untracked_files(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import rollback_to_checkpoint

        _init_repo(tmp_repo)
        (tmp_repo / "f.txt").write_text("v1")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "v1")

        # Create checkpoint with small content
        from aristotle_mcp._tools_rollback import create_rollback_point

        create_rollback_point("large-test", run_id="")

        # Create large untracked files (>100MB threshold)
        # Write 101 MB of data in chunks to avoid memory issues
        large_file = tmp_repo / "large_untracked.bin"
        chunk = b"0" * (1024 * 1024)
        with large_file.open("wb") as f:
            for _ in range(101):
                f.write(chunk)

        # Rollback should detect large untracked files and warn
        result = rollback_to_checkpoint("large-test", run_id="")

        assert "warning" in result
        assert "untracked" in result["warning"].lower() or "large" in result["warning"].lower()

    # ------------------------------------------------------------------
    # 11. should_proceed_with_rollback_after_untracked_warning
    # ------------------------------------------------------------------
    def test_should_proceed_with_rollback_after_untracked_warning(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "f.txt").write_text("v1")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "v1")

        create_rollback_point("proceed-test", run_id="")

        (tmp_repo / "f.txt").write_text("v2")

        original_run = subprocess.run

        def mock_run(cmd, **kwargs):
            if "du" in cmd:
                mock = MagicMock()
                mock.returncode = 0
                mock.stdout = "200000000\t.\n"
                mock.stderr = ""
                return mock
            return original_run(cmd, **kwargs)

        with patch("aristotle_mcp._tools_rollback.subprocess.run", side_effect=mock_run):
            result = rollback_to_checkpoint("proceed-test", run_id="")

        # Rollback should still succeed despite warning
        assert result["success"] is True
        assert (tmp_repo / "f.txt").read_text() == "v1"

    # ------------------------------------------------------------------
    # 12. should_validate_path_blocks_traversal
    # ------------------------------------------------------------------
    def test_should_validate_path_blocks_traversal(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import validate_path

        assert validate_path("../etc/passwd", tmp_repo) is False
        assert validate_path("foo/../../etc/passwd", tmp_repo) is False

    # ------------------------------------------------------------------
    # 13. should_accept_valid_relative_path
    # ------------------------------------------------------------------
    def test_should_accept_valid_relative_path(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import validate_path

        assert validate_path("src/main.py", tmp_repo) is True

    # ------------------------------------------------------------------
    # 14. should_accept_absolute_path_within_repo
    # ------------------------------------------------------------------
    def test_should_accept_absolute_path_within_repo(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import validate_path

        abs_path = str(tmp_repo / "src" / "main.py")
        assert validate_path(abs_path, tmp_repo) is True

    # ------------------------------------------------------------------
    # 15. should_reject_symlink_escape
    # ------------------------------------------------------------------
    def test_should_reject_symlink_escape(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import validate_path

        _init_repo(tmp_repo)
        (tmp_repo / "subdir").mkdir()
        link = tmp_repo / "subdir" / "escape"
        target = tmp_repo.parent / "outside_repo.txt"
        target.write_text("secret")
        link.symlink_to(target)

        assert validate_path(str(link), tmp_repo) is False

        # Cleanup
        link.unlink(missing_ok=True)
        target.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # 16. should_fail_gracefully_on_stash_create_error
    # ------------------------------------------------------------------
    def test_should_fail_gracefully_on_stash_create_error(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        # No git repo initialized → git stash will fail
        result = create_rollback_point("fail-test", run_id="")
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 17. should_handle_stash_with_no_changes
    # ------------------------------------------------------------------
    def test_should_handle_stash_with_no_changes(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)
        # Working tree is clean — no changes to stash
        result = create_rollback_point("no-changes", run_id="")
        assert result["success"] is True
        assert "no changes" in result.get("message", "").lower()

    # ------------------------------------------------------------------
    # 17.1. should_restore_via_tag_when_no_stash_exists
    # ------------------------------------------------------------------
    def test_should_restore_via_tag_when_no_stash_exists(self, tmp_repo: Path) -> None:
        """Tag-based rollback: create checkpoint with no changes (tag created),
        modify a file, rollback should restore via tag."""
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)

        # Commit a tracked file so the working tree is clean
        (tmp_repo / "tracked.txt").write_text("original")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "add tracked")

        # Create checkpoint with clean working tree → tag created, no stash
        cp = create_rollback_point("tag-test", run_id="")
        assert cp["success"] is True
        assert cp["stash_ref"] is None
        assert "no changes" in cp.get("message", "").lower()

        # Create a new file (untracked) and modify tracked file
        (tmp_repo / "test_tag_rollback.txt").write_text("modified content")

        # Rollback should restore via tag
        result = rollback_to_checkpoint("tag-test", run_id="")
        assert result["success"] is True
        assert result.get("pipeline_reset_required") is True

        # New untracked file should be gone (restored to clean state)
        assert not (tmp_repo / "test_tag_rollback.txt").exists()

    # ------------------------------------------------------------------
    # 17.2. should_reject_empty_checkpoint_name
    # ------------------------------------------------------------------
    def test_should_reject_empty_checkpoint_name(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)
        (tmp_repo / "dirty.txt").write_text("change")

        result = create_rollback_point("", run_id="")
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 18. should_fail_gracefully_on_stash_apply_error
    # ------------------------------------------------------------------
    def test_should_fail_gracefully_on_stash_apply_error(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import rollback_to_checkpoint

        _init_repo(tmp_repo)

        # No checkpoint exists — apply should fail
        result = rollback_to_checkpoint("nonexistent-cp", run_id="")
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 19. should_handle_empty_stash_list_on_cleanup
    # ------------------------------------------------------------------
    def test_should_handle_empty_stash_list_on_cleanup(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import cleanup_rollback_stashes

        _init_repo(tmp_repo)
        result = cleanup_rollback_stashes(keep=3)
        assert result["success"] is True

    # ------------------------------------------------------------------
    # 20. should_succeed_when_keep_count_exceeds_available_stashes
    # ------------------------------------------------------------------
    def test_should_succeed_when_keep_count_exceeds_available_stashes(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "a.txt").write_text("a")
        create_rollback_point("cp-a", run_id="")
        (tmp_repo / "b.txt").write_text("b")
        create_rollback_point("cp-b", run_id="")

        assert _count_prefixed_stashes(tmp_repo) == 2

        result = cleanup_rollback_stashes(keep=5)
        assert result["success"] is True
        # All 2 stashes should still be present
        assert _count_prefixed_stashes(tmp_repo) == 2

    # ------------------------------------------------------------------
    # 20.1. should_reject_negative_or_non_integer_keep
    # ------------------------------------------------------------------
    @pytest.mark.parametrize("keep_value", [-1, 1.5, "three"])
    def test_should_reject_negative_or_non_integer_keep(
        self, tmp_repo: Path, keep_value,
    ) -> None:
        from aristotle_mcp._tools_rollback import cleanup_rollback_stashes

        _init_repo(tmp_repo)
        result = cleanup_rollback_stashes(keep=keep_value)  # type: ignore[arg-type]
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 21. should_handle_rollback_to_nonexistent_checkpoint
    # ------------------------------------------------------------------
    def test_should_handle_rollback_to_nonexistent_checkpoint(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import rollback_to_checkpoint

        _init_repo(tmp_repo)
        result = rollback_to_checkpoint("does-not-exist", run_id="")
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 22. should_complete_create_rollback_cleanup_lifecycle
    # ------------------------------------------------------------------
    def test_should_complete_create_rollback_cleanup_lifecycle(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "lifecycle.txt").write_text("v1")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "v1")

        # Create
        r1 = create_rollback_point("lifecycle-cp", run_id="")
        assert r1["success"] is True

        # Modify
        (tmp_repo / "lifecycle.txt").write_text("v2")

        # Rollback
        r2 = rollback_to_checkpoint("lifecycle-cp", run_id="")
        assert r2["success"] is True
        assert (tmp_repo / "lifecycle.txt").read_text() == "v1"

        # Cleanup
        r3 = cleanup_rollback_stashes(keep=0)
        assert r3["success"] is True
        assert _count_prefixed_stashes(tmp_repo) == 0

    # ------------------------------------------------------------------
    # 23. should_write_audit_entry_on_rollback_create
    # ------------------------------------------------------------------
    def test_should_write_audit_entry_on_rollback_create(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._audit_log import append_audit_entry
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)
        (tmp_repo / "audit.txt").write_text("change")

        with patch(
            "aristotle_mcp._tools_rollback.append_audit_entry",
            wraps=append_audit_entry,
        ) as mock_audit:
            create_rollback_point("audit-cp", run_id="run-123")
            mock_audit.assert_called_once()
            call_kwargs = mock_audit.call_args
            assert call_kwargs is not None

    # ------------------------------------------------------------------
    # 24. should_write_audit_entry_on_rollback_to_checkpoint
    # ------------------------------------------------------------------
    def test_should_write_audit_entry_on_rollback_to_checkpoint(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._audit_log import append_audit_entry
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "f.txt").write_text("v1")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "v1")

        create_rollback_point("audit-rb-cp", run_id="")

        (tmp_repo / "f.txt").write_text("v2")

        with patch(
            "aristotle_mcp._tools_rollback.append_audit_entry",
            wraps=append_audit_entry,
        ) as mock_audit:
            rollback_to_checkpoint("audit-rb-cp", run_id="run-456")
            mock_audit.assert_called_once()
            call_kwargs = mock_audit.call_args
            assert call_kwargs is not None

    # ------------------------------------------------------------------
    # 25. should_preserve_stash_on_apply_failure
    # ------------------------------------------------------------------
    def test_should_preserve_stash_on_apply_failure(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "conflict.txt").write_text("base")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "base")

        create_rollback_point("preserve-cp", run_id="")

        # Modify and commit
        (tmp_repo / "conflict.txt").write_text("committed-change")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "change")

        # Now working tree has committed changes that conflict with stash
        # The stash still has "base", apply should fail due to conflict
        # because current HEAD has "committed-change" but stash base was "base"
        # Actually stash apply applies to working directory, so we need conflict
        (tmp_repo / "conflict.txt").write_text("dirty-working")

        result = rollback_to_checkpoint("preserve-cp", run_id="")
        if not result["success"]:
            # Stash should still exist (not dropped)
            assert _count_prefixed_stashes(tmp_repo) >= 1

    # ------------------------------------------------------------------
    # 26. should_handle_stash_apply_merge_conflict
    # ------------------------------------------------------------------
    def test_should_handle_stash_apply_merge_conflict(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "merge.txt").write_text("original")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "original")

        create_rollback_point("merge-cp", run_id="")

        # Commit conflicting change on current branch
        (tmp_repo / "merge.txt").write_text("branch-change")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "branch-change")

        result = rollback_to_checkpoint("merge-cp", run_id="")
        # If conflict occurred, it should report it
        if not result["success"]:
            assert "conflict" in result.get("error", "").lower() or "conflict" in str(
                result
            ).lower()

    # ------------------------------------------------------------------
    # 27. should_write_audit_entry_on_cleanup_rollback_stashes
    # ------------------------------------------------------------------
    def test_should_write_audit_entry_on_cleanup_rollback_stashes(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._audit_log import append_audit_entry
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "c.txt").write_text("c")
        create_rollback_point("cleanup-audit-cp", run_id="")

        with patch(
            "aristotle_mcp._tools_rollback.append_audit_entry",
            wraps=append_audit_entry,
        ) as mock_audit:
            cleanup_rollback_stashes(keep=0)
            mock_audit.assert_called_once()
            call_kwargs = mock_audit.call_args
            assert call_kwargs is not None

    # ------------------------------------------------------------------
    # 28. should_handle_special_characters_in_checkpoint_name
    # ------------------------------------------------------------------
    def test_should_handle_special_characters_in_checkpoint_name(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)
        (tmp_repo / "special.txt").write_text("data")

        # Names with spaces and unicode
        result = create_rollback_point("test with spaces", run_id="")
        assert result["success"] is True

        stashes = _stash_list(tmp_repo)
        assert any("aristotle-rollback:checkpoint-test with spaces" in s for s in stashes)

        # Shell-unsafe chars — must use list-form args, never shell=True
        (tmp_repo / "special2.txt").write_text("data2")
        result2 = create_rollback_point("test;echo pwned", run_id="")
        assert result2["success"] is True

        # Verify no command injection occurred
        stashes2 = _stash_list(tmp_repo)
        assert any("aristotle-rollback:checkpoint-test;echo pwned" in s for s in stashes2)
        # No file called "pwned" should exist
        assert not (tmp_repo / "pwned").exists()

    # ------------------------------------------------------------------
    # 29. should_handle_duplicate_checkpoint_name
    # ------------------------------------------------------------------
    def test_should_handle_duplicate_checkpoint_name(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import create_rollback_point

        _init_repo(tmp_repo)

        (tmp_repo / "dup1.txt").write_text("first")
        r1 = create_rollback_point("dup-name", run_id="")
        assert r1["success"] is True

        (tmp_repo / "dup2.txt").write_text("second")
        r2 = create_rollback_point("dup-name", run_id="")
        assert r2["success"] is True

        # Two stashes with same name prefix should exist
        stashes = _stash_list(tmp_repo)
        dup_count = sum(1 for s in stashes if "aristotle-rollback:checkpoint-dup-name" in s)
        assert dup_count == 2

    # ------------------------------------------------------------------
    # 30. should_handle_guard_block_then_rollback_interaction
    # ------------------------------------------------------------------
    def test_should_handle_guard_block_then_rollback_interaction(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "guard.txt").write_text("safe")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "safe")

        create_rollback_point("guard-cp", run_id="")

        (tmp_repo / "guard.txt").write_text("unsafe")
        # Simulate: even if a commit guard blocked a commit, rollback should work
        result = rollback_to_checkpoint("guard-cp", run_id="")
        assert result["success"] is True
        assert (tmp_repo / "guard.txt").read_text() == "safe"

    # ------------------------------------------------------------------
    # 31. should_handle_externally_removed_stash
    # ------------------------------------------------------------------
    def test_should_handle_externally_removed_stash(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "ext.txt").write_text("data")
        create_rollback_point("ext-cp", run_id="")

        # Drop the stash externally
        _git(tmp_repo, "stash", "drop", "stash@{0}")

        # Now rollback should fail gracefully
        result = rollback_to_checkpoint("ext-cp", run_id="")
        assert result["success"] is False
        assert "error" in result

    # ------------------------------------------------------------------
    # 32. should_succeed_stash_apply_with_modified_working_directory
    # ------------------------------------------------------------------
    def test_should_succeed_stash_apply_with_modified_working_directory(
        self, tmp_repo: Path,
    ) -> None:
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_repo(tmp_repo)
        (tmp_repo / "tracked.txt").write_text("original")
        (tmp_repo / "other.txt").write_text("other")
        _git(tmp_repo, "add", ".")
        _git(tmp_repo, "commit", "-m", "initial")

        create_rollback_point("mod-workdir-cp", run_id="")

        # Modify a different (non-conflicting) file
        (tmp_repo / "other.txt").write_text("modified-other")

        result = rollback_to_checkpoint("mod-workdir-cp", run_id="")
        assert result["success"] is True

    # ------------------------------------------------------------------
    # 33. should_delete_all_stashes_when_keep_zero
    # ------------------------------------------------------------------
    def test_should_delete_all_stashes_when_keep_zero(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
        )

        _init_repo(tmp_repo)

        for i in range(4):
            (tmp_repo / f"k_{i}.txt").write_text(str(i))
            create_rollback_point(f"keep-zero-{i}", run_id="")

        assert _count_prefixed_stashes(tmp_repo) == 4

        result = cleanup_rollback_stashes(keep=0)
        assert result["success"] is True
        assert _count_prefixed_stashes(tmp_repo) == 0
