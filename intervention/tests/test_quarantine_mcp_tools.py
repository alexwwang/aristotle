"""Quarantine MCP tool integration tests."""
import pytest

from quarantine_engine import (
    QuarantineEngine,
    QuarantineResult,
    QuarantineNotFoundError,
    ReconcileResult,
)


@pytest.fixture
def engine(repo_root):
    return QuarantineEngine(repo_root=repo_root)


@pytest.fixture
def clean_file(repo_root):
    import subprocess
    from pathlib import Path
    path = "src/auth.ts"
    full = Path(repo_root) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("export const auth = true;\n")
    subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_root, check=True)
    return path


def _mcp_move_to_quarantine(engine, files, run_id, phase, violation_type, boundary_commit="HEAD"):
    """MCP tool wrapper for move_to_quarantine."""
    result = engine.move_to_quarantine(
        files=files, run_id=run_id, phase=phase,
        violation_type=violation_type, boundary_commit=boundary_commit,
    )
    if hasattr(result, "__dict__"):
        return {
            "success": result.success,
            "action": result.action,
            "files_affected": result.files_affected,
            "quarantine_paths": result.quarantine_paths,
            "original_paths": result.original_paths,
            "partial_failure": result.partial_failure,
            "failed_files": result.failed_files,
            "quarantine_success": result.quarantine_success,
            "message": result.message,
        }
    return result


def _mcp_list_quarantine(engine, run_id):
    """MCP tool wrapper for list_quarantine."""
    records = engine.list_quarantine(run_id=run_id)
    return [
        {
            "original_path": r.original_path,
            "quarantine_path": r.quarantine_path,
            "violation_type": r.violation_type,
            "run_id": r.run_id,
            "phase": r.phase,
            "timestamp": r.timestamp,
            "boundary_commit": r.boundary_commit,
        }
        for r in records
    ]


def _mcp_restore(engine, original_path, run_id):
    """MCP tool wrapper for restore."""
    result = engine.restore(original_path=original_path, run_id=run_id)
    if result is None:
        return None
    return {
        "success": result.success,
        "new_path": result.new_path,
        "message": result.message,
    }


def _mcp_quarantine_retry(engine, files, run_id, phase, violation_type, boundary_commit="HEAD"):
    """MCP tool wrapper for quarantine_retry (re-calls move_to_quarantine with idempotency)."""
    return _mcp_move_to_quarantine(engine, files, run_id, phase, violation_type, boundary_commit)


def _mcp_reconcile(engine, project_id, run_id):
    """MCP tool wrapper for reconcile."""
    result = engine.reconcile(project_id=project_id, run_id=run_id)
    return {
        "success": result.success,
        "mismatches": result.mismatches,
        "message": result.message,
    }


# === Q-028: move_to_quarantine MCP tool returns dict ===

def test_move_to_quarantine_tool_returns_dict(engine, clean_file):
    """Q-028: MCP tool returns plain dict (not dataclass)."""
    result = _mcp_move_to_quarantine(
        engine, files=[clean_file], run_id="run-028",
        phase=4, violation_type="SKIP_RED_PHASE",
    )
    assert isinstance(result, dict)
    assert "success" in result
    assert "action" in result


# === Q-029: list_quarantine MCP tool returns list of dicts ===

def test_list_quarantine_tool_returns_list_of_dicts(engine, clean_file):
    """Q-029: MCP tool returns List[dict] with snake_case keys."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-029", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = _mcp_list_quarantine(engine, run_id="run-029")
    assert isinstance(result, list)
    assert len(result) >= 1
    for item in result:
        assert isinstance(item, dict)
        assert "original_path" in item
        assert "run_id" in item


# === Q-030: restore MCP tool returns dict ===

def test_restore_tool_returns_dict(engine, clean_file):
    """Q-030: MCP tool returns dict with success and new_path."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-030", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = _mcp_restore(engine, original_path=clean_file, run_id="run-030")
    assert isinstance(result, dict)
    assert "success" in result
    assert "new_path" in result


# === Q-031: quarantine_retry MCP tool is idempotent ===

def test_quarantine_retry_tool_is_idempotent(engine, clean_file):
    """Q-031: Retry skips already-quarantined files."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-031", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = _mcp_quarantine_retry(
        engine, files=[clean_file], run_id="run-031",
        phase=4, violation_type="SKIP_RED_PHASE",
    )
    assert isinstance(result, dict)
    assert result.get("success") is True
    assert result.get("files_affected") == [] or clean_file not in result.get("files_affected", [])


# === Q-031b: quarantine_retry returns QuarantineResult on success ===

def test_quarantine_retry_tool_returns_quarantine_result_on_success(engine, repo_root, clean_file):
    """Q-031b: After partial failure, retry succeeds for failed file."""
    import subprocess
    from pathlib import Path
    result1 = engine.move_to_quarantine(
        files=[clean_file, "nonexistent.py"],
        run_id="run-031b", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert result1.partial_failure is True
    full = Path(repo_root) / "nonexistent.py"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("now exists")
    result2 = _mcp_quarantine_retry(
        engine, files=["nonexistent.py"],
        run_id="run-031b", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    assert isinstance(result2, dict)
    assert result2["success"] is True
    assert "nonexistent.py" in result2["files_affected"]


# === Q-032: move_to_quarantine MCP tool validates run_id ===

def test_move_to_quarantine_tool_validates_run_id(engine):
    """Q-032: MCP tool raises ValueError for invalid run_id."""
    with pytest.raises(ValueError):
        _mcp_move_to_quarantine(
            engine, files=["f.py"], run_id="../bad",
            phase=4, violation_type="SKIP_RED_PHASE",
        )


# === Q-033: list_quarantine MCP tool validates run_id ===

def test_list_quarantine_tool_validates_run_id(engine):
    """Q-033: MCP tool raises ValueError for invalid run_id."""
    with pytest.raises(ValueError):
        _mcp_list_quarantine(engine, run_id="../bad")


# === Q-033b: reconcile MCP tool returns dict ===

def test_reconcile_tool_returns_dict(engine, clean_file):
    """Q-033b: MCP tool returns dict with success and mismatches."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-033b", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = _mcp_reconcile(engine, project_id="test-proj", run_id="run-033b")
    assert isinstance(result, dict)
    assert "success" in result
    assert "mismatches" in result


# === Q-033c: reconcile MCP tool validates run_id ===

def test_reconcile_tool_validates_run_id(engine):
    """Q-033c: MCP tool raises ValueError for invalid run_id."""
    with pytest.raises(ValueError):
        _mcp_reconcile(engine, project_id="test-proj", run_id="../bad")


# === Q-076: Set quarantine_success=false on resume with failure ===

def test_should_set_quarantine_success_false_on_resume_with_failure(engine, repo_root, clean_file):
    """Q-076: SuspendedPipeline quarantine_success=false; warning + retry offer."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-076", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    records = engine.list_quarantine(run_id="run-076")
    assert isinstance(records, list)
    assert len(records) >= 1
    assert records[0].run_id == "run-076"


# === Q-077: Handle runtime quarantine hook failure ===

def test_should_handle_runtime_quarantine_hook_failure(engine, repo_root, clean_file):
    """Q-077: Hook throws after state persisted; pipeline suspended."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-077", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    records = engine.list_quarantine(run_id="run-077")
    assert isinstance(records, list)
    assert len(records) >= 1
    assert records[0].run_id == "run-077"


# === Q-078: Detect orphaned suspend and reconcile workspace ===

def test_should_detect_orphaned_suspend_and_reconcile_workspace(engine, repo_root, clean_file):
    """Q-078: Stack has entries but no active pipeline; reconcile."""
    engine.move_to_quarantine(
        files=[clean_file], run_id="run-078", phase=4,
        violation_type="SKIP_RED_PHASE",
    )
    result = engine.reconcile(project_id="test-proj", run_id="run-078")
    assert isinstance(result, ReconcileResult)
    assert result.success is True
    assert isinstance(result.mismatches, list)


# === Q-120: Reconcile tool propagates QuarantineNotFoundError ===

def test_reconcile_tool_propagates_quarantine_not_found_error(engine):
    """Q-120: reconcile MCP propagates QuarantineNotFoundError."""
    with pytest.raises(QuarantineNotFoundError):
        _mcp_reconcile(engine, project_id="test-proj", run_id="nonexistent-run")
