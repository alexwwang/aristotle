"""GPAV integration and violation detection."""
from typing import Optional, Dict, Any
from aristotle_auto_reflection.intervention_types import ViolationEvent, BEHAVIORAL_VIOLATIONS

TDD_PHASES = {4, 5}
VALID_OPERATIONS = {"create", "modify", "delete"}

class ViolationFilter:
    def filter(self, event: ViolationEvent) -> Optional[ViolationEvent]:
        """Return *event* if it is a behavioral violation in a TDD phase with a valid operation, else None."""
        if event.violation_type not in BEHAVIORAL_VIOLATIONS:
            return None
        phase = event.context.get("phase")
        if phase not in TDD_PHASES:
            return None
        operation = event.context.get("operation")
        if operation not in VALID_OPERATIONS:
            return None
        return event
