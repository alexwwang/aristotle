"""SpecialHandler — handles special violation types (PATTERN_CYCLE, FILE_SPLIT_NEEDED, PROMPT_INJECTION_BLOCKED)."""
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


_FILE_SPLIT_SIZE_THRESHOLD = 100 * 1024


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
        if violation_type == "PATTERN_CYCLE":
            return self.handle_pattern_cycle(context)
        if violation_type == "FILE_SPLIT_NEEDED":
            return self.handle_file_split_needed(context)
        if violation_type == "PROMPT_INJECTION_BLOCKED":
            return self.handle_prompt_injection_blocked(context)
        return InterventionResult(
            success=False,
            action="unknown",
            error=f"Unknown special violation type: {violation_type}",
        )

    def handle_pattern_cycle(self, context: Dict[str, Any]) -> InterventionResult:
        pipeline_state = context.get("pipeline_state")
        if pipeline_state in ("suspended", "paused"):
            return InterventionResult(
                success=True,
                action="skipped",
                pipeline_action="skipped",
                user_message=f"Pipeline already {pipeline_state}; PATTERN_CYCLE briefing still spawned.",
                pending_pause=(pipeline_state == "suspended"),
            )
        return InterventionResult(
            success=True,
            action="spawn_subagent",
            pipeline_action="paused",
            user_message="Pattern cycle detected. Pipeline paused. Briefing subagent spawned.",
            subagent_spawn_request={
                "template_id": "T-5",
                "params": {
                    "violation_type": "PATTERN_CYCLE",
                    "occurrences": context.get("occurrences", 3),
                    "window": context.get("window", 10),
                    "run_id": context.get("run_id"),
                    "phase": context.get("phase"),
                },
            },
        )

    def handle_file_split_needed(self, context: Dict[str, Any]) -> InterventionResult:
        file_path = context.get("file_path")
        file_size = context.get("file_size", 0)
        if context.get("unsplittable"):
            return InterventionResult(
                success=True,
                action="paused",
                pipeline_action="paused",
                user_message=f"File {file_path} is unsplittable. Pipeline paused.",
            )
        if not file_path or not isinstance(file_size, (int, float)) or file_size <= _FILE_SPLIT_SIZE_THRESHOLD:
            return InterventionResult(
                success=True,
                action="noop",
                pipeline_action=None,
                user_message="File does not require splitting.",
            )
        return InterventionResult(
            success=True,
            action="split",
            pipeline_action=None,
            files_affected=[file_path],
            user_message=f"File {file_path} too large. Split subagent spawned.",
            subagent_spawn_request={
                "template_id": "T-3",
                "params": {
                    "file_path": file_path,
                    "file_size": file_size,
                    "language": context.get("language"),
                },
            },
        )

    def handle_prompt_injection_blocked(self, context: Dict[str, Any]) -> InterventionResult:
        regeneration_attempts = context.get("regeneration_attempts")
        regeneration_attempt = context.get("regeneration_attempt")
        clean_prompt = context.get("clean_prompt")

        if regeneration_attempt is not None and clean_prompt:
            return InterventionResult(
                success=True,
                action="regenerated",
                pipeline_action=None,
                user_message="Prompt injection blocked and prompt regenerated.",
            )

        if regeneration_attempts is not None and regeneration_attempts >= 4:
            return InterventionResult(
                success=True,
                action="degraded",
                pipeline_action="paused",
                user_message=(
                    "Injection detected but clean regeneration failed after 4 total attempts "
                    "(1 initial + 3 retries). Resolve manually."
                ),
            )

        return InterventionResult(
            success=True,
            action="blocked",
            pipeline_action=None,
            user_message="Prompt injection detected and blocked. Security review spawned.",
        )
