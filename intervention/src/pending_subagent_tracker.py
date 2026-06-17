"""PendingSubagentTracker — tracks pending subagent lifecycle."""
from dataclasses import dataclass, field
from typing import Optional, Any, Dict


_TEMPLATE_POST_ACTION: Dict[str, str] = {
    "T-5": "notify_briefing_complete",
    "T-3": "notify_split_complete",
}


def _validate_key(key: str) -> None:
    parts = key.split(":")
    if len(parts) > 3:
        raise ValueError(
            f"Invalid key format (too many colon-delimited segments): {key}. "
            "Expected '${run_id}:${template_id}:${violation_type}:${attempt}' or similar with at most 2 colons."
        )


@dataclass
class PendingSubagent:
    key: str
    template_id: str
    params: dict = field(default_factory=dict)
    status: str = "pending"
    result: Any = None
    error: Optional[str] = None
    reconnected: bool = False


class PendingSubagentTracker:
    def __init__(self) -> None:
        self._pending: Dict[str, PendingSubagent] = {}

    def register(self, key: str, template_id: str, params: dict = None) -> PendingSubagent:
        _validate_key(key)
        sub = PendingSubagent(
            key=key,
            template_id=template_id,
            params=params or {},
            status="pending",
        )
        self._pending[key] = sub
        return sub

    def complete(self, key: str, result: Any = None) -> Optional[str]:
        sub = self._pending.get(key)
        if sub is None:
            return None
        sub.status = "completed"
        sub.result = result
        post_action = _TEMPLATE_POST_ACTION.get(sub.template_id)
        return post_action

    def fail(self, key: str, error: str) -> Optional[PendingSubagent]:
        sub = self._pending.get(key)
        if sub is None:
            return None
        sub.status = "failed"
        sub.error = error
        return sub

    def reconnect(self, key: str, template_id: str, params: dict = None) -> PendingSubagent:
        _validate_key(key)
        sub = PendingSubagent(
            key=key,
            template_id=template_id,
            params=params or {},
            status="pending",
            reconnected=True,
        )
        self._pending[key] = sub
        return sub
