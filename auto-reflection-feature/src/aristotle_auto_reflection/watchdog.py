"""GPAV integration and violation detection."""
from dataclasses import dataclass
from typing import Optional, Dict, Any

@dataclass
class ViolationEvent:
    violation_type: str
    affected_file_path: str
    timestamp: str
    context: Dict[str, Any]

BEHAVIORAL_VIOLATIONS = {"SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST"}
TDD_PHASES = {4, 5}

class ViolationFilter:
    def filter(self, event: ViolationEvent) -> Optional[ViolationEvent]:
        if event.violation_type not in BEHAVIORAL_VIOLATIONS:
            return None
        phase = event.context.get("phase")
        if phase not in TDD_PHASES:
            return None
        return event
