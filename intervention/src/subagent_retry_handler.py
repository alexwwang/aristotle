"""SubagentRetryHandler — manages subagent retry attempts and degradation.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from typing import Dict, Any, Optional


class SubagentRetryHandler:
    def build_spawn_request(self, template_id: str, params: Dict[str, Any], run_id: str,
                            violation_type: str, attempt: int, last_error: Optional[str] = None) -> Dict[str, Any]:
        raise NotImplementedError

    def report_subagent_degradation(self, template_id: str, run_id: str,
                                     violation_type: str, errors: list) -> None:
        raise NotImplementedError
