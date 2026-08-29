"""TDD RED phase tests for Pipeline Reset module (3-layer fallback chain).

Tests the reset of PipelineState via a 3-layer fallback chain:
  Layer 1: Watchdog Observer detects rollback_to_checkpoint return → auto-calls tdd_checkpoint
  Layer 2: Watchdog not running → MCP handler directly triggers pipeline_reset
  Layer 3: Both fail → next pipeline_start resets state

Also covers force_resolve_violation and resolve_timeout helpers.

Target import paths (modules do NOT exist yet):
  - aristotle_mcp._tools_reset: pipeline_reset, force_resolve_violation, resolve_timeout
  - aristotle_mcp._tools_rollback: rollback_to_checkpoint
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from unittest.mock import patch, MagicMock, call


# ---------------------------------------------------------------------------
# Test data constants
# ---------------------------------------------------------------------------

DIRTY_STATE: dict[str, Any] = {
    "observerTimeoutCount": 5,
    "auditEntryCount": 100,
    "evictionNeeded": True,
    "phase": 3,
}

CLEAN_STATE: dict[str, Any] = {
    "observerTimeoutCount": 0,
    "auditEntryCount": 0,
    "evictionNeeded": False,
    "phase": 1,
}

PARTIALLY_DIRTY: dict[str, Any] = {
    "observerTimeoutCount": 0,
    "auditEntryCount": 5,
    "evictionNeeded": True,
    "phase": 1,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_pipeline_state(repo_dir: Path, state: dict[str, Any]) -> None:
    """Helper: write pipeline-state.json into the repo."""
    state_file = repo_dir / ".aristotle" / "pipeline-state.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state))


def _read_pipeline_state(repo_dir: Path) -> dict[str, Any]:
    """Helper: read pipeline-state.json from the repo."""
    state_file = repo_dir / ".aristotle" / "pipeline-state.json"
    return json.loads(state_file.read_text())


def _audit_jsonl_path(repo_dir: Path) -> Path:
    """Helper: return the JSONL audit log path."""
    return repo_dir / ".aristotle" / "audit.jsonl"


def _write_audit_jsonl_entries(repo_dir: Path, entries: list[dict[str, Any]]) -> None:
    """Helper: write audit.jsonl entries."""
    log_file = _audit_jsonl_path(repo_dir)
    log_file.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(e, ensure_ascii=False) for e in entries]
    log_file.write_text("\n".join(lines) + "\n")


def _write_audit_entries(repo_dir: Path, entries: list[dict[str, Any]]) -> None:
    """Helper: write audit log entries to JSONL."""
    _write_audit_jsonl_entries(repo_dir, entries)


def _read_audit_entries(repo_dir: Path) -> list[dict[str, Any]]:
    """Helper: read audit log entries from JSONL."""
    log_file = _audit_jsonl_path(repo_dir)
    if not log_file.exists():
        return []
    result = []
    for line in log_file.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                result.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return result


# ---------------------------------------------------------------------------
# Target imports (RED phase — modules don't exist yet, will raise at runtime)
# ---------------------------------------------------------------------------

class _NotImplemented:
    """Sentinel that raises a clear error if called without patching."""
    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError(
            "TDD RED: target module not yet implemented — "
            "this function should only be called inside a patched context"
        )

try:
    from aristotle_mcp._tools_reset import (
        pipeline_reset,
        force_resolve_violation,
        resolve_timeout,
    )
    from aristotle_mcp._tools_rollback import rollback_to_checkpoint
except ModuleNotFoundError:
    pipeline_reset = _NotImplemented()  # type: ignore[assignment,misc]
    force_resolve_violation = _NotImplemented()  # type: ignore[assignment,misc]
    resolve_timeout = _NotImplemented()  # type: ignore[assignment,misc]
    rollback_to_checkpoint = _NotImplemented()  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------

class TestPipelineReset:
    """25 tests for the Pipeline Reset 3-layer fallback chain."""

    # ------------------------------------------------------------------
    # Layer 1 — Watchdog Observer
    # ------------------------------------------------------------------

    def test_should_reset_state_via_layer1_watchdog(self, tmp_repo: Path) -> None:
        """Layer 1: dirty state triggers 3-layer fallback,
        watchdog observer auto-calls pipeline_reset → state cleared."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer"
        ) as mock_get_observer:
            mock_observer = MagicMock()
            mock_get_observer.return_value = mock_observer

            pipeline_reset(repo_dir=str(tmp_repo))

            mock_observer.trigger_reset.assert_called_once()
            mock_observer.trigger_reset.assert_called_once()

            state = _read_pipeline_state(tmp_repo)
            assert state == CLEAN_STATE

    def test_should_clear_observer_timeout_count(self, tmp_repo: Path) -> None:
        """After reset, observerTimeoutCount must be 0."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state["observerTimeoutCount"] == 0

    def test_should_clear_audit_entry_count(self, tmp_repo: Path) -> None:
        """After reset, auditEntryCount must be 0."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state["auditEntryCount"] == 0

    def test_should_reset_phase_to_1(self, tmp_repo: Path) -> None:
        """After reset, phase must be 1."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state["phase"] == 1

    def test_should_reset_eviction_needed_flag(self, tmp_repo: Path) -> None:
        """After reset, evictionNeeded must be False."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state["evictionNeeded"] is False

    # ------------------------------------------------------------------
    # Layer 2 — MCP handler direct trigger
    # ------------------------------------------------------------------

    def test_should_trigger_layer2_when_watchdog_down(self, tmp_repo: Path) -> None:
        """Watchdog not running → MCP handler triggers pipeline_reset directly."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer",
            return_value=None,
        ), patch(
            "aristotle_mcp._tools_reset._mcp_handler_reset"
        ) as mock_mcp:
            mock_mcp.return_value = CLEAN_STATE

            pipeline_reset(repo_dir=str(tmp_repo))

            mock_mcp.assert_called_once()

    # ------------------------------------------------------------------
    # Layer 3 — pipeline_start resets on next cycle
    # ------------------------------------------------------------------

    def test_should_trigger_layer3_on_next_pipeline_start(self, tmp_repo: Path) -> None:
        """Both Layer 1 and Layer 2 fail → pipeline_start resets dirty state."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer",
            return_value=None,
        ), patch(
            "aristotle_mcp._tools_reset._mcp_handler_reset",
            side_effect=RuntimeError("MCP handler unavailable"),
        ), patch(
            "aristotle_mcp._tools_reset._pipeline_start_reset"
        ) as mock_start:
            mock_start.return_value = CLEAN_STATE

            pipeline_reset(repo_dir=str(tmp_repo))

            mock_start.assert_called_once()

    def test_should_execute_fallback_chain_in_order(self, tmp_repo: Path) -> None:
        """Verify Layer 1 tried first, then Layer 2, then Layer 3."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        call_order: list[str] = []

        def _mock_watchdog() -> MagicMock:
            call_order.append("layer1_watchdog")
            # Simulate watchdog failure to force Layer 2
            observer = MagicMock()
            observer.trigger_reset.side_effect = RuntimeError("watchdog crashed")
            return observer

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer",
            side_effect=_mock_watchdog,
        ), patch(
            "aristotle_mcp._tools_reset._mcp_handler_reset"
        ) as mock_mcp:
            def _mcp_reset(**kwargs: Any) -> dict[str, Any]:
                call_order.append("layer2_mcp")
                raise RuntimeError("MCP down")

            mock_mcp.side_effect = _mcp_reset

            with patch(
                "aristotle_mcp._tools_reset._pipeline_start_reset"
            ) as mock_start:
                def _start_reset(**kwargs: Any) -> dict[str, Any]:
                    call_order.append("layer3_start")
                    return CLEAN_STATE

                mock_start.side_effect = _start_reset

                pipeline_reset(repo_dir=str(tmp_repo))

        assert call_order == ["layer1_watchdog", "layer2_mcp", "layer3_start"]

    # ------------------------------------------------------------------
    # force_resolve_violation
    # ------------------------------------------------------------------

    def test_should_handle_force_resolve_violation_manual_trigger(self, tmp_repo: Path) -> None:
        """Resolve violation with timestamp → audit entry recorded."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        timestamp = "2025-01-15T10:30:00Z"
        reason = "Manual override after investigation"
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "runId": "r1", "result": "error", "params": {"timestamp": timestamp}},
        ])

        with patch("aristotle_mcp._tools_reset._write_audit_entry") as mock_audit:
            force_resolve_violation(
                timestamp=timestamp,
                reason=reason,
                repo_dir=str(tmp_repo),
            )
            mock_audit.assert_called_once()
            entry = mock_audit.call_args[1] if mock_audit.call_args[1] else mock_audit.call_args[0][0]
            assert entry["tool"] == "force_resolve_violation"
            assert entry["reason"] == reason

    def test_should_return_error_for_force_resolve_with_nonexistent_timestamp(
        self, tmp_repo: Path
    ) -> None:
        """No matching violation for given timestamp → error returned."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "runId": "r1", "result": "error", "params": {"timestamp": "2025-01-14T00:00:00Z"}},
        ])

        result = force_resolve_violation(
            timestamp="1999-01-01T00:00:00Z",
            reason="ghost violation",
            repo_dir=str(tmp_repo),
        )
        assert result["success"] is False
        assert "not found" in result["error"].lower() or "no matching" in result["error"].lower()

    def test_should_write_force_resolved_reason_to_audit(self, tmp_repo: Path) -> None:
        """Manual resolution records the reason string in the audit entry."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        reason = "False positive from flaky test"
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "runId": "r1", "result": "error", "params": {"timestamp": "2025-01-15T10:30:00Z"}},
        ])

        with patch("aristotle_mcp._tools_reset._write_audit_entry") as mock_audit:
            force_resolve_violation(
                timestamp="2025-01-15T10:30:00Z",
                reason=reason,
                repo_dir=str(tmp_repo),
            )
            written = mock_audit.call_args[1] if mock_audit.call_args[1] else mock_audit.call_args[0][0]
            assert written["reason"] == reason

    # ------------------------------------------------------------------
    # resolve_timeout
    # ------------------------------------------------------------------

    def test_should_auto_correct_with_resolve_timeout(self, tmp_repo: Path) -> None:
        """Audit shows resolved but state outdated → resolve_timeout auto-corrects."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "status": "resolved", "timestamp": "2025-01-15T10:00:00Z"},
        ])

        with patch(
            "aristotle_mcp._tools_reset._audit_shows_resolved", return_value=True
        ):
            resolve_timeout(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state["observerTimeoutCount"] == 0

    def test_should_be_idempotent_on_multiple_resolve_timeout_calls(self, tmp_repo: Path) -> None:
        """Repeated resolve_timeout calls are safe and produce no duplicates."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "status": "resolved", "timestamp": "2025-01-15T10:00:00Z"},
        ])

        with patch(
            "aristotle_mcp._tools_reset._audit_shows_resolved", return_value=True
        ):
            resolve_timeout(repo_dir=str(tmp_repo))
            resolve_timeout(repo_dir=str(tmp_repo))
            resolve_timeout(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE
        # Audit log should not contain duplicate resolve_timeout entries beyond the 3 calls
        entries = _read_audit_entries(tmp_repo)
        resolve_entries = [e for e in entries if e.get("tool") == "resolve_timeout"]
        assert len(resolve_entries) <= 3

    # ------------------------------------------------------------------
    # Concurrency & edge cases
    # ------------------------------------------------------------------

    def test_should_handle_concurrent_reset_requests_safely(self, tmp_repo: Path) -> None:
        """Multiple simultaneous resets handled safely (mock-based)."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()

            # Simulate concurrent calls
            pipeline_reset(repo_dir=str(tmp_repo))
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE

    def test_should_be_noop_when_state_already_reset(self, tmp_repo: Path) -> None:
        """Reset on a clean state → no effect, no error."""
        _write_pipeline_state(tmp_repo, CLEAN_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": False},
        ):
            result = pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE

    # ------------------------------------------------------------------
    # Audit entries
    # ------------------------------------------------------------------

    def test_should_write_audit_entry_on_pipeline_reset(self, tmp_repo: Path) -> None:
        """McpAuditEntry with tool='pipeline_reset' written on reset."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch("aristotle_mcp._tools_reset._write_audit_entry") as mock_audit, patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        mock_audit.assert_called_once()
        entry = mock_audit.call_args[1] if mock_audit.call_args[1] else mock_audit.call_args[0][0]
        assert entry["tool"] == "pipeline_reset"

    def test_should_write_audit_entry_on_force_resolve_violation(self, tmp_repo: Path) -> None:
        """McpAuditEntry written when force_resolve_violation is called."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "runId": "r1", "result": "error", "params": {"timestamp": "2025-01-15T10:30:00Z"}},
        ])

        with patch("aristotle_mcp._tools_reset._write_audit_entry") as mock_audit:
            force_resolve_violation(
                timestamp="2025-01-15T10:30:00Z",
                reason="investigated",
                repo_dir=str(tmp_repo),
            )
        mock_audit.assert_called_once()

    def test_should_write_audit_entry_on_resolve_timeout(self, tmp_repo: Path) -> None:
        """McpAuditEntry with tool='resolve_timeout' written."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch("aristotle_mcp._tools_reset._write_audit_entry") as mock_audit, patch(
            "aristotle_mcp._tools_reset._audit_shows_resolved", return_value=True
        ):
            resolve_timeout(repo_dir=str(tmp_repo))

        mock_audit.assert_called_once()
        entry = mock_audit.call_args[1] if mock_audit.call_args[1] else mock_audit.call_args[0][0]
        assert entry["tool"] == "resolve_timeout"

    # ------------------------------------------------------------------
    # Failure modes
    # ------------------------------------------------------------------

    def test_should_handle_gracefully_when_all_fallback_layers_fail(
        self, tmp_repo: Path
    ) -> None:
        """All 3 layers fail → state remains consistent, no exception raised."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer",
            side_effect=RuntimeError("observer error"),
        ), patch(
            "aristotle_mcp._tools_reset._mcp_handler_reset",
            side_effect=RuntimeError("MCP error"),
        ), patch(
            "aristotle_mcp._tools_reset._pipeline_start_reset",
            side_effect=RuntimeError("start error"),
        ):
            # Should NOT raise
            result = pipeline_reset(repo_dir=str(tmp_repo))

        # State should remain as-is (no partial reset)
        state = _read_pipeline_state(tmp_repo)
        assert state["phase"] == DIRTY_STATE["phase"]
        # Result indicates failure
        assert result["success"] is False

    def test_should_not_correct_when_audit_does_not_show_resolved(
        self, tmp_repo: Path
    ) -> None:
        """Guard prevents false positive when audit does not show resolved."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)
        _write_audit_entries(tmp_repo, [
            {"tool": "violation", "status": "open", "timestamp": "2025-01-15T10:00:00Z"},
        ])

        with patch(
            "aristotle_mcp._tools_reset._audit_shows_resolved", return_value=False
        ):
            resolve_timeout(repo_dir=str(tmp_repo))

        # State unchanged
        state = _read_pipeline_state(tmp_repo)
        assert state["observerTimeoutCount"] == DIRTY_STATE["observerTimeoutCount"]

    def test_should_reset_partially_dirty_state(self, tmp_repo: Path) -> None:
        """Some counters dirty, phase=1 → still resets dirty counters."""
        _write_pipeline_state(tmp_repo, PARTIALLY_DIRTY)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE

    def test_should_reset_dirty_state_regardless_of_rollback(
        self, tmp_repo: Path
    ) -> None:
        """Dirty state always triggers the 3-layer fallback chain,
        regardless of rollback availability. (F-01 fix: rollback veto removed.)"""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            mock_obs.return_value = MagicMock()
            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE

    # ------------------------------------------------------------------
    # Integration-style tests (mocked externals)
    # ------------------------------------------------------------------

    def test_should_trigger_layer2_integration_reset(self, tmp_repo: Path) -> None:
        """Layer 2 path: actual file operations with mocked watchdog."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer",
            return_value=None,
        ), patch(
            "aristotle_mcp._tools_reset._mcp_handler_reset"
        ) as mock_mcp:
            mock_mcp.return_value = CLEAN_STATE

            pipeline_reset(repo_dir=str(tmp_repo))

        # Verify the file was actually written
        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE

    def test_should_trigger_layer3_integration_reset(self, tmp_repo: Path) -> None:
        """Layer 3 path: pipeline_start writes clean state to disk."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch(
            "aristotle_mcp._tools_reset._get_watchdog_observer",
            return_value=None,
        ), patch(
            "aristotle_mcp._tools_reset._mcp_handler_reset",
            side_effect=RuntimeError("MCP unavailable"),
        ), patch(
            "aristotle_mcp._tools_reset._pipeline_start_reset"
        ) as mock_start:
            mock_start.return_value = CLEAN_STATE

            pipeline_reset(repo_dir=str(tmp_repo))

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE

    # ------------------------------------------------------------------
    # Error handling
    # ------------------------------------------------------------------

    def test_should_handle_tdd_checkpoint_callback_failure(self, tmp_repo: Path) -> None:
        """tdd_checkpoint callback failure → error logged, no crash."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_obs:
            observer = MagicMock()
            observer.trigger_reset.side_effect = RuntimeError("checkpoint callback failed")
            mock_obs.return_value = observer

            with patch("aristotle_mcp._tools_reset._mcp_handler_reset") as mock_mcp:
                mock_mcp.return_value = CLEAN_STATE

                # Should NOT raise
                pipeline_reset(repo_dir=str(tmp_repo))

    def test_should_handle_watchdog_error_response(self, tmp_repo: Path) -> None:
        """Watchdog running but returns error → fallback to Layer 2."""
        _write_pipeline_state(tmp_repo, DIRTY_STATE)

        with patch(
            "aristotle_mcp._tools_rollback.rollback_to_checkpoint",
            return_value={"pipeline_reset_required": True},
        ), patch("aristotle_mcp._tools_reset._get_watchdog_observer") as mock_get_obs:
            error_observer = MagicMock()
            error_observer.trigger_reset.return_value = {"error": "internal failure"}
            mock_get_obs.return_value = error_observer

            with patch(
                "aristotle_mcp._tools_reset._mcp_handler_reset"
            ) as mock_mcp:
                mock_mcp.return_value = CLEAN_STATE

                pipeline_reset(repo_dir=str(tmp_repo))

                # Layer 2 should have been invoked
                mock_mcp.assert_called_once()

        state = _read_pipeline_state(tmp_repo)
        assert state == CLEAN_STATE
