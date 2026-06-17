"""MainAgentTracker — tracks consecutive main-agent failures after subagent degradation."""
from dataclasses import dataclass
from typing import Optional


_MAIN_AGENT_FAILURE_THRESHOLD = 4


@dataclass
class MainAgentTrackerResult:
    consecutive_failures: int = 0
    degraded: bool = False
    pause_message: Optional[str] = None


class MainAgentTracker:
    def __init__(self) -> None:
        self._failures: dict = {}

    def record_result(self, key: str, success: bool) -> Optional[MainAgentTrackerResult]:
        parts = key.split(":")
        if len(parts) > 2:
            raise ValueError(
                f"Invalid key format (too many colon-delimited segments): {key}. "
                "Expected 'scope:run_id' (single colon)."
            )
        if success:
            self._failures[key] = 0
            return MainAgentTrackerResult(consecutive_failures=0, degraded=False)
        count = self._failures.get(key, 0) + 1
        self._failures[key] = count
        if count >= _MAIN_AGENT_FAILURE_THRESHOLD:
            return MainAgentTrackerResult(
                consecutive_failures=count,
                degraded=True,
                pause_message=(
                    "Main agent failed 4 consecutive attempts after subagent degradation. "
                    "Pipeline paused for manual intervention."
                ),
            )
        return MainAgentTrackerResult(consecutive_failures=count, degraded=False)

    def is_degraded(self, key: str) -> bool:
        return self._failures.get(key, 0) >= _MAIN_AGENT_FAILURE_THRESHOLD
