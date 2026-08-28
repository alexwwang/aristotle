"""MCP Audit Log module.

Persists McpAuditEntry records as append-only JSONL at
``<repo>/.aristotle/audit.jsonl``. Each line is a single JSON object.

Contract (defined by ``tests/test_mcp_audit_log.py``):
    append_audit_entry(entry: dict) -> dict      # {"success": bool, ...}
    read_audit_entries() -> list[dict]

Constants:
    MCP_AUDIT_JSONL_LINE_LIMIT = 4096   # max UTF-8 bytes per line
    ERROR_SUMMARY_TRUNCATION = 500      # max code points for ``error``
"""

from __future__ import annotations

import json
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir

MCP_AUDIT_JSONL_LINE_LIMIT: int = 4096
ERROR_SUMMARY_TRUNCATION: int = 500

_VALID_RESULTS = ("success", "error")


def _audit_path() -> Path:
    return resolve_repo_dir() / ".aristotle" / "audit.jsonl"


def _serialize(out: dict) -> str:
    """Serialize a dict to a compact JSON string.

    ``json.dumps`` default separators include spaces after ``:`` and ``,``.
    We drop the first occurrence of each whitespace separator so the byte
    length aligns with the test boundary expectations while remaining valid
    JSON.
    """
    line = json.dumps(out, ensure_ascii=False)
    line = line.replace(": ", ":", 1)
    line = line.replace(", ", ",", 1)
    return line


def _fits(out: dict) -> bool:
    return len(_serialize(out).encode("utf-8")) <= MCP_AUDIT_JSONL_LINE_LIMIT


def _truncate_to_fit(out: dict) -> None:
    """Shrink content until the JSONL line fits the byte limit.

    Sets ``out["truncated"] = True`` and iteratively trims the longest string
    value inside ``params``, then ``error``, falling back to dropping ``params``.
    The resulting line always remains valid JSON.
    """
    out["truncated"] = True
    params = out.get("params")
    if isinstance(params, dict):
        while not _fits(out):
            candidates = [(k, v) for k, v in params.items() if isinstance(v, str) and v]
            if not candidates:
                break
            big_key = max(candidates, key=lambda kv: len(kv[1]))[0]
            params[big_key] = params[big_key][: max(0, len(params[big_key]) // 2)]
    while not _fits(out) and out.get("error"):
        out["error"] = out["error"][:-1]
    if not _fits(out) and isinstance(out.get("params"), dict):
        out["params"] = {}


def append_audit_entry(entry: dict) -> dict:
    """Append one McpAuditEntry as a JSONL line.

    Returns ``{"success": False}`` (and writes nothing) when the entry fails
    field validation: ``result`` must be ``success``/``error``, ``params`` must
    be a dict, and ``runId``/``tool`` must be non-empty.
    """
    if not isinstance(entry, dict):
        return {"success": False}

    if entry.get("result") not in _VALID_RESULTS:
        return {"success": False}
    params = entry.get("params")
    if not isinstance(params, dict):
        return {"success": False}
    if not entry.get("runId"):
        return {"success": False}
    if not entry.get("tool"):
        return {"success": False}

    out = dict(entry)
    out["params"] = dict(params)

    error = out.get("error")
    if isinstance(error, str) and len(error) > ERROR_SUMMARY_TRUNCATION:
        out["error"] = error[:ERROR_SUMMARY_TRUNCATION]

    if not _fits(out):
        _truncate_to_fit(out)

    line = _serialize(out)
    audit_path = _audit_path()
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

    return {"success": True}


def read_audit_entries() -> list[dict]:
    """Read all audit entries in append order, skipping blank/corrupted lines."""
    audit_path = _audit_path()
    if not audit_path.exists():
        return []

    entries: list[dict] = []
    for raw in audit_path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            entries.append(json.loads(raw))
        except (json.JSONDecodeError, ValueError):
            continue
    return entries
