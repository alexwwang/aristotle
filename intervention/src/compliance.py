"""Compliance auto-fix module — TDD Phase 4 Red stubs.

All functions and methods raise NotImplementedError.
Business logic will be implemented in the Green phase.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, List, Any


class ViolationType(str, Enum):
    SKIP_RED_PHASE = "SKIP_RED_PHASE"
    MODIFIED_TEST = "MODIFIED_TEST"
    MISSING_TEST = "MISSING_TEST"
    SKIP_REVIEW = "SKIP_REVIEW"
    INSUFFICIENT_REVIEW = "INSUFFICIENT_REVIEW"
    UNFIXED_ISSUES = "UNFIXED_ISSUES"
    INVALID_REVIEW_PROMPT = "INVALID_REVIEW_PROMPT"
    REGRESSION = "REGRESSION"
    MISSING_KI_DOC = "MISSING_KI_DOC"
    KI_DOC_OUTDATED = "KI_DOC_OUTDATED"
    UNCOMMITTED_PHASE = "UNCOMMITTED_PHASE"
    UNCOMMITTED_REVIEW = "UNCOMMITTED_REVIEW"
    MISSING_KI_ASSESSMENT = "MISSING_KI_ASSESSMENT"


VIOLATION_PRIORITY: Dict[ViolationType, str] = {
    ViolationType.SKIP_RED_PHASE: "P1",
    ViolationType.MODIFIED_TEST: "P1",
    ViolationType.MISSING_TEST: "P1",
    ViolationType.SKIP_REVIEW: "P2",
    ViolationType.INSUFFICIENT_REVIEW: "P2",
    ViolationType.UNFIXED_ISSUES: "P2",
    ViolationType.INVALID_REVIEW_PROMPT: "P2",
    ViolationType.REGRESSION: "P3",
    ViolationType.MISSING_KI_DOC: "P4",
    ViolationType.KI_DOC_OUTDATED: "P4",
    ViolationType.UNCOMMITTED_PHASE: "P4",
    ViolationType.UNCOMMITTED_REVIEW: "P4",
    ViolationType.MISSING_KI_ASSESSMENT: "P5",
}


@dataclass
class ViolationEvent:
    violation_type: ViolationType
    rectified: bool = False
    phase: int = 4
    severity: str = "P4"
    timestamp: str = ""
    context: Dict[str, Any] = field(default_factory=dict)
    files: List[str] = field(default_factory=list)


@dataclass
class CommitResult:
    success: bool = False
    committed: bool = False
    reason: str = ""


@dataclass
class AssessmentResult:
    assessment_result: str = "PASS"
    priority_counts: Dict[str, int] = field(
        default_factory=lambda: {"P1": 0, "P2": 0, "P3": 0, "P4": 0, "P5": 0}
    )
    phase: int = 4
    run_id: str = ""
    unrectified_total: int = 0


@dataclass
class InterventionResult:
    action: str = ""
    success: bool = False
    user_message: str = ""
    committed: bool = True
    ki_doc_updated: bool = False
    post_batch_commit_failed: bool = False


@dataclass
class BatchInterventionResult:
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0


class CommitGuard:
    """Phase-boundary and review auto-commit with failure tracking."""

    def __init__(self, project_root: str = ""):
        self.project_root = project_root
        self._commit_failures: Dict[str, int] = {}

    def ensure_committed(self, phase=None, run_id="", review_round=None, context=None):
        raise NotImplementedError

    def _build_message(self, phase=None, run_id="", review_round=None):
        raise NotImplementedError

    def failure_count(self, run_id: str, phase: int) -> int:
        raise NotImplementedError


def compute_assessment_from_violations(violations, phase=4):
    raise NotImplementedError


def compliance_check(phase, context=None):
    raise NotImplementedError


def _handle_compliance(guard, run_id, phase):
    raise NotImplementedError


def _handle_merged(events, context):
    raise NotImplementedError


def assess(phase, run_id=""):
    raise NotImplementedError


def pipeline_resume(run_id=""):
    raise NotImplementedError


def intervene_batch(events):
    raise NotImplementedError


class KiDocManager:
    """KI document lifecycle manager for compliance."""

    def __init__(self, ki_doc_path: str = ""):
        self.ki_doc_path = ki_doc_path

    def ensure_updated(self):
        raise NotImplementedError

    def record_intervention(self, events):
        raise NotImplementedError

    def ensure_assessment(self, phase, result):
        raise NotImplementedError

    def compute_signature(self, event):
        raise NotImplementedError

    def check_staleness(self, current_violations):
        raise NotImplementedError


class InterventionCoordinator:
    """Coordinator with phase_violations registry for assessment."""

    def __init__(self):
        self._phase_violations: Dict[tuple, List[ViolationEvent]] = {}
