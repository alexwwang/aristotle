"""Quarantine E2E tests — full workflow tests with real git operations."""
import pytest
import subprocess
import json
from pathlib import Path

from quarantine_engine import QuarantineEngine


@pytest.fixture
def engine(repo_root):
    return QuarantineEngine(repo_root=repo_root)


def _create_clean_file(repo_root, path, content="content\n"):
    full = Path(repo_root) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content)
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", f"add {path}"], cwd=repo_root, check=True)


def _create_dirty_file(repo_root, path, new_content="dirty\n"):
    full = Path(repo_root) / path
    full.write_text(new_content)


def _create_untracked_file(repo_root, path, content="untracked\n"):
    full = Path(repo_root) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content)


# === Q-110: E2E full happy path ===

def test_e2e_full_happy_path(engine, repo_root):
    """Q-110: Quarantine 2 mixed-state files, list, restore one, reconcile."""
    _create_clean_file(repo_root, "src/clean.ts", "clean content\n")
    _create_dirty_file(repo_root, "src/clean.ts", "dirty content\n")
    _create_untracked_file(repo_root, "lib/untracked.py", "untracked content\n")

    result = engine.move_to_quarantine(
        files=["src/clean.ts", "lib/untracked.py"],
        run_id="run-e2e-110", phase=4,
        violation_type="SKIP_RED_PHASE", boundary_commit="HEAD",
    )
    assert result.success is True
    assert result.quarantine_success is True

    records = engine.list_quarantine(run_id="run-e2e-110")
    assert len(records) >= 2

    restore_result = engine.restore("src/clean.ts", run_id="run-e2e-110")
    assert restore_result is not None
    assert restore_result.success is True

    reconcile_result = engine.reconcile(project_id="e2e-proj", run_id="run-e2e-110")
    assert reconcile_result.success is True


# === Q-111: E2E partial failure with retry ===

def test_e2e_partial_failure_with_retry(engine, repo_root):
    """Q-111: Quarantine 3 files (1 missing), verify partial_failure, retry."""
    _create_clean_file(repo_root, "src/a.ts", "a\n")
    _create_untracked_file(repo_root, "lib/b.py", "b\n")

    result = engine.move_to_quarantine(
        files=["src/a.ts", "lib/b.py", "missing.py"],
        run_id="run-e2e-111", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.partial_failure is True
    assert result.success is True

    Path(repo_root, "missing.py").write_text("now exists\n")
    retry_result = engine.move_to_quarantine(
        files=["missing.py"],
        run_id="run-e2e-111", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert retry_result.success is True


# === Q-112: E2E cross-phase restore precedence ===

def test_e2e_cross_phase_restore_precedence(engine, repo_root):
    """Q-112: Same file in phase3 and phase4; restore picks latest (phase4)."""
    _create_clean_file(repo_root, "src/target.ts", "phase3 content\n")
    engine.move_to_quarantine(
        files=["src/target.ts"], run_id="run-e2e-112", phase=3,
        violation_type="SKIP_RED_PHASE",
    )

    _create_clean_file(repo_root, "src/target.ts", "phase4 content\n")
    engine.move_to_quarantine(
        files=["src/target.ts"], run_id="run-e2e-112", phase=4,
        violation_type="SKIP_RED_PHASE",
    )

    result = engine.restore("src/target.ts", run_id="run-e2e-112")
    assert result is not None
    assert result.success is True
    restored_content = (Path(repo_root) / "src/target.ts").read_text()
    assert "phase4" in restored_content


# === Q-113: E2E reconcile detects manual changes ===

def test_e2e_reconcile_detects_manual_changes(engine, repo_root):
    """Q-113: Manually modify workspace, reconcile reports mismatches."""
    _create_clean_file(repo_root, "src/watched.ts", "original\n")
    engine.move_to_quarantine(
        files=["src/watched.ts"], run_id="run-e2e-113", phase=4,
        violation_type="SKIP_RED_PHASE",
    )

    Path(repo_root, "src/watched.ts").parent.mkdir(parents=True, exist_ok=True)
    Path(repo_root, "src/watched.ts").write_text("manually restored\n")
    Path(repo_root, "src/unexpected_new.ts").parent.mkdir(parents=True, exist_ok=True)
    Path(repo_root, "src/unexpected_new.ts").write_text("surprise\n")

    reconcile_result = engine.reconcile(project_id="e2e-proj", run_id="run-e2e-113")
    assert isinstance(reconcile_result.mismatches, list)
    assert len(reconcile_result.mismatches) >= 1


# === Q-114: E2E orphan detection and cleanup ===

def test_e2e_orphan_detection_and_cleanup(engine, repo_root):
    """Q-114: Create orphan physical file + orphan metadata, list reports both."""
    _create_clean_file(repo_root, "src/orphan_test.ts", "content\n")
    engine.move_to_quarantine(
        files=["src/orphan_test.ts"], run_id="run-e2e-114", phase=4,
        violation_type="SKIP_RED_PHASE",
    )

    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-e2e-114" / "phase4"
    (quarantine_dir / "orphan_physical.py").write_text("# orphan file\n")
    (quarantine_dir / "metadata-deadbeef.json").write_text(
        json.dumps({
            "original_path": "ghost.py",
            "quarantine_path": str(quarantine_dir / "ghost.py"),
            "violation_type": "SKIP_RED_PHASE",
            "run_id": "run-e2e-114",
            "phase": 4,
            "timestamp": "2026-06-13T00:00:00Z",
            "boundary_commit": "abc123",
        })
    )

    records = engine.list_quarantine(run_id="run-e2e-114")
    assert len(records) >= 1

    reconcile_result = engine.reconcile(project_id="e2e-proj", run_id="run-e2e-114")
    assert reconcile_result.success is True
    assert isinstance(reconcile_result.mismatches, list)
    assert len(reconcile_result.mismatches) >= 1


# === Q-115: E2E crash recovery idempotent retry ===

def test_e2e_crash_recovery_idempotent_retry(engine, repo_root):
    """Q-115: Simulate mid-quarantine crash (partial metadata), retry succeeds."""
    _create_clean_file(repo_root, "src/crash.ts", "crash content\n")
    quarantine_dir = Path(repo_root) / "local-assets" / ".violation-quarantine" / "run-e2e-115" / "phase4"
    quarantine_dir.mkdir(parents=True, exist_ok=True)

    partial_meta = quarantine_dir / "metadata-partial00.json"
    partial_meta.write_text('{"original_path": "src/crash.ts", "quarantine')

    result = engine.move_to_quarantine(
        files=["src/crash.ts"], run_id="run-e2e-115", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result.success is True
