import os
import sys
import pytest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aristotle_auto_reflection.intervention_coordinator import InterventionCoordinator, TDDViolationError
from aristotle_auto_reflection.intervention_types import ViolationEvent, PipelineContext


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
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "SKIP_RED_PHASE"
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
        event = ViolationEvent("MODIFIED_TEST", test_file, "2026-05-26T10:00:00+08:00", {"phase": 5})
        integration_context.current_phase = 5
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "MODIFIED_TEST"


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
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError):
            coord.intervene(event)


class TestE2ERollbackFailure:
    def test_should_end_to_end_handle_rollback_failure_gracefully(self, temp_git_repo, integration_context):
        repo, tracked, _ = temp_git_repo
        event = ViolationEvent("SKIP_RED_PHASE", "nonexistent.py", "2026-05-26T10:00:00+08:00", {"phase": 4})
        coord = InterventionCoordinator(integration_context)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "SKIP_RED_PHASE"


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
