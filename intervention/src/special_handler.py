"""SpecialHandler — handles special violation types.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class InterventionResult:
    success: bool = False
    action: str = ""
    pipeline_action: Optional[str] = None
    files_affected: List[str] = field(default_factory=list)
    user_message: str = ""
    subagent_spawn_request: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    pending_pause: bool = False


class SpecialHandler:
    def handle_special(self, violation_type: str, context: Dict[str, Any]) -> InterventionResult:
        raise NotImplementedError

    def handle_file_split_needed(self, context: Dict[str, Any]) -> InterventionResult:
        raise NotImplementedError

    def handle_prompt_injection_blocked(self, context: Dict[str, Any]) -> InterventionResult:
        raise NotImplementedError

    def handle_pattern_cycle(self, context: Dict[str, Any]) -> InterventionResult:
        raise NotImplementedError
