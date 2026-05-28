"""Tests for watchdog module and intervention coordinator."""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aristotle_auto_reflection.watchdog import ViolationFilter
from aristotle_auto_reflection.intervention_types import ViolationEvent, PipelineContext
from aristotle_auto_reflection.intervention_coordinator import (
    InterventionCoordinator,
    TDDViolationError,
)


def _make_context(**overrides):
    """Build a PipelineContext with sensible defaults."""
    defaults = dict(
        current_phase=4,
        req_number="REQ-001",
        loop_round=1,
        stage="phase_boundary",
        boundary_commit_hash="abc123",
        ki_doc_path="/tmp/ki.md",
        metadata={"round_results": []},
    )
    defaults.update(overrides)
    return PipelineContext(**defaults)


def _event(vtype, filepath="", phase=4, **ctx_extra):
    """Shorthand to create a ViolationEvent."""
    ctx = {"phase": phase}
    ctx.update(ctx_extra)
    return ViolationEvent(vtype, filepath, "2026-05-25T10:00:00Z", ctx)


class TestViolationFilter:
    def test_filter_passes_valid_skip_red_phase(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is not None
        assert result.violation_type == "SKIP_RED_PHASE"

    def test_filter_passes_valid_modified_test(self):
        event = ViolationEvent(
            violation_type="MODIFIED_TEST",
            affected_file_path="tests/test_calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "modify", "phase": 5}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is not None

    def test_filter_passes_valid_missing_test(self):
        event = ViolationEvent(
            violation_type="MISSING_TEST",
            affected_file_path="src/utils.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is not None

    def test_filter_rejects_invalid_phase(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 6}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is None

    def test_filter_rejects_non_behavioral_violation(self):
        event = ViolationEvent(
            violation_type="CODE_QUALITY",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is None

    def test_filter_rejects_invalid_operation(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "unknown", "phase": 4}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is None

    def test_filter_rejects_missing_operation(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"phase": 4}
        )
        filter_obj = ViolationFilter()
        result = filter_obj.filter(event)
        assert result is None


class TestInterventionCoordinator:
    """Rewritten from TestWatchdogIntervener — uses InterventionCoordinator API."""

    def test_intervene_skip_red_phase(self):
        coord = InterventionCoordinator(_make_context())
        event = _event("SKIP_RED_PHASE", "src/calc.py", phase=5)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "SKIP_RED_PHASE"
        assert exc_info.value.plan.target_phase == 5
        assert exc_info.value.plan.auto_fix is True
        assert exc_info.value.plan.is_destructive is True
        assert "test" in exc_info.value.plan.instruction.lower()

    def test_intervene_modified_test(self):
        coord = InterventionCoordinator(_make_context())
        event = _event("MODIFIED_TEST", "tests/test_calc.py", phase=5)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "MODIFIED_TEST"
        assert exc_info.value.plan.target_phase == 5
        assert "test" in exc_info.value.plan.instruction.lower()

    def test_intervene_missing_test(self):
        coord = InterventionCoordinator(_make_context())
        event = _event("MISSING_TEST", "src/utils.py", phase=5)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "MISSING_TEST"
        assert exc_info.value.plan.target_phase == 5
        assert exc_info.value.plan.needs_rollback is False

    def test_intervene_process_skip_review(self):
        coord = InterventionCoordinator(_make_context())
        event = _event("SKIP_REVIEW", phase=1)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "SKIP_REVIEW"
        assert exc_info.value.plan.target_phase == 1
        assert "review" in exc_info.value.plan.instruction.lower()

    def test_intervene_process_unfixed_issues(self):
        coord = InterventionCoordinator(_make_context())
        event = _event("UNFIXED_ISSUES", phase=2, issues=["H-1", "M-2"])
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.result.violation_code == "UNFIXED_ISSUES"
        assert exc_info.value.plan.target_phase == 2
        assert "fix" in exc_info.value.plan.instruction.lower()

    def test_missing_test_no_skeleton_created(self):
        """New coordinator does NOT create test skeleton files."""
        coord = InterventionCoordinator(_make_context())
        event = _event("MISSING_TEST", "src/new_module.py", phase=5)
        with pytest.raises(TDDViolationError):
            coord.intervene(event)
        test_path = os.path.join(os.path.dirname(__file__), "test_new_module_test.py")
        assert not os.path.exists(test_path)
