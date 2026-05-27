import logging
from typing import Dict, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

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
    def build_frontmatter(self, event) -> Dict[str, Any]:
        return {
            "category": VIOLATION_TO_CATEGORY.get(event.violation_type, "UNKNOWN"),
            "confidence": 0.85,
            "error_summary": f"LLM {event.violation_type} in {event.affected_file_path}",
            "auto_reflection": True,
            "source": "tdd-pipeline",
            "intent_tags": {
                "domain": "tdd_pipeline",
                "task_goal": event.violation_type.lower()
            },
            "failed_skill": "tdd_pipeline"
        }

    def build_body(self, event) -> str:
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

    def generate(self, event) -> RuleContent:
        return RuleContent(
            frontmatter=self.build_frontmatter(event),
            body=self.build_body(event)
        )
