"""PendingSubagentTracker — tracks pending subagent lifecycle.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class PendingSubagent:
    key: str
    template_id: str
    params: dict = field(default_factory=dict)
    status: str = "pending"
    result: Any = None
    error: Optional[str] = None


class PendingSubagentTracker:
    def register(self, key: str, template_id: str, params: dict = None) -> PendingSubagent:
        raise NotImplementedError

    def complete(self, key: str, result: Any = None) -> Optional[str]:
        raise NotImplementedError

    def fail(self, key: str, error: str) -> None:
        raise NotImplementedError
