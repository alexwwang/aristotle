"""GPAVValidator — validates GPAV submissions in 5 ordered steps."""
from dataclasses import dataclass, field
from typing import List, Optional, Dict


_VALID_SEVERITIES = {"C", "H", "M", "P", "L", "I"}
_FINDINGS_CAP = 50


@dataclass
class GPAVValidationResult:
    valid: bool = False
    rejection_step: Optional[int] = None
    rejection_reason: str = ""
    truncated_findings: List[dict] = field(default_factory=list)
    steps_executed: List[int] = field(default_factory=list)


class GPAVValidator:
    def __init__(self) -> None:
        self._last_round: Dict[str, int] = {}

    def validate(self, submission: dict) -> GPAVValidationResult:
        run_id = submission.get("run_id") or submission.get("runId")
        round_num = submission.get("round")
        findings = submission.get("findings", []) or []

        # Step 0: severity enum check
        for f in findings:
            sev = f.get("severity")
            if sev not in _VALID_SEVERITIES:
                return GPAVValidationResult(
                    valid=False,
                    rejection_step=0,
                    rejection_reason=f"Invalid severity '{sev}' (allowed: C/H/M/P/L/I)",
                    steps_executed=[0],
                )

        # Step 1: strict monotonic round
        last = self._last_round.get(run_id, 0)
        if not isinstance(round_num, int) or round_num <= last:
            return GPAVValidationResult(
                valid=False,
                rejection_step=1,
                rejection_reason=(
                    f"Round {round_num} is not strictly greater than last recorded round {last}"
                ),
                steps_executed=[0, 1],
            )

        # Step 2: cap at 50
        truncated = findings[:_FINDINGS_CAP]

        # Step 3: dedup by (severity+description)
        seen_pairs = set()
        for f in truncated:
            key = (f.get("severity"), f.get("description"))
            if key in seen_pairs:
                return GPAVValidationResult(
                    valid=False,
                    rejection_step=3,
                    rejection_reason=(
                        f"Duplicate finding (severity={key[0]}, description='{key[1]}') "
                        "— all-or-nothing dedup"
                    ),
                    truncated_findings=truncated,
                    steps_executed=[0, 1, 2, 3],
                )
            seen_pairs.add(key)

        # Step 4: ID uniqueness
        ids = [f.get("id") for f in truncated if f.get("id") is not None]
        if len(ids) != len(set(ids)):
            return GPAVValidationResult(
                valid=False,
                rejection_step=4,
                rejection_reason="Duplicate finding.id values within submission",
                truncated_findings=truncated,
                steps_executed=[0, 1, 2, 3, 4],
            )

        self._last_round[run_id] = round_num
        return GPAVValidationResult(
            valid=True,
            truncated_findings=truncated,
            steps_executed=[0, 1, 2, 3, 4],
        )
