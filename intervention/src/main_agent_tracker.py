"""MainAgentTracker — tracks consecutive main-agent failures.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from typing import Optional


class MainAgentTracker:
    def record_result(self, key: str, success: bool) -> Optional[str]:
        raise NotImplementedError

    def is_degraded(self, key: str) -> bool:
        raise NotImplementedError
