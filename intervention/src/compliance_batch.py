"""Compliance batch handling."""
from dataclasses import dataclass, field
from typing import List, Optional, Any

from compliance import (
    ViolationEvent,
    ViolationType,
    VIOLATION_PRIORITY,
    InterventionResult,
    compute_assessment_from_violations,
    _handle_merged,
)


@dataclass
class BatchInterventionResult:
    items: List[dict] = field(default_factory=list)
    success: bool = False
    action: str = ""
    post_batch_commit_failed: bool = False
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    committed: bool = False
    ki_doc_updated: bool = False

    def to_intervention_results(self) -> List[InterventionResult]:
        return [
            InterventionResult(
                action=item.get("action", "auto-committed"),
                success=item.get("success", True),
                committed=item.get("committed", False),
            )
            for item in self.items
        ]


def intervene_batch(events: list, context: Any) -> BatchInterventionResult:
    if not events:
        return BatchInterventionResult(
            items=[],
            success=True,
            action="auto_committed",
            total=0,
            succeeded=0,
            failed=0,
            skipped=0,
        )

    post_batch_commit_failed = False
    if hasattr(context, "metadata"):
        post_batch_commit_failed = context.metadata.get("post_batch_commit_failed", False)
    elif isinstance(context, dict):
        post_batch_commit_failed = context.get("post_batch_commit_failed", False)

    merged_result = _handle_merged(events, context)
    items = []
    succeeded = 0
    failed = 0
    for ev in events:
        success = getattr(ev, "rectified", False)
        if success:
            succeeded += 1
        else:
            failed += 1
        items.append({
            "violation_type": str(ev.violation_type),
            "success": success,
            "action": "auto-committed" if success else "blocked",
            "committed": merged_result.committed if success else False,
        })

    action = "blocked" if post_batch_commit_failed else "auto_committed"

    return BatchInterventionResult(
        items=items,
        success=merged_result.success and not post_batch_commit_failed,
        action=action,
        post_batch_commit_failed=post_batch_commit_failed or merged_result.post_batch_commit_failed,
        total=len(events),
        succeeded=succeeded,
        failed=failed,
        skipped=merged_result.skipped,
        committed=merged_result.committed,
        ki_doc_updated=merged_result.ki_doc_updated,
    )


def handle_merged(events: list, context: Any) -> BatchInterventionResult:
    return intervene_batch(events, context)


def handle_compliance(context: Any) -> Optional[BatchInterventionResult]:
    failure_count = 0
    post_batch_commit_failed = False
    if hasattr(context, "metadata"):
        failure_count = context.metadata.get("failure_count", 0)
        post_batch_commit_failed = context.metadata.get("post_batch_commit_failed", False)
    elif isinstance(context, dict):
        failure_count = context.get("failure_count", 0)
        post_batch_commit_failed = context.get("post_batch_commit_failed", False)

    if failure_count >= 3:
        return BatchInterventionResult(
            items=[],
            success=False,
            action="blocked",
            total=0,
        )
    if post_batch_commit_failed:
        return BatchInterventionResult(
            items=[],
            success=True,
            action="blocked",
            post_batch_commit_failed=True,
            total=0,
        )
    return BatchInterventionResult(
        items=[],
        success=True,
        action="auto_committed",
        total=0,
    )
