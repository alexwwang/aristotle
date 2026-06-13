"""GPAVValidator — validates GPAV submissions in 5 ordered steps.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class GPAVValidationResult:
    valid: bool = False
    rejection_step: Optional[int] = None
    rejection_reason: str = ""
    truncated_findings: List[dict] = field(default_factory=list)
    steps_executed: List[int] = field(default_factory=list)


class GPAVValidator:
    def validate(self, submission: dict) -> GPAVValidationResult:
        raise NotImplementedError
