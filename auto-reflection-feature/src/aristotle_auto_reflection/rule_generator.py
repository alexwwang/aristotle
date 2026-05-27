import logging
from typing import Dict, Any
from dataclasses import dataclass

from aristotle_auto_reflection.intervention_types import ViolationEvent

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

    def build_body(self, event: ViolationEvent) -> str:
        """Build Markdown rule body with Context, Rule, Why, and Example sections."""
        return f"""## Context
During TDD Pipeline execution, the LLM {event.context.get("operation", "performed an action")} in phase {event.context.get("phase", "unknown")}.

## Rule
Always write failing tests (Red phase) before implementation code. Never modify tests to make them pass without first seeing them fail.

## Why
Skipping the Red phase undermines test-driven development. Tests must fail before implementation to prove they are meaningful and not tautological.

## Example
**Bad**: Write implementation first, then add tests that already pass.
**Good**: Write tests that fail, then implement code to make them pass.
"""

    def generate(self, event: ViolationEvent) -> RuleContent:
        """Produce a complete RuleContent (frontmatter + body) from a violation event."""
        return RuleContent(
            frontmatter=self.build_frontmatter(event),
            body=self.build_body(event)
        )
