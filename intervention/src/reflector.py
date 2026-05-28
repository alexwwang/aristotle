import logging
from typing import Optional
from dataclasses import dataclass

from intervention_types import ViolationEvent

logger = logging.getLogger(__name__)

_HASH_MODULO = 10000


@dataclass
class ReflectionResult:
    rule_id: str
    rule_path: str
    success: bool
    error: Optional[str] = None

class AutoReflector:
    def __init__(self, mcp_available: bool = True) -> None:
        self.mcp_available = mcp_available

    def build_reflection_prompt(self, event: ViolationEvent) -> str:
        """Format a violation event into a structured reflection prompt for rule generation."""
        return f"""TDD Pipeline Violation Detected

Violation Type: {event.violation_type}
Affected File: {event.affected_file_path}
Timestamp: {event.timestamp}
Operation: {event.context.get("operation", "unknown")}
Phase: {event.context.get("phase", "unknown")}

Generate a preventive rule for this violation."""

    def reflect(self, event: ViolationEvent) -> Optional[ReflectionResult]:
        """Reflect on a violation event and produce a rule result via MCP (or return None if MCP unavailable)."""
        if not self.mcp_available:
            return None
        
        prompt = self.build_reflection_prompt(event)
        # In a real implementation, this would call MCP write_rule
        # For now, return a mock successful result
        return ReflectionResult(
            rule_id=f"rule_{event.violation_type}_{hash(event.affected_file_path) % _HASH_MODULO}",
            rule_path=f"rules/{event.violation_type}.md",
            success=True
        )
