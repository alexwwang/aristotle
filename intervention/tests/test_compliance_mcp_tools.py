"""Compliance MCP assess tool tests — TDD Phase 4 Red."""
import pytest
from datetime import datetime

from compliance import (
    assess,
    InterventionCoordinator,
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
        context={"phase": phase, "run_id": "INT-abc123"},
        files=files if files is not None else [],
    )


# C-27
def test_assess_tool_returns_json_with_priority_counts():
    result = assess(phase=4, run_id="INT-abc123")
    assert result["assessmentResult"] == "PASS"
    assert "priorityCounts" in result


# C-28
def test_assess_tool_accesses_phase_violations_registry():
    coordinator = InterventionCoordinator()
    coordinator._phase_violations[("INT-abc123", 4)] = [
        _make_violation(ViolationType.REGRESSION, rectified=False),
        _make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3"),
        _make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3"),
        _make_violation(ViolationType.REGRESSION, rectified=False, severity_override="P3"),
    ]
    result = assess(phase=4, run_id="INT-abc123")
    assert "assessmentResult" in result


# C-29
def test_assess_tool_returns_pass_for_empty_phase_violations():
    coordinator = InterventionCoordinator()
    result = assess(phase=4, run_id="INT-abc123")
    assert result["assessmentResult"] == "PASS"
    assert result["unrectifiedTotal"] == 0
