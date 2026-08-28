"""Pipeline Reset module — watchdog/tdd-pipeline recovery.

Resets `PipelineState` (`.aristotle/pipeline-state.json`) via a 3-layer
fallback chain:
    Layer 1: Watchdog Observer detects `rollback_to_checkpoint` return and
             auto-calls `tdd_checkpoint`.
    Layer 2: Watchdog not running (or Layer 1 failed) → MCP handler
             (`_mcp_handler_reset`) writes a clean state.
    Layer 3: Both fail → next `pipeline_start` (`_pipeline_start_reset`)
             resets the state.

Also exposes manual violation resolution (`force_resolve_violation`) and
audit-driven auto-correction (`resolve_timeout`). All state mutations are
recorded via `McpAuditEntry` through `_write_audit_entry`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CLEAN_STATE: dict[str, Any] = {
    "observerTimeoutCount": 0,
    "auditEntryCount": 0,
    "evictionNeeded": False,
    "phase": 1,
}


def _pipeline_state_file(repo_dir: str) -> Path:
    return Path(repo_dir) / ".aristotle" / "pipeline-state.json"


def _read_audit_entries(repo: Path) -> list[dict]:
    """Read audit entries from `<repo>/.aristotle/audit.jsonl` (corruption-safe)."""
    log = repo / ".aristotle" / "audit.jsonl"
    if not log.exists():
        return []
    entries: list[dict] = []
    for raw in log.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            entries.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return entries


def _write_audit_entry(entry: dict) -> dict:
    """Persist one McpAuditEntry (delegates to the audit-log module)."""
    from aristotle_mcp._audit_log import append_audit_entry

    return append_audit_entry(entry)


def _get_watchdog_observer():
    """Return the running Watchdog observer, or None if unavailable.

    The Watchdog runs inside the TS bridge; the Python side currently has no
    live handle, so it returns None and the reset chain falls through to
    Layer 2/3. This is the integration seam for a future Python↔TS bridge.
    """
    return None


def _mcp_handler_reset() -> dict:
    """Layer 2: MCP handler writes a clean state (placeholder for bridge call)."""
    return dict(CLEAN_STATE)


def _pipeline_start_reset() -> dict:
    """Layer 3: next pipeline_start writes a clean state."""
    return dict(CLEAN_STATE)


def _finalize_reset(state_file: Path) -> dict:
    """Persist CLEAN_STATE and record the reset audit entry."""
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(CLEAN_STATE))
    _write_audit_entry(
        {
            "tool": "pipeline_reset",
            "runId": "pipeline_reset",
            "result": "success",
            "params": {"path": str(state_file)},
        }
    )
    return {"success": True}


def pipeline_reset(repo_dir: str) -> dict:
    """Reset pipeline state to CLEAN_STATE via the 3-layer fallback chain.

    Returns ``{"success": True}`` on a successful reset (file written), or
    ``{"success": False, "error": ...}`` if every layer failed (state left
    untouched).
    """
    state_file = _pipeline_state_file(repo_dir)

    # Layer 1 — Watchdog Observer
    try:
        observer = _get_watchdog_observer()
        if observer is not None:
            result = observer.trigger_reset()
            if isinstance(result, dict) and result.get("error"):
                raise RuntimeError(result["error"])
            return _finalize_reset(state_file)
    except Exception:
        pass

    # Layer 2 — MCP handler direct trigger
    try:
        _mcp_handler_reset()
        return _finalize_reset(state_file)
    except Exception:
        pass

    # Layer 3 — pipeline_start resets on next cycle
    try:
        _pipeline_start_reset()
        return _finalize_reset(state_file)
    except Exception:
        return {"success": False, "error": "all reset layers failed"}


def force_resolve_violation(timestamp: str, reason: str, repo_dir: str) -> dict:
    """Manually mark a detected violation (matched by ``timestamp``) as resolved.

    Looks up the violation in the audit log; if no matching entry exists,
    returns ``{"success": False}``. Otherwise records a
    ``force_resolve_violation`` audit entry and returns ``{"success": True}``.
    """
    repo = Path(repo_dir)
    entries = _read_audit_entries(repo)
    match = next(
        (e for e in entries if e.get("tool") == "violation" and e.get("params", {}).get("timestamp") == timestamp),
        None,
    )
    if match is None:
        return {
            "success": False,
            "error": f"no matching violation for timestamp {timestamp}",
        }

    _write_audit_entry(
        {
            "tool": "force_resolve_violation",
            "runId": "force_resolve_violation",
            "result": "success",
            "reason": reason,
            "timestamp": timestamp,
            "params": {"timestamp": timestamp, "reason": reason},
        }
    )
    return {"success": True}


def _audit_shows_resolved(repo: Path) -> bool:
    """True if the audit log contains a violation already marked resolved."""
    entries = _read_audit_entries(repo)
    return any(e.get("tool") == "violation" and e.get("status") == "resolved" for e in entries)


def resolve_timeout(repo_dir: str) -> dict:
    """Auto-correct pipeline state when the audit log shows a resolved violation.

    If the audit shows resolved, overwrite the pipeline state with CLEAN_STATE
    and record a ``resolve_timeout`` audit entry. Otherwise leaves state
    untouched (guard against false positives).
    """
    repo = Path(repo_dir)
    state_file = _pipeline_state_file(repo_dir)

    if not _audit_shows_resolved(repo):
        return {"success": True, "corrected": False}

    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(CLEAN_STATE))
    _write_audit_entry(
        {
            "tool": "resolve_timeout",
            "runId": "resolve_timeout",
            "result": "success",
            "params": {},
        }
    )
    return {"success": True, "corrected": True}
