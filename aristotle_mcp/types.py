"""
Phase 4 stub — type definitions.
Business code isolated to _phase5_ref/types.py for TDD Red phase.
Types are dataclass definitions — kept in full since they contain no business logic.
"""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ViolationEvent:
    violation_type: str
    timestamp: str
    file: str = ""
    phase: int = 0
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class RollbackResult:
    success: bool
    stash_ref: str = ""
    pipeline_reset_required: bool = False
    message: str = ""


@dataclass
class PipelineContext:
    phase: int = 1
    run_id: str = ""
    observer_timeout_count: int = 0
    audit_entry_count: int = 0
    eviction_needed: bool = False


@dataclass
class InterventionRecord:
    violation: ViolationEvent
    action_taken: str = ""
    timestamp: str = ""
    success: bool = False
    rollback_result: RollbackResult | None = None
