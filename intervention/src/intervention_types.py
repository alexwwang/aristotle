"""Data models and constants for Watchdog Intervention.

Dataclasses are structural placeholders (no methods with business logic).
VIOLATION_PRIORITY is a production lookup table used by InterventionCoordinator.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List

__all__ = [
    "ViolationEvent",
    "InterventionPlan",
    "RollbackResult",
    "CommitResult",
    "PatternMatch",
    "ValidationResult",
    "TestResult",
    "PipelineContext",
    "InterventionResult",
    "BEHAVIORAL_VIOLATIONS",
    "VIOLATION_PRIORITY",
]


@dataclass
class ViolationEvent:
    """Existing event type from watchdog.py — re-exported for convenience."""

    violation_type: str
    affected_file_path: str
    timestamp: str
    context: Dict[str, Any]
    affected_file_paths: List[str] = field(default_factory=list)
    rectified: bool = False


@dataclass
class InterventionPlan:
    """Replaces RemediationPlan. Stub — all fields optional for construction."""

    target_phase: int = 0
    auto_fix: bool = False
    needs_rollback: bool = False
    is_destructive: bool = False
    instruction: str = ""


@dataclass
class RollbackResult:
    """Outcome of a git-rollback attempt for an intervention."""

    success: bool = False
    action: str = ""
    files_affected: List[str] = field(default_factory=list)
    git_hash: Optional[str] = None
    partial_failure: bool = False
    failed_files: List[str] = field(default_factory=list)


@dataclass
class CommitResult:
    """Outcome of an auto-commit operation."""

    success: bool = False
    action: str = ""
    hash: Optional[str] = None


@dataclass
class PatternMatch:
    """A single forbidden-pattern match found during prompt validation."""

    category: str = ""
    pattern: str = ""
    line_number: int = 0
    language: str = ""


@dataclass
class ValidationResult:
    """Aggregated result of forbidden-pattern validation across all languages."""

    is_valid: bool = True
    matches: List[PatternMatch] = field(default_factory=list)


@dataclass
class TestResult:
    """Record of a single test execution within a pipeline phase."""

    test_name: str = ""
    passed: bool = False
    error_message: Optional[str] = None
    execution_time: Optional[float] = None


@dataclass
class PipelineContext:
    """Runtime context carried across pipeline phases and loop rounds."""

    current_phase: int = 0
    req_number: str = ""
    loop_round: Optional[int] = None
    stage: str = ""
    boundary_commit_hash: Optional[str] = None
    phase5_test_results: Optional[List[TestResult]] = None
    ki_doc_path: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class InterventionResult:
    """Final outcome produced after processing a violation through the intervention pipeline."""

    violation_code: str = ""
    violation_type: str = ""
    target_phase: int = 0
    auto_fix_applied: bool = False
    auto_fix_details: str = ""
    instruction: str = ""
    ki_doc_updated: bool = False
    committed: bool = False
    rollback_result: Optional[RollbackResult] = None
    validation_result: Optional[ValidationResult] = None


BEHAVIORAL_VIOLATIONS = frozenset({"SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST", "REGRESSION"})


# Priority table for violation types
VIOLATION_PRIORITY = {
    "SKIP_RED_PHASE": 1,
    "MODIFIED_TEST": 1,
    "MISSING_TEST": 1,
    "SKIP_REVIEW": 2,
    "INSUFFICIENT_REVIEW": 2,
    "UNFIXED_ISSUES": 2,
    "INVALID_REVIEW_PROMPT": 2,
    "REGRESSION": 3,
    "MISSING_KI_DOC": 4,
    "KI_DOC_OUTDATED": 4,
    "UNCOMMITTED_PHASE": 4,
    "UNCOMMITTED_REVIEW": 4,
    "MISSING_KI_ASSESSMENT": 5,
}
