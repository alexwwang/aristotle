"""Compliance assessment computation tests — TDD Phase 4 Red."""
import pytest
from datetime import datetime

from compliance import (
    compute_assessment_from_violations,
    AssessmentResult,
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


# C-13
def test_compute_assessment_fail_when_p1_unrectified():
    violations = [
        _make_violation(ViolationType.SKIP_RED_PHASE, rectified=False),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False),
        _make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3"),
        _make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3"),
        _make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3"),
    ]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result == AssessmentResult(
        assessment_result="FAIL",
        priority_counts={"P1": 1, "P2": 2, "P3": 3, "P4": 0, "P5": 0},
        unrectified_total=6,
    )


# C-14
def test_compute_assessment_conditional_when_p2_ge_three():
    violations = [_make_violation(ViolationType.SKIP_REVIEW, rectified=False) for _ in range(4)]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result == AssessmentResult(
        assessment_result="CONDITIONAL",
        priority_counts={"P1": 0, "P2": 4, "P3": 0, "P4": 0, "P5": 0},
        unrectified_total=4,
    )


# C-15
def test_compute_assessment_conditional_at_exact_p2_threshold():
    violations = [_make_violation(ViolationType.SKIP_REVIEW, rectified=False) for _ in range(3)]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result.assessment_result == "CONDITIONAL"


# C-16
def test_compute_assessment_pass_when_p2_below_threshold_and_no_p1():
    violations = [
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False),
        *[_make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3") for _ in range(5)],
    ]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result == AssessmentResult(
        assessment_result="PASS",
        priority_counts={"P1": 0, "P2": 1, "P3": 5, "P4": 0, "P5": 0},
        unrectified_total=6,
    )


# C-17
def test_compute_assessment_pass_when_all_violations_rectified():
    violations = [
        _make_violation(ViolationType.SKIP_RED_PHASE, rectified=True),
        _make_violation(ViolationType.SKIP_RED_PHASE, rectified=True),
        _make_violation(ViolationType.SKIP_RED_PHASE, rectified=True),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=True),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=True),
    ]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result.assessment_result == "PASS"
    assert all(v == 0 for v in result.priority_counts.values())


# C-18
def test_compute_assessment_pass_when_no_violations():
    result = compute_assessment_from_violations([], phase=4)
    assert result == AssessmentResult(
        assessment_result="PASS",
        priority_counts={"P1": 0, "P2": 0, "P3": 0, "P4": 0, "P5": 0},
        unrectified_total=0,
    )


# C-19
def test_compute_assessment_pass_when_only_p4_p5_unrectified():
    violations = [
        _make_violation(ViolationType.UNCOMMITTED_PHASE, rectified=False),
        _make_violation(ViolationType.UNCOMMITTED_PHASE, rectified=False),
        _make_violation(ViolationType.MISSING_KI_ASSESSMENT, rectified=False),
    ]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result.assessment_result == "PASS"


# C-20
def test_compute_assessment_counts_current_phase_only():
    violations = [
        _make_violation(ViolationType.SKIP_RED_PHASE, rectified=False, phase=3),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False, phase=4),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False, phase=4),
    ]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result.assessment_result == "PASS"


# C-35
def test_p3_regression_reclassified_to_p2():
    violations = [_make_violation(ViolationType.REGRESSION, rectified=False)]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result.priority_counts["P3"] == 0
    assert result.priority_counts["P2"] >= 1


# C-41
def test_p_severity_excluded_from_priority_counts_and_unrectified_total():
    violations = [
        _make_violation(ViolationType.SKIP_RED_PHASE, rectified=False),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False),
        _make_violation(ViolationType.SKIP_REVIEW, rectified=False, severity_override="P0"),
    ]
    result = compute_assessment_from_violations(violations, phase=4)
    assert result.priority_counts == {"P1": 1, "P2": 1, "P3": 0, "P4": 0, "P5": 0}
    assert result.unrectified_total == 2
    assert result.assessment_result == "FAIL"


# C-42
@pytest.mark.parametrize(
    "scenario",
    [
        "fail_1xp1",
        "conditional_3xp2",
        "pass_1xp3",
        "empty",
    ],
)
def test_priority_counts_always_has_all_five_keys(scenario):
    violations_map = {
        "fail_1xp1": [_make_violation(ViolationType.SKIP_RED_PHASE, rectified=False)],
        "conditional_3xp2": [_make_violation(ViolationType.SKIP_REVIEW, rectified=False) for _ in range(3)],
        "pass_1xp3": [_make_violation(ViolationType.REGRESSION, rectified=False)],
        "empty": [],
    }
    result = compute_assessment_from_violations(violations_map[scenario], phase=4)
    for key in ("P1", "P2", "P3", "P4", "P5"):
        assert key in result.priority_counts
