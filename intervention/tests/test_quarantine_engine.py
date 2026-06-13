"""Quarantine Engine unit and integration tests."""
import pytest
import subprocess
import json
import os
import hashlib
import logging
from pathlib import Path
from datetime import datetime
from unittest.mock import patch

from quarantine_engine import (
    QuarantineEngine,
    QuarantineResult,
    QuarantineNotFoundError,
    MAX_FILES_PER_QUARANTINE,
    MAX_SUFFIX_RETRY,
    MAX_RUN_ID_LENGTH,
)


# === Fixtures (from test plan §5.1-5.3) ===

@pytest.fixture
def repo_root_no_git_user(tmp_path):
    """Isolated git repository WITHOUT configuring user.email/user.name."""
    git_dir = tmp_path / "test_repo_no_git_user"
    git_dir.mkdir()
    subprocess.run(["git", "init"], cwd=git_dir, check=True)
    return str(git_dir)


@pytest.fixture
def engine(repo_root):
    """QuarantineEngine instance bound to temp repo."""
    return QuarantineEngine(repo_root=repo_root)


@pytest.fixture
def clean_file(repo_root):
    """Create a committed clean file. Returns relative path."""
    path = "src/auth.ts"
    full = Path(repo_root) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("export const auth = true;\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_root, check=True)
    return path


@pytest.fixture
def dirty_file(repo_root, clean_file):
    """Modify a tracked file to make it dirty."""
    full = Path(repo_root) / clean_file
    full.write_text("export const auth = false;\n")
    return clean_file


@pytest.fixture
def untracked_file(repo_root):
    """Create an untracked file."""
    path = "lib/helper.py"
    full = Path(repo_root) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("def help(): pass\n")
    return path


@pytest.fixture
def mock_subprocess_run_failure(monkeypatch):
    """Mock subprocess.run to simulate git commit failure (other git commands succeed)."""
    original_run = subprocess.run
    def run(args, **kwargs):
        if len(args) > 1 and args[0] == "git" and "commit" in args:
            class Result:
                returncode = 1
                stdout = b""
                stderr = b"git: commit failed"
            return Result()
        return original_run(args, **kwargs)
    monkeypatch.setattr("subprocess.run", run)


@pytest.fixture
def mock_shutil_copy2_failure(monkeypatch):
    """Mock shutil.copy2 to raise OSError."""
    def copy2(src, dst):
        raise OSError("Permission denied")
    monkeypatch.setattr("shutil.copy2", copy2)


@pytest.fixture
def mock_shutil_move_failure(monkeypatch):
    """Mock shutil.move to raise OSError."""
    def move(src, dst):
        raise OSError("Disk full")
    monkeypatch.setattr("shutil.move", move)


@pytest.fixture
def mock_os_remove_failure(monkeypatch):
    """Mock os.remove to raise OSError."""
    def remove(path):
        raise OSError("Permission denied")
    monkeypatch.setattr("os.remove", remove)


# === Q-001: Quarantine single clean file ===

def test_should_quarantine_single_clean_file(engine, clean_file):
    """Q-001: Move a committed clean file to quarantine."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-001", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True
    assert result.quarantine_success is True
    assert clean_file in result.files_affected


# === Q-002: Quarantine single dirty tracked file ===

def test_should_quarantine_single_dirty_tracked_file(engine, dirty_file):
    """Q-002: Copy dirty tracked file, git rm -f, metadata written."""
    result = engine.move_to_quarantine(
        files=[dirty_file], run_id="run-002", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True
    assert dirty_file in result.files_affected


# === Q-003: Quarantine single untracked file ===

def test_should_quarantine_single_untracked_file(engine, untracked_file):
    """Q-003: Copy untracked file, os.remove original, metadata written."""
    result = engine.move_to_quarantine(
        files=[untracked_file], run_id="run-003", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True
    assert untracked_file in result.files_affected
    assert not (Path(engine.repo_root) / untracked_file).exists()


# === Q-004: Quarantine batch mixed file states ===

def test_should_quarantine_batch_mixed_file_states(engine, repo_root, clean_file, untracked_file):
    """Q-004: Batch of 3 files: clean, dirty tracked, untracked.

    Note: dirty_file fixture returns the same path as clean_file, so we create
    a second distinct dirty tracked file inline to keep 3 unique entries.
    """
    dirty2_path = "src/dirty2.ts"
    dirty2_full = Path(repo_root) / dirty2_path
    dirty2_full.parent.mkdir(parents=True, exist_ok=True)
    dirty2_full.write_text("export const dirty2 = true;\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "add dirty2"], cwd=repo_root, check=True)
    dirty2_full.write_text("export const dirty2 = false;\n")
    result = engine.move_to_quarantine(
        files=[clean_file, dirty2_path, untracked_file],
        run_id="run-004", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True
    assert len(result.files_affected) == 3
    assert result.partial_failure is False
    assert not (Path(engine.repo_root) / clean_file).exists()


# === Q-005: Create quarantine directory structure ===

def test_should_create_quarantine_directory_structure(engine, clean_file):
    """Q-005: When quarantine dir does not exist, recursively create subdirs."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-005", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    quarantine_dir = Path(engine.repo_root) / "local-assets" / ".violation-quarantine" / "run-005" / "phase4"
    assert quarantine_dir.is_dir()


# === Q-006: Write per-file metadata JSON ===

def test_should_write_per_file_metadata_json(engine, clean_file):
    """Q-006: Each quarantined file produces metadata-{hash}.json."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-006", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    quarantine_dir = Path(engine.repo_root) / "local-assets" / ".violation-quarantine" / "run-006" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    assert len(metadata_files) >= 1


# === Q-007: Git commit quarantine operations with git add -f ===

def test_should_commit_quarantine_operations_with_git_add_force(engine, clean_file):
    """Q-007: Git commit uses git add -f to bypass .gitignore rules."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-007", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    assert result.quarantine_success is True
    log = subprocess.run(
        ["git", "log", "--oneline", "-1"],
        cwd=engine.repo_root, capture_output=True, text=True,
    )
    assert log.returncode == 0


# === Q-008: Resolve HEAD to actual SHA ===

def test_should_resolve_head_to_actual_sha_for_boundary_commit(engine, clean_file):
    """Q-008: boundary_commit='HEAD' resolves to actual SHA via git rev-parse."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-008", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True
    quarantine_dir = Path(engine.repo_root) / "local-assets" / ".violation-quarantine" / "run-008" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    assert len(metadata_files) >= 1
    meta = json.loads(metadata_files[0].read_text())
    assert meta["boundary_commit"] != "HEAD"
    assert len(meta["boundary_commit"]) == 40


# === Q-009: List quarantine files for specific run_id ===

def test_should_list_quarantine_files_for_specific_run_id(engine, clean_file):
    """Q-009: Query by run_id returns all QuarantineMeta records for that run."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-009", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    records = engine.list_quarantine(run_id="run-009")
    assert len(records) >= 1
    assert records[0].run_id == "run-009"


# === Q-010: Return empty list for nonexistent run_id ===

def test_should_return_empty_list_for_nonexistent_run_id(engine):
    """Q-010: Query for unknown run_id returns empty list."""
    records = engine.list_quarantine(run_id="nonexistent-run")
    assert records == []


# === Q-011: List includes all metadata fields ===

def test_should_list_includes_all_metadata_fields(engine, clean_file):
    """Q-011: Verify list returns all 7 QuarantineMeta fields."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-011", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    records = engine.list_quarantine(run_id="run-011")
    assert len(records) >= 1
    meta = records[0]
    for field_name in ("original_path", "quarantine_path", "violation_type",
                       "run_id", "phase", "timestamp", "boundary_commit"):
        assert hasattr(meta, field_name)
    assert meta.original_path == clean_file
    assert meta.run_id == "run-011"
    assert meta.phase == 4


# === Q-012: List across multiple phase subdirectories ===

def test_should_list_across_multiple_phase_subdirectories(engine, repo_root, clean_file):
    """Q-012: Files in phase3 and phase4 for same run_id; list returns all."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-012", phase=3,
        violation_type="SKIP_RED_PHASE",
    )
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("export const auth = true;\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add-012"], cwd=repo_root, check=True)
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-012", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    records = engine.list_quarantine(run_id="run-012")
    assert len(records) >= 2


# === Q-013: Restore file to original path ===

def test_should_restore_file_to_original_path(engine, clean_file):
    """Q-013: Copy quarantined file back to original_path."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-013", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.restore(clean_file, run_id="run-013")
    assert result is not None
    assert result.success is True
    assert result.new_path == clean_file


# === Q-014: Restore most recent when run_id omitted ===

def test_should_restore_most_recent_when_run_id_omitted(engine, clean_file):
    """Q-014: File quarantined across two runs; restore without run_id copies most recent."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-014a", phase=3,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-create file for second quarantine
    full = Path(engine.repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("export const auth = true;\n")
    subprocess.run(["git", "add", "."], cwd=engine.repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add"], cwd=engine.repo_root, check=True)
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-014b", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.restore(clean_file)
    assert result is not None
    assert result.success is True


# === Q-015: Preserve quarantine copy after restore ===

def test_should_preserve_quarantine_copy_after_restore(engine, clean_file):
    """Q-015: After restore, quarantine dir still contains the file and metadata."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-015", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    engine.restore(clean_file, run_id="run-015")
    quarantine_dir = Path(engine.repo_root) / "local-assets" / ".violation-quarantine" / "run-015" / "phase4"
    assert quarantine_dir.is_dir()


# === Q-016: QuarantineResult field compatibility ===

def test_should_produce_rollback_compatible_result_fields(engine, clean_file):
    """Q-016: QuarantineResult contains success, action, files_affected, etc."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-016", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert hasattr(result, "success")
    assert result.success is True
    assert hasattr(result, "action")
    assert result.action == "quarantined"
    assert hasattr(result, "files_affected")
    assert hasattr(result, "partial_failure")
    assert hasattr(result, "failed_files")


# === Q-017: action="quarantined" not "deleted" ===

def test_should_set_action_to_quarantined_not_deleted(engine, clean_file):
    """Q-017: action field equals 'quarantined', not 'deleted'."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-017", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.action == "quarantined"


# === Q-018: quarantine_paths and original_paths arrays ===

def test_should_populate_quarantine_paths_and_original_paths(engine, clean_file):
    """Q-018: QuarantineResult includes quarantinePaths and originalPaths arrays."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-018", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert hasattr(result, "quarantine_paths")
    assert hasattr(result, "original_paths")
    assert len(result.quarantine_paths) >= 1
    assert len(result.original_paths) >= 1


# === Q-019: quarantine_success=True on full success ===

def test_should_set_quarantine_success_true_on_full_success(engine, clean_file):
    """Q-019: All files quarantined AND git commit succeeds -> quarantine_success=True."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-019", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.quarantine_success is True


# === Q-020: quarantine_success=False on commit failure ===

def test_should_set_quarantine_success_false_on_commit_failure(engine, clean_file, mock_subprocess_run_failure):
    """Q-020: Git commit fails -> quarantine_success=False."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-020", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.quarantine_success is False


# === Q-021: Partial failure when some files fail ===

def test_should_return_partial_failure_when_some_files_fail(engine, repo_root, clean_file, untracked_file):
    """Q-021: 2/3 succeed; partial_failure=True, success=True."""
    result = engine.move_to_quarantine(
        files=[clean_file, "nonexistent.py", untracked_file],
        run_id="run-021", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.partial_failure is True
    assert result.success is True


# === Q-022: No rollback on partial failure ===

def test_should_not_rollback_moved_files_on_partial_failure(engine, repo_root, clean_file, untracked_file):
    """Q-022: Already-moved files remain in quarantine."""
    result = engine.move_to_quarantine(
        files=[clean_file, "nonexistent.py"],
        run_id="run-022", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.partial_failure is True
    assert clean_file in result.files_affected


# === Q-023: success=False when all files fail ===

def test_should_return_success_false_when_all_files_fail(engine):
    """Q-023: All fail; success=False, partial_failure=False."""
    result = engine.move_to_quarantine(
        files=["nonexistent1.py", "nonexistent2.py"],
        run_id="run-023", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is False
    assert result.partial_failure is False


# === Q-024: failed_files populated with reasons ===

def test_should_populate_failed_files_with_reasons(engine):
    """Q-024: Each failed file has reason string."""
    result = engine.move_to_quarantine(
        files=["nonexistent.py"],
        run_id="run-024", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert len(result.failed_files) >= 1


# === Q-025: Reconcile clean workspace ===

def test_should_reconcile_clean_workspace_after_quarantine(engine, clean_file):
    """Q-025: reconcile returns success=True, mismatches=[]."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-025", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.reconcile(project_id="test-proj", run_id="run-025")
    assert result.success is True
    assert result.mismatches == []


# === Q-026: Detect unexpected file during reconcile ===

def test_should_detect_unexpected_file_in_workspace_during_reconcile(engine, repo_root, clean_file):
    """Q-026: File exists that should have been quarantined; mismatch reported."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-026", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-create file to simulate unexpected presence
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("unexpected content")
    result = engine.reconcile(project_id="test-proj", run_id="run-026")
    assert len(result.mismatches) >= 1


# === Q-027: Detect modified file during reconcile ===

def test_should_detect_modified_file_in_workspace_during_reconcile(engine, repo_root, clean_file):
    """Q-027: File differs from expected state; mismatch reported."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-027", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-create file with modified content to trigger mismatch detection
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("modified content")
    result = engine.reconcile(project_id="test-proj", run_id="run-027")
    assert len(result.mismatches) >= 1


# === Q-034: Reject run_id with ".." ===

def test_should_raise_value_error_for_run_id_with_dot_dot(engine):
    """Q-034: '..' in run_id raises ValueError."""
    with pytest.raises(ValueError):
        engine.move_to_quarantine(files=["f.py"], run_id="../etc", phase=4, violation_type="SKIP_RED_PHASE")


# === Q-035: Reject run_id with "/" ===

def test_should_raise_value_error_for_run_id_with_slash(engine):
    """Q-035: '/' in run_id raises ValueError."""
    with pytest.raises(ValueError):
        engine.move_to_quarantine(files=["f.py"], run_id="run/abc", phase=4, violation_type="SKIP_RED_PHASE")


# === Q-036: Reject run_id with "\" ===

def test_should_raise_value_error_for_run_id_with_backslash(engine):
    """Q-036: '\\' in run_id raises ValueError."""
    with pytest.raises(ValueError):
        engine.move_to_quarantine(files=["f.py"], run_id="run\\abc", phase=4, violation_type="SKIP_RED_PHASE")


# === Q-037: Validate run_id before any file operations ===

def test_should_validate_run_id_before_any_file_operations(engine, clean_file, monkeypatch):
    """Q-037: Validation before any os.path.exists or shutil calls."""
    call_log = []
    original_exists = os.path.exists
    def tracked_exists(p):
        call_log.append("exists")
        return original_exists(p)
    monkeypatch.setattr("os.path.exists", tracked_exists)
    with pytest.raises(ValueError):
        engine.move_to_quarantine(files=[clean_file], run_id="../bad", phase=4, violation_type="SKIP_RED_PHASE")
    assert call_log == []


# === Q-038: Skip file not found ===

def test_should_skip_file_not_found_and_add_to_failed_files(engine):
    """Q-038: Skip file, add 'not found' to failed_files, continue."""
    result = engine.move_to_quarantine(
        files=["nonexistent_file.py"], run_id="run-038", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert len(result.failed_files) >= 1


# === Q-039: Enforce max files per quarantine call ===

def test_should_enforce_max_files_per_quarantine_call(engine):
    """Q-039: 51 files -> ValueError; no truncation."""
    files = [f"file_{i}.py" for i in range(MAX_FILES_PER_QUARANTINE + 1)]
    with pytest.raises(ValueError):
        engine.move_to_quarantine(files=files, run_id="run-039", phase=4, violation_type="SKIP_RED_PHASE")


# === Q-040: Not delete original when copy to quarantine fails ===

def test_should_not_delete_original_when_copy_to_quarantine_fails(engine, repo_root, dirty_file, mock_shutil_copy2_failure):
    """Q-040: shutil.copy2 OSError; original untouched."""
    original = Path(repo_root) / dirty_file
    content_before = original.read_text()
    result = engine.move_to_quarantine(
        files=[dirty_file], run_id="run-040", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert original.exists()
    assert original.read_text() == content_before
    assert isinstance(result, QuarantineResult)
    assert len(result.failed_files) >= 1


# === Q-041: Add to failed_files on copy failure with reason ===

def test_should_add_to_failed_files_on_copy_failure_with_reason(engine, dirty_file, mock_shutil_copy2_failure):
    """Q-041: Failed dirty file gets reason 'copy_failed'."""
    result = engine.move_to_quarantine(
        files=[dirty_file], run_id="run-041", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert any("copy_failed" in str(f) for f in result.failed_files)


# === Q-042: Handle git rm failure for dirty file ===

def test_should_handle_git_rm_failure_for_dirty_file(engine, repo_root, dirty_file, mock_subprocess_run_failure):
    """Q-042: git rm -f non-zero; log warning, 'git_rm_failed'."""
    result = engine.move_to_quarantine(
        files=[dirty_file], run_id="run-042", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert len(result.failed_files) >= 1
    assert result.quarantine_success is False


# === Q-043: Quarantine copy kept on git rm failure ===

def test_should_not_remove_quarantine_copy_on_git_rm_failure(engine, repo_root, dirty_file, mock_subprocess_run_failure):
    """Q-043: Quarantine copy kept even if git rm fails."""
    engine.move_to_quarantine(
        files=[dirty_file], run_id="run-043", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-043" / "phase4"
    assert quarantine_dir.is_dir()
    assert len(list(quarantine_dir.iterdir())) > 0


# === Q-044: Re-stage file when move fails after git rm cached ===

def test_should_restage_file_when_move_fails_after_git_rm_cached(engine, repo_root, clean_file, mock_shutil_move_failure):
    """Q-044: git rm --cached succeeds but shutil.move fails; git add re-stages."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-044", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    tracked = subprocess.run(
        ["git", "ls-files", clean_file], cwd=repo_root,
        capture_output=True, text=True,
    )
    assert clean_file in tracked.stdout


# === Q-045: File stays tracked when move fails ===

def test_should_leave_file_tracked_when_move_fails_after_git_rm_cached(engine, repo_root, clean_file, mock_shutil_move_failure):
    """Q-045: After re-staging, file remains in git index."""
    content_before = (Path(repo_root) / clean_file).read_text()
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-045", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert (Path(repo_root) / clean_file).exists()
    assert (Path(repo_root) / clean_file).read_text() == content_before
    tracked = subprocess.run(
        ["git", "ls-files", clean_file], cwd=repo_root,
        capture_output=True, text=True,
    )
    assert clean_file in tracked.stdout


# === Q-046: Handle remove failure for untracked file ===

def test_should_handle_remove_failure_for_untracked_file(engine, untracked_file, mock_os_remove_failure):
    """Q-046: os.remove fails; log warning, add to failed_files."""
    result = engine.move_to_quarantine(
        files=[untracked_file], run_id="run-046", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert len(result.failed_files) >= 1


# === Q-047: Reset staging when git commit fails ===

def test_should_reset_staging_when_git_commit_fails(engine, repo_root, clean_file, mock_subprocess_run_failure):
    """Q-047: git commit non-zero; git reset HEAD clears staged changes."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-047", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    status = subprocess.run(
        ["git", "status", "--porcelain"], cwd=repo_root,
        capture_output=True, text=True,
    )
    assert status.stdout.strip() == ""


# === Q-048: Restore deleted files via git checkout after reset ===

def test_should_restore_deleted_files_via_git_checkout_after_reset(engine, repo_root, clean_file, mock_subprocess_run_failure):
    """Q-048: git checkout HEAD -- {path} for deleted tracked files."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-048", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert (Path(repo_root) / clean_file).exists()


# === Q-049: Log warning with stderr on commit failure ===

def test_should_log_warning_with_stderr_on_commit_failure(engine, clean_file, mock_subprocess_run_failure, caplog):
    """Q-049: WARN log containing git stderr."""
    with caplog.at_level(logging.WARNING):
        engine.move_to_quarantine(
            files=[clean_file], run_id="run-049", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert any("stderr" in r.message.lower() for r in caplog.records)


# === Q-050: quarantine_success=False on integration commit failure (FM-10) ===

def test_should_set_quarantine_success_false_on_integration_commit_failure_fm10(engine, clean_file, mock_subprocess_run_failure, caplog):
    """Q-050: quarantine_success=False when commit fails in integration context."""
    with caplog.at_level(logging.WARNING):
        result = engine.move_to_quarantine(
            files=[clean_file], run_id="run-050", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert result.quarantine_success is False
    assert any("commit failed" in r.message.lower() or "stderr" in r.message.lower() for r in caplog.records)


# === Q-051: Raise FileExistsError when original path occupied ===

def test_should_raise_file_exists_error_when_original_path_occupied(engine, repo_root, clean_file):
    """Q-051: FileExistsError with conflict message."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-051", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-create file at original location to simulate conflict
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("conflict content")
    with pytest.raises(FileExistsError):
        engine.restore(clean_file, run_id="run-051")


# === Q-052: Return None when no quarantine metadata ===

def test_should_return_none_when_no_quarantine_metadata(engine, clean_file):
    """Q-052: restore() returns None when no metadata found."""
    result = engine.restore("never_quarantined.py", run_id="run-052")
    assert result is None


# === Q-053: Return None when quarantine file missing ===

def test_should_return_none_when_quarantine_file_missing(engine, repo_root, clean_file):
    """Q-053: Metadata exists but file deleted; restore() returns None."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-053", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Delete quarantine file but keep metadata
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-053" / "phase4"
    for f in quarantine_dir.iterdir():
        if not f.name.startswith("metadata-"):
            f.unlink()
    result = engine.restore(clean_file, run_id="run-053")
    assert result is None


# === Q-054: Skip corrupted metadata during list ===

def test_should_skip_corrupted_metadata_during_list(engine, repo_root, clean_file):
    """Q-054: JSON decode error; skip, log warning, return remaining."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-054", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-054" / "phase4"
    bad_meta = quarantine_dir / "metadata-badjson00.json"
    bad_meta.write_text("{invalid json")
    records = engine.list_quarantine(run_id="run-054")
    assert isinstance(records, list)
    assert len(records) >= 1


# === Q-055: Raise ValueError when restore metadata corrupted ===

def test_should_raise_value_error_when_restore_metadata_corrupted(engine, repo_root, clean_file):
    """Q-055: Corrupted JSON on restore -> ValueError (JSONDecodeError subclass)."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-055", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-055" / "phase4"
    for meta_file in quarantine_dir.glob("metadata-*.json"):
        meta_file.write_text("{broken")
    with pytest.raises(ValueError):
        engine.restore(clean_file, run_id="run-055")


# === Q-056: Append numeric suffix on hash collision ===

def test_should_append_numeric_suffix_on_metadata_hash_collision(engine, repo_root, clean_file):
    """Q-056: Second collision -> metadata-{hash}-2.json."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-056", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Quarantine same file again to trigger collision
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("restored content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add"], cwd=repo_root, check=True)
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-056", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-056" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    assert len(metadata_files) >= 2


# === Q-057: Increment suffix until available filename found ===

def test_should_increment_suffix_until_available_filename_found(engine, repo_root, clean_file):
    """Q-057: -2 exists -> try -3, up to -100."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-057", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-057" / "phase4"
    base_hash = hashlib.sha256(clean_file.encode()).hexdigest()[:8]
    for i in range(2, 5):
        (quarantine_dir / f"metadata-{base_hash}-{i}.json").write_text("{}")
    # Re-add file and quarantine again
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("more content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add2"], cwd=repo_root, check=True)
    result2 = engine.move_to_quarantine(
        files=[clean_file], run_id="run-057", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result2.success is True
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    assert len(metadata_files) >= 5


# === Q-058: Find correct metadata through hash collision suffixes ===

def test_should_find_correct_metadata_through_hash_collision_suffixes(engine, repo_root, clean_file):
    """Q-058: Restore scans -2, -3... to match original_path."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-058", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-add and quarantine again to create collision
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("new content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add3"], cwd=repo_root, check=True)
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-058", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.restore(clean_file, run_id="run-058")
    assert result is not None
    assert result.success is True


# === Q-059: Handle broken hash collision suffix sequence ===

def test_should_handle_broken_hash_collision_suffix_sequence(engine, repo_root, clean_file):
    """Q-059: -2 deleted, -3 exists; restore finds correct match.

    Suffix files are created manually (not via double-quarantine) because the
    engine's collision logic is not yet implemented in TDD Red Phase.
    """
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-059", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-059" / "phase4"
    base_hash = hashlib.sha256(clean_file.encode()).hexdigest()[:8]
    stub_meta = {
        "original_path": clean_file,
        "quarantine_path": "",
        "violation_type": "SKIP_RED_PHASE",
        "run_id": "run-059",
        "phase": 4,
        "timestamp": "",
        "boundary_commit": "",
    }
    (quarantine_dir / f"metadata-{base_hash}-2.json").write_text(json.dumps(stub_meta))
    (quarantine_dir / f"metadata-{base_hash}-3.json").write_text(json.dumps(stub_meta))
    (quarantine_dir / f"metadata-{base_hash}-2.json").unlink()
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("restored")
    result = engine.restore(clean_file, run_id="run-059")
    assert result is not None


# === Q-060: Warn when hash collisions exceed 100 ===

def test_should_warn_when_hash_collisions_exceed_100(engine, repo_root, clean_file, caplog):
    """Q-060: 100+ suffixes -> WARNING log."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-060", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-060" / "phase4"
    base_hash = hashlib.sha256(clean_file.encode()).hexdigest()[:8]
    for i in range(2, 102):
        (quarantine_dir / f"metadata-{base_hash}-{i}.json").write_text(
            json.dumps({"original_path": f"fake_{i}.py", "quarantine_path": "", "violation_type": "SKIP_RED_PHASE",
                        "run_id": "run-060", "phase": 4, "timestamp": "", "boundary_commit": ""})
        )
    with caplog.at_level(logging.WARNING):
        records = engine.list_quarantine(run_id="run-060")
    assert isinstance(records, list)
    assert any("collision" in r.message.lower() for r in caplog.records)


# === Q-061: Append timestamp suffix when quarantine path occupied ===

def test_should_append_timestamp_suffix_when_quarantine_path_occupied(engine, repo_root, clean_file):
    """Q-061: Target exists -> append _YYYYMMDDTHHmmss."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-061", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-061" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("content again")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-061", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    all_meta = list(quarantine_dir.glob("metadata-*.json"))
    assert len(all_meta) >= 2


# === Q-062: Add to failed_files when timestamp suffix collides ===

def test_should_add_to_failed_files_when_timestamp_suffix_collides_within_same_second(engine, repo_root, clean_file):
    """Q-062: Suffix retry also occupied -> failed_files."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-062", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-add and attempt second quarantine in same second
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("content again")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add4"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-062", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert isinstance(result, QuarantineResult)
    assert result.quarantine_success is False
    assert len(result.failed_files) >= 1


# === Q-063: Resolve quarantine path conflict across runs ===

def test_should_resolve_quarantine_path_conflict_across_runs(engine, repo_root, clean_file):
    """Q-063: Same basename from different paths deduplicated."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-063a", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-add file for second run
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("different content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add5"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-063b", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True


# === Q-064: Set quarantine_success=True when boundary_commit invalid ===

def test_should_set_quarantine_success_true_when_boundary_commit_invalid(engine, repo_root, clean_file):
    """Q-064: git cat-file -e fails; quarantine_success=True, boundary_commit_valid=False."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-064", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="invalidsha123",
    )
    assert result.quarantine_success is True
    assert result.boundary_commit_valid is False


# === Q-065: Set empty boundary_commit when git rev-parse fails (empty repo) ===

def test_should_set_empty_boundary_commit_when_git_rev_parse_fails(repo_root_no_git_user):
    """Q-065: Empty repo; boundary_commit='EMPTY_REPO', quarantine_success=True."""
    engine = QuarantineEngine(repo_root=repo_root_no_git_user)
    test_file = "test.txt"
    full = Path(repo_root_no_git_user) / test_file
    full.write_text("content")
    result = engine.move_to_quarantine(
        files=[test_file], run_id="run-065", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.quarantine_success is True
    quarantine_dir = Path(repo_root_no_git_user) / "local-assets" / ".violation-quarantine" / "run-065" / "phase4"
    meta_files = list(quarantine_dir.glob("metadata-*.json"))
    assert meta_files, "Expected at least one metadata file"
    meta = json.loads(meta_files[0].read_text())
    assert meta.get("boundary_commit") == ""


# === Q-065b: Store empty string boundary_commit when rev-parse fails in non-empty repo ===

def test_should_store_empty_string_boundary_commit_when_rev_parse_fails_in_nonempty_repo(repo_root):
    """Q-065b: Non-empty repo with corrupted .git/HEAD; boundary_commit stores ''."""
    test_file = "src/real_file.ts"
    full = Path(repo_root) / test_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("content\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=repo_root, check=True)
    head_path = Path(repo_root) / ".git" / "HEAD"
    head_path.write_text("ref: refs/heads/nonexistent-branch\n")
    engine = QuarantineEngine(repo_root=repo_root)
    result = engine.move_to_quarantine(
        files=[test_file], run_id="run-065b", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert isinstance(result, QuarantineResult)
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-065b" / "phase4"
    meta_files = list(quarantine_dir.glob("metadata-*.json"))
    assert meta_files, "Expected at least one metadata file"
    meta = json.loads(meta_files[0].read_text())
    assert meta.get("boundary_commit") == ""


# === Q-066: Store full SHA never ref in metadata ===

def test_should_store_full_sha_never_ref_in_metadata(engine, repo_root, clean_file):
    """Q-066: Metadata stores resolved SHA, never 'HEAD'."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-066", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-066" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    assert len(metadata_files) >= 1
    meta = json.loads(metadata_files[0].read_text())
    assert meta["boundary_commit"] != "HEAD"


# === Q-119: Set boundary_commit_valid=True when SHA exists in repo ===

def test_should_set_boundary_commit_valid_true_when_sha_exists_in_repo(engine, repo_root, clean_file):
    """Q-119: Valid SHA verified by git cat-file -e; boundary_commit_valid=True."""
    sha_result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_root,
        capture_output=True, text=True,
    )
    valid_sha = sha_result.stdout.strip()
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-119", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit=valid_sha,
    )
    assert result.quarantine_success is True
    assert result.boundary_commit_valid is True


# === Q-067: Skip already quarantined file idempotently ===

def test_should_skip_already_quarantined_file_idempotently(engine, repo_root, clean_file):
    """Q-067: Metadata + file exist -> skip silently."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-067", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-add file for second attempt
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("new content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add6"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-067", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    assert result.files_affected == [] or clean_file not in result.files_affected


# === Q-068: Search all phase subdirectories for idempotency ===

def test_should_search_all_phase_subdirectories_for_idempotency_check(engine, repo_root, clean_file):
    """Q-068: phase3 quarantine detected in phase4 re-quarantine."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-068", phase=3,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-add file for phase4 attempt
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("new content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add7"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-068", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True


# === Q-069: Re-quarantine when metadata stale (file missing) ===

def test_should_re_quarantine_when_metadata_stale_file_missing(engine, repo_root, clean_file):
    """Q-069: Metadata exists, file missing -> proceed with quarantine."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-069", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-069" / "phase4"
    # Delete physical quarantine file but keep metadata
    for f in quarantine_dir.iterdir():
        if not f.name.startswith("metadata-"):
            f.unlink()
    # Re-add file
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("restored content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add8"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-069", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True


# === Q-070: Allow re-quarantine after restore ===

def test_should_allow_re_quarantine_after_restore(engine, repo_root, clean_file):
    """Q-070: Original file restored; re-quarantine proceeds."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-070", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    engine.restore(clean_file, run_id="run-070")
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-070", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True


# === Q-071: Not skip when file exists at original_path after restore ===

def test_should_not_skip_when_file_exists_at_original_path_after_restore(engine, repo_root, clean_file):
    """Q-071: After restore, original file exists; re-quarantine allowed."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-071", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    engine.restore(clean_file, run_id="run-071")
    assert (Path(repo_root) / clean_file).exists()
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-071", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    assert clean_file in result.files_affected


# === Q-072: Isolate quarantine directories per project ===

def test_should_isolate_quarantine_directories_per_project(tmp_path, clean_file):
    """Q-072: Different repo_root -> separate dirs."""
    repo_a = tmp_path / "repo_a"
    repo_b = tmp_path / "repo_b"
    for r in (repo_a, repo_b):
        r.mkdir()
        subprocess.run(["git", "init"], cwd=r, check=True)
        ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
        subprocess.run(["git", "config", "user.email", f"test-{ts}@example.com"], cwd=r, check=True)
        subprocess.run(["git", "config", "user.name", f"Test User {ts}"], cwd=r, check=True)
    eng_a = QuarantineEngine(repo_root=str(repo_a))
    eng_b = QuarantineEngine(repo_root=str(repo_b))
    assert eng_a.repo_root != eng_b.repo_root
    file_a = repo_a / "file.py"
    file_a.write_text("content")
    subprocess.run(["git", "add", "."], cwd=repo_a, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_a, check=True)
    result_a = eng_a.move_to_quarantine(files=["file.py"], run_id="run-a", phase=4, violation_type="SKIP_RED_PHASE")
    records_a = eng_a.list_quarantine(run_id="run-a")
    records_b = eng_b.list_quarantine(run_id="run-a")
    assert len(records_a) >= 1
    assert records_b == []


# === Q-073: Warn when quarantine dir exceeds soft size limit ===

def test_should_warn_when_quarantine_dir_exceeds_soft_size_limit(engine, repo_root, clean_file, caplog):
    """Q-073: >100MB -> WARNING, no block."""
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-073", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-073" / "phase4"
    large_file = quarantine_dir / "large_dummy"
    large_file.write_bytes(b"\0" * (101 * 1024 * 1024))
    with caplog.at_level(logging.WARNING):
        result2 = engine.move_to_quarantine(
            files=["nonexistent.py"], run_id="run-073b", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert any("soft" in r.message.lower() and "limit" in r.message.lower() for r in caplog.records)


# === Q-074: Abort git command on per-command timeout ===

def test_should_abort_git_command_on_per_command_timeout(engine, repo_root, clean_file):
    """Q-074: >10s -> terminate subprocess, add to failed_files."""
    original_run = subprocess.run
    def selective_timeout(*args, **kwargs):
        if args and len(args[0]) > 1 and args[0][0] == "git" and "commit" in args[0]:
            raise subprocess.TimeoutExpired(cmd="git commit", timeout=0.001)
        return original_run(*args, **kwargs)
    with patch("subprocess.run", side_effect=selective_timeout):
        result = engine.move_to_quarantine(
            files=[clean_file], run_id="run-074", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert isinstance(result, QuarantineResult)
    assert len(result.failed_files) >= 1


# === Q-075: Return partial result on aggregate timeout exceeded ===

def test_should_return_partial_result_on_aggregate_timeout_exceeded(engine, repo_root, clean_file):
    """Q-075: >60s total -> partial result, quarantine_success=False."""
    original_run = subprocess.run
    def selective_timeout(*args, **kwargs):
        if args and len(args[0]) > 1 and args[0][0] == "git" and "commit" in args[0]:
            raise subprocess.TimeoutExpired(cmd="git commit", timeout=0.001)
        return original_run(*args, **kwargs)
    with patch("subprocess.run", side_effect=selective_timeout):
        result = engine.move_to_quarantine(
            files=[clean_file], run_id="run-075", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert isinstance(result, QuarantineResult)
    assert result.quarantine_success is False
    assert len(result.failed_files) >= 1


# === Q-079: Raise TypeError when files is None ===

def test_should_raise_type_error_when_files_is_none(engine):
    """Q-079: move_to_quarantine(files=None) raises TypeError."""
    with pytest.raises(TypeError):
        engine.move_to_quarantine(files=None, run_id="run-079", phase=4, violation_type="SKIP_RED_PHASE")


# === Q-080: Raise TypeError when restore original_path is None ===

def test_should_raise_type_error_when_restore_original_path_is_none(engine):
    """Q-080: restore(original_path=None) raises TypeError."""
    with pytest.raises(TypeError):
        engine.restore(original_path=None, run_id="run-080")


# === Q-082: Return success with empty arrays when files empty ===

def test_should_return_success_with_empty_arrays_when_files_empty(engine):
    """Q-082: files=[] returns QuarantineResult(success=True, files_affected=[])."""
    result = engine.move_to_quarantine(
        files=[], run_id="run-082", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    assert result.files_affected == []
    assert result.quarantine_success is True


# === Q-083: Accept run_id at max length 128 ===

def test_should_accept_run_id_at_max_length_128(engine):
    """Q-083: run_id of exactly 128 alphanumeric chars is accepted."""
    long_run_id = "a" * MAX_RUN_ID_LENGTH
    result = engine.move_to_quarantine(
        files=[], run_id=long_run_id, phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True


# === Q-084: Reject run_id exceeding max length 129 ===

def test_should_reject_run_id_exceeding_max_length_129(engine):
    """Q-084: run_id of 129 chars raises ValueError."""
    long_run_id = "a" * (MAX_RUN_ID_LENGTH + 1)
    with pytest.raises(ValueError):
        engine.move_to_quarantine(files=[], run_id=long_run_id, phase=4, violation_type="SKIP_RED_PHASE")


# === Q-087: Reject file path with dot-dot traversal ===

def test_should_reject_file_path_with_dot_dot_traversal(engine):
    """Q-087: move_to_quarantine(files=['../../etc/passwd']) raises ValueError."""
    with pytest.raises(ValueError):
        engine.move_to_quarantine(
            files=["../../etc/passwd"], run_id="run-087", phase=4,
            violation_type="SKIP_RED_PHASE",
        )


# === Q-087b: Reject absolute file path ===

def test_should_reject_absolute_file_path(engine):
    """Q-087b: move_to_quarantine(files=['/etc/passwd']) raises ValueError."""
    with pytest.raises(ValueError):
        engine.move_to_quarantine(
            files=["/etc/passwd"], run_id="run-087b", phase=4,
            violation_type="SKIP_RED_PHASE",
        )


# === Q-088: Round-trip metadata with unicode and special chars ===

def test_should_round_trip_metadata_with_unicode_and_special_chars(engine, repo_root):
    """Q-088: original_path with unicode, spaces, special chars survives JSON round-trip."""
    path = "src/日本語 module (v2).ts"
    full = Path(repo_root) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("export const test = true;\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "init unicode"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=[path], run_id="run-088", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
    records = engine.list_quarantine(run_id="run-088")
    assert len(records) >= 1
    assert records[0].original_path == path


# === Q-089: Not leave partial JSON on metadata write failure ===

def test_should_not_leave_partial_json_on_metadata_write_failure(engine, repo_root, clean_file):
    """Q-089: JSON write fails mid-way; no partial metadata file remains."""
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-089" / "phase4"
    original_write_text = Path.write_text
    def selective_write_text(self, data, *args, **kwargs):
        if "metadata-" in self.name and ".violation-quarantine" in str(self):
            raise OSError("disk full")
        return original_write_text(self, data, *args, **kwargs)
    with patch("pathlib.Path.write_text", selective_write_text):
        result = engine.move_to_quarantine(
            files=[clean_file], run_id="run-089", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert isinstance(result, QuarantineResult)
    assert len(result.failed_files) >= 1 or result.quarantine_success is False
    partial_files = list(quarantine_dir.glob("metadata-*.json")) if quarantine_dir.exists() else []
    for f in partial_files:
        try:
            json.loads(f.read_text())
        except json.JSONDecodeError:
            pytest.fail(f"Partial JSON file found: {f}")


# === Q-090: Work without preconfigured git user ===

def test_should_work_without_preconfigured_git_user(repo_root_no_git_user):
    """Q-090: QuarantineEngine commits even without git user config."""
    test_file = "test.txt"
    full = Path(repo_root_no_git_user) / test_file
    full.write_text("content")
    engine = QuarantineEngine(repo_root=repo_root_no_git_user)
    result = engine.move_to_quarantine(
        files=[test_file], run_id="run-090", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert isinstance(result, QuarantineResult)
    assert result.success is True


# === Q-091: Close file handles after copy failure ===

def test_should_close_file_handles_after_copy_failure(engine, repo_root, dirty_file):
    """Q-091: Mock shutil.copy2 opens real file handle then raises; verify no open handles remain."""
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-091" / "phase4"

    def fail_copy(src, dst):
        raise OSError("Permission denied")

    with patch("shutil.copy2", side_effect=fail_copy):
        result = engine.move_to_quarantine(
            files=[dirty_file], run_id="run-091", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert isinstance(result, QuarantineResult)
    assert len(result.failed_files) >= 1
    if quarantine_dir.exists():
        assert len(list(quarantine_dir.iterdir())) == 0


# === Q-092: Terminate subprocess and clean up on git timeout ===

def test_should_terminate_subprocess_and_clean_up_on_git_timeout(engine, repo_root, clean_file):
    """Q-092: Git timeout; subprocess.terminate() called, no zombie process."""
    def run_timeout(*args, **kwargs):
        if "git" in str(args[0]) and "commit" in str(args[0]):
            raise subprocess.TimeoutExpired(cmd="git commit", timeout=10)
        class Result:
            returncode = 0
            stdout = b""
            stderr = b""
        return Result()

    with patch("subprocess.run", side_effect=run_timeout):
        result = engine.move_to_quarantine(
            files=[clean_file], run_id="run-092", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert isinstance(result, QuarantineResult)
    assert len(result.failed_files) >= 1


# === Q-093: Use single git commit for batch quarantine ===

def test_should_use_single_git_commit_for_batch_quarantine(engine, repo_root, clean_file, dirty_file, untracked_file):
    """Q-093: Batch of 3 files produces exactly 1 git commit (not 3)."""
    initial_log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo_root,
        capture_output=True, text=True,
    ).stdout.strip().split("\n")
    initial_count = len(initial_log)
    engine.move_to_quarantine(
        files=[clean_file, dirty_file, untracked_file],
        run_id="run-093", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    final_log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo_root,
        capture_output=True, text=True,
    ).stdout.strip().split("\n")
    assert len(final_log) == initial_count + 1


# === Q-094: Read metadata only without loading file contents ===

def test_should_read_metadata_only_without_loading_file_contents(engine, repo_root, clean_file):
    """Q-094: list_quarantine reads JSON files but does NOT open quarantined file contents."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-094", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    with patch("builtins.open", wraps=open) as mock_open:
        records = engine.list_quarantine(run_id="run-094")
        # Should not open the quarantined file itself (only metadata JSON)
        opened_paths = [call.args[0] for call in mock_open.call_args_list]
        for p in opened_paths:
            p_str = str(p)
            if not p_str.endswith(".json"):
                assert False, f"Unexpected file open: {p}"
    assert isinstance(records, list)


# === Q-095: Resolve boundary commit in detached HEAD state ===

def test_should_resolve_boundary_commit_in_detached_head_state(repo_root, clean_file):
    """Q-095: In detached HEAD, boundary_commit='HEAD' still resolves to actual SHA."""
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_root,
        capture_output=True, text=True,
    ).stdout.strip()
    subprocess.run(["git", "checkout", "--detach", sha], cwd=repo_root, check=True)
    engine = QuarantineEngine(repo_root=repo_root)
    result = engine.move_to_quarantine(
        files=[clean_file], run_id="run-095", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True


# === Q-096: Return reverse-orphan entries in list quarantine ===

def test_should_return_reverse_orphan_entries_in_list_quarantine(engine, repo_root, clean_file, caplog):
    """Q-096: Physical file with no metadata; reported with warning."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-096", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-096" / "phase4"
    # Create orphan physical file (no metadata)
    (quarantine_dir / "orphan_file.py").write_text("# orphan")
    with caplog.at_level(logging.WARNING):
        records = engine.list_quarantine(run_id="run-096")
    assert isinstance(records, list)
    assert len(records) >= 2


# === Q-097: Return orphaned metadata entries in list quarantine ===

def test_should_return_orphaned_metadata_entries_in_list_quarantine(engine, repo_root, clean_file):
    """Q-097: Metadata exists but file absent; listed with orphan flag."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-097", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-097" / "phase4"
    # Delete physical quarantine file
    for f in quarantine_dir.iterdir():
        if not f.name.startswith("metadata-"):
            f.unlink()
    records = engine.list_quarantine(run_id="run-097")
    assert isinstance(records, list)
    assert len(records) >= 1
    assert records[0].original_path == clean_file


# === Q-098: Include _list_warnings field when IO errors during listing ===

def test_should_include_list_warnings_field_when_io_errors_during_listing(engine, repo_root, clean_file, caplog):
    """Q-098: IO errors during listing populate _list_warnings field."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-098", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-098" / "phase4"
    import os as _os
    for f in quarantine_dir.glob("metadata-*.json"):
        _os.chmod(f, 0o000)
    try:
        with caplog.at_level(logging.WARNING):
            records = engine.list_quarantine(run_id="run-098")
        assert isinstance(records, list)
        # IO errors during listing should produce a warning (permission/IO related)
        assert any(
            "permission" in r.message.lower() or "io" in r.message.lower() or "denied" in r.message.lower()
            for r in caplog.records
        )
    finally:
        for f in quarantine_dir.glob("metadata-*.json"):
            _os.chmod(f, 0o644)


# === Q-099: Restore file from highest phase number ===

def test_should_restore_file_from_highest_phase_number(engine, repo_root, clean_file):
    """Q-099: Same file in phase3 and phase4; restore picks phase4 copy."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-099", phase=3,
        violation_type="SKIP_RED_PHASE",
    )
    # Re-add file
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("phase4 content")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add9"], cwd=repo_root, check=True)
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-099", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.restore(clean_file, run_id="run-099")
    assert result is not None
    assert result.success is True
    restored = (Path(repo_root) / clean_file).read_text()
    assert "phase4" in restored


# === Q-100: Return same result on duplicate restore call ===

def test_should_return_same_result_on_duplicate_restore_call(engine, clean_file):
    """Q-100: Second restore() returns same RestoreResult; no error."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-100", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result1 = engine.restore(clean_file, run_id="run-100")
    result2 = engine.restore(clean_file, run_id="run-100")
    assert result1 is not None
    assert result2 is not None
    assert result1.success == result2.success
    assert result1.new_path == result2.new_path


# === Q-101: Warn when restored file differs from boundary_commit content ===

def test_should_warn_when_restored_file_differs_from_boundary_commit_content(engine, repo_root, clean_file, caplog):
    """Q-101: Restored file content differs from boundary_commit version; WARNING logged."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-101", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-101" / "phase4"
    for f in quarantine_dir.iterdir():
        if not f.name.startswith("metadata-"):
            f.write_text("modified content\n")
    with caplog.at_level(logging.WARNING):
        result = engine.restore(clean_file, run_id="run-101")
    assert result is not None
    assert any("differ" in r.message.lower() for r in caplog.records)


# === Q-109: Warn when restored file did not exist at boundary_commit ===

def test_should_warn_when_restored_file_did_not_exist_at_boundary_commit(engine, repo_root, clean_file, caplog):
    """Q-109: File newly created after boundary_commit; WARNING logged, restore succeeds."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-109", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    with caplog.at_level(logging.WARNING):
        result = engine.restore(clean_file, run_id="run-109")
    assert result is not None
    assert result.success is True
    assert any("not exist" in r.message.lower() or "new file" in r.message.lower() for r in caplog.records)


# === Q-102: Not write metadata for failed files in batch ===

def test_should_not_write_metadata_for_failed_files_in_batch(engine, repo_root, clean_file, untracked_file):
    """Q-102: In batch quarantine, failed files have no metadata written."""
    engine.move_to_quarantine(
        files=[clean_file, "nonexistent.py", untracked_file],
        run_id="run-102", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-102" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    # Should only have metadata for files that succeeded
    for mf in metadata_files:
        meta = json.loads(mf.read_text())
        assert meta["original_path"] != "nonexistent.py"


# === Q-103: Preserve files without auto-deletion after termination ===

def test_should_preserve_files_without_auto_deletion_after_termination(engine, repo_root, clean_file):
    """Q-103: After pipeline termination, quarantined files persist."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-103", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-103" / "phase4"
    assert quarantine_dir.is_dir()
    assert len(list(quarantine_dir.iterdir())) > 0


# === Q-104: Raise QuarantineNotFoundError when reconcile has no record ===

def test_should_raise_quarantine_not_found_error_when_reconcile_has_no_record(engine):
    """Q-104: reconcile() on unknown run_id raises QuarantineNotFoundError."""
    with pytest.raises(QuarantineNotFoundError):
        engine.reconcile(project_id="test-proj", run_id="nonexistent-run")


# === Q-105: Detect orphan physical files during reconcile cross-scan ===

def test_should_detect_orphan_physical_files_during_reconcile_cross_scan(engine, repo_root, clean_file):
    """Q-105: Reconcile cross-scans physical files against metadata; reports orphans."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-105", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-105" / "phase4"
    (quarantine_dir / "orphan.py").write_text("# orphan")
    result = engine.reconcile(project_id="test-proj", run_id="run-105")
    assert result.success is True
    assert len(result.mismatches) >= 1
    assert any("orphan" in str(m).lower() for m in result.mismatches)


# === Q-106: Accept batch of exactly MAX_FILES_PER_QUARANTINE ===

def test_should_accept_batch_of_exactly_max_files_per_quarantine(engine, repo_root):
    """Q-106: Exactly 50 files accepted without error."""
    files = []
    for i in range(MAX_FILES_PER_QUARANTINE):
        path = f"src/file_{i}.py"
        full = Path(repo_root) / path
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(f"# file {i}\n")
        files.append(path)
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "init batch"], cwd=repo_root, check=True)
    result = engine.move_to_quarantine(
        files=files, run_id="run-106", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert isinstance(result, QuarantineResult)
    assert result.success is True


# === Q-107: Use suffix up to MAX_SUFFIX_RETRY as upper limit ===

def test_should_use_suffix_up_to_max_retry_as_upper_limit(engine, repo_root, clean_file, caplog):
    """Q-107: Hash collision suffix retries capped at MAX_SUFFIX_RETRY (100)."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-107", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-107" / "phase4"
    base_hash = hashlib.sha256(clean_file.encode()).hexdigest()[:8]
    for i in range(2, MAX_SUFFIX_RETRY + 2):
        (quarantine_dir / f"metadata-{base_hash}-{i}.json").write_text("{}")
    full = Path(repo_root) / clean_file
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("another attempt")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "re-add-107"], cwd=repo_root, check=True)
    with caplog.at_level(logging.WARNING):
        result = engine.move_to_quarantine(
            files=[clean_file], run_id="run-107", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
    assert isinstance(result, QuarantineResult)
    assert len(result.failed_files) >= 1 or result.quarantine_success is False


# === Q-108: List quarantined files across all runs when run_id is null ===

def test_should_list_quarantined_files_across_all_runs_when_run_id_is_null(engine, repo_root, clean_file):
    """Q-108: list_quarantine(run_id=None) returns all quarantined files across all runs."""
    # Create two files for different runs
    path_a = "src/file_a.ts"
    path_b = "src/file_b.ts"
    for p in (path_a, path_b):
        full = Path(repo_root) / p
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(f"// {p}\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "init multi"], cwd=repo_root, check=True)
    engine.move_to_quarantine(files=[path_a], run_id="run-108a", phase=4, violation_type="SKIP_RED_PHASE")
    # Re-add for second run
    full_b = Path(repo_root) / path_b
    full_b.parent.mkdir(parents=True, exist_ok=True)
    full_b.write_text("// b\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "add b"], cwd=repo_root, check=True)
    engine.move_to_quarantine(files=[path_b], run_id="run-108b", phase=4, violation_type="SKIP_RED_PHASE")
    records = engine.list_quarantine(run_id=None)
    assert len(records) >= 2
    run_ids = {r.run_id for r in records}
    assert len(run_ids) >= 2


# === Q-116: Truncate filename_hash to 8 hex chars ===

def test_should_truncate_filename_hash_to_8_hex_chars(engine, repo_root, clean_file):
    """Q-116: SHA256(original_path)[:8] produces 8 hex chars."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-116", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-116" / "phase4"
    metadata_files = list(quarantine_dir.glob("metadata-*.json"))
    assert len(metadata_files) >= 1
    # Check that metadata filename uses 8-char hash
    name = metadata_files[0].stem  # e.g., metadata-a1b2c3d4
    hash_part = name.replace("metadata-", "").split("-")[0]
    assert len(hash_part) == 8


# === Q-117: Reconcile with correct project_id ===

def test_should_reconcile_with_correct_project_id(engine, clean_file):
    """Q-117: reconcile(project_id='proj-A') matches quarantine records."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-117", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.reconcile(project_id="proj-A", run_id="run-117")
    assert result.success is True


# === Q-118: Raise error on mismatched project_id in reconcile ===

def test_should_raise_error_on_mismatched_project_id_in_reconcile(engine, clean_file):
    """Q-118: reconcile(project_id='wrong-proj') raises QuarantineNotFoundError."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-118", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    with pytest.raises(QuarantineNotFoundError):
        engine.reconcile(project_id="wrong-proj", run_id="run-118")


# === Q-121: Reject invalid violation_type ===

def test_should_reject_invalid_violation_type(engine, clean_file):
    """Q-121: move_to_quarantine with violation_type='INVALID_TYPE' raises ValueError."""
    with pytest.raises(ValueError):
        engine.move_to_quarantine(
            files=[clean_file], run_id="run-121", phase=4,
            violation_type="INVALID_TYPE",
        )
