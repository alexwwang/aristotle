"""
Quarantine Engine — moves violating files to quarantine, tracks metadata,
and provides restore/reconcile operations.

Phase 4 TDD Stub: All methods raise NotImplementedError.
Business logic will be implemented in Phase 5 to make tests pass.
"""

from dataclasses import dataclass, field
from typing import Optional


ViolationType = str

VALID_VIOLATION_TYPES = frozenset({
    'SKIP_RED_PHASE', 'MODIFIED_TEST', 'MISSING_TEST',
    'INVALID_REVIEW_PROMPT', 'SKIP_REVIEW', 'INSUFFICIENT_REVIEW', 'UNFIXED_ISSUES',
    'REGRESSION',
    'UNCOMMITTED_PHASE', 'MISSING_KI_DOC', 'KI_DOC_OUTDATED', 'UNCOMMITTED_REVIEW',
    'MISSING_KI_ASSESSMENT',
    'PROPOSAL',
    'FILE_SPLIT_NEEDED', 'PROMPT_INJECTION_BLOCKED', 'PATTERN_CYCLE',
})


@dataclass
class QuarantineMeta:
    """Metadata for a single quarantined file."""
    original_path: str
    quarantine_path: str
    violation_type: str
    run_id: str
    phase: int
    timestamp: str
    boundary_commit: str


@dataclass
class QuarantineResult:
    """Result from move_to_quarantine operation."""
    success: bool
    action: str = "quarantined"
    files_affected: list = field(default_factory=list)
    quarantine_paths: list = field(default_factory=list)
    original_paths: list = field(default_factory=list)
    partial_failure: bool = False
    failed_files: list = field(default_factory=list)
    quarantine_success: bool = True
    boundary_commit_valid: bool = True
    message: str = ""


@dataclass
class RestoreResult:
    """Result from restore operation."""
    success: bool
    new_path: str = ""
    message: str = ""


@dataclass
class ReconcileResult:
    """Result from reconcile operation."""
    success: bool
    mismatches: list = field(default_factory=list)
    message: str = ""


class QuarantineNotFoundError(Exception):
    """Raised when reconcile is called with unknown run_id."""
    pass


MAX_FILES_PER_QUARANTINE = 50
MAX_SUFFIX_RETRY = 100
GIT_COMMAND_TIMEOUT_S = 10
GIT_AGGREGATE_TIMEOUT_S = 60
SOFT_SIZE_LIMIT_MB = 100
MAX_RUN_ID_LENGTH = 128


class QuarantineEngine:
    """Manages file quarantine operations for TDD pipeline violations."""

    def __init__(self, repo_root: str):
        self.repo_root = repo_root

    def move_to_quarantine(
        self,
        files: list[str],
        run_id: str,
        phase: int,
        violation_type: str,
        boundary_commit: str = "HEAD",
    ) -> QuarantineResult:
        raise NotImplementedError("Phase 4 stub — move_to_quarantine not yet implemented")

    def list_quarantine(
        self,
        run_id: Optional[str] = None,
    ) -> list[QuarantineMeta]:
        raise NotImplementedError("Phase 4 stub — list_quarantine not yet implemented")

    def restore(
        self,
        original_path: str,
        run_id: Optional[str] = None,
    ) -> Optional[RestoreResult]:
        raise NotImplementedError("Phase 4 stub — restore not yet implemented")

    def reconcile(
        self,
        project_id: str,
        run_id: str,
    ) -> ReconcileResult:
        raise NotImplementedError("Phase 4 stub — reconcile not yet implemented")
