"""KI Doc write/read tools for Aristotle MCP.

Knowledge-item document management for intervention, assessment, and merge entries.
Supports write, read, filter, freshness check, and audit logging.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aristotle_mcp._utils import _now_iso
from aristotle_mcp.config import resolve_repo_dir

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
KI_HEADER = "# Review Records\n\n"
KI_FRESHNESS_THRESHOLD = 86400  # 24 hours in seconds

VALID_ENTRY_TYPES = ("intervention", "assessment", "merge")

REQUIRED_FIELDS: dict[str, list[str]] = {
    "intervention": ["violation", "timestamp", "file", "phase"],
    "assessment": ["phase"],
    "merge": ["events"],
}

# ISO timestamp pattern: 2026-06-02T10:00:00+08:00
_TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}")

# Entry header: ## Type — timestamp
_ENTRY_HEADER_RE = re.compile(r"^##\s+(\w+)\s*[—\-]\s*(.+)$", re.MULTILINE)


# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------
def _validate_ki_path(ki_doc_path: str) -> str | None:
    """Validate that the path doesn't contain traversal sequences, absolute paths, or symlink escapes.

    Parameters
    ----------
    ki_doc_path : str
        The path to validate.

    Returns
    -------
    str | None
        Error message if validation fails, None if path is valid.
    """
    p = Path(ki_doc_path)

    # Block path traversal via ../
    if ".." in p.parts:
        return "Path traversal not allowed"

    repo_dir = resolve_repo_dir()
    repo_resolved = repo_dir.resolve()

    # Check symlink BEFORE resolve (resolve follows symlinks, making is_symlink() always False)
    unresolved = repo_dir / p if not p.is_absolute() else p
    if unresolved.exists() and unresolved.is_symlink():
        target = unresolved.resolve()
        try:
            target.relative_to(repo_resolved)
        except ValueError:
            return "Symlink targets must be within the repository directory"

    # Resolve to absolute path
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (repo_dir / p).resolve()

    # Must be within repo (belt-and-suspenders with symlink check above)
    try:
        resolved.relative_to(repo_resolved)
    except ValueError:
        return "Path must be within the repository directory"

    return None


# ---------------------------------------------------------------------------
# Audit helper
# ---------------------------------------------------------------------------
def _try_audit(action: str, **kwargs: Any) -> None:
    """Attempt to append an audit entry. Silently no-ops on failure."""
    try:
        from aristotle_mcp._audit_log import append_audit_entry

        append_audit_entry({
            "tool": action,
            "runId": kwargs.pop("run_id", "ki_doc"),
            "result": "success",
            "params": kwargs,
        })
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Entry builders
# ---------------------------------------------------------------------------
def _build_intervention_entry(kwargs: dict) -> str:
    ts = kwargs.get("timestamp", _now_iso())
    lines = [
        f"## Intervention — {ts}",
        f"- **type**: intervention",
        f"- **Violation**: {kwargs['violation']}",
        f"- **File**: {kwargs['file']}",
        f"- **Phase**: {kwargs['phase']}",
        f"- **timestamp**: {ts}",
    ]
    if "rollback_result" in kwargs:
        lines.append(f"- **rollback_result**: {json.dumps(kwargs['rollback_result'], ensure_ascii=False)}")
    if "validation_result" in kwargs:
        lines.append(f"- **validation_result**: {json.dumps(kwargs['validation_result'], ensure_ascii=False)}")
    if "context" in kwargs:
        lines.append(f"- **context**: {json.dumps(kwargs['context'], ensure_ascii=False)}")
    lines.append("")  # trailing blank line
    return "\n".join(lines) + "\n"


def _build_assessment_entry(kwargs: dict) -> str:
    ts = kwargs.get("timestamp", _now_iso())
    lines = [
        f"## Assessment — {ts}",
        f"- **type**: assessment",
        f"- **Phase**: {kwargs['phase']}",
    ]
    if "next_phase" in kwargs:
        lines.append(f"- **Next Phase**: {kwargs['next_phase']}")
    lines.append(f"- **Status**: {kwargs.get('status', '')}")
    lines.append(f"- **timestamp**: {ts}")
    if "issues" in kwargs:
        lines.append(f"- **Issues**: {json.dumps(kwargs['issues'], ensure_ascii=False)}")
    lines.append("")
    return "\n".join(lines) + "\n"


def _build_merge_entry(kwargs: dict) -> str:
    ts = kwargs.get("timestamp", _now_iso())
    lines = [
        f"## Merge — {ts}",
        f"- **type**: merge",
    ]
    events = kwargs.get("events", [])
    event_parts = []
    for evt in events:
        vt = evt.get("violation_type", "")
        fp = evt.get("affected_file_path", "")
        ets = evt.get("timestamp", "")
        event_parts.append(f"{vt} in {fp} ({ets})")
    lines.append(f"- **Events**: {', '.join(event_parts)}")
    if "context" in kwargs:
        ctx = kwargs["context"]
        for k, v in ctx.items():
            lines.append(f"- **{k}**: {v}")
    lines.append(f"- **timestamp**: {ts}")
    lines.append("")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# write_ki_doc
# ---------------------------------------------------------------------------
def write_ki_doc(entry_type: str, ki_doc_path: str, **kwargs) -> dict:
    """Write a knowledge-item entry to a markdown file.

    Parameters
    ----------
    entry_type : str
        One of ``"intervention"``, ``"assessment"``, ``"merge"``.
    ki_doc_path : str
        Absolute path to the KI document file.
    **kwargs
        Entry-type-specific fields (violation, timestamp, file, phase, etc.).

    Returns
    -------
    dict
        ``{"success": True}`` on success, ``{"success": False, "error": ...}`` on I/O error.

    Raises
    ------
    ValueError
        If *entry_type* is invalid or required fields are missing.
    """
    # --- Validate entry type ---
    if entry_type not in VALID_ENTRY_TYPES:
        raise ValueError(f"Invalid entry_type: {entry_type}")

    # --- Validate required fields ---
    for field in REQUIRED_FIELDS.get(entry_type, []):
        if field not in kwargs:
            raise ValueError(f"Missing required field for {entry_type}: {field}")

    # --- Path traversal check ---
    validation_error = _validate_ki_path(ki_doc_path)
    if validation_error:
        return {"success": False, "error": validation_error}

    # Resolve path against repo_dir to avoid CWD mismatch
    p = Path(ki_doc_path)
    if p.is_absolute():
        path = p.resolve()
    else:
        path = (resolve_repo_dir() / p).resolve()

    try:
        # Directory-as-path guard (produces I/O error)
        if path.is_dir():
            return {"success": False, "error": f"I/O error: path is a directory: {ki_doc_path}"}

        # Ensure parent directory exists
        path.parent.mkdir(parents=True, exist_ok=True)

        # Read existing content (or start fresh)
        if path.exists():
            try:
                existing = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                try:
                    existing = path.read_bytes().decode("utf-8", errors="replace")
                except Exception:
                    existing = KI_HEADER
        else:
            existing = KI_HEADER

        # Ensure the standard header is present
        if not existing.startswith("# Review Records"):
            existing = KI_HEADER + existing

        # Build entry markdown
        builders = {
            "intervention": _build_intervention_entry,
            "assessment": _build_assessment_entry,
            "merge": _build_merge_entry,
        }
        entry = builders[entry_type](kwargs)

        new_content = existing + entry

        # Sanitize surrogate / non-encodable characters
        try:
            new_content.encode("utf-8")
        except UnicodeEncodeError:
            new_content = new_content.encode("utf-8", errors="replace").decode("utf-8")

        path.write_text(new_content, encoding="utf-8")

        # Audit log (best-effort)
        _try_audit("write_ki_doc", entry_type=entry_type, path=ki_doc_path)

        return {"success": True}

    except OSError as exc:
        return {"success": False, "error": f"I/O error: {exc}"}


# ---------------------------------------------------------------------------
# Entry parsing helpers
# ---------------------------------------------------------------------------
def _parse_entry_block(block: str) -> dict | None:
    """Parse a single ``## Type — timestamp`` block into a dict."""
    lines = block.strip().split("\n")
    if not lines:
        return None

    header_match = _ENTRY_HEADER_RE.match(lines[0])
    if not header_match:
        return None

    entry_type = header_match.group(1).lower()
    timestamp = header_match.group(2).strip()

    result: dict[str, Any] = {"type": entry_type, "timestamp": timestamp}

    for line in lines[1:]:
        line = line.strip()
        if not line.startswith("- **") or "**:" not in line:
            continue
        try:
            key_start = 4  # len("- **")
            key_end = line.index("**:", key_start)
        except ValueError:
            continue
        key = line[key_start:key_end].strip().lower()
        value_str = line[key_end + 3:].strip()

        # Try JSON → int → float → raw string
        try:
            result[key] = json.loads(value_str)
            continue
        except (json.JSONDecodeError, ValueError):
            pass
        try:
            result[key] = int(value_str)
            continue
        except ValueError:
            pass
        try:
            result[key] = float(value_str)
            continue
        except ValueError:
            pass
        result[key] = value_str

    return result


def _parse_entries(content: str) -> list[dict]:
    """Split content on ``## `` headers and parse each block."""
    parts = re.split(r"^##\s+", content, flags=re.MULTILINE)
    entries: list[dict] = []
    for part in parts[1:]:  # skip text before first ##
        entry = _parse_entry_block("## " + part)
        if entry is not None:
            entries.append(entry)
    return entries


def _apply_filter(entries: list[dict], filt: dict) -> list[dict]:
    """Return entries matching all filter criteria."""
    since_str = filt.get("since")
    result: list[dict] = []

    for entry in entries:
        match = True

        for key, value in filt.items():
            if key == "since":
                entry_ts = entry.get("timestamp", "")
                if entry_ts and since_str:
                    try:
                        if datetime.fromisoformat(entry_ts) < datetime.fromisoformat(str(since_str)):
                            match = False
                    except (ValueError, TypeError):
                        pass
            else:
                entry_val = entry.get(key)
                if entry_val is None or entry_val != value:
                    # Try string comparison as fallback
                    if str(entry_val) != str(value):
                        match = False
                        break

        if match:
            result.append(entry)

    return result


# ---------------------------------------------------------------------------
# read_ki_docs
# ---------------------------------------------------------------------------
def read_ki_docs(
    ki_doc_path: str,
    filter: dict | None = None,
    freshness_check: bool = False,
) -> list[dict] | dict:
    """Read entries from a KI doc file.

    Parameters
    ----------
    ki_doc_path : str
        Absolute path to the KI document.
    filter : dict, optional
        Field-level filters.  Supports ``type``, ``phase``, ``since`` (ISO timestamp), etc.
    freshness_check : bool
        If *True*, return ``{"fresh": True/False}`` instead of entry list.

    Returns
    -------
    list[dict] | dict
        List of entry dicts, or freshness result dict.
    """
    # --- Path traversal check ---
    validation_error = _validate_ki_path(ki_doc_path)
    if validation_error:
        return []

    p = Path(ki_doc_path)
    if p.is_absolute():
        path = p.resolve()
    else:
        path = (resolve_repo_dir() / p).resolve()

    if freshness_check:
        return _check_freshness(ki_doc_path)

    if not path.exists():
        return []

    # Read content (handle non-UTF-8 gracefully)
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            content = path.read_bytes().decode("utf-8", errors="replace")
        except Exception:
            return []

    _try_audit("read_ki_docs", path=ki_doc_path)

    entries = _parse_entries(content)

    if filter:
        entries = _apply_filter(entries, filter)

    return entries


# ---------------------------------------------------------------------------
# Freshness helpers
# ---------------------------------------------------------------------------
def _check_freshness(ki_doc_path: str, threshold: int = KI_FRESHNESS_THRESHOLD) -> dict:
    """Check whether the KI doc's newest entry is within *threshold* seconds of now."""
    path = Path(ki_doc_path)

    if not path.exists():
        return {"fresh": True}

    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Malformed / binary → treat as fresh
        return {"fresh": True}

    newest = _parse_newest_timestamp_from_content(content)

    if newest is None:
        # No parseable timestamps → treat as fresh
        return {"fresh": True}

    try:
        newest_dt = datetime.fromisoformat(newest)
        now = datetime.now(timezone.utc)
        if newest_dt.tzinfo is None:
            newest_dt = newest_dt.replace(tzinfo=timezone.utc)
        age_seconds = (now - newest_dt).total_seconds()
        return {"fresh": age_seconds < threshold}
    except (ValueError, TypeError):
        return {"fresh": True}


# ---------------------------------------------------------------------------
# Timestamp parsing
# ---------------------------------------------------------------------------
def _parse_newest_timestamp(file_path_or_content: str) -> str | None:
    """Return the newest ISO timestamp found in a file or raw content string.

    Parameters
    ----------
    file_path_or_content : str
        Either a file path (read if it exists) or raw content to scan.

    Returns
    -------
    str | None
        The newest timestamp string, or *None* if none found.
    """
    p = Path(file_path_or_content)
    if p.exists() and p.is_file():
        try:
            content = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            return None
    else:
        content = file_path_or_content

    return _parse_newest_timestamp_from_content(content)


def _parse_newest_timestamp_from_content(content: str) -> str | None:
    """Scan *content* for ISO timestamps and return the chronologically newest."""
    timestamps = _TS_RE.findall(content)
    if not timestamps:
        return None

    best: str | None = None
    best_dt: datetime | None = None
    for ts in timestamps:
        try:
            dt = datetime.fromisoformat(ts)
            if best_dt is None or dt > best_dt:
                best_dt = dt
                best = ts
        except (ValueError, TypeError):
            continue
    return best


# ---------------------------------------------------------------------------
# Convenience helpers (used by watchdog / other modules)
# ---------------------------------------------------------------------------
def _ensure_assessment(ki_doc_path: str) -> dict:
    """Create an empty assessment entry if the KI doc has none.  Returns write result."""
    entries = read_ki_docs(ki_doc_path) or []
    if any(e.get("type") == "assessment" for e in entries):
        return {"success": True, "message": "assessment already exists"}
    return write_ki_doc(
        entry_type="assessment",
        ki_doc_path=ki_doc_path,
        phase=0,
        status="",
    )


def _touch_ki_doc(ki_doc_path: str) -> dict:
    """Unconditionally write a KEEP_ALIVE intervention entry to the KI doc.

    NOTE: This is a mutation (write), not a freshness check. The name
    ``_touch_ki_doc`` reflects this — unlike the intervention source's
    ``ensure_updated`` which was a read-only comparison check.
    """
    return write_ki_doc(
        entry_type="intervention",
        ki_doc_path=ki_doc_path,
        violation="KEEP_ALIVE",
        timestamp=_now_iso(),
        file="",
        phase=0,
    )


def register_ki_doc_tools(mcp) -> None:
    """Register KI doc tools with the MCP server."""
    mcp.tool()(write_ki_doc)
    mcp.tool()(read_ki_docs)
