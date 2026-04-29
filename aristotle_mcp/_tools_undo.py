"""Phase 0: on_undo MCP tool — mark workflow as undone."""

from __future__ import annotations

from aristotle_mcp._orch_state import _load_workflow, _save_workflow


def on_undo(
    workflow_id: str,
    undo_scope: str = "unknown",
    timestamp: int = 0,
) -> dict:
    """Receive undo event, mark workflow as undone. Does NOT auto-revert git.

    Args:
        workflow_id: The workflow to mark as undone.
        undo_scope: Scope of the undo (default "unknown").
        timestamp: Unix ms timestamp (default 0).

    Returns dict with status and workflow_id.
    """
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"status": "unknown_workflow"}

    workflow["undo_received_at"] = timestamp
    workflow["undo_scope"] = undo_scope
    workflow["status"] = "undone"
    _save_workflow(workflow_id, workflow)

    return {
        "status": "undone",
        "workflow_id": workflow_id,
        "message": "Workflow marked as undone.",
    }


def register_undo_tools(mcp) -> None:
    """Register on_undo with the MCP server."""
    mcp.tool()(on_undo)
