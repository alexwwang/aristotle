"""PriorityPipeline — sorts and processes violations by priority with validity elimination."""
from collections import deque
from typing import List, Any

from intervention_types import ViolationEvent, InterventionResult, VIOLATION_PRIORITY


_P2_TYPES = {"REGRESSION", "UNFIXED_ISSUES", "SKIP_REVIEW", "INSUFFICIENT_REVIEW", "INVALID_REVIEW_PROMPT"}
_SUSPEND_TRIGGER_TYPES = {"MODIFIED_TEST", "MISSING_TEST"}


class ValidityEliminator:
    def eliminate(self, pending: List[ViolationEvent], applied: ViolationEvent) -> List[ViolationEvent]:
        return self.eliminate_with_result(pending, applied, None)

    def eliminate_with_result(self, pending: List[ViolationEvent], applied_event: ViolationEvent,
                              applied_result: Any = None) -> List[ViolationEvent]:
        if not pending:
            return []

        applied_type = applied_event.violation_type
        applied_files = set(
            applied_event.affected_file_paths
            or ([applied_event.affected_file_path] if applied_event.affected_file_path else [])
        )

        triggers_suspend = applied_type in _SUSPEND_TRIGGER_TYPES
        if applied_result is not None:
            pa = getattr(applied_result, "pipeline_action", None)
            if pa is not None and pa not in ("suspended", "suspend"):
                triggers_suspend = False

        result = []
        for ev in pending:
            ev_files = set(
                ev.affected_file_paths
                or ([ev.affected_file_path] if ev.affected_file_path else [])
            )
            if triggers_suspend and ev.violation_type in _P2_TYPES:
                continue
            if applied_files and ev_files and applied_files & ev_files:
                continue
            result.append(ev)
        return result


class PriorityPipeline:
    def __init__(self, coordinator: Any = None, eliminator: ValidityEliminator = None) -> None:
        self.coordinator = coordinator
        self.eliminator = eliminator or ValidityEliminator()

    def process_concurrent(self, events: List[ViolationEvent]) -> List[InterventionResult]:
        if not events:
            return []

        for ev in events:
            if ev.violation_type not in VIOLATION_PRIORITY:
                raise ValueError(
                    f"Unknown violation type '{ev.violation_type}' — not in VIOLATION_PRIORITY"
                )

        indexed = list(enumerate(events))
        indexed.sort(
            key=lambda ix: (VIOLATION_PRIORITY.get(ix[1].violation_type, 99), ix[0]),
        )
        ordered = [ev for _, ev in indexed]

        remaining = deque(ordered)
        results: List[InterventionResult] = []
        first_event = True
        suspend_elimination_done = False
        while remaining:
            current = remaining.popleft()
            result = self._dispatch(current)
            results.append(result)

            is_suspend_trigger = current.violation_type in _SUSPEND_TRIGGER_TYPES
            effective_suspend = (
                is_suspend_trigger and first_event and not suspend_elimination_done
            )
            if effective_suspend:
                suspend_elimination_done = True
            first_event = False

            new_remaining = []
            applied_files = set(
                current.affected_file_paths
                or ([current.affected_file_path] if current.affected_file_path else [])
            )
            for ev in list(remaining):
                ev_files = set(
                    ev.affected_file_paths
                    or ([ev.affected_file_path] if ev.affected_file_path else [])
                )
                if effective_suspend and ev.violation_type in _P2_TYPES:
                    continue
                if applied_files and ev_files and applied_files & ev_files:
                    continue
                new_remaining.append(ev)
            remaining = deque(new_remaining)

        return results

    def _dispatch(self, event: ViolationEvent) -> InterventionResult:
        if self.coordinator is not None:
            method = getattr(self.coordinator, "intervene", None)
            if method is not None:
                result = method(event)
                if result is not None:
                    if not getattr(result, "violation_type", ""):
                        result.violation_type = event.violation_type
                    return result
        return InterventionResult(
            violation_code=event.violation_type,
            violation_type=event.violation_type,
        )
