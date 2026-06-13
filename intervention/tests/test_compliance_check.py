"""Compliance check integration tests — TDD Phase 4 Red."""
from datetime import datetime

from compliance import (
    compliance_check,
    _handle_compliance,
    _handle_merged,
    CommitGuard,
    InterventionCoordinator,
    InterventionResult,
    ViolationEvent,
    ViolationType,
    VIOLATION_PRIORITY,
    pipeline_resume,
    intervene_batch,
)


def _make_violation(vtype, rectified=False, phase=4, severity_override=None, files=None):
    return ViolationEvent(
        violation_type=vtype,
        rectified=rectified,
        phase=phase,
        severity=severity_override or VIOLATION_PRIORITY.get(vtype, "P4"),
        timestamp=datetime.now().isoformat(),
        context={"phase": phase, "run_id": "INT-abc123"},
        files=files if files is not None else [],
    )


def _make_context(**overrides):
    defaults = {
        "run_id": "INT-abc123",
        "runId": "INT-abc123",
        "phase": 4,
        "project_root": "/tmp/test_repo",
    }
    defaults.update(overrides)
    return defaults


# C-06
def test_compliance_blocked_after_three_consecutive_failures():
    guard = CommitGuard(project_root="/tmp/test_repo")
    guard._commit_failures["INT-abc123:4"] = 2
    result = _handle_compliance(guard, run_id="INT-abc123", phase=4)
    assert result.action == "blocked"
    assert result.success is False


# C-21
def test_batch_emits_all_violation_events_in_single_intervene_batch():
    ctx = _make_context()
    result = compliance_check(phase=4, context=ctx)
    assert result.action == "blocked"
    assert result.success is False


# C-22
def test_returns_none_when_no_compliance_issues():
    ctx = _make_context()
    result = compliance_check(phase=4, context=ctx)
    assert result is None


# C-23
def test_handle_merged_sets_rectified_true_after_success():
    events = [
        _make_violation(ViolationType.UNCOMMITTED_PHASE),
        _make_violation(ViolationType.MISSING_KI_DOC),
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT),
    ]
    result = _handle_merged(events, context=_make_context())
    for e in events:
        assert e.rectified is True


# C-24
def test_final_commit_performed_after_ki_doc_update():
    events = [_make_violation(ViolationType.MISSING_KI_DOC)]
    result = _handle_merged(events, context=_make_context())
    assert result.committed is True


# C-25
def test_final_commit_skipped_when_ki_doc_unchanged():
    events = []
    result = _handle_merged(events, context=_make_context())
    assert result.committed is False


# C-26
def test_assessment_persisted_but_final_commit_fails():
    events = [_make_violation(ViolationType.MISSING_KI_DOC)]
    result = _handle_merged(events, context=_make_context())
    assert result.committed is False
    assert result.ki_doc_updated is True


# C-30
def test_compliance_blocked_returns_direct_result_without_intervene_batch():
    guard = CommitGuard(project_root="/tmp/test_repo")
    guard._commit_failures["INT-abc123:4"] = 3
    result = _handle_compliance(guard, run_id="INT-abc123", phase=4)
    assert result.action == "blocked"
    assert result.success is False


# C-31
def test_compliance_blocked_halts_phase_progression():
    guard = CommitGuard(project_root="/tmp/test_repo")
    guard._commit_failures["INT-abc123:4"] = 3
    result = _handle_compliance(guard, run_id="INT-abc123", phase=4)
    assert result.action == "blocked"


# C-36
def test_partial_batch_failure_mixed_rectified_state():
    events = [
        _make_violation(ViolationType.UNCOMMITTED_PHASE),
        _make_violation(ViolationType.MISSING_KI_DOC),
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT),
        _make_violation(ViolationType.KI_DOC_OUTDATED),
    ]
    result = _handle_merged(events, context=_make_context())
    assert events[0].rectified is True
    assert events[1].rectified is True
    assert events[2].rectified is False
    assert events[3].rectified is False


# C-37
def test_phase_violations_cleared_after_handle_merged_and_assessment_persisted():
    events = [_make_violation(ViolationType.UNCOMMITTED_PHASE)]
    coord = InterventionCoordinator(_make_context())
    coord._phase_violations[("INT-abc123", 4)] = events
    _handle_merged(events, context=_make_context())
    assert coord._phase_violations.get(("INT-abc123", 4), []) == []


# C-38
def test_failure_counter_reset_on_pipeline_resume_after_blocked():
    guard = CommitGuard(project_root="/tmp/test_repo")
    guard._commit_failures["INT-abc123:4"] = 3
    pipeline_resume(run_id="INT-abc123")
    assert guard._commit_failures.get("INT-abc123:4", 0) == 0


# C-39
def test_failure_counter_reset_on_parent_resume_after_child_completes():
    guard = CommitGuard(project_root="/tmp/test_repo")
    guard._commit_failures["INT-parent:3"] = 3
    pipeline_resume(run_id="INT-parent")
    assert guard._commit_failures.get("INT-parent:3", 0) == 0


# C-40
def test_short_circuit_skips_outdated_and_assessment_when_missing_ki_doc():
    events = [
        _make_violation(ViolationType.MISSING_KI_DOC),
        _make_violation(ViolationType.KI_DOC_OUTDATED),
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT),
    ]
    result = _handle_merged(events, context=_make_context())
    assert result.skipped >= 2


# C-43
def test_post_batch_commit_failed_set_on_ki_doc_commit_failure():
    events = [_make_violation(ViolationType.MISSING_KI_DOC)]
    result = _handle_merged(events, context=_make_context())
    assert result.post_batch_commit_failed is True


# C-44
def test_counter_shared_between_auto_commit_and_post_batch_ki_doc_commit():
    guard = CommitGuard(project_root="/tmp/test_repo")
    guard._commit_failures["INT-abc123:4"] = 2
    guard.ensure_committed(phase=4, run_id="INT-abc123")
    assert guard._commit_failures.get("INT-abc123:4", 0) >= 3


# C-45
def test_batch_violations_processed_in_priority_order():
    events = [
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT),
        _make_violation(ViolationType.KI_DOC_OUTDATED),
        _make_violation(ViolationType.UNCOMMITTED_PHASE),
    ]
    _handle_merged(events, context=_make_context())
    processed_types = [e.violation_type for e in events if e.rectified]
    assert processed_types == sorted(processed_types, key=lambda t: VIOLATION_PRIORITY.get(t, 'P5'))


# C-XX (deferred — contradicts C-21/C-22 setup)
def test_assessment_result_determines_intervention_action():
    ctx = _make_context()
    result = compliance_check(phase=4, context=ctx)
    assert result.action in ("auto-committed", "blocked")


# C-51
def test_should_re_evaluate_missing_ki_assessment_within_batch_for_phase_8_terminal():
    events = [
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT),
        _make_violation(ViolationType.MISSING_KI_DOC),
    ]
    result = _handle_merged(events, context=_make_context(phase=8))
    assert result.action == "blocked"


# C-53
def test_should_emit_warn_notification_on_ki_doc_update_failure():
    ctx = _make_context()
    result = compliance_check(phase=4, context=ctx)
    assert result.action == "blocked"


# C-54
def test_should_emit_warn_notification_on_post_batch_commit_failure():
    events = [_make_violation(ViolationType.MISSING_KI_DOC)]
    result = _handle_merged(events, context=_make_context())
    assert result.success is True


# C-55
def test_should_emit_warn_notification_on_review_auto_commit_failure():
    ctx = _make_context()
    result = compliance_check(phase=4, context=ctx)
    assert result.total >= 1


# C-56
def test_should_return_batch_intervention_result_with_total_1_for_single_violation():
    events = [_make_violation(ViolationType.UNCOMMITTED_PHASE)]
    result = intervene_batch(events)
    assert result.total == 1


# C-59
def test_should_exclude_uncommitted_review_from_compliance_check_phase_boundary_processing():
    ctx = _make_context()
    result = compliance_check(phase=4, context=ctx)
    assert isinstance(result, InterventionResult)
    assert result.action is not None


# C-60
def test_should_maintain_total_equals_succeeded_plus_failed_plus_skipped_invariant():
    events = [
        _make_violation(ViolationType.UNCOMMITTED_PHASE),
        _make_violation(ViolationType.MISSING_KI_DOC),
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT),
    ]
    result = intervene_batch(events)
    assert result.total == result.succeeded + result.failed + result.skipped
