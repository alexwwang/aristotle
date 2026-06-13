"""Migrated type definitions for the Aristotle MCP server.

These dataclasses were originally defined in the intervention/ package
and have been migrated here as part of the Phase 4 merge.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ViolationEvent:
    """Represents a TDD pipeline violation detected by the watchdog."""

    violation_type: str
    timestamp: str
    file: str = ""
    phase: int = 0
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class RollbackResult:
    """Result of a git-based rollback operation."""

    success: bool
    stash_ref: str = ""
    pipeline_reset_required: bool = False
    message: str = ""


@dataclass
class PipelineContext:
    """Context for the current TDD pipeline run."""

    phase: int = 1
    run_id: str = ""
    observer_timeout_count: int = 0
    audit_entry_count: int = 0
    eviction_needed: bool = False


@dataclass
class InterventionRecord:
    """Record of a watchdog intervention action."""

    violation: ViolationEvent
    action_taken: str = ""
    timestamp: str = ""
    success: bool = False
    rollback_result: RollbackResult | None = None
