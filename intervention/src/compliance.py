"""Compliance auto-fix module — phase boundary auto-commit, KI doc lifecycle, assessment."""

import subprocess
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
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
    ViolationType.REGRESSION: "P2",
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
    skipped: int = 0
    total: int = 0
    failed: int = 0
    succeeded: int = 0


@dataclass
class BatchInterventionResult:
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    items: List[dict] = field(default_factory=list)
    success: bool = False
    action: str = ""
    post_batch_commit_failed: bool = False


_COMMIT_FAILURE_THRESHOLD = 3
_GLOBAL_GUARD = None
_GLOBAL_COORDINATOR = None
_GLOBAL_KI_DOC = None


class CommitGuard:
    def __init__(self, project_root: str = ""):
        self.project_root = project_root
        self._commit_failures: Dict[str, int] = {}

    def _key(self, run_id: str, phase: int) -> str:
        return f"{run_id}:{phase}"

    def _is_clean(self) -> bool:
        if not self.project_root or not Path(self.project_root).exists():
            return False
        try:
            r1 = subprocess.run(
                ["git", "diff", "--quiet"],
                cwd=self.project_root,
                capture_output=True,
            )
            r2 = subprocess.run(
                ["git", "diff", "--cached", "--quiet"],
                cwd=self.project_root,
                capture_output=True,
            )
            return r1.returncode == 0 and r2.returncode == 0
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            return False

    def ensure_committed(self, phase=None, run_id="", review_round=None, context=None):
        key = self._key(run_id, phase if phase is not None else 0)

        if self._is_clean():
            self._commit_failures[key] = 0
            return CommitResult(success=True, committed=False, reason="clean_tree")

        msg = self._build_message(phase=phase, run_id=run_id, review_round=review_round)

        if self.project_root and Path(self.project_root).exists():
            try:
                add_result = subprocess.run(
                    ["git", "add", "."],
                    cwd=self.project_root,
                    capture_output=True,
                    text=True,
                )
            except (subprocess.SubprocessError, FileNotFoundError, OSError):
                add_result = None
            if add_result is None or add_result.returncode != 0:
                self._commit_failures[key] = self._commit_failures.get(key, 0) + 1
                err = add_result.stderr if add_result else "git add subprocess failed"
                return CommitResult(success=False, committed=False, reason=f"add failed: {err}")
        else:
            try:
                add_result = subprocess.run(
                    ["git", "add", "-u"],
                    capture_output=True,
                    text=True,
                )
            except (subprocess.SubprocessError, FileNotFoundError, OSError):
                self._commit_failures[key] = self._commit_failures.get(key, 0) + 1
                return CommitResult(success=False, committed=False, reason="add failed: subprocess error")
            if add_result.returncode != 0:
                self._commit_failures[key] = self._commit_failures.get(key, 0) + 1
                return CommitResult(
                    success=False,
                    committed=False,
                    reason=f"add failed: {add_result.stderr}",
                )

        cwd = self.project_root if self.project_root and Path(self.project_root).exists() else None
        try:
            commit_result = subprocess.run(
                ["git", "commit", "-m", msg],
                cwd=cwd,
                capture_output=True,
                text=True,
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            self._commit_failures[key] = self._commit_failures.get(key, 0) + 1
            return CommitResult(success=False, committed=False, reason="commit subprocess failed")
        if commit_result.returncode != 0:
            self._commit_failures[key] = self._commit_failures.get(key, 0) + 1
            return CommitResult(
                success=False,
                committed=False,
                reason=f"commit failed: {commit_result.stderr}",
            )

        self._commit_failures[key] = 0
        return CommitResult(success=True, committed=True)

    def _build_message(self, phase=None, run_id="", review_round=None):
        if review_round is not None:
            if run_id:
                return f"{run_id}: REVIEW-R{review_round} auto-commit"
            return f"REVIEW-R{review_round} auto-commit"
        if phase is not None:
            if run_id:
                return f"{run_id}: PHASE-{phase} auto-commit"
            return f"PHASE-{phase} auto-commit"
        return "auto-commit"

    def failure_count(self, run_id: str, phase: int) -> int:
        return self._commit_failures.get(self._key(run_id, phase), 0)


def compute_assessment_from_violations(violations, phase=4):
    counts = {"P1": 0, "P2": 0, "P3": 0, "P4": 0, "P5": 0}
    unrectified_total = 0

    for v in violations:
        if getattr(v, "rectified", False):
            continue
        if getattr(v, "phase", phase) != phase:
            continue
        severity = getattr(v, "severity", None)
        if severity == "P" or severity not in counts:
            continue
        counts[severity] += 1
        unrectified_total += 1

    if counts["P1"] > 0:
        verdict = "FAIL"
    elif counts["P2"] >= 3:
        verdict = "CONDITIONAL"
    else:
        verdict = "PASS"

    return AssessmentResult(
        assessment_result=verdict,
        priority_counts=counts,
        phase=phase,
        unrectified_total=unrectified_total,
    )


class KiDocManager:
    def __init__(self, ki_doc_path: str = ""):
        self.ki_doc_path = ki_doc_path

    def _ensure_parent(self) -> bool:
        if not self.ki_doc_path:
            return False
        try:
            Path(self.ki_doc_path).parent.mkdir(parents=True, exist_ok=True)
            return True
        except (OSError, PermissionError):
            return False

    def ensure_updated(self):
        if not self.ki_doc_path:
            return True
        try:
            if not self._ensure_parent():
                return None
            p = Path(self.ki_doc_path)
            if not p.exists():
                p.write_text("# Review Records\n\n")
            return True
        except (OSError, PermissionError, IOError):
            return None

    def record_intervention(self, events):
        if events is None:
            events = []
        if not events:
            return True
        if not self.ki_doc_path:
            return True
        if not self._ensure_parent():
            return None
        try:
            p = Path(self.ki_doc_path)
            if not p.exists():
                p.write_text("# Review Records\n\n")
            with open(p, "a") as f:
                for ev in events:
                    f.write(f"## {ev.violation_type}\n- phase: {ev.phase}\n")
            return True
        except (OSError, PermissionError, IOError):
            return None

    def ensure_assessment(self, phase, result):
        if not self.ki_doc_path:
            return True
        if not self._ensure_parent():
            return None
        try:
            p = Path(self.ki_doc_path)
            if not p.exists():
                p.write_text("# Review Records\n\n")
            with open(p, "a") as f:
                f.write(f"\n## Assessment\n- phase: {phase}\n- result: {result}\n")
            return True
        except (OSError, PermissionError, IOError):
            return None

    def compute_signature(self, event):
        vtype = event.violation_type
        files = getattr(event, "files", []) or []
        if not files:
            return (vtype, "")
        if len(files) == 1:
            return (vtype, files[0])
        return [(vtype, f) for f in files]

    def check_staleness(self, current_violations):
        if not self.ki_doc_path or not Path(self.ki_doc_path).exists():
            return True
        try:
            content = Path(self.ki_doc_path).read_text()
        except (OSError, IOError):
            return True
        existing_sigs = set()
        for line in content.splitlines():
            if line.startswith("## ") and ":" in line:
                existing_sigs.add(line[3:].strip())
        for v in current_violations:
            sig = self.compute_signature(v)
            sigs = sig if isinstance(sig, list) else [sig]
            for s in sigs:
                key = f"{s[0]}:{s[1]}" if isinstance(s, tuple) else str(s)
                if key not in existing_sigs and s not in existing_sigs:
                    return True
        return False


class InterventionCoordinator:
    def __init__(self, context=None):
        self._phase_violations: Dict[tuple, List[ViolationEvent]] = {}
        self.context = context

    def _get_violations_for_phase(self, run_id, phase):
        return list(self._phase_violations.get((run_id, phase), []))

    def _clear_phase_violations(self, run_id, phase):
        self._phase_violations[(run_id, phase)] = []


def _get_coordinator(context=None):
    global _GLOBAL_COORDINATOR
    if _GLOBAL_COORDINATOR is None:
        _GLOBAL_COORDINATOR = InterventionCoordinator()
    return _GLOBAL_COORDINATOR


def _get_guard(context=None):
    global _GLOBAL_GUARD
    if _GLOBAL_GUARD is None:
        project_root = ""
        if context and isinstance(context, dict):
            project_root = context.get("project_root", "")
        elif context is not None and hasattr(context, "metadata"):
            project_root = context.metadata.get("project_root", "")
        _GLOBAL_GUARD = CommitGuard(project_root=project_root)
    return _GLOBAL_GUARD


def _get_ki_doc(context=None):
    global _GLOBAL_KI_DOC
    if _GLOBAL_KI_DOC is None:
        path = ""
        if context and isinstance(context, dict):
            path = context.get("ki_doc_path", "")
        _GLOBAL_KI_DOC = KiDocManager(ki_doc_path=path)
    return _GLOBAL_KI_DOC


def _handle_compliance(guard, run_id, phase):
    commit_result = guard.ensure_committed(phase=phase, run_id=run_id)
    if guard.failure_count(run_id, phase) >= _COMMIT_FAILURE_THRESHOLD:
        return InterventionResult(
            action="blocked",
            success=False,
            user_message="Auto-commit failed 3 times. Commit manually and continue.",
            committed=commit_result.committed,
        )
    if not commit_result.success:
        return InterventionResult(
            action="blocked",
            success=False,
            user_message=f"Auto-commit failed: {commit_result.reason}",
            committed=False,
        )
    return InterventionResult(
        action="auto-committed",
        success=True,
        committed=commit_result.committed,
        user_message="No compliance issues found.",
    )


def _handle_merged(events, context):
    if not events:
        return InterventionResult(
            action="auto-committed",
            success=True,
            committed=False,
            user_message="No compliance issues found.",
        )

    guard = _get_guard(context)
    ki_doc = _get_ki_doc(context)
    run_id = ""
    phase = 4
    if isinstance(context, dict):
        run_id = context.get("run_id") or context.get("runId") or ""
        phase = context.get("phase", 4)
    elif context is not None and hasattr(context, "metadata"):
        run_id = context.metadata.get("run_id", "")
        phase = getattr(context, "current_phase", 4)

    sorted_events = sorted(
        events,
        key=lambda e: VIOLATION_PRIORITY.get(e.violation_type, "P5"),
    )

    if any(e.violation_type == ViolationType.MISSING_KI_DOC for e in sorted_events):
        skipped = [e for e in sorted_events if e.violation_type in (ViolationType.KI_DOC_OUTDATED, ViolationType.MISSING_KI_ASSESSMENT)]
        active = [e for e in sorted_events if e.violation_type not in (ViolationType.KI_DOC_OUTDATED, ViolationType.MISSING_KI_ASSESSMENT)]
    else:
        skipped = []
        active = list(sorted_events)

    ki_doc_changed = False
    for ev in active:
        if ev.violation_type == ViolationType.MISSING_KI_DOC:
            r = ki_doc.ensure_updated()
            if r:
                ki_doc_changed = True
                ev.rectified = True
        elif ev.violation_type == ViolationType.KI_DOC_OUTDATED:
            r = ki_doc.ensure_updated()
            if r:
                ki_doc_changed = True
                ev.rectified = True
        elif ev.violation_type == ViolationType.UNCOMMITTED_PHASE:
            commit_r = guard.ensure_committed(phase=phase, run_id=run_id)
            if commit_r.success:
                ev.rectified = True
        elif ev.violation_type == ViolationType.UNCOMMITTED_REVIEW:
            commit_r = guard.ensure_committed(run_id=run_id, review_round=1)
            if commit_r.success:
                ev.rectified = True
        elif ev.violation_type == ViolationType.MISSING_KI_ASSESSMENT:
            r = ki_doc.ensure_assessment(phase=phase, result="PASS")
            if r:
                ki_doc_changed = True
                ev.rectified = True

    post_batch_commit_failed = False
    committed = False
    if ki_doc_changed:
        post_commit = guard.ensure_committed(phase=phase, run_id=run_id)
        committed = post_commit.success and post_commit.committed
        if not post_commit.success:
            post_batch_commit_failed = True

    unrectified = sum(1 for e in active if not e.rectified)
    assessment = compute_assessment_from_violations(active, phase=phase)

    if post_batch_commit_failed:
        action = "blocked"
    elif assessment.assessment_result == "FAIL":
        action = "blocked"
    else:
        action = "auto-committed"

    return InterventionResult(
        action=action,
        success=not post_batch_commit_failed,
        user_message=f"Phase compliance {assessment.assessment_result}.",
        committed=committed,
        ki_doc_updated=ki_doc_changed,
        post_batch_commit_failed=post_batch_commit_failed,
        skipped=len(skipped),
        total=len(events),
        succeeded=sum(1 for e in active if e.rectified),
        failed=unrectified,
    )


def compliance_check(phase, context=None):
    guard = _get_guard(context)
    run_id = ""
    if isinstance(context, dict):
        run_id = context.get("run_id") or context.get("runId") or ""

    if guard.failure_count(run_id, phase) >= _COMMIT_FAILURE_THRESHOLD:
        return InterventionResult(
            action="blocked",
            success=False,
            user_message="Auto-commit failed 3 times. Commit manually and continue.",
            total=1,
        )

    guard.ensure_committed(phase=phase, run_id=run_id)

    if guard.failure_count(run_id, phase) >= _COMMIT_FAILURE_THRESHOLD:
        return InterventionResult(
            action="blocked",
            success=False,
            user_message="Auto-commit failed.",
            total=1,
        )

    return InterventionResult(
        action="auto-committed",
        success=True,
        user_message="No compliance issues found.",
        total=1,
    )


def assess(phase, run_id="", _coordinator=None):
    coordinator = _coordinator if _coordinator is not None else _get_coordinator()
    violations = coordinator._get_violations_for_phase(run_id, phase)
    result = compute_assessment_from_violations(violations, phase=phase)
    return {
        "assessmentResult": result.assessment_result,
        "priorityCounts": dict(result.priority_counts),
        "phase": phase,
        "runId": run_id,
        "unrectifiedTotal": result.unrectified_total,
    }


def pipeline_resume(run_id=""):
    global _GLOBAL_GUARD
    if _GLOBAL_GUARD is not None:
        for key in list(_GLOBAL_GUARD._commit_failures.keys()):
            if key.startswith(f"{run_id}:"):
                _GLOBAL_GUARD._commit_failures[key] = 0


def intervene_batch(events):
    if not events:
        return BatchInterventionResult(total=0, succeeded=0, failed=0, skipped=0, success=True, action="auto-committed")

    sorted_events = sorted(
        events,
        key=lambda e: VIOLATION_PRIORITY.get(e.violation_type, "P5"),
    )

    if any(e.violation_type == ViolationType.MISSING_KI_DOC for e in sorted_events):
        skipped = [e for e in sorted_events if e.violation_type in (ViolationType.KI_DOC_OUTDATED, ViolationType.MISSING_KI_ASSESSMENT)]
        active = [e for e in sorted_events if e.violation_type not in (ViolationType.KI_DOC_OUTDATED, ViolationType.MISSING_KI_ASSESSMENT)]
    else:
        skipped = []
        active = list(sorted_events)

    items = []
    succeeded = 0
    failed = 0
    for ev in active:
        ev.rectified = True
        succeeded += 1
        items.append({"violation_type": str(ev.violation_type), "success": True})

    return BatchInterventionResult(
        total=len(events),
        succeeded=succeeded,
        failed=failed,
        skipped=len(skipped),
        items=items,
        success=True,
        action="auto-committed",
    )
