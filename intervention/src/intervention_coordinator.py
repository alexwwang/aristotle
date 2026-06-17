"""InterventionCoordinator — orchestrates TDD pipeline violation handling."""

import logging
import subprocess
from typing import Dict, List, Optional, Tuple
from intervention_types import (
    InterventionResult,
    InterventionPlan,
    ViolationEvent,
    PipelineContext,
    VIOLATION_PRIORITY,
    BEHAVIORAL_VIOLATIONS,
)
from prompt_validator import PromptValidator
from rollback_engine import RollbackEngine
from ki_doc_manager import KiDocManager
from commit_guard import CommitGuard

logger = logging.getLogger(__name__)


class TDDViolationError(Exception):
    def __init__(self, event: ViolationEvent, plan: InterventionPlan, result: Optional[InterventionResult] = None):
        self.event = event
        self.plan = plan
        self.result = result
        super().__init__(f"TDDViolationError: {plan.instruction}")


# Violation types that can be merged in batch processing
_MERGEABLE_TYPES = {
    "MISSING_KI_DOC",
    "KI_DOC_OUTDATED",
    "UNCOMMITTED_PHASE",
    "UNCOMMITTED_REVIEW",
    "MISSING_KI_ASSESSMENT",
}

_PLAN_MAP = {
    "SKIP_REVIEW": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 2),
        auto_fix=False,
        needs_rollback=False,
        is_destructive=False,
        instruction="Review was skipped. Resume Ralph Loop from current phase.",
    ),
    "INSUFFICIENT_REVIEW": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 2),
        auto_fix=False,
        needs_rollback=False,
        is_destructive=False,
        instruction="Insufficient review rounds. Ensure ZERO_C_H_M across consecutive rounds.",
    ),
    "UNFIXED_ISSUES": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 2),
        auto_fix=False,
        needs_rollback=False,
        is_destructive=False,
        instruction="Fix unfixed issues before proceeding.",
    ),
    "SKIP_RED_PHASE": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 4),
        auto_fix=True,
        needs_rollback=True,
        is_destructive=True,
        instruction="Implementation written before test. Rollback implementation, write test first.",
    ),
    "MODIFIED_TEST": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 5),
        auto_fix=True,
        needs_rollback=True,
        is_destructive=True,
        instruction="Test was modified during GREEN phase. Restore original test.",
    ),
    "MISSING_TEST": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 5),
        auto_fix=False,
        needs_rollback=False,
        is_destructive=False,
        instruction="Missing test for implementation. Write test first.",
    ),
    "REGRESSION": lambda e, ctx: InterventionPlan(
        target_phase=5,
        auto_fix=False,
        needs_rollback=False,
        is_destructive=False,
        instruction="Regression detected — return to Phase 5 and fix the failing implementation",
    ),
    "MISSING_KI_DOC": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 3),
        auto_fix=True,
        needs_rollback=False,
        is_destructive=False,
        instruction="KI doc missing. Create or locate KI review document.",
    ),
    "KI_DOC_OUTDATED": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 3),
        auto_fix=True,
        needs_rollback=False,
        is_destructive=False,
        instruction="KI doc outdated. Auto-append missing entries.",
    ),
    "UNCOMMITTED_PHASE": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 3),
        auto_fix=True,
        needs_rollback=False,
        is_destructive=False,
        instruction="Uncommitted phase work. Auto-commit changes.",
    ),
    "UNCOMMITTED_REVIEW": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 3),
        auto_fix=True,
        needs_rollback=False,
        is_destructive=False,
        instruction="Uncommitted review work. Auto-commit changes.",
    ),
    "MISSING_KI_ASSESSMENT": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 3),
        auto_fix=True,
        needs_rollback=False,
        is_destructive=False,
        instruction="Missing KI assessment. Run assessment and record.",
    ),
    "INVALID_REVIEW_PROMPT": lambda e, ctx: InterventionPlan(
        target_phase=e.context.get("phase", 2),
        auto_fix=False,
        needs_rollback=False,
        is_destructive=False,
        instruction="Review prompt contains forbidden patterns. Rewrite prompt.",
    ),
}


from handlers import Handlers as _Handlers
from signal_mapper import (
    SignalMapper,
    SIGNAL_TO_TYPE as _SIGNAL_TO_TYPE,
    SPECIAL_SIGNAL_TO_TYPE as _SPECIAL_SIGNAL_TO_TYPE,
    PROTOCOL_SIGNALS as _PROTOCOL_SIGNALS,
)
from special_handler import SpecialHandler as _SpecialHandler


class InterventionCoordinator:
    def __init__(self, context: PipelineContext) -> None:
        self.context = context
        self.prompt_validator = PromptValidator()
        self.rollback_engine = RollbackEngine()
        self.ki_doc = KiDocManager(context.ki_doc_path)
        self.commit_guard = CommitGuard()
        self._handlers = _Handlers()
        self._special_handler = _SpecialHandler()
        self._signal_mapper = SignalMapper()
        self._phase_violations: Dict[Tuple[str, int], List[ViolationEvent]] = {}

    def intervene(self, event: ViolationEvent) -> Optional[InterventionResult]:
        if self._validate_and_early_return(event):
            return None

        if event.violation_type == "INVALID_REVIEW_PROMPT":
            return self._intervene_via_handler(event)

        if event.violation_type == "KI_DOC_OUTDATED":
            try:
                if self.ki_doc.ensure_updated(event.timestamp):
                    return None
            except (IOError, OSError) as e:
                logger.warning("ensure_updated failed, falling through to violation path: %s", e)

        return self._intervene_legacy(event)

    def _intervene_via_handler(self, event: ViolationEvent) -> InterventionResult:
        vtype = event.violation_type
        handler_method = None
        if vtype == "MODIFIED_TEST":
            handler_method = self._handlers.handle_modified_test
        elif vtype == "MISSING_TEST":
            handler_method = self._handlers.handle_missing_test
        elif vtype == "REGRESSION":
            handler_method = self._handlers.handle_regression
        elif vtype == "SKIP_RED_PHASE":
            handler_method = self._handlers.handle_skip_red_phase
        elif vtype == "SKIP_REVIEW":
            handler_method = self._handlers.handle_skip_review
        elif vtype == "INSUFFICIENT_REVIEW":
            handler_method = self._handlers.handle_insufficient_review
        elif vtype == "UNFIXED_ISSUES":
            handler_method = self._handlers.handle_unfixed_issues
        elif vtype == "INVALID_REVIEW_PROMPT":
            handler_method = self._handlers.handle_invalid_review_prompt
        elif vtype in ("UNCOMMITTED_PHASE", "MISSING_KI_DOC", "KI_DOC_OUTDATED",
                       "MISSING_KI_ASSESSMENT", "UNCOMMITTED_REVIEW"):
            return self._intervene_legacy(event)

        if handler_method is None:
            return self._intervene_legacy(event)

        try:
            result = handler_method(event, self.context)
            if result is not None:
                result.violation_code = result.violation_code or vtype
                result.violation_type = result.violation_type or vtype
                self._register_phase_violation(event)
                if result.success and result.action not in ("blocked", "paused", "spawn_subagent"):
                    event.rectified = True
                return result
        except ValueError:
            raise
        except Exception as e:
            logger.warning("handler failed: %s", e)

        return self._intervene_legacy(event)

    def _register_phase_violation(self, event: ViolationEvent) -> None:
        run_id = event.context.get("run_id") or event.context.get("req_number", "")
        phase = event.context.get("phase", self.context.current_phase)
        key = (run_id, phase)
        if key not in self._phase_violations:
            self._phase_violations[key] = []
        if not any(e is event for e in self._phase_violations[key]):
            self._phase_violations[key].append(event)

    def intervene_from_signal(self, signal: str, context: dict) -> InterventionResult:
        if signal in _PROTOCOL_SIGNALS:
            return self._handle_protocol_signal(signal, context)

        if signal in _SIGNAL_TO_TYPE:
            vtype = _SIGNAL_TO_TYPE[signal]
            event = self._build_event_from_signal(vtype, context, signal)
            result = self.intervene(event)
            if result is None:
                result = InterventionResult(violation_code=vtype, violation_type=vtype)
            return result

        if signal in _SPECIAL_SIGNAL_TO_TYPE:
            special_type = _SPECIAL_SIGNAL_TO_TYPE[signal]
            special_result = self._special_handler.handle_special(special_type, context)
            return InterventionResult(
                violation_code=special_type,
                violation_type=special_type,
                action=getattr(special_result, "action", ""),
                success=getattr(special_result, "success", True),
            )

        raise ValueError(f"Unknown detection signal: {signal}")

    def _build_event_from_signal(self, vtype: str, context: dict, signal: str = None) -> ViolationEvent:
        run_id = context.get("run_id") or context.get("runId") or context.get("req_number", "")
        phase = context.get("phase", self.context.current_phase)
        files = context.get("files", [])
        event = ViolationEvent(
            violation_type=vtype,
            affected_file_path=files[0] if files else "",
            timestamp=__import__("datetime").datetime.now().isoformat(),
            context={**context, "phase": phase, "signal": signal} if signal else {**context, "phase": phase},
            affected_file_paths=files,
            rectified=False,
        )
        return event

    def _handle_protocol_signal(self, signal: str, context: dict) -> InterventionResult:
        handler_name = _PROTOCOL_SIGNALS[signal]
        pseudo_type = handler_name.replace("_handle_", "").upper()
        return InterventionResult(
            violation_code=pseudo_type,
            violation_type=pseudo_type,
            action="recorded",
            success=True,
            user_message=f"Protocol signal {signal} processed.",
        )

    def _intervene_legacy(self, event: ViolationEvent) -> Optional[InterventionResult]:
        if self._validate_and_early_return(event):
            return None

        if self._needs_prompt_validation(event):
            if self._handle_prompt_violation(event):
                return None

        if event.violation_type == "KI_DOC_OUTDATED":
            try:
                if self.ki_doc.ensure_updated(event.timestamp):
                    return None
            except (IOError, OSError) as e:
                logger.warning("ensure_updated failed, falling through to violation path: %s", e)

        plan = self._build_plan(event)
        pre_commit_ok = self._stage_pre_rollback(event, plan)
        return self._execute_intervention(event, plan, pre_commit_ok)

    def _validate_and_early_return(self, event: ViolationEvent) -> bool:
        if not self._is_valid_event(event):
            return True
        if event.violation_type not in VIOLATION_PRIORITY:
            return True
        if event.violation_type == "INSUFFICIENT_REVIEW":
            rounds = event.context.get("rounds", 0)
            round_results = self.context.metadata.get("round_results", [])
            if rounds >= 2 and len(round_results) >= 2:
                last_two = round_results[-2:]
                if all(r.get("C", 0) == 0 and r.get("H", 0) == 0 and r.get("M", 0) == 0 for r in last_two):
                    return True
        return False

    def _handle_prompt_violation(self, event: ViolationEvent) -> bool:
        prompt = event.context.get("prompt", "")
        validation_result = self.prompt_validator.validate(prompt)
        if validation_result.is_valid:
            return True
        plan = self._build_plan(event)
        v13_ki_ok = self.ki_doc.record_intervention(event, plan, None, validation_result)
        v13_commit_result = self.commit_guard.ensure_committed(self.context)
        v13_commit_ok = v13_commit_result.success if v13_commit_result else True
        result = InterventionResult(
            violation_code=event.violation_type,
            target_phase=plan.target_phase,
            auto_fix_applied=False,
            instruction=plan.instruction,
            validation_result=validation_result,
            ki_doc_updated=v13_ki_ok is True,
            committed=v13_commit_ok,
        )
        raise TDDViolationError(event, plan, result)

    def _stage_pre_rollback(self, event: ViolationEvent, plan: InterventionPlan) -> bool:
        pre_commit_ok = True
        if plan.is_destructive or plan.target_phase < self.context.current_phase:
            files_to_stage = (
                list(event.affected_file_paths)
                if event.affected_file_paths
                else ([event.affected_file_path] if event.affected_file_path else [])
            )
            valid_files = [fp for fp in files_to_stage if self.rollback_engine.validate_path(fp)]
            if valid_files:
                try:
                    subprocess.run(
                        ["git", "add"] + valid_files,
                        capture_output=True,
                        text=True,
                    )
                except Exception as e:
                    logger.warning("batch git add failed: %s", e)
            pre_commit_result = self.commit_guard.ensure_committed(self.context)
            pre_commit_ok = pre_commit_result.success if pre_commit_result else True
        return pre_commit_ok

    def _execute_intervention(self, event: ViolationEvent, plan: InterventionPlan, pre_commit_ok: bool) -> InterventionResult:
        rollback_result = None
        if plan.auto_fix and plan.needs_rollback:
            rollback_result = self.rollback_engine.rollback(event, plan, self.context)

        ki_write_ok = self.ki_doc.record_intervention(event, plan, rollback_result)
        ki_doc_updated = ki_write_ok is True

        post_commit_result = self.commit_guard.ensure_committed(self.context)
        post_commit_ok = post_commit_result.success if post_commit_result else True

        result = InterventionResult(
            violation_code=event.violation_type,
            violation_type=event.violation_type,
            target_phase=plan.target_phase,
            auto_fix_applied=rollback_result.success if rollback_result else False,
            auto_fix_details=rollback_result.action if rollback_result else "",
            instruction=plan.instruction,
            ki_doc_updated=ki_doc_updated,
            committed=pre_commit_ok and post_commit_ok,
            rollback_result=rollback_result,
        )
        raise TDDViolationError(event, plan, result)

    def intervene_batch(self, events: List[ViolationEvent]) -> None:
        if not events:
            return None

        # Sort by VIOLATION_PRIORITY
        sorted_events = sorted(
            events,
            key=lambda e: VIOLATION_PRIORITY.get(e.violation_type, 99),
        )

        # Split into mergeable and non-mergeable
        non_mergeable = [e for e in sorted_events if e.violation_type not in _MERGEABLE_TYPES]
        mergeable = [e for e in sorted_events if e.violation_type in _MERGEABLE_TYPES]

        # Design: only the first non-mergeable event is processed per batch.
        # Subsequent non-mergeable events are intentionally deferred — the
        # pipeline retry cycle will re-detect and re-trigger intervention
        # for remaining items in a subsequent batch pass.
        if non_mergeable:
            self.intervene(non_mergeable[0])
            return

        # Only mergeable events → handle merged
        if mergeable:
            self._handle_merged(mergeable)

    def _is_valid_event(self, event: ViolationEvent) -> bool:
        if not event.violation_type:
            return False
        if "phase" not in event.context:
            return False
        if event.violation_type in BEHAVIORAL_VIOLATIONS and not (event.affected_file_path or event.affected_file_paths):
            return False
        return True

    def _needs_prompt_validation(self, event: ViolationEvent) -> bool:
        return event.violation_type == "INVALID_REVIEW_PROMPT"

    def _build_plan(self, event: ViolationEvent) -> InterventionPlan:
        builder = _PLAN_MAP.get(event.violation_type)
        if builder:
            return builder(event, self.context)
        # Fallback for unknown types
        return InterventionPlan(
            target_phase=event.context.get("phase", 0),
            auto_fix=False,
            needs_rollback=False,
            is_destructive=False,
            instruction=f"Unknown violation type: {event.violation_type}",
        )

    def _handle_merged(self, events: List[ViolationEvent]) -> None:
        # 1. V-10/V-11: commit first
        commit_types = {"UNCOMMITTED_PHASE", "UNCOMMITTED_REVIEW"}
        for e in events:
            if e.violation_type in commit_types:
                self.commit_guard.ensure_committed(self.context)
                break  # commit once for all V-10/V-11

        # 2. V-12: assessment
        assessment_events = [e for e in events if e.violation_type == "MISSING_KI_ASSESSMENT"]
        assessment_status = None
        assessment_issues = []
        assessment_counts = {}
        if assessment_events:
            assessment_status, assessment_issues, assessment_counts = self._compute_assessment()
            self.ki_doc.ensure_assessment(
                self.context.current_phase,
                self.context.current_phase + 1,
                assessment_status,
                assessment_issues,
                assessment_counts,
            )

        # 3. Record all events for assessment tracking (guarded by KI violation presence)
        ki_types = {"MISSING_KI_DOC", "KI_DOC_OUTDATED"}
        ki_events = [e for e in events if e.violation_type in ki_types]
        if ki_events:
            self.ki_doc.record_merge(events, self.context)

        # 4. Final commit
        final_commit_result = self.commit_guard.ensure_committed(self.context)
        final_commit_ok = final_commit_result.success if final_commit_result else True

        # 5. Raise TDDViolationError
        plan = self._build_plan(events[0])
        result = InterventionResult(
            violation_code="MERGED:" + ",".join(e.violation_type for e in events),
            target_phase=plan.target_phase,
            auto_fix_applied=True,
            instruction="Merged auto-fix interventions applied.",
            ki_doc_updated=bool(assessment_events) or bool(ki_events),
            committed=final_commit_ok,
        )
        raise TDDViolationError(events[0], plan, result)

    def _compute_assessment(self) -> Tuple[str, List[str], Dict[str, int]]:
        round_results = self.context.metadata.get("round_results", [])
        if not round_results:
            return "PASS", [], {"P0": 0, "P1": 0, "P2": 0, "P3": 0, "P4": 0}

        last = round_results[-1]
        c = last.get("C", 0)
        h = last.get("H", 0)
        m = last.get("M", 0)
        p = last.get("P", 0)
        low = last.get("L", 0)

        counts = {"P0": c, "P1": h, "P2": m, "P3": p, "P4": low}

        issues = []
        if c > 0:
            issues.append(f"P0: {c} Critical issues")
        if h > 0:
            issues.append(f"P1: {h} High issues")
        if m > 0:
            issues.append(f"P2: {m} Medium issues")

        if c > 0 or h > 0:
            status = "FAIL"
        elif m > 0:
            status = "CONDITIONAL"
        else:
            status = "PASS"

        return status, issues, counts
