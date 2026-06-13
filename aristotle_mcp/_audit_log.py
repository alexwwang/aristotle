"""
Phase 4 stub — audit log module.
Business code isolated to _phase5_ref/_audit_log.py for TDD Red phase.
"""
from pathlib import Path

# Constants (needed by tests and other stubs)
MCP_AUDIT_JSONL_LINE_LIMIT: int = 4096
ERROR_SUMMARY_TRUNCATION: int = 500


def append_audit_entry(entry: dict) -> dict:
    """Stub: append a JSONL audit entry."""
    raise NotImplementedError("Phase 4 stub — append_audit_entry not implemented")


def read_audit_entries() -> list[dict]:
    """Stub: read all audit entries from JSONL."""
    raise NotImplementedError("Phase 4 stub — read_audit_entries not implemented")
