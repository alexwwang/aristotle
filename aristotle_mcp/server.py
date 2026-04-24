"""Aristotle MCP Server - Entry point and tool registry."""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from aristotle_mcp._tools_rules import register_rules_tools
from aristotle_mcp._tools_sync import register_sync_tools
from aristotle_mcp._tools_reflection import register_reflection_tools
from aristotle_mcp._tools_feedback import register_feedback_tools
from aristotle_mcp._orch_start import register_orch_start_tools
from aristotle_mcp._orch_event import register_orch_event_tools
from aristotle_mcp._orch_review import register_orch_review_tools
from aristotle_mcp._tools_undo import register_undo_tools

# Re-export all public symbols for backward compatibility
from aristotle_mcp._utils import (
    _now_iso,
    _resolve_path,
    _safe_resolve,
    _unique_filename,
    _rejected_dir_for,
)
from aristotle_mcp._tools_rules import (
    get_audit_decision,
    init_repo_tool,
    write_rule,
    read_rules,
    stage_rule,
    commit_rule,
    reject_rule,
    restore_rule,
    list_rules,
)
from aristotle_mcp._tools_sync import (
    check_sync_status,
    sync_rules,
)
from aristotle_mcp._tools_reflection import (
    persist_draft,
    create_reflection_record,
    complete_reflection_record,
)
from aristotle_mcp._orch_start import orchestrate_start
from aristotle_mcp._orch_event import orchestrate_on_event
from aristotle_mcp._orch_review import orchestrate_review_action
from aristotle_mcp._orch_prompts import (
    O_INTENT_PROMPT,
    REFLECTOR_PROMPT_TEMPLATE,
    CHECKER_PROMPT_TEMPLATE,
    REVISE_PROMPT_TEMPLATE,
    _build_intent_extraction_prompt,
    _build_reflector_prompt,
    _build_checker_prompt,
    _build_revise_prompt,
)
from aristotle_mcp._orch_state import (
    _workflow_dir,
    _save_workflow,
    _load_workflow,
    _next_sequence,
    _ensure_repo_initialized,
    _cleanup_stale_workflows,
)
from aristotle_mcp._orch_parsers import (
    _parse_checker_result,
    _format_review_output,
    _parse_revised_rule,
    _do_search_and_notify,
)

# Re-export config symbols used by tests via _server.X access
from aristotle_mcp.config import resolve_repo_dir

mcp = FastMCP("aristotle-mcp")

register_rules_tools(mcp)
register_sync_tools(mcp)
register_reflection_tools(mcp)
register_feedback_tools(mcp)
register_orch_start_tools(mcp)
register_orch_event_tools(mcp)
register_orch_review_tools(mcp)
register_undo_tools(mcp)


if __name__ == "__main__":
    mcp.run()
