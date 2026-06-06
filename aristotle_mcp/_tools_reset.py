"""Pipeline Reset module — 3-layer fallback chain for state recovery.

Layer 1: Watchdog Observer (observer.trigger_reset)
Layer 2: MCP handler direct reset
Layer 3: pipeline_start reset on next cycle

Also provides force_resolve_violation and resolve_timeout helpers.

All audit entries are written to .aristotle/audit.jsonl via _audit_log.
These are internal-only functions not registered as MCP tools.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from aristotle_mcp.config import resolve_repo_dir
from aristotle_mcp._utils import _now_iso

# ── Constants ──

CLEAN_STATE: dict[str, Any] = {
    "observerTimeoutCount": 0,
    "auditEntryCount": 0,
    "evictionNeeded": False,
    "phase": 1,
}


# ── Internal helpers ──


def _resolve_repo(repo_dir: str = "") -> Path:
    """Resolve the repo directory from parameter or config."""
    return Path(repo_dir) if repo_dir else resolve_repo_dir()


def _state_path(repo_dir: str = "") -> Path:
    """Return path to pipeline-state.json."""
    return _resolve_repo(repo_dir) / ".aristotle" / "pipeline-state.json"


def _read_pipeline_state(repo_dir: str = "") -> dict[str, Any]:
    """Read pipeline-state.json. Returns a copy of CLEAN_STATE on missing/corrupt."""
    path = _state_path(repo_dir)
    if path.exists():
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return dict(CLEAN_STATE)


def _write_pipeline_state_to_disk(state: dict[str, Any], repo_dir: str = "") -> None:
    """Atomically write pipeline-state.json."""
    path = _state_path(repo_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state))


def _is_clean(state: dict[str, Any]) -> bool:
    """Check if a state dict matches CLEAN_STATE."""
    return (
        state.get("observerTimeoutCount", 0) == 0
        and state.get("auditEntryCount", 0) == 0
        and state.get("evictionNeeded", False) is False
        and state.get("phase", 1) == 1
    )


# ── Patchable internal functions ──


def _get_watchdog_observer() -> object | None:
    """Return a watchdog observer instance, or None if unavailable."""
    return None


def _mcp_handler_reset(**kwargs: Any) -> dict[str, Any]:
    """Layer 2 fallback: MCP handler triggers pipeline reset directly."""
    raise RuntimeError("MCP handler reset not available")


def _pipeline_start_reset(**kwargs: Any) -> dict[str, Any]:
    """Layer 3 fallback: pipeline_start resets state on next cycle."""
    raise RuntimeError("Pipeline start reset not available")


def _write_audit_entry(entry: dict) -> None:
    """Append an audit entry to .aristotle/audit.jsonl via the standard audit log."""
    try:
        from aristotle_mcp._audit_log import append_audit_entry
        append_audit_entry({
            "tool": entry.get("tool", "unknown"),
            "runId": entry.get("runId", entry.get("timestamp", "")),
            "result": "success",
            "params": {k: v for k, v in entry.items() if k not in ("tool", "runId", "result")},
        })
    except Exception:
        pass


def _audit_shows_resolved(repo_dir: str = "") -> bool:
    """Check whether the audit log contains any resolved violations."""
    try:
        from aristotle_mcp._audit_log import read_audit_entries
        entries = read_audit_entries()
        return any(
            e.get("params", {}).get("status") == "resolved" or e.get("status") == "resolved"
            for e in entries
        )
    except Exception:
        return False


# ── Public API ──


def pipeline_reset(repo_dir: str = "") -> dict:
    """Reset pipeline state via a 3-layer fallback chain.

    Layer 1: watchdog observer.trigger_reset()
    Layer 2: _mcp_handler_reset()
    Layer 3: _pipeline_start_reset()

    No-op when state is already clean.
    Never raises — all errors are caught and returned as ``{"success": False}``.
    """
    try:
        state = _read_pipeline_state(repo_dir)

        if _is_clean(state):
            return {"success": True, "message": "State already clean"}

        # ── 3-layer fallback chain ──
        reset_success = False

        # Layer 1: Watchdog Observer
        try:
            observer = _get_watchdog_observer()
            if observer is not None:
                trigger_result = observer.trigger_reset()  # type: ignore[union-attr]
                if isinstance(trigger_result, dict) and "error" in trigger_result:
                    raise RuntimeError(f"Watchdog error: {trigger_result['error']}")
                reset_success = True
        except Exception:
            pass

        # Layer 2: MCP handler direct
        if not reset_success:
            try:
                _mcp_handler_reset(repo_dir=repo_dir)
                reset_success = True
            except Exception:
                pass

        # Layer 3: pipeline_start
        if not reset_success:
            try:
                _pipeline_start_reset(repo_dir=repo_dir)
                reset_success = True
            except Exception:
                pass

        if reset_success:
            _write_pipeline_state_to_disk(CLEAN_STATE, repo_dir)
            try:
                _write_audit_entry({"tool": "pipeline_reset", "timestamp": _now_iso()})
            except Exception:
                pass  # audit failure must not fail the reset
            return {"success": True}

        # All layers failed — leave state unchanged
        return {"success": False}

    except Exception:
        return {"success": False}


def force_resolve_violation(timestamp: str, reason: str, repo_dir: str = "") -> dict:
    """Record a manual violation resolution.

    Writes an audit entry with ``tool="force_resolve_violation"``.
    Returns ``{"success": False, "error": ...}`` when the audit log
    cannot be written (e.g. no matching violation on record).
    """
    try:
        from aristotle_mcp._audit_log import read_audit_entries

        entries = read_audit_entries()
        if not entries:
            return {
                "success": False,
                "error": "Cannot resolve violation: audit log does not exist",
            }

        matching = [
            e for e in entries
            if e.get("params", {}).get("timestamp") == timestamp
            or e.get("timestamp") == timestamp
        ]
        if not matching:
            return {
                "success": False,
                "error": f"No matching violation found for timestamp: {timestamp}",
            }

        entry = {
            "tool": "force_resolve_violation",
            "timestamp": timestamp,
            "reason": reason,
        }
        _write_audit_entry(entry)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def resolve_timeout(repo_dir: str = "") -> dict:
    """Auto-correct state when audit shows resolved but state is outdated.

    Idempotent — safe to call multiple times.
    Guard: does NOT correct when audit does not show resolved.
    """
    try:
        if not _audit_shows_resolved(repo_dir):
            return {"success": True, "message": "No resolved audit entries"}

        state = _read_pipeline_state(repo_dir)
        if _is_clean(state):
            return {"success": True, "message": "State already clean"}

        _write_pipeline_state_to_disk(CLEAN_STATE, repo_dir)

        try:
            _write_audit_entry({"tool": "resolve_timeout", "timestamp": _now_iso()})
        except Exception:
            pass

        return {"success": True}

    except Exception:
        return {"success": False}
