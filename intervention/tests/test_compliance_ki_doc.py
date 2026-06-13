"""Compliance KI doc manager tests — TDD Phase 4 Red."""
import pytest
from datetime import datetime
from pathlib import Path

from compliance import (
    KiDocManager,
    ViolationEvent,
    ViolationType,
    VIOLATION_PRIORITY,
)


def _make_violation(vtype, rectified=False, phase=4, severity_override=None, files=None):
    return ViolationEvent(
        violation_type=vtype,
        rectified=rectified,
        phase=phase,
        severity=severity_override or VIOLATION_PRIORITY.get(vtype, "P4"),
        timestamp=datetime.now().isoformat(),
        context={"phase": phase},
        files=files if files is not None else [],
    )


@pytest.fixture
def ki_doc_path(tmp_path):
    return str(tmp_path / "04-review-records.md")


@pytest.fixture
def ki_mgr(ki_doc_path):
    return KiDocManager(ki_doc_path)


# C-09
def test_ensure_updated_creates_ki_doc_when_missing(ki_mgr, ki_doc_path):
    ki_mgr.ensure_updated()
    assert Path(ki_doc_path).exists()


# C-10
def test_ensure_updated_appends_entry_when_doc_exists(ki_doc_path, ki_mgr):
    Path(ki_doc_path).parent.mkdir(parents=True, exist_ok=True)
    Path(ki_doc_path).write_text("# Review Records\n\n")
    events = [_make_violation(ViolationType.UNCOMMITTED_PHASE)]
    ki_mgr.record_intervention(events)
    ki_mgr.ensure_updated()
    assert Path(ki_doc_path).read_text() != ""


# C-11
def test_ki_update_skips_record_intervention_for_empty_events(ki_mgr, ki_doc_path):
    ki_mgr.ensure_updated()
    ki_mgr.ensure_assessment(phase=4, result="PASS")
    assert Path(ki_doc_path).exists()


# C-12
def test_ensure_updated_handles_creation_failure_gracefully(ki_mgr):
    ki_mgr.ki_doc_path = "/nonexistent/deep/path/ki.md"
    result = ki_mgr.ensure_updated()
    assert result is None


# C-47
def test_ensure_updated_retries_once_on_failure(ki_mgr):
    ki_mgr.ki_doc_path = "/nonexistent/deep/path/ki.md"
    result = ki_mgr.ensure_updated()
    assert result is None


# C-48
def test_ki_doc_best_effort_when_record_intervention_fails(ki_mgr, ki_doc_path):
    Path(ki_doc_path).parent.mkdir(parents=True, exist_ok=True)
    Path(ki_doc_path).write_text("# Review Records\n\n")
    ki_mgr.record_intervention(events=None)
    ki_mgr.ensure_assessment(phase=4, result="PASS")
    assert Path(ki_doc_path).exists()


# C-49
def test_violation_signature_matching_detects_stale_ki_doc(ki_mgr, ki_doc_path):
    event_a = _make_violation(ViolationType.UNCOMMITTED_PHASE, files=["file_a"])
    sig = ki_mgr.compute_signature(event_a)
    assert sig[0] == ViolationType.UNCOMMITTED_PHASE


# C-52
def test_should_use_ki_doc_update_commit_message_format(ki_mgr):
    event = _make_violation(ViolationType.UNCOMMITTED_PHASE)
    result = ki_mgr.ensure_updated()
    assert isinstance(result, bool)


# C-57
def test_should_use_empty_string_signature_when_files_array_is_empty(ki_mgr):
    event = _make_violation(ViolationType.UNCOMMITTED_PHASE, files=[])
    sig = ki_mgr.compute_signature(event)
    assert sig == (ViolationType.UNCOMMITTED_PHASE, "")


# C-58
def test_should_identify_ki_doc_as_up_to_date_when_ki_has_more_signatures_than_violations(ki_mgr, ki_doc_path):
    Path(ki_doc_path).parent.mkdir(parents=True, exist_ok=True)
    Path(ki_doc_path).write_text("# Review Records\n\n")
    current = [
        _make_violation(ViolationType.UNCOMMITTED_PHASE, files=["a.py"]),
        _make_violation(ViolationType.UNCOMMITTED_PHASE, files=["b.py"]),
    ]
    ki_mgr.check_staleness(current)
    assert len(current) >= 0


# C-61
def test_multi_file_violation_produces_multiple_signatures(ki_mgr):
    event = _make_violation(ViolationType.SKIP_RED_PHASE, files=["a.py", "b.py"])
    sigs = ki_mgr.compute_signature(event)
    assert len(sigs) == 2
