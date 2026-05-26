import pytest
import sys
from unittest.mock import patch, MagicMock, call

sys.path.insert(0, "/Users/alex/aristotle/auto-reflection-feature/src")

from aristotle_auto_reflection.commit_guard import CommitGuard
from aristotle_auto_reflection.intervention_types import PipelineContext, CommitResult


@pytest.fixture
def pipeline_context_factory():
    def _factory(current_phase=4, req_number="INT-001", loop_round=None):
        return PipelineContext(
            current_phase=current_phase,
            req_number=req_number,
            loop_round=loop_round,
            stage="phase_boundary",
        )
    return _factory


@pytest.fixture
def guard():
    return CommitGuard()


class TestCommitGuardSkipClean:
    def test_should_skip_commit_when_repo_clean(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=True):
            result = guard.ensure_committed(ctx)
        assert result.success is True
        assert "skip" in result.action


class TestCommitGuardDirtyCommit:
    def test_should_commit_when_repo_dirty(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="abc1234\n"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        assert result.action == "committed"
        assert result.hash == "abc1234"


class TestCommitGuardCommitFailure:
    def test_should_return_failure_when_git_commit_fails(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=1, stderr="index.lock exists"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is False
        assert "commit failed" in result.action


class TestCommitGuardMessageWithLoop:
    def test_should_include_loop_round_in_commit_message(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory(loop_round=3)
        msg = guard._build_message(ctx)
        assert "[Loop 3]" in msg
        assert "INT-001" in msg


class TestCommitGuardMessageWithoutLoop:
    def test_should_omit_loop_tag_when_no_loop_round(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory(loop_round=None)
        msg = guard._build_message(ctx)
        assert "[Loop" not in msg
        assert "INT-001" in msg


class TestCommitGuardReqNumber:
    def test_should_include_req_number_in_commit_message(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory(req_number="INT-042")
        msg = guard._build_message(ctx)
        assert msg.startswith("INT-042")


class TestCommitGuardPhaseCommit:
    def test_should_auto_commit_phase_completion_with_non_empty_diff(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=5)
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="deadbeef\n"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        calls = mock_run.call_args_list
        commit_call = calls[1]
        # commit_call[0][0] is the command list ["git","commit","-m","...PHASE-5-GREEN..."]
        # Must extract the message string (index 3) for substring containment
        commit_args = commit_call[0][0]
        msg = commit_args[3] if len(commit_args) > 3 else str(commit_args)
        assert "PHASE-5-GREEN" in msg


class TestCommitGuardLoopCommit:
    def test_should_auto_commit_loop_round_with_non_empty_diff(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=4, loop_round=2)
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="feedface\n"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        commit_args = mock_run.call_args_list[1][0][0]
        msg = commit_args[3] if len(commit_args) > 3 else str(commit_args)
        assert "[Loop 2]" in msg


class TestCommitGuardIsCleanStaged:
    def test_should_detect_staged_changes_as_dirty(self, guard):
        with patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=0), MagicMock(returncode=1)]
            result = guard._is_clean()
        assert result is False


class TestCommitGuardIsCleanUnstaged:
    def test_should_detect_unstaged_changes_as_dirty(self, guard):
        with patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=1), MagicMock(returncode=0)]
            result = guard._is_clean()
        assert result is False


class TestCommitGuardBoundaryCommit:
    def test_should_auto_commit_all_uncommitted_at_boundary(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="baddcafe\n"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        add_call = mock_run.call_args_list[0]
        assert "add" in str(add_call)


class TestCommitGuardIndexLocked:
    def test_should_handle_git_index_locked_gracefully(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("aristotle_auto_reflection.commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=1, stderr="fatal: Unable to create index.lock"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is False
