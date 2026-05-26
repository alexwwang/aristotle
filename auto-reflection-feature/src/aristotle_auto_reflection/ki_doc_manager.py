"""KiDocManager — manages the KI (Knowledge Integration) review document."""

import re
from pathlib import Path


class KiDocManager:
    def __init__(self, ki_doc_path: str):
        self.ki_doc_path = ki_doc_path

    def record_intervention(self, event, plan, rollback_result, validation_result=None):
        entry = self._format_intervention_entry(event, plan, rollback_result, validation_result)
        try:
            self._append(entry)
        except IOError:
            return None

    def ensure_assessment(self, phase, next_phase, status, issues, priority_counts=None):
        if not status:
            p = Path(self.ki_doc_path)
            if not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("# Review Records\n\n")
            return
        entry = self._format_assessment_entry(phase, next_phase, status, issues, priority_counts)
        self._append(entry)

    def ensure_updated(self, last_intervention_ts):
        newest_ts = self._parse_newest_timestamp()
        if newest_ts is None:
            return True
        return not (newest_ts < last_intervention_ts)

    def record_merge(self, events, context):
        entry = self._format_merge_entry(events, context)
        self._append(entry)

    def _parse_newest_timestamp(self):
        p = Path(self.ki_doc_path)
        if not p.exists():
            return None
        text = p.read_text()
        matches = re.findall(
            r"\*\*Timestamp\*\*:\s*(\d{4}-\d{2}-\d{2}T[\d:]+(?:[+-]\d{2}:\d{2}|Z))",
            text,
        )
        return matches[-1] if matches else None

    def _append(self, entry):
        p = Path(self.ki_doc_path)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("# Review Records\n\n")
        with open(p, "a") as f:
            f.write(entry)

    # ── Formatting helpers ──────────────────────────────────────

    def _format_intervention_entry(self, event, plan, rollback_result, validation_result=None):
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
        lines.append("\n")
        return "".join(lines)

    def _format_assessment_entry(self, phase, next_phase, status, issues, priority_counts=None):
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

    def _format_merge_entry(self, events, context):
        violation_types = [e.violation_type for e in events]
        lines = [
            "## Merged Intervention\n",
            f"**Violations**: {', '.join(violation_types)}\n",
            f"**Phase**: {context.current_phase}\n",
            f"**Requirement**: {context.req_number}\n",
            "\n",
        ]
        return "".join(lines)
