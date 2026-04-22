from __future__ import annotations

import json
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir
from aristotle_mcp._utils import _now_iso


def persist_draft(sequence: int, content: str) -> dict:
    """Persist a DRAFT report to disk for later review and re-reflect.

    Args:
        sequence: State record sequence number
        content: Full DRAFT report markdown content

    Returns dict with success, file_path.
    """
    drafts_dir = resolve_repo_dir().parent / "aristotle-drafts"
    drafts_dir.mkdir(parents=True, exist_ok=True)
    file_path = drafts_dir / f"rec_{sequence}.md"
    # Atomic write
    tmp = file_path.with_suffix(".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.rename(file_path)
    return {"success": True, "file_path": str(file_path)}


def create_reflection_record(
    target_session_id: str,
    target_label: str,
    reflector_session_id: str,
) -> dict:
    """Append a new reflection record to the state file.

    Auto-generates sequence number, handles 50-record pruning with
    DRAFT file cleanup, and returns the new record id.

    Args:
        target_session_id: The session being analyzed
        target_label: Short label (e.g. "current", "last", "passive-trigger")
        reflector_session_id: The Reflector subagent's session ID

    Returns dict with success, id, draft_file_path.
    """
    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)

    if state_path.exists():
        try:
            records = json.loads(state_path.read_text(encoding="utf-8"))
            if not isinstance(records, list):
                records = []
        except (json.JSONDecodeError, ValueError):
            records = []
    else:
        records = []

    max_seq = 0
    for r in records:
        rid = r.get("id", "")
        if rid.startswith("rec_"):
            try:
                max_seq = max(max_seq, int(rid[4:]))
            except ValueError:
                pass
    n = max_seq + 1
    record_id = f"rec_{n}"
    drafts_dir = resolve_repo_dir().parent / "aristotle-drafts"
    draft_path = drafts_dir / f"rec_{n}.md"

    record = {
        "id": record_id,
        "reflector_session_id": reflector_session_id,
        "target_session_id": target_session_id,
        "target_label": target_label,
        "draft_file_path": str(draft_path),
        "launched_at": _now_iso(),
        "status": "processing",
        "rules_count": None,
    }

    records.append(record)

    while len(records) > 50:
        old = records.pop(0)
        old_draft = old.get("draft_file_path")
        if old_draft:
            old_path = Path(old_draft).expanduser()
            if old_path.exists():
                old_path.unlink()

    state_path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    actual_idx = None
    for i, r in enumerate(records):
        if r.get("reflector_session_id") == reflector_session_id:
            actual_idx = i + 1
            break

    return {
        "success": True,
        "id": record_id,
        "sequence": n,
        "review_index": actual_idx or len(records),
        "draft_file_path": str(draft_path),
        "total_records": len(records),
    }


def complete_reflection_record(
    sequence: int,
    status: str,
    rules_count: int | None = None,
) -> dict:
    """Update a reflection record after Checker completes.

    Updates status, rules_count, and completed_at timestamp.

    Args:
        sequence: The record sequence number (from create_reflection_record)
        status: New status (auto_committed, partial_commit, checker_failed)
        rules_count: Number of rules processed

    Returns dict with success, message.
    """
    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    if not state_path.exists():
        return {"success": False, "message": "State file not found"}

    try:
        records = json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        return {"success": False, "message": "State file corrupted"}

    target_id = f"rec_{sequence}"
    found = False
    for record in records:
        if record.get("id") == target_id:
            record["status"] = status
            record["completed_at"] = _now_iso()
            if rules_count is not None:
                record["rules_count"] = rules_count
            found = True
            break

    if not found:
        return {"success": False, "message": f"Record {target_id} not found"}

    state_path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    return {"success": True, "message": f"Record {target_id} updated to {status}"}


def register_reflection_tools(mcp) -> None:
    """Register reflection tools with the MCP server."""
    mcp.tool()(persist_draft)
    mcp.tool()(create_reflection_record)
    mcp.tool()(complete_reflection_record)
