"""PriorityPipeline — sorts and processes violations by priority.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from typing import List, Any
from intervention_types import ViolationEvent, InterventionResult


class ValidityEliminator:
    def eliminate(self, pending: List[ViolationEvent], applied: ViolationEvent) -> List[ViolationEvent]:
        raise NotImplementedError


class PriorityPipeline:
    def __init__(self, coordinator: Any = None, eliminator: ValidityEliminator = None) -> None:
        self.coordinator = coordinator
        self.eliminator = eliminator or ValidityEliminator()

    def process_concurrent(self, events: List[ViolationEvent]) -> List[InterventionResult]:
        raise NotImplementedError
