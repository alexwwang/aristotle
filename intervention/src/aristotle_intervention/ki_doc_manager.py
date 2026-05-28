"""KiDocManager — manages the KI (Knowledge Integration) review document."""

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional

from aristotle_intervention.intervention_types import (
    InterventionPlan,
    PipelineContext,
    RollbackResult,
    ValidationResult,
    ViolationEvent,
)

logger = logging.getLogger(__name__)

_DEFAULT_HEADER: str = "# Review Records\n\n"


class KiDocManager:
    def __init__(self, ki_doc_path: str) -> None:
        self.ki_doc_path = ki_doc_path

    def record_intervention(
        self,
        event: ViolationEvent,
        plan: InterventionPlan,
        rollback_result: Optional[RollbackResult] = None,
        validation_result: Optional[ValidationResult] = None,
    ) -> Optional[bool]:
        """Append an intervention entry to the KI document."""
        entry = self._format_intervention_entry(event, plan, rollback_result, validation_result)
        try:
            self._append(entry)
            return True
        except IOError as e:
            logger.warning("Failed to record intervention: %s", e)
            return None

    def ensure_assessment(
        self,
        phase: int,
        next_phase: int,
        status: str,
        issues: List[str],
        priority_counts: Optional[Dict[str, int]] = None,
    ) -> Optional[bool]:
        """Write a phase assessment entry or create the doc if status is empty."""
        if not status:
            p = Path(self.ki_doc_path)
            if not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(_DEFAULT_HEADER)
            return True
        entry = self._format_assessment_entry(phase, next_phase, status, issues, priority_counts)
        try:
            self._append(entry)
            return True
        except IOError as e:
            logger.warning("Failed to ensure assessment: %s", e)
            return None

    def ensure_updated(self, last_intervention_ts: str) -> bool:
        """Return True if the doc is up-to-date. Non-existent docs are treated as up-to-date."""
        newest_ts = self._parse_newest_timestamp()
        if newest_ts is None:
            return True
        return not (newest_ts < last_intervention_ts)

    def record_merge(
        self,
        events: List[ViolationEvent],
        context: PipelineContext,
    ) -> Optional[bool]:
        """Append a merged-intervention entry summarizing multiple events."""
        entry = self._format_merge_entry(events, context)
        try:
            self._append(entry)
            return True
        except IOError as e:
            logger.warning("Failed to record merge: %s", e)
            return None

    def _parse_newest_timestamp(self) -> Optional[str]:
        p = Path(self.ki_doc_path)
        if not p.exists():
            return None
        text = p.read_text()
        matches = re.findall(
            r"\*\*Timestamp\*\*:\s*(\d{4}-\d{2}-\d{2}T[\d:]+(?:[+-]\d{2}:\d{2}|Z))",
            text,
        )
        return matches[-1] if matches else None

    def _append(self, entry: str) -> None:
        p = Path(self.ki_doc_path)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(_DEFAULT_HEADER)
        with open(p, "a") as f:
            f.write(entry)

    # ── Formatting helpers ──────────────────────────────────────

    def _format_intervention_entry(self, event: ViolationEvent, plan: InterventionPlan, rollback_result: Optional[RollbackResult], validation_result: Optional[ValidationResult] = None) -> str:
        lines = [
            "## Intervention\n",
            f"**Violation**: {event.violation_type}\n",
            f"**Timestamp**: {event.timestamp}\n",
            f"**File**: {event.affected_file_path}\n",
            f"**Phase**: {event.context.get('phase', 'N/A')}\n",
        ]
        if rollback_result:
            lines.append(f"**Rollback**: {rollback_result.action}\n")
            if rollback_result.files_affected:
                lines.append(f"**Files affected**: {', '.join(rollback_result.files_affected)}\n")
        if plan.instruction:
            lines.append(f"**Instruction**: {plan.instruction}\n")
        if validation_result and hasattr(validation_result, "matches") and validation_result.matches:
            forbidden = [f"{m.category}:{m.pattern}" for m in validation_result.matches]
            lines.append(f"**Forbidden patterns**: {', '.join(forbidden)}\n")
        lines.append("\n")
        return "".join(lines)

    def _format_assessment_entry(self, phase: int, next_phase: int, status: str, issues: List[str], priority_counts: Optional[dict] = None) -> str:
        lines = [
            "## Assessment\n",
            f"**Phase**: {phase} → {next_phase}\n",
            f"**Status**: {status}\n",
        ]
        if issues:
            lines.append(f"**Issues**: {'; '.join(issues)}\n")
        if priority_counts:
            lines.append(f"**Priority counts**: {priority_counts}\n")
        lines.append("\n")
        return "".join(lines)

    def _format_merge_entry(self, events: List[ViolationEvent], context: PipelineContext) -> str:
        violation_types = [e.violation_type for e in events]
        lines = [
            "## Merged Intervention\n",
            f"**Violations**: {', '.join(violation_types)}\n",
            f"**Phase**: {context.current_phase}\n",
            f"**Requirement**: {context.req_number}\n",
            "\n",
        ]
        return "".join(lines)
