"""
Phase 4 stub — KI doc tools.
Business code isolated to _phase5_ref/_tools_ki_doc.py for TDD Red phase.
"""
from typing import Any

# Constants
KI_HEADER = "# Review Records\n\n"
KI_FRESHNESS_THRESHOLD = 86400  # 24 hours in seconds
VALID_ENTRY_TYPES = ("intervention", "assessment", "merge")
REQUIRED_FIELDS: dict[str, list[str]] = {
    "intervention": ["violation", "timestamp", "file", "phase"],
    "assessment": ["phase"],
    "merge": ["events"],
}


def write_ki_doc(entry_type: str, ki_doc_path: str, **kwargs) -> dict:
    """Stub: write a KI entry to markdown file."""
    raise NotImplementedError("Phase 4 stub — write_ki_doc not implemented")


def read_ki_docs(
    ki_doc_path: str,
    filter: dict | None = None,
    freshness_check: bool = False,
) -> list[dict] | dict:
    """Stub: read KI entries with optional filter."""
    raise NotImplementedError("Phase 4 stub — read_ki_docs not implemented")


def register_ki_doc_tools(mcp) -> None:
    pass
