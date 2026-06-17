"""SubagentRetryHandler — manages subagent retry attempts and degradation."""
from typing import Dict, Any, Optional


_MAX_ATTEMPTS = 4


class SubagentRetryHandler:
    def build_spawn_request(self, template_id: str, params: Dict[str, Any], run_id: str,
                            violation_type: str, attempt: int,
                            last_error: Optional[str] = None) -> Dict[str, Any]:
        if attempt < 1 or attempt > _MAX_ATTEMPTS:
            raise ValueError(f"Invalid attempt {attempt} (must be 1..{_MAX_ATTEMPTS})")

        request: Dict[str, Any] = {
            "template_id": template_id,
            "params": dict(params),
            "run_id": run_id,
            "violation_type": violation_type,
            "attempt": attempt,
        }

        if attempt == 1:
            return request

        hint = self._build_hint(attempt, last_error)
        if hint:
            request["escalation_hint"] = hint
        return request

    def _build_hint(self, attempt: int, last_error: Optional[str]) -> str:
        prev_failures = attempt - 1
        times_word = "time" if prev_failures == 1 else "times"
        error_part = f" Last error: {last_error}." if last_error else ""
        if attempt >= _MAX_ATTEMPTS:
            return (
                f"Failed {prev_failures} {times_word}. This is the final attempt "
                f"before degradation to main agent.{error_part}"
            )
        return f"Failed {prev_failures} {times_word}. Retry with adjusted context.{error_part}"

    def report_subagent_degradation(self, template_id: str, run_id: str,
                                     violation_type: str, errors: list) -> None:
        raise ValueError(
            f"Subagent {template_id} degraded after {len(errors)} failed attempt(s) "
            f"(run_id={run_id}, violation_type={violation_type}). "
            f"Errors: {errors}"
        )
