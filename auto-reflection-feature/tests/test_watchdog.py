"""Tests for watchdog module and intervener."""
import pytest
import sys
import os
sys.path.insert(0, "/workspace/auto-reflection-feature/src")
from aristotle_auto_reflection.watchdog import ViolationFilter, ViolationEvent
from aristotle_auto_reflection.intervener import WatchdogIntervener, TDDViolationError, RemediationPlan

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

class TestWatchdogIntervener:
    def test_intervene_skip_red_phase(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 5}
        )
        intervener = WatchdogIntervener()
        with pytest.raises(TDDViolationError) as exc_info:
            intervener.intervene(event)
        assert "PHASE-4-RED" in str(exc_info.value)
        assert "Write failing tests" in str(exc_info.value)

    def test_intervene_modified_test(self):
        event = ViolationEvent(
            violation_type="MODIFIED_TEST",
            affected_file_path="tests/test_calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "modify", "phase": 5}
        )
        intervener = WatchdogIntervener()
        with pytest.raises(TDDViolationError) as exc_info:
            intervener.intervene(event)
        assert "PHASE-5-GREEN" in str(exc_info.value)

    def test_intervene_missing_test(self):
        event = ViolationEvent(
            violation_type="MISSING_TEST",
            affected_file_path="src/utils.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 5}
        )
        intervener = WatchdogIntervener()
        with pytest.raises(TDDViolationError) as exc_info:
            intervener.intervene(event)
        assert "PHASE-4-RED" in str(exc_info.value)

    def test_intervene_process_skip_review(self):
        event = ViolationEvent(
            violation_type="SKIP_REVIEW",
            affected_file_path="docs/01-requirements.md",
            timestamp="2026-05-25T10:00:00Z",
            context={"phase": 1}
        )
        intervener = WatchdogIntervener()
        with pytest.raises(TDDViolationError) as exc_info:
            intervener.intervene(event)
        assert "PHASE-1-DESIGN" in str(exc_info.value)
        assert "Ralph Loop Review" in str(exc_info.value)

    def test_intervene_process_unfixed_issues(self):
        event = ViolationEvent(
            violation_type="UNFIXED_ISSUES",
            affected_file_path="docs/02-technical-solution.md",
            timestamp="2026-05-25T10:00:00Z",
            context={"phase": 2, "issues": ["H-1", "M-2"]}
        )
        intervener = WatchdogIntervener()
        with pytest.raises(TDDViolationError) as exc_info:
            intervener.intervene(event)
        assert "PHASE-2-SOLUTION" in str(exc_info.value)
        assert "Fix 2 open issues" in str(exc_info.value)

    def test_auto_remediate_creates_test_skeleton(self):
        event = ViolationEvent(
            violation_type="MISSING_TEST",
            affected_file_path="src/new_module.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 5}
        )
        intervener = WatchdogIntervener()
        try:
            intervener.intervene(event)
        except TDDViolationError:
            pass
        test_path = "/workspace/auto-reflection-feature/tests/test_new_module_test.py"
        assert os.path.exists(test_path), "Test skeleton should be created"
