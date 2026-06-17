"""PatternCycleDetector — sliding-window cycle detection (10 checkpoint events)."""
from collections import deque
from typing import Dict, Tuple


_PATTERN_CYCLE_THRESHOLD = 3
_WINDOW_SIZE = 10


class PatternCycleDetector:
    def __init__(self) -> None:
        self._windows: Dict[str, deque] = {}

    def record_checkpoint(self, run_id: str, violation_type: str) -> None:
        if run_id not in self._windows:
            self._windows[run_id] = deque(maxlen=_WINDOW_SIZE)
        self._windows[run_id].append(violation_type)

    def check_cycle(self, run_id: str, violation_type: str) -> Tuple[int, bool]:
        window = self._windows.get(run_id)
        if not window:
            return 0, False
        count = sum(1 for v in window if v == violation_type)
        return count, count >= _PATTERN_CYCLE_THRESHOLD

    def get_count(self, run_id: str, violation_type: str) -> int:
        window = self._windows.get(run_id)
        if not window:
            return 0
        return sum(1 for v in window if v == violation_type)
