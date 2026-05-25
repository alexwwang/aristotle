"""Tests for watchdog module."""
import pytest
import sys
sys.path.insert(0, "/workspace/auto-reflection-feature/src")
from aristotle_auto_reflection.watchdog import ViolationFilter, ViolationEvent

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
