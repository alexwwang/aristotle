import pytest
from unittest.mock import patch, MagicMock


from commit_guard import CommitGuard
from intervention_types import PipelineContext, CommitResult


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
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
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
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=1, stderr="index.lock exists"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is False
        assert "commit failed" in result.action


class TestCommitGuardRevParseFailure:
    def test_should_return_success_with_empty_hash_when_rev_parse_fails(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0),
                MagicMock(returncode=1, stdout="", stderr="unknown revision"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        assert result.hash == ""
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
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="deadbeef\n"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        calls = mock_run.call_args_list
        commit_call = calls[1]
        commit_args = commit_call[0][0]
        assert any("PHASE-5-GREEN" in str(arg) for arg in commit_args)


class TestCommitGuardLoopCommit:
    def test_should_auto_commit_loop_round_with_non_empty_diff(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=4, loop_round=2)
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="feedface\n"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is True
        commit_args = mock_run.call_args_list[1][0][0]
        assert any("[Loop 2]" in str(arg) for arg in commit_args)


class TestCommitGuardIsCleanStaged:
    def test_should_detect_staged_changes_as_dirty(self, guard):
        with patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=0), MagicMock(returncode=1)]
            result = guard._is_clean()
        assert result is False
        # Verify call order: first git diff --quiet, then git diff --cached --quiet
        calls = mock_run.call_args_list
        assert calls[0][0][0] == ["git", "diff", "--quiet"]
        assert calls[1][0][0] == ["git", "diff", "--cached", "--quiet"]


class TestCommitGuardIsCleanUnstaged:
    def test_should_detect_unstaged_changes_as_dirty(self, guard):
        with patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=1), MagicMock(returncode=0)]
            result = guard._is_clean()
        assert result is False
        # Verify call order: first git diff --quiet, then git diff --cached --quiet
        calls = mock_run.call_args_list
        assert calls[0][0][0] == ["git", "diff", "--quiet"]
        assert calls[1][0][0] == ["git", "diff", "--cached", "--quiet"]


class TestCommitGuardIsCleanBothDirty:
    def test_should_return_false_when_both_staged_and_unstaged_changes(self, guard):
        with patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=1), MagicMock(returncode=1)]
            result = guard._is_clean()
        assert result is False


class TestCommitGuardIsCleanTrue:
    def test_should_return_true_when_both_diffs_clean(self, guard):
        with patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=0), MagicMock(returncode=0)]
            result = guard._is_clean()
        assert result is True


class TestCommitGuardIsCleanGitFailure:
    def test_should_return_false_when_git_command_fails(self, guard):
        with patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [MagicMock(returncode=128), MagicMock(returncode=0)]
            result = guard._is_clean()
        assert result is False


class TestCommitGuardIsCleanSubprocessException:
    def test_should_propagate_exception_when_git_not_found(self, guard):
        with patch("commit_guard.subprocess.run", side_effect=FileNotFoundError("git not found")):
            with pytest.raises(FileNotFoundError):
                guard._is_clean()


class TestCommitGuardBoundaryCommit:
    def test_should_auto_commit_all_uncommitted_at_boundary(self, guard, pipeline_context_factory):
        ctx = pipeline_context_factory()
        with patch.object(guard, "_is_clean", return_value=False), \
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
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
             patch("commit_guard.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=1, stderr="fatal: Unable to create index.lock"),
            ]
            result = guard.ensure_committed(ctx)
        assert result.success is False
