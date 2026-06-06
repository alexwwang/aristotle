"""MCP Audit Log — append-only JSONL audit trail for tool calls."""
from __future__ import annotations

import json
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir

MCP_AUDIT_JSONL_LINE_LIMIT: int = 4096
ERROR_SUMMARY_TRUNCATION: int = 500

_VALID_RESULTS = ("success", "error")


def _audit_jsonl_path() -> Path:
    return resolve_repo_dir() / ".aristotle" / "audit.jsonl"


def _shrink_to_fit(record: dict) -> dict:
    """Return a shrunk copy. Does NOT mutate the input."""
    import copy

    line = json.dumps(record, ensure_ascii=False)
    original_bytes = len(line.encode("utf-8"))
    if original_bytes <= MCP_AUDIT_JSONL_LINE_LIMIT:
        return record  # no copy needed, fits as-is

    # Work on a copy to avoid mutating caller's dict
    record = copy.deepcopy(record)

    needs_flag = original_bytes > MCP_AUDIT_JSONL_LINE_LIMIT + 2

    params = record.get("params")
    if isinstance(params, dict):
        for key in list(params.keys()):
            val = params[key]
            if isinstance(val, str):
                while len(val) > 0:
                    line = json.dumps(record, ensure_ascii=False)
                    if len(line.encode("utf-8")) <= MCP_AUDIT_JSONL_LINE_LIMIT:
                        break
                    val = val[:-1]
                    record["params"][key] = val

    if needs_flag:
        record["truncated"] = True
        params = record.get("params")
        if isinstance(params, dict):
            for key in list(params.keys()):
                val = params[key]
                if isinstance(val, str):
                    while len(val) > 0:
                        line = json.dumps(record, ensure_ascii=False)
                        if len(line.encode("utf-8")) <= MCP_AUDIT_JSONL_LINE_LIMIT:
                            return record
                        val = val[:-1]
                        record["params"][key] = val

        line = json.dumps(record, ensure_ascii=False)
        if len(line.encode("utf-8")) <= MCP_AUDIT_JSONL_LINE_LIMIT:
            return record

        # Byte-level truncation — cannot guarantee valid JSON
        return {
            "truncated": True,
            "tool": record.get("tool", "unknown"),
            "runId": record.get("runId", ""),
        }

    return record


def append_audit_entry(entry: dict) -> dict:
    """Append a JSONL audit entry to .aristotle/audit.jsonl.

    Validates required fields (tool, runId, result), enforces the 4KB
    line limit, and truncates the error field at ERROR_SUMMARY_TRUNCATION
    code points.
    """
    tool = entry.get("tool")
    if not tool or not isinstance(tool, str):
        return {"success": False, "error": "Missing or empty 'tool' field"}

    run_id = entry.get("runId")
    if not run_id or not isinstance(run_id, str):
        return {"success": False, "error": "Missing or empty 'runId' field"}

    result_val = entry.get("result")
    if result_val not in _VALID_RESULTS:
        return {"success": False, "error": f"Invalid result value: {result_val!r}. Must be 'success' or 'error'"}

    params = entry.get("params")
    if params is None:
        return {"success": False, "error": "'params' must not be None"}

    if not isinstance(params, dict):
        return {"success": False, "error": "'params' must be a dict"}

    record: dict = dict(entry)

    error_val = record.get("error")
    if error_val is not None and len(error_val) > ERROR_SUMMARY_TRUNCATION:
        record["error"] = error_val[:ERROR_SUMMARY_TRUNCATION]

    record = _shrink_to_fit(record)

    line = json.dumps(record, ensure_ascii=False)

    audit_path = _audit_jsonl_path()
    audit_path.parent.mkdir(parents=True, exist_ok=True)

    with open(audit_path, "a", encoding="utf-8") as f:
        f.write(line + "\n")

    return {"success": True}


def read_audit_entries() -> list[dict]:
    """Read all audit entries from .aristotle/audit.jsonl.

    Returns entries in chronological order (file order).
    Skips corrupted JSON lines gracefully.
    Returns empty list if the file does not exist.
    """
    audit_path = _audit_jsonl_path()
    if not audit_path.exists():
        return []

    entries: list[dict] = []
    for line in audit_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except (json.JSONDecodeError, ValueError):
            continue

    return entries
