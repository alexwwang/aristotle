import pytest
import sys
from rule_generator import RuleGenerator
from watchdog import ViolationEvent

class TestRuleGenerator:
    def test_build_frontmatter_contains_auto_reflection(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        generator = RuleGenerator()
        frontmatter = generator.build_frontmatter(event)
        assert frontmatter.get("auto_reflection") is True
        assert frontmatter.get("source") == "tdd-pipeline"

    def test_build_frontmatter_contains_category(self):
        event = ViolationEvent(
            violation_type="MODIFIED_TEST",
            affected_file_path="tests/test.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "modify", "phase": 5}
        )
        generator = RuleGenerator()
        frontmatter = generator.build_frontmatter(event)
        assert "category" in frontmatter
        assert frontmatter["category"] is not None

    def test_build_body_contains_context(self):
        event = ViolationEvent(
            violation_type="MISSING_TEST",
            affected_file_path="src/utils.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        generator = RuleGenerator()
        body = generator.build_body(event)
        assert "## Context" in body
        assert "## Rule" in body
        assert "## Why" in body
        assert "## Example" in body

    def test_generate_returns_rule_content(self):
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        generator = RuleGenerator()
        rule = generator.generate(event)
        assert rule is not None
        assert rule.frontmatter is not None
        assert rule.body is not None
