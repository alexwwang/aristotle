from __future__ import annotations

import uuid
from pathlib import Path

from aristotle_mcp.frontmatter import read_frontmatter_raw, update_frontmatter_field
from aristotle_mcp._orch_state import _save_workflow, _next_sequence
from aristotle_mcp._orch_prompts import _build_reflector_prompt
from aristotle_mcp._tools_rules import list_rules
from aristotle_mcp.config import MAX_FEEDBACK_REFLECT


def report_feedback(
    rule_ids: list,
    error_description: str,
    context: str = "",
    session_id: str = "",
    auto_reflect: bool = True,
    project_directory: str = "",
) -> dict:
    """Report feedback for one or more rules and optionally trigger reflection.

    Args:
        rule_ids: List of rule IDs to receive feedback.
        error_description: Description of the error observed.
        context: Additional context for the reflection workflow.
        session_id: Session ID to associate with the reflection.
        auto_reflect: Whether to auto-trigger a reflection workflow.
        project_directory: Project directory path for the reflection workflow.

    Returns dict with action ("notify" | "fire_sub"), message, and optional
    workflow_id / sub_role when a reflection is fired.
    """
    # 1. Validate inputs
    if not rule_ids:
        return {"action": "notify", "message": "rule_ids cannot be empty"}
    if not error_description or not error_description.strip():
        return {"action": "notify", "message": "error_description cannot be empty"}

    # 2. Cache list_rules results per rule_id
    rule_cache: dict[str, dict | None] = {}
    for rule_id in rule_ids:
        result = list_rules(keyword=rule_id, limit=10)
        found = None
        for rule in result.get("rules", []):
            if rule.get("metadata", {}).get("id") == rule_id:
                found = rule
                break
        rule_cache[rule_id] = found

    # 3. Check if any found
    found_any = any(rule_cache.values())
    if not found_any:
        return {
            "action": "notify",
            "message": "No verified rules found for the given rule_ids",
        }

    # 4. Update feedback signal for each found rule
    found_rules = [r for r in rule_cache.values() if r is not None]
    max_feedback_count = 0

    for rule in found_rules:
        path = Path(rule["path"])
        fm = read_frontmatter_raw(path)
        if fm is None:
            continue

        # Safe extraction of current signal values
        try:
            current_sample = int(fm.get("sample_size", 0) or 0)
        except (ValueError, TypeError):
            current_sample = 0

        try:
            current_failure = float(fm.get("failure_rate", 0.0) or 0.0)
        except (ValueError, TypeError):
            current_failure = 0.0

        new_sample = current_sample + 1
        new_failure = (current_failure * current_sample + 1) / new_sample
        new_success = 1.0 - new_failure

        update_frontmatter_field(path, "sample_size", str(new_sample))
        update_frontmatter_field(path, "failure_rate", str(round(new_failure, 3)))
        update_frontmatter_field(path, "success_rate", str(round(new_success, 3)))

        # Track max feedback_count for depth check
        try:
            fb_count = int(fm.get("feedback_count", 0) or 0)
        except (ValueError, TypeError):
            fb_count = 0
        max_feedback_count = max(max_feedback_count, fb_count)

    # 5 & 6. Check recursion depth; if ok and auto_reflect, increment feedback_count and create workflow
    if auto_reflect and max_feedback_count < MAX_FEEDBACK_REFLECT:
        for rule in found_rules:
            path = Path(rule["path"])
            fm = read_frontmatter_raw(path)
            if fm is None:
                continue
            try:
                fb_count = int(fm.get("feedback_count", 0) or 0)
            except (ValueError, TypeError):
                fb_count = 0
            update_frontmatter_field(path, "feedback_count", str(fb_count + 1))

        workflow_id = f"wf_{uuid.uuid4().hex[:16]}"
        found_rule_ids = [
            r["metadata"]["id"] for r in found_rules if "id" in r.get("metadata", {})
        ]

        sequence = _next_sequence()
        feedback_depth = max_feedback_count

        sub_prompt = _build_reflector_prompt(
            target_session_id=session_id,
            focus_hint="feedback",
            sequence=sequence,
            project_directory=project_directory,
            user_language="en-US",
        )

        _save_workflow(
            workflow_id,
            {
                "phase": "reflecting",
                "command": "reflect",
                "source": "feedback",
                "target_session_id": session_id,
                "sequence": sequence,
                "pending_role": "R",
                "record_created": False,
                "feedback_rule_ids": found_rule_ids,
                "feedback_error": error_description,
                "re_reflect_count": feedback_depth,
                "project_directory": project_directory,
            },
        )

        return {
            "action": "fire_sub",
            "sub_role": "R",
            "workflow_id": workflow_id,
            "sub_prompt": sub_prompt,
            "message": "Feedback recorded; reflection workflow started",
        }

    # 7. Return notify (auto_reflect disabled or depth exceeded)
    if auto_reflect and max_feedback_count >= MAX_FEEDBACK_REFLECT:
        return {
            "action": "notify",
            "message": f"Max feedback reflection depth ({MAX_FEEDBACK_REFLECT}) reached",
        }

    return {
        "action": "notify",
        "message": "Feedback signal updated",
    }


def register_feedback_tools(mcp) -> None:
    """Register feedback tools with the MCP server."""
    mcp.tool()(report_feedback)
