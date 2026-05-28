import logging
from typing import Dict, Any
from dataclasses import dataclass

from aristotle_intervention.intervention_types import ViolationEvent

logger = logging.getLogger(__name__)

_DEFAULT_CONFIDENCE = 0.85

@dataclass
class RuleContent:
    frontmatter: Dict[str, Any]
    body: str

VIOLATION_TO_CATEGORY = {
    "SKIP_RED_PHASE": "PATTERN_VIOLATION",
    "MODIFIED_TEST": "PATTERN_VIOLATION",
    "MISSING_TEST": "PATTERN_VIOLATION",
}

class RuleGenerator:
    def build_frontmatter(self, event: ViolationEvent) -> Dict[str, Any]:
        """Build YAML frontmatter dict from a violation event."""
        return {
            "category": VIOLATION_TO_CATEGORY.get(event.violation_type, "UNKNOWN"),
            "confidence": _DEFAULT_CONFIDENCE,
            "error_summary": f"LLM {event.violation_type} in {event.affected_file_path}",
            "auto_reflection": True,
            "source": "tdd-pipeline",
            "intent_tags": {
                "domain": "tdd_pipeline",
                "task_goal": event.violation_type.lower()
            },
            "failed_skill": "tdd_pipeline"
        }

    _VIOLATION_TEMPLATES: Dict[str, str] = {
        "SKIP_RED_PHASE": (
            "## Context\n"
            "During TDD Pipeline execution, the LLM skipped the Red phase and proceeded directly to implementation in phase {phase}.\n\n"
            "## Rule\n"
            "Always write failing tests (Red phase) before implementation code. Every piece of production code must be preceded by a test that fails.\n\n"
            "## Why\n"
            "Skipping the Red phase undermines test-driven development. Tests must fail before implementation to prove they are meaningful and not tautological.\n\n"
            "## Example\n"
            "**Bad**: Write implementation first, then add tests that already pass.\n"
            "**Good**: Write tests that fail, then implement code to make them pass."
        ),
        "MODIFIED_TEST": (
            "## Context\n"
            "During TDD Pipeline execution, the LLM modified an existing test to make it pass without adding new functionality in phase {phase}.\n\n"
            "## Rule\n"
            "Never modify tests to make them pass. If a test fails, fix the implementation — not the test. Tests are specifications, not suggestions.\n\n"
            "## Why\n"
            "Modifying tests to pass defeats the purpose of TDD. A failing test signals a bug or missing feature in production code, not a test problem.\n\n"
            "## Example\n"
            "**Bad**: Change test assertions to match buggy implementation output.\n"
            "**Good**: Fix the implementation so the original test passes."
        ),
        "MISSING_TEST": (
            "## Context\n"
            "During TDD Pipeline execution, the LLM wrote implementation code without a corresponding test in phase {phase}.\n\n"
            "## Rule\n"
            "Every implementation change requires a corresponding test. No production code should exist without test coverage.\n\n"
            "## Why\n"
            "Untested code is unverifiable code. Without tests, there is no safety net to catch regressions or validate behavior.\n\n"
            "## Example\n"
            "**Bad**: Add a new function with no test, planning to write one later.\n"
            "**Good**: Write the test first (Red), then implement the function (Green)."
        ),
    }

    _DEFAULT_TEMPLATE: str = (
        "## Context\n"
        "During TDD Pipeline execution, the LLM {operation} in phase {phase}.\n\n"
        "## Rule\n"
        "Always write failing tests (Red phase) before implementation code. Never modify tests to make them pass without first seeing them fail.\n\n"
        "## Why\n"
        "Skipping the Red phase undermines test-driven development. Tests must fail before implementation to prove they are meaningful and not tautological.\n\n"
        "## Example\n"
        "**Bad**: Write implementation first, then add tests that already pass.\n"
        "**Good**: Write tests that fail, then implement code to make them pass."
    )

    def build_body(self, event: ViolationEvent) -> str:
        """Build Markdown rule body with Context, Rule, Why, and Example sections."""
        phase = event.context.get("phase", "unknown")
        template = self._VIOLATION_TEMPLATES.get(event.violation_type, self._DEFAULT_TEMPLATE)
        if event.violation_type in self._VIOLATION_TEMPLATES:
            return template.format(phase=phase)
        return template.format(
            operation=event.context.get("operation", "performed an action"),
            phase=phase,
        )

    def generate(self, event: ViolationEvent) -> RuleContent:
        """Produce a complete RuleContent (frontmatter + body) from a violation event."""
        return RuleContent(
            frontmatter=self.build_frontmatter(event),
            body=self.build_body(event)
        )
