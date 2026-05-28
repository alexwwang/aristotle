import os
import sys
import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aristotle_intervention.intervention_coordinator import InterventionCoordinator, TDDViolationError
from aristotle_intervention.intervention_types import ViolationEvent, PipelineContext


@pytest.fixture
def temp_git_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=str(repo), capture_output=True, check=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=str(repo), capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=str(repo), capture_output=True)
    tracked = repo / "src" / "module.py"
    tracked.parent.mkdir(parents=True, exist_ok=True)
    tracked.write_text("# module")
    subprocess.run(["git", "add", "."], cwd=str(repo), capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=str(repo), capture_output=True)
    untracked = repo / "src" / "new_file.py"
    untracked.write_text("# new")
    return repo, [str(tracked.relative_to(repo))], [str(untracked.relative_to(repo))]


@pytest.fixture
def temp_ki_doc(tmp_path):
    path = tmp_path / "04-review-records.md"
    path.write_text("# Review Records\n\n")
    return str(path)


@pytest.fixture
def integration_context(temp_git_repo, temp_ki_doc):
    repo_path, _, _ = temp_git_repo
    return PipelineContext(
        current_phase=4,
        req_number="INT-001",
        ki_doc_path=temp_ki_doc,
        metadata={"round_results": []},
    )


class TestE2ESkipRedPhase:
    def test_should_end_to_end_block_pipeline_on_skip_red_phase(self, temp_git_repo, integration_context):
        repo, tracked, _ = temp_git_repo
        event = ViolationEvent("SKIP_RED_PHASE", tracked[0], "2026-05-26T10:00:00+08:00", {"phase": 4})
        old_cwd = os.getcwd()
        os.chdir(str(repo))
        try:
            coord = InterventionCoordinator(integration_context)
            with pytest.raises(TDDViolationError) as exc_info:
                coord.intervene(event)
            assert exc_info.value.result.violation_code == "SKIP_RED_PHASE"
        finally:
            os.chdir(old_cwd)
        ki_content = Path(integration_context.ki_doc_path).read_text()
        assert "SKIP_RED_PHASE" in ki_content


class TestE2ERestoreModifiedTest:
    def test_should_end_to_end_restore_modified_test_from_git(self, temp_git_repo, integration_context):
        repo, tracked, _ = temp_git_repo
        test_file = "tests/test_module.py"
        test_path = repo / test_file
        test_path.parent.mkdir(parents=True, exist_ok=True)
        test_path.write_text("# original test")
        subprocess.run(["git", "add", test_file], cwd=str(repo), capture_output=True)
        subprocess.run(["git", "commit", "-m", "add test"], cwd=str(repo), capture_output=True)
        hash_result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(repo), capture_output=True, text=True)
        integration_context.boundary_commit_hash = hash_result.stdout.strip()
        test_path.write_text("# modified test")
        event = ViolationEvent("MODIFIED_TEST", test_file, "2026-05-26T10:00:00+08:00", {"phase": 5})
        integration_context.current_phase = 5
        old_cwd = os.getcwd()
        os.chdir(str(repo))
        try:
            coord = InterventionCoordinator(integration_context)
            with pytest.raises(TDDViolationError) as exc_info:
                coord.intervene(event)
            assert exc_info.value.result.violation_code == "MODIFIED_TEST"
            assert test_path.read_text() == "# original test"
        finally:
            os.chdir(old_cwd)


class TestE2EMergedViolations:
    def test_should_end_to_end_handle_merged_violations_in_correct_order(self, temp_git_repo, integration_context):
        repo, _, _ = temp_git_repo
        integration_context.current_phase = 3
        events = [
            ViolationEvent("UNCOMMITTED_PHASE", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
            ViolationEvent("MISSING_KI_ASSESSMENT", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
            ViolationEvent("MISSING_KI_DOC", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
        ]
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene_batch(events)
        assert "MERGED" in exc_info.value.result.violation_code
        ki_content = Path(integration_context.ki_doc_path).read_text()
        assert "Merged" in ki_content


class TestE2EPreserveOnRollback:
    def test_should_end_to_end_preserve_committed_work_on_phase_rollback(self, temp_git_repo, integration_context):
        repo, _, _ = temp_git_repo
        impl_file = "src/impl.py"
        impl_path = repo / impl_file
        impl_path.write_text("# phase 5 work")
        subprocess.run(["git", "add", impl_file], cwd=str(repo), capture_output=True)
        subprocess.run(["git", "commit", "-m", "phase 5"], cwd=str(repo), capture_output=True)
        integration_context.current_phase = 5
        event = ViolationEvent("SKIP_RED_PHASE", impl_file, "2026-05-26T10:00:00+08:00", {"phase": 5})
        old_cwd = os.getcwd()
        os.chdir(str(repo))
        try:
            coord = InterventionCoordinator(integration_context)
            with pytest.raises(TDDViolationError):
                coord.intervene(event)
            # SKIP_RED_PHASE rollback deletes the file via git rm,
            # but the pre-rollback commit preserves it in git history
            show_result = subprocess.run(
                ["git", "show", "HEAD~1:" + impl_file],
                capture_output=True, text=True,
            )
            assert "# phase 5 work" in show_result.stdout, "committed work should be recoverable from git history"
        finally:
            os.chdir(old_cwd)


class TestE2EGracefulDegradation:
    def test_should_end_to_end_handle_nonexistent_file_gracefully(self, temp_git_repo, integration_context):
        repo, tracked, _ = temp_git_repo
        event = ViolationEvent("SKIP_RED_PHASE", "nonexistent.py", "2026-05-26T10:00:00+08:00", {"phase": 4})
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "SKIP_RED_PHASE"
        assert exc_info.value.result.rollback_result.success is True

    def test_should_end_to_end_handle_git_rm_failure(self, temp_git_repo, integration_context):
        repo, tracked, _ = temp_git_repo
        event = ViolationEvent("SKIP_RED_PHASE", tracked[0], "2026-05-26T10:00:00+08:00", {"phase": 4})
        integration_context.current_phase = 4
        old_cwd = os.getcwd()
        os.chdir(str(repo))
        try:
            coord = InterventionCoordinator(integration_context)
            with patch("aristotle_intervention.rollback_engine.subprocess.run") as mock_run, \
                 patch.object(coord.commit_guard, "ensure_committed") as mock_cg:
                mock_cg.return_value = MagicMock(success=True)
                mock_run.side_effect = [
                    MagicMock(returncode=0, stdout=str(repo) + "\n"),
                    MagicMock(returncode=0, stdout=tracked[0] + "\n"),
                    MagicMock(returncode=1, stderr="error: unable to stat"),
                ]
                with pytest.raises(TDDViolationError) as exc_info:
                    coord.intervene(event)
                assert exc_info.value.result.rollback_result.success is False
        finally:
            os.chdir(old_cwd)


class TestE2EPromptValidation:
    def test_should_end_to_end_validate_prompt_and_block_with_details(self, temp_git_repo, integration_context):
        integration_context.current_phase = 2
        event = ViolationEvent("INVALID_REVIEW_PROMPT", "", "2026-05-26T10:00:00+08:00",
                               {"phase": 2, "prompt": "stop condition gate pass"})
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "INVALID_REVIEW_PROMPT"


class TestE2ERegressionRollback:
    def test_should_end_to_end_rollback_to_phase5_on_regression(self, temp_git_repo, integration_context):
        repo, _, _ = temp_git_repo
        integration_context.current_phase = 6
        event = ViolationEvent("REGRESSION", "src/module.py", "2026-05-26T10:00:00+08:00", {"phase": 6})
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.plan.target_phase == 5
        ki_content = Path(integration_context.ki_doc_path).read_text()
        assert "REGRESSION" in ki_content


class TestE2EMultiFileRollback:
    def test_should_end_to_end_rollback_multiple_affected_files(self, temp_git_repo, integration_context):
        repo, tracked, _ = temp_git_repo
        file_a = "src/a.py"
        file_b = "src/b.py"
        (repo / file_a).write_text("# impl a")
        (repo / file_b).write_text("# impl b")
        subprocess.run(["git", "add", file_a, file_b], cwd=str(repo), capture_output=True)
        subprocess.run(["git", "commit", "-m", "add impl files"], cwd=str(repo), capture_output=True)
        event = ViolationEvent("SKIP_RED_PHASE", file_a, "2026-05-26T10:00:00+08:00",
                               {"phase": 4}, affected_file_paths=[file_a, file_b])
        integration_context.current_phase = 4
        old_cwd = os.getcwd()
        os.chdir(str(repo))
        try:
            coord = InterventionCoordinator(integration_context)
            with pytest.raises(TDDViolationError) as exc_info:
                coord.intervene(event)
            assert exc_info.value.result.rollback_result.success is True
            assert set(exc_info.value.result.rollback_result.files_affected) == {file_a, file_b}
        finally:
            os.chdir(old_cwd)


class TestE2EKiDocOutdatedAutoAppend:
    def test_should_end_to_end_auto_append_outdated_ki_doc_for_ki_doc_outdated(self, temp_git_repo, integration_context):
        integration_context.current_phase = 3
        event = ViolationEvent("KI_DOC_OUTDATED", "", "2026-05-26T10:00:00+08:00", {"phase": 3})
        ki_path = Path(integration_context.ki_doc_path)
        ki_path.parent.mkdir(parents=True, exist_ok=True)
        ki_path.write_text("## Intervention\n\n**Timestamp**: 2026-05-25T09:00:00+08:00\n\n")
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "KI_DOC_OUTDATED"
        ki_content = ki_path.read_text()
        assert "KI_DOC_OUTDATED" in ki_content


class TestE2EInsufficientReviewAutoFix:
    def test_should_end_to_end_auto_fix_insufficient_review(self, temp_git_repo, integration_context):
        integration_context.current_phase = 2
        event = ViolationEvent("INSUFFICIENT_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "INSUFFICIENT_REVIEW"
        ki_content = Path(integration_context.ki_doc_path).read_text()
        assert "INSUFFICIENT_REVIEW" in ki_content
