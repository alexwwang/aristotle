"""Compliance CommitGuard tests — TDD Phase 4 Red."""
import pytest
import subprocess
from datetime import datetime
from pathlib import Path

from compliance import (
    CommitGuard,
    CommitResult,
)


@pytest.fixture
def repo_root(tmp_path):
    git_dir = tmp_path / "test_repo"
    git_dir.mkdir()
    subprocess.run(["git", "init"], cwd=git_dir, check=True, capture_output=True)
    ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
    subprocess.run(["git", "config", "user.email", f"test-{ts}@example.com"], cwd=git_dir, check=True)
    subprocess.run(["git", "config", "user.name", f"Test User {ts}"], cwd=git_dir, check=True)
    return str(git_dir)


@pytest.fixture
def guard(repo_root):
    return CommitGuard(project_root=repo_root)


def _make_dirty_tree(repo_root):
    (Path(repo_root) / "new_file.py").write_text("# dirty")


# C-01
def test_ensure_committed_stages_and_commits_dirty_tree(repo_root, guard):
    _make_dirty_tree(repo_root)
    result = guard.ensure_committed(phase=4, run_id="INT-abc123")
    assert result == CommitResult(success=True, committed=True)


# C-02
def test_ensure_committed_skips_when_tree_clean(repo_root, guard):
    # Make initial commit so tree is clean
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_root, check=True, capture_output=True)
    result = guard.ensure_committed(phase=4, run_id="INT-abc123")
    assert result == CommitResult(success=True, committed=False, reason="clean_tree")


# C-03
def test_ensure_committed_handles_precommit_hook_rejection(repo_root, guard):
    _make_dirty_tree(repo_root)
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True, capture_output=True)
    # Install rejecting pre-commit hook
    hooks_dir = Path(repo_root) / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    (hooks_dir / "pre-commit").write_text("#!/bin/sh\nexit 1\n")
    (hooks_dir / "pre-commit").chmod(0o755)
    result = guard.ensure_committed(phase=4, run_id="INT-abc123")
    assert result.success is False
    assert result.committed is False
    assert guard._commit_failures.get("INT-abc123:4", 0) >= 1


# C-04
def test_ensure_committed_handles_git_add_failure(guard):
    result = guard.ensure_committed(phase=4, run_id="INT-abc123")
    assert result == CommitResult(success=False, committed=False)


# C-05
def test_failure_counter_resets_on_clean_tree(repo_root, guard):
    guard._commit_failures["INT-abc123:4"] = 2
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_root, check=True, capture_output=True)
    result = guard.ensure_committed(phase=4, run_id="INT-abc123")
    assert isinstance(result, CommitResult)
    assert result.success is True
    assert guard._commit_failures.get("INT-abc123:4", 0) == 0


# C-07
def test_ensure_committed_commits_review_findings(repo_root, guard):
    _make_dirty_tree(repo_root)
    result = guard.ensure_committed(review_round=2, run_id="INT-abc123")
    assert result.success is True


# C-08
def test_ensure_committed_commits_zero_issue_finding(repo_root, guard):
    result = guard.ensure_committed(review_round=1, run_id="INT-abc123")
    assert result.committed is True


# C-32
def test_build_message_formats_phase_commit_message(guard):
    msg = guard._build_message(phase=4, run_id="INT-abc123")
    assert msg == "INT-abc123: PHASE-4 auto-commit"


# C-33
def test_build_message_formats_review_commit_message(guard):
    msg = guard._build_message(run_id="INT-abc123", review_round=2)
    assert msg == "INT-abc123: REVIEW-R2 auto-commit"


# C-34
def test_build_message_fallback_to_legacy_format(guard):
    msg = guard._build_message(phase=4, run_id="")
    assert msg == "PHASE-4 auto-commit"


# C-46
def test_review_auto_commit_failure_increments_counter_toward_blocked(repo_root, guard):
    _make_dirty_tree(repo_root)
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True, capture_output=True)
    hooks_dir = Path(repo_root) / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    (hooks_dir / "pre-commit").write_text("#!/bin/sh\nexit 1\n")
    (hooks_dir / "pre-commit").chmod(0o755)
    result = guard.ensure_committed(review_round=2, run_id="INT-abc123", phase=4)
    assert guard._commit_failures.get("INT-abc123:4", 0) >= 1
    assert result.success is False
