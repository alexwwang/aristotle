"""Handlers for violation types.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class InterventionResult:
    success: bool = False
    action: str = ""
    pipeline_action: Optional[str] = None
    files_affected: List[str] = field(default_factory=list)
    user_message: str = ""
    child_run_id: Optional[str] = None
    subagent_spawn_request: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class Handlers:
    def handle_modified_test(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_missing_test(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_regression(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_skip_red_phase(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_skip_review(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_insufficient_review(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_unfixed_issues(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_invalid_review_prompt(self, event: Any, context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_compliance(self, events: List[Any], context: Any) -> InterventionResult:
        raise NotImplementedError

    def handle_merged(self, events: List[Any], context: Any) -> InterventionResult:
        raise NotImplementedError

    def intervene_batch(self, events: List[Any], context: Any) -> List[InterventionResult]:
        raise NotImplementedError
