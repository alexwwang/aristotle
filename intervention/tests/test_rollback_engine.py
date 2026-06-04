import os
import sys
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from rollback_engine import RollbackEngine
from intervention_types import (
    ViolationEvent, InterventionPlan, RollbackResult, PipelineContext,
)


@pytest.fixture
def rollback_engine():
    return RollbackEngine()


@pytest.fixture
def pipeline_context_factory():
    def _factory(current_phase=4, req_number="INT-001", boundary_commit_hash="abc1234",
                 phase5_test_results=None, metadata=None):
        return PipelineContext(
            current_phase=current_phase,
            req_number=req_number,
            boundary_commit_hash=boundary_commit_hash,
            phase5_test_results=phase5_test_results,
            metadata=metadata or {"round_results": []},
        )
    return _factory


def _v4_event(filepath="src/module.py"):
    return ViolationEvent("SKIP_RED_PHASE", filepath, "2026-05-26T10:00:00+08:00", {"phase": 4})


def _v5_event(filepath="tests/test_module.py"):
    return ViolationEvent("MODIFIED_TEST", filepath, "2026-05-26T10:00:00+08:00", {"phase": 5})


def _v1_event():
    return ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})


class TestRollbackDeleteTracked:
    def test_should_delete_tracked_implementation_file_via_git_rm(self, rollback_engine, pipeline_context_factory):
        event = _v4_event()
        plan = InterventionPlan(4, True, True, True, "Write failing test")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "deleted" in result.action.lower() or "git rm" in result.action.lower()


class TestRollbackDeleteUntracked:
    def test_should_delete_untracked_implementation_file_via_os_remove(self, rollback_engine, pipeline_context_factory):
        event = _v4_event()
        plan = InterventionPlan(4, True, True, True, "Write failing test")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=False), \
             patch("rollback_engine.os.path.exists", return_value=True), \
             patch("rollback_engine.os.remove") as mock_remove:
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        mock_remove.assert_called_once_with("src/module.py")


class TestRollbackDeletePathValidationFail:
    def test_should_fail_delete_when_path_validation_fails(self, rollback_engine, pipeline_context_factory):
        event = _v4_event("../etc/passwd")
        plan = InterventionPlan(4, True, True, True, "Write failing test")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=False):
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False


class TestRollbackRestoreFromBoundary:
    def test_should_restore_test_from_boundary_commit_hash(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore test")
        ctx = pipeline_context_factory(boundary_commit_hash="deadbeef")
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="deadbeef\n"),
            ]
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True


class TestRollbackRestoreFallbackHead:
    def test_should_fallback_to_head_when_boundary_commit_hash_none(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore test")
        ctx = pipeline_context_factory(boundary_commit_hash=None)
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="abc1234\n"),
            ]
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        checkout_call = mock_run.call_args_list[0]
        assert "HEAD" in str(checkout_call)

    def test_should_fallback_to_head_when_boundary_commit_hash_non_hex(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore test")
        ctx = pipeline_context_factory(boundary_commit_hash="invalid!ref;rm -rf /")
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout="abc1234\n"),
            ]
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        checkout_call = mock_run.call_args_list[0]
        assert "HEAD" in str(checkout_call)
        assert "invalid" not in str(checkout_call)


class TestRollbackRestoreUntracked:
    def test_should_skip_restore_for_untracked_test_file(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore test")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=False):
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False
        assert "untracked" in result.action.lower()


class TestRollbackRestoreCheckoutFail:
    def test_should_fail_restore_when_git_checkout_fails(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore test")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="checkout failed")
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False


class TestRollbackDispatchV4:
    def test_should_dispatch_to_delete_implementation_for_v4(self, rollback_engine, pipeline_context_factory):
        event = _v4_event()
        plan = InterventionPlan(4, True, True, True, "Delete impl")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "_delete_implementation") as mock_del:
            mock_del.return_value = RollbackResult(True, "deleted", ["src/module.py"])
            result = rollback_engine.rollback(event, plan, ctx)
        mock_del.assert_called_once_with(event, ctx)


class TestRollbackDispatchV5:
    def test_should_dispatch_to_restore_test_for_v5(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore test")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "_restore_test") as mock_restore:
            mock_restore.return_value = RollbackResult(True, "restored", ["tests/test_module.py"])
            result = rollback_engine.rollback(event, plan, ctx)
        mock_restore.assert_called_once_with(event, ctx)


class TestRollbackNoop:
    def test_should_return_noop_for_non_rollback_violation(self, rollback_engine, pipeline_context_factory):
        event = _v1_event()
        plan = InterventionPlan(2, False, False, False, "Execute review")
        ctx = pipeline_context_factory()
        result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "no-op" in result.action.lower()


class TestRollbackNoopRegression:
    def test_should_return_noop_for_regression_violation(self, rollback_engine, pipeline_context_factory):
        """REGRESSION (V-7) has needs_rollback=False, rollback engine returns no-op."""
        event = ViolationEvent("REGRESSION", "src/module.py", "2026-05-26T10:00:00+08:00", {"phase": 6})
        plan = InterventionPlan(5, False, False, False, "Regression detected")
        ctx = pipeline_context_factory()
        result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "no-op" in result.action.lower()


class TestPathTraversal:
    def test_should_reject_path_traversal_attempt(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="/repo\n")
            result = rollback_engine.validate_path("../etc/passwd")
        assert result is False


class TestPathAbsoluteOutside:
    def test_should_reject_absolute_path_outside_repo(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="/repo\n")
            result = rollback_engine.validate_path("/etc/passwd")
        assert result is False


class TestPathGitUnavailable:
    def test_should_return_false_when_git_unavailable_for_path_validation(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1)
            result = rollback_engine.validate_path("src/module.py")
        assert result is False


class TestPathLeadingDash:
    def test_should_reject_path_starting_with_dash(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="/repo\n")
            result = rollback_engine.validate_path("-rf /")
        assert result is False


class TestIsTrackedTrue:
    def test_should_return_true_for_tracked_file(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="src/module.py\n")
            result = rollback_engine._is_tracked("src/module.py")
        assert result is True


class TestIsTrackedFalse:
    def test_should_return_false_for_untracked_file(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="")
            result = rollback_engine._is_tracked("src/new_file.py")
        assert result is False


class TestIsTrackedGitFail:
    def test_should_return_false_when_git_ls_files_fails(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1)
            result = rollback_engine._is_tracked("src/module.py")
        assert result is False


class TestGitRmFails:
    def test_should_return_failure_result_when_git_rm_fails(self, rollback_engine, pipeline_context_factory):
        event = _v4_event()
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="rm failed")
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False


class TestGitCheckoutFails:
    def test_should_return_failure_result_when_git_checkout_fails(self, rollback_engine, pipeline_context_factory):
        event = _v5_event()
        plan = InterventionPlan(5, True, True, True, "Restore")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="checkout failed")
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False


class TestGitUnavailable:
    def test_should_return_failure_when_git_unavailable(self, rollback_engine, pipeline_context_factory):
        event = _v4_event()
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=False):
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False


class TestSingleFileFailure:
    def test_should_return_failure_when_git_rm_fails_on_single_file(self, rollback_engine, pipeline_context_factory):
        event = _v4_event("src/module.py")
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="permission denied")
            result = rollback_engine.rollback(event, plan, ctx)
        assert isinstance(result, RollbackResult)
        assert result.success is False


class TestFileAlreadyDeleted:
    def test_should_succeed_when_file_already_deleted(self, rollback_engine, pipeline_context_factory):
        event = _v4_event("src/deleted.py")
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=False), \
             patch("rollback_engine.os.path.exists", return_value=False):
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "no action needed" in result.action


class TestPathValidationRejectLog:
    def test_should_reject_and_log_on_path_validation_failure(self, rollback_engine):
        with patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="/repo\n")
            result = rollback_engine.validate_path("../../etc/shadow")
        assert result is False


class TestPartialRollbackFailure:
    """Test plan row 74: Some files succeed, some fail → partial_failure=True."""

    def test_should_set_partial_failure_flag_on_partial_rollback(self, rollback_engine, pipeline_context_factory):
        """Multiple files via affected_file_paths: first succeeds, second fails → partial_failure=True."""
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/a.py",
            timestamp="2026-05-26T00:00:00+08:00",
            context={},
            affected_file_paths=["src/a.py", "src/b.py"],
        )
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=1, stderr="permission denied"),
            ]
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.partial_failure is True
        assert "src/b.py" in result.failed_files
        assert "src/a.py" not in result.failed_files


class TestMultiFileMixedTracked:
    def test_should_use_git_rm_for_tracked_and_os_remove_for_untracked(self, rollback_engine, pipeline_context_factory):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/a.py",
            timestamp="2026-05-26T00:00:00+08:00",
            context={},
            affected_file_paths=["src/tracked.py", "src/untracked.py"],
        )
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", side_effect=[True, False]), \
             patch("rollback_engine.os.path.exists", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run, \
             patch("rollback_engine.os.remove") as mock_remove:
            mock_run.return_value = MagicMock(returncode=0)
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "src/tracked.py" in result.files_affected
        assert "src/untracked.py" in result.files_affected
        mock_remove.assert_called_once_with("src/untracked.py")


class TestMultiFileAllFail:
    def test_should_return_failure_when_all_files_fail_rollback(self, rollback_engine, pipeline_context_factory):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/a.py",
            timestamp="2026-05-26T00:00:00+08:00",
            context={},
            affected_file_paths=["src/a.py", "src/b.py"],
        )
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=False):
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is False
        assert "all files failed" in result.action


class TestFallbackToSingularField:
    """Test plan row 79: When affected_file_paths is empty, fallback to affected_file_path."""

    def test_should_fallback_to_single_file_when_affected_file_paths_empty(self, rollback_engine, pipeline_context_factory):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/module.py",
            timestamp="2026-05-26T10:00:00+08:00",
            context={"phase": 4},
            affected_file_paths=[],
        )
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "src/module.py" in result.files_affected


class TestFallbackDefaultField:
    def test_should_use_singular_field_when_affected_file_paths_not_provided(self, rollback_engine, pipeline_context_factory):
        event = ViolationEvent("SKIP_RED_PHASE", "src/module.py", "2026-05-26T10:00:00+08:00", {})
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "src/module.py" in result.files_affected


class TestDualFieldPrecedence:
    """Test plan row 79b: Plural affected_file_paths takes precedence over singular."""

    def test_should_prefer_affected_file_paths_over_singular_when_both_present(self, rollback_engine, pipeline_context_factory):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="c.py",
            timestamp="2026-05-26T10:00:00+08:00",
            context={},
            affected_file_paths=["a.py", "b.py"],
        )
        plan = InterventionPlan(4, True, True, True, "Delete")
        ctx = pipeline_context_factory()
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
        assert "a.py" in result.files_affected
        assert "b.py" in result.files_affected
        assert "c.py" not in result.files_affected


class TestRollbackDispatchFromPhase5:
    def test_should_dispatch_rollback_for_v4_from_phase5_context(self, rollback_engine, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=5)
        event = _v4_event()
        plan = InterventionPlan(4, True, True, True, "Rollback to Phase 4")
        with patch.object(rollback_engine, "validate_path", return_value=True), \
             patch.object(rollback_engine, "_is_tracked", return_value=True), \
             patch("rollback_engine.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = rollback_engine.rollback(event, plan, ctx)
        assert result.success is True
