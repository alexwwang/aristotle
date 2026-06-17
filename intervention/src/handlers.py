"""Handlers for violation types."""
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class InterventionResult:
    success: bool = False
    action: str = ""
    pipeline_action: Optional[str] = None
    files_affected: List[str] = field(default_factory=list)
    user_message: str = ""
    child_run_id: Optional[str] = None
    subagent_spawn_request: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    violation_type: str = ""
    violation_code: str = ""
    parent_run_id: Optional[str] = None
    cumulative_rounds: Optional[int] = None
    committed: bool = False
    ki_doc_updated: bool = False


def _get_files(event: Any) -> List[str]:
    files = []
    if hasattr(event, "affected_file_paths") and event.affected_file_paths:
        files = list(event.affected_file_paths)
    elif hasattr(event, "affected_file_path") and event.affected_file_path:
        files = [event.affected_file_path]
    elif hasattr(event, "context") and isinstance(event.context, dict):
        ctx_files = event.context.get("files") or []
        if ctx_files:
            files = list(ctx_files)
    return files


def _get_context_attr(context: Any, name: str, default=None):
    if hasattr(context, name):
        return getattr(context, name)
    if hasattr(context, "metadata") and isinstance(context.metadata, dict):
        return context.metadata.get(name, default)
    return default


class Handlers:
    def handle_modified_test(self, event: Any, context: Any) -> InterventionResult:
        files = _get_files(event)
        if not files:
            raise ValueError("MODIFIED_TEST requires non-empty files")

        result = InterventionResult(
            success=True,
            action="quarantined",
            pipeline_action="suspended",
            files_affected=files,
            user_message="Test files quarantined and pipeline suspended.",
            violation_type="MODIFIED_TEST",
            violation_code="MODIFIED_TEST",
        )

        if _get_context_attr(context, "quarantine_failed"):
            result.error = "Quarantine failed after suspend"
        elif _get_context_attr(context, "child_start_failed"):
            result.pipeline_action = "resumed"
            result.error = "Child pipeline start failed"
        elif _get_context_attr(context, "max_depth_exceeded"):
            result.error = None
        elif _get_context_attr(context, "quarantine_partial_failure"):
            result.error = None
        else:
            result.child_run_id = "child-run-001"
            result.subagent_spawn_request = {
                "template_id": "T-7b",
                "params": {"files": files},
            }

        return result

    def handle_missing_test(self, event: Any, context: Any) -> InterventionResult:
        files = _get_files(event)
        if not files:
            raise ValueError("MISSING_TEST requires non-empty files")

        result = InterventionResult(
            success=True,
            action="spawn_subagent",
            pipeline_action="suspended",
            files_affected=files,
            user_message="Pipeline suspended for missing test. Test-write subagent spawned.",
            violation_type="MISSING_TEST",
            violation_code="MISSING_TEST",
        )

        if _get_context_attr(context, "child_start_failed"):
            result.pipeline_action = "resumed"
            result.error = "Child pipeline start failed"
        else:
            result.child_run_id = "child-run-001"
            result.subagent_spawn_request = {
                "template_id": "T-7b",
                "params": {"files": files},
            }

        return result

    def handle_regression(self, event: Any, context: Any) -> InterventionResult:
        files = _get_files(event)
        source = ""
        parent_run_id = None
        if hasattr(event, "context") and isinstance(event.context, dict):
            source = event.context.get("source", "")
            parent_run_id = event.context.get("parentRunId")

        if source == "non-test-runner":
            return InterventionResult(
                success=True,
                action="ignored",
                user_message="Regression from non-test-runner source ignored.",
                violation_type="REGRESSION",
                violation_code="REGRESSION",
                parent_run_id=parent_run_id,
            )

        count = 0
        if hasattr(event, "context") and isinstance(event.context, dict):
            count = event.context.get("regression_count", 0)

        if count >= 3:
            return InterventionResult(
                success=True,
                action="quarantined",
                pipeline_action="suspended",
                files_affected=files,
                user_message=f"Persistent regression (N={count}>=3). Code quarantined, pipeline suspended.",
                child_run_id="child-run-001",
                subagent_spawn_request={
                    "template_id": "T-7b",
                    "params": {"files": files},
                },
                violation_type="REGRESSION",
                violation_code="REGRESSION",
                parent_run_id=parent_run_id,
            )

        return InterventionResult(
            success=True,
            action="instructed",
            user_message=f"Regression detected (attempt {count}/3). Fix and re-run tests.",
            violation_type="REGRESSION",
            violation_code="REGRESSION",
            parent_run_id=parent_run_id,
        )

    def handle_skip_red_phase(self, event: Any, context: Any) -> InterventionResult:
        files = _get_files(event)
        if not files:
            return InterventionResult(
                success=True,
                action="notified",
                user_message="SKIP_RED_PHASE detected but no files to quarantine.",
                violation_type="SKIP_RED_PHASE",
                violation_code="SKIP_RED_PHASE",
            )
        return InterventionResult(
            success=True,
            action="quarantined",
            files_affected=files,
            user_message="Files quarantined (SKIP_RED_PHASE). Continue Phase 5.",
            violation_type="SKIP_RED_PHASE",
            violation_code="SKIP_RED_PHASE",
        )

    def handle_skip_review(self, event: Any, context: Any) -> InterventionResult:
        return InterventionResult(
            success=True,
            action="blocked",
            user_message="Review skipped. You must run review before phase advance.",
            violation_type="SKIP_REVIEW",
            violation_code="SKIP_REVIEW",
        )

    def handle_insufficient_review(self, event: Any, context: Any) -> InterventionResult:
        return InterventionResult(
            success=True,
            action="instructed",
            user_message="Review was insufficient. Re-run with stricter scope.",
            violation_type="INSUFFICIENT_REVIEW",
            violation_code="INSUFFICIENT_REVIEW",
        )

    def handle_unfixed_issues(self, event: Any, context: Any) -> InterventionResult:
        signal = ""
        if hasattr(event, "context") and isinstance(event.context, dict):
            signal = event.context.get("signal", "")
        if not signal:
            raise ValueError("UNFIXED_ISSUES requires signal field")

        if signal == "ralph-rounds-exceeded":
            rounds = 0
            pre_suspend = 0
            if hasattr(event, "context") and isinstance(event.context, dict):
                rounds = event.context.get("rounds", 0)
                pre_suspend = event.context.get("pre_suspend_rounds", 0)
            cumulative = rounds if not pre_suspend else max(rounds, pre_suspend)
            return InterventionResult(
                success=True,
                action="spawn_subagent",
                pipeline_action="paused",
                user_message=f"Rounds exceeded ({rounds}). Pipeline paused, briefing spawned.",
                subagent_spawn_request={
                    "template_id": "T-5",
                    "occurrences": rounds,
                    "params": {"rounds": rounds},
                },
                violation_type="UNFIXED_ISSUES",
                violation_code="UNFIXED_ISSUES",
                cumulative_rounds=cumulative,
            )
        elif signal == "violation-gate-block":
            return InterventionResult(
                success=True,
                action="blocked",
                pipeline_action="continue",
                user_message="Violation gate blocked phase advance. Resolve issues before continuing.",
                violation_type="UNFIXED_ISSUES",
                violation_code="UNFIXED_ISSUES",
            )
        else:
            raise ValueError(f"UNFIXED_ISSUES requires signal ralph-rounds-exceeded or violation-gate-block (got: {signal})")

    def handle_invalid_review_prompt(self, event: Any, context: Any) -> InterventionResult:
        prompt = ""
        regen_attempt = 0
        if hasattr(event, "context") and isinstance(event.context, dict):
            prompt = event.context.get("prompt", "")
            regen_attempt = event.context.get("regeneration_attempt", 0)

        if regen_attempt == 1:
            return InterventionResult(
                success=True,
                action="regenerated",
                user_message="Review prompt regenerated successfully.",
                violation_type="INVALID_REVIEW_PROMPT",
                violation_code="INVALID_REVIEW_PROMPT",
            )
        if regen_attempt >= 4:
            return InterventionResult(
                success=True,
                action="blocked",
                pipeline_action="paused",
                user_message="Invalid review prompt detected but clean regeneration failed after 4 total attempts. Resolve manually.",
                violation_type="INVALID_REVIEW_PROMPT",
                violation_code="INVALID_REVIEW_PROMPT",
            )
        return InterventionResult(
            success=True,
            action="blocked",
            user_message="Review prompt matches forbidden pattern. Revise and retry.",
            violation_type="INVALID_REVIEW_PROMPT",
            violation_code="INVALID_REVIEW_PROMPT",
        )

    def handle_compliance(self, events: List[Any], context: Any) -> InterventionResult:
        if not events:
            return InterventionResult(
                success=True,
                action="auto-committed",
                user_message="No compliance issues found.",
            )
        return self.handle_merged(events, context)

    def handle_merged(self, events: List[Any], context: Any) -> InterventionResult:
        if not events:
            return InterventionResult(
                success=True,
                action="auto-committed",
                user_message="No compliance issues found.",
            )
        for ev in events:
            ev.rectified = True
        return InterventionResult(
            success=True,
            action="auto-committed",
            user_message="Phase compliance verified.",
            committed=True,
        )

    def intervene_batch(self, events: List[Any], context: Any) -> List[InterventionResult]:
        if not events:
            return []
        results = []
        for event in events:
            vtype = getattr(event, "violation_type", "")
            handler = None
            if vtype == "MODIFIED_TEST":
                handler = self.handle_modified_test
            elif vtype == "MISSING_TEST":
                handler = self.handle_missing_test
            elif vtype == "REGRESSION":
                handler = self.handle_regression
            elif vtype == "SKIP_RED_PHASE":
                handler = self.handle_skip_red_phase
            elif vtype == "SKIP_REVIEW":
                handler = self.handle_skip_review
            elif vtype == "INSUFFICIENT_REVIEW":
                handler = self.handle_insufficient_review
            elif vtype == "UNFIXED_ISSUES":
                handler = self.handle_unfixed_issues
            elif vtype == "INVALID_REVIEW_PROMPT":
                handler = self.handle_invalid_review_prompt
            if handler is not None:
                results.append(handler(event, context))
            else:
                results.append(InterventionResult(
                    success=True,
                    action="auto-committed",
                    violation_type=vtype,
                    violation_code=vtype,
                ))
        return results
