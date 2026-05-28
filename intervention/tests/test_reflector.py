import pytest
import sys
sys.path.insert(0, "/workspace/auto-reflection-feature/src")
from aristotle_intervention.reflector import AutoReflector
from aristotle_intervention.watchdog import ViolationEvent

class TestAutoReflector:
    def test_build_reflection_prompt_contains_violation_type(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        reflector = AutoReflector()
        prompt = reflector.build_reflection_prompt(event)
        assert "SKIP_RED_PHASE" in prompt
        assert "src/calc.py" in prompt
        assert "create" in prompt

    def test_build_reflection_prompt_contains_tdd_context(self):
        event = ViolationEvent(
            violation_type="MODIFIED_TEST",
            affected_file_path="tests/test.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "modify", "phase": 5}
        )
        reflector = AutoReflector()
        prompt = reflector.build_reflection_prompt(event)
        assert "TDD Pipeline" in prompt or "tdd" in prompt.lower()

    def test_reflect_with_mcp_available(self):
        event = ViolationEvent(
            violation_type="MISSING_TEST",
            affected_file_path="src/utils.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        reflector = AutoReflector()
        result = reflector.reflect(event)
        assert result is not None
        assert result.success
        assert result.rule_id is not None

    def test_reflect_with_mcp_unavailable(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        reflector = AutoReflector(mcp_available=False)
        result = reflector.reflect(event)
        assert result is None or not result.success
