"""Phase 0: Session Snapshot Bridge tests.

Tests cover:
- config.py: SESSIONS_DIR_NAME + resolve_sessions_dir()
- _orch_prompts.py: session_file parameter in _build_reflector_prompt
- _orch_start.py: session_file passthrough + use_bridge detection
- _tools_undo.py: on_undo MCP tool
- _orch_event.py: undone status short-circuit

All tests should FAIL before business code is implemented (TDD Phase 4).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from _orch_helpers import (
    _load_workflow,
    _start_reflect_workflow,
    init_repo_tool,
    orchestrate_on_event,
    orchestrate_start,
)


# ═══════════════════════════════════════════════════════════
# UT-1: resolve_sessions_dir
# ═══════════════════════════════════════════════════════════

class TestResolveSessionsDir:

    def test_should_resolve_sessions_dir_under_opencode_config(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        from aristotle_mcp.config import resolve_sessions_dir
        result = resolve_sessions_dir()
        assert result == tmp_path / ".config" / "opencode" / "aristotle-sessions"

    def test_should_have_sessions_dir_name_constant(self):
        from aristotle_mcp.config import SESSIONS_DIR_NAME
        assert SESSIONS_DIR_NAME == "aristotle-sessions"


# ═══════════════════════════════════════════════════════════
# UT-2/3: _build_reflector_prompt with session_file
# ═══════════════════════════════════════════════════════════

class TestBuildReflectorPrompt:

    def test_should_include_session_file_in_reflector_prompt(self):
        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            session_file="/path/to/snapshot.json",
        )
        assert "SESSION_FILE: /path/to/snapshot.json" in prompt
        # Verify IMPORTANT block with Read instruction
        assert "Read tool" in prompt or "Read" in prompt
        # Verify empty-file fallback instruction
        assert "SESSION_FILE is empty" in prompt or "empty" in prompt.lower()

    def test_should_handle_empty_session_file_gracefully(self):
        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            session_file="",
        )
        assert "SESSION_FILE:" in prompt  # Empty value after colon


# ═══════════════════════════════════════════════════════════
# UT-4: orchestrate_start passes session_file to prompt
# ═══════════════════════════════════════════════════════════

class TestOrchestrateStartSessionFile:

    def test_should_pass_session_file_to_reflector_prompt(self, tmp_repo):
        result = orchestrate_start("reflect", json.dumps({
            "target_session_id": "ses_target1",
            "session_file": "/tmp/ses_target1_snapshot.json",
        }))
        assert result["action"] == "fire_sub"
        assert "/tmp/ses_target1_snapshot.json" in result["sub_prompt"]

    def test_should_work_without_session_file(self, tmp_repo):
        """Backward compatibility: session_file is optional."""
        result = orchestrate_start("reflect", json.dumps({
            "target_session_id": "ses_target1",
        }))
        assert result["action"] == "fire_sub"


# ═══════════════════════════════════════════════════════════
# UT-5/6: use_bridge detection
# ═══════════════════════════════════════════════════════════

class TestBridgeDetection:

    def test_should_return_use_bridge_true_when_marker_exists(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        sessions_dir = tmp_path / ".config" / "opencode" / "aristotle-sessions"
        sessions_dir.mkdir(parents=True, exist_ok=True)
        (sessions_dir / ".bridge-active").write_text("{}", encoding="utf-8")

        result = orchestrate_start("reflect", json.dumps({
            "target_session_id": "ses_target1",
        }))
        assert result.get("use_bridge") is True

    def test_should_return_use_bridge_false_by_default(self, tmp_path, monkeypatch):
        # No .bridge-active file → use_bridge should be False
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        result = orchestrate_start("reflect", json.dumps({
            "target_session_id": "ses_target1",
        }))
        assert result.get("use_bridge") is False


# ═══════════════════════════════════════════════════════════
# UT-7/8/9/10b: on_undo MCP tool
# ═══════════════════════════════════════════════════════════

class TestOnUndo:

    def test_should_mark_workflow_undone_on_undo(self, tmp_repo):
        init_repo_tool()
        from aristotle_mcp._tools_undo import on_undo
        from aristotle_mcp.server import _save_workflow

        _save_workflow("wf_test_undo_1", {
            "phase": "reflecting",
            "status": "running",
        })
        result = on_undo("wf_test_undo_1", undo_scope="session", timestamp=1234567890)
        assert result["status"] == "undone"
        assert result["workflow_id"] == "wf_test_undo_1"

        wf = _load_workflow("wf_test_undo_1")
        assert wf["status"] == "undone"
        assert wf["undo_scope"] == "session"
        assert wf["undo_received_at"] == 1234567890

    def test_should_return_unknown_for_nonexistent_undo(self, tmp_repo):
        init_repo_tool()
        from aristotle_mcp._tools_undo import on_undo
        result = on_undo("wf_nonexistent")
        assert result["status"] == "unknown_workflow"

    def test_should_use_defaults_for_missing_undo_params(self, tmp_repo):
        init_repo_tool()
        from aristotle_mcp._tools_undo import on_undo
        from aristotle_mcp.server import _save_workflow

        _save_workflow("wf_test_defaults", {"phase": "reflecting", "status": "running"})
        on_undo("wf_test_defaults")  # No scope/timestamp
        wf = _load_workflow("wf_test_defaults")
        assert wf["undo_scope"] == "unknown"
        assert wf["undo_received_at"] == 0

    def test_should_remain_undone_on_double_undo(self, tmp_repo):
        init_repo_tool()
        from aristotle_mcp._tools_undo import on_undo
        from aristotle_mcp.server import _save_workflow

        _save_workflow("wf_test_double", {"phase": "reflecting", "status": "running"})
        on_undo("wf_test_double", undo_scope="session", timestamp=100)
        on_undo("wf_test_double", undo_scope="manual", timestamp=200)

        wf = _load_workflow("wf_test_double")
        assert wf["status"] == "undone"
        # Second call overwrites (last-write-wins, acceptable)
        assert wf["undo_received_at"] == 200


# ═══════════════════════════════════════════════════════════
# UT-10: orchestrate_on_event ignores undone workflow
# ═══════════════════════════════════════════════════════════

class TestUndoneShortCircuit:

    def test_should_ignore_events_for_undone_workflow(self, tmp_repo):
        init_repo_tool()
        from aristotle_mcp.server import _save_workflow

        _save_workflow("wf_" + "a" * 16, {
            "phase": "reflecting",
            "status": "undone",
        })
        result = orchestrate_on_event("subagent_done", json.dumps({
            "workflow_id": "wf_" + "a" * 16,
            "session_id": "ses_late",
            "result": "Late result that should be ignored",
        }))
        assert result["action"] == "notify"
        assert "undone" in result.get("message", "").lower() or "ignored" in result.get("message", "").lower()

    def test_should_ignore_events_for_cancelled_workflow(self, tmp_repo):
        init_repo_tool()
        from aristotle_mcp.server import _save_workflow

        _save_workflow("wf_" + "b" * 16, {
            "phase": "reflecting",
            "status": "cancelled",
        })
        result = orchestrate_on_event("subagent_done", json.dumps({
            "workflow_id": "wf_" + "b" * 16,
            "session_id": "ses_late",
            "result": "Late result that should be ignored",
        }))
        assert result["action"] == "notify"
        assert "cancelled" in result.get("message", "").lower() or "ignored" in result.get("message", "").lower()


# ═══════════════════════════════════════════════════════════
# UT-11: Compact prompt mode selection (config-based)
# ═══════════════════════════════════════════════════════════

class TestCompactPromptMode:

    def test_compact_mode_via_env(self, monkeypatch):
        """ARISTOTLE_PROMPT_MODE=compact → compact prompt."""
        monkeypatch.setenv("ARISTOTLE_PROMPT_MODE", "compact")
        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            project_directory="/tmp",
            user_language="en-US",
            session_file="/tmp/test.json",
        )
        assert "REFLECTOR.md" not in prompt
        assert "compact mode" in prompt
        assert "3-Why" in prompt
        assert "max 2 reflections" in prompt

    def test_compact_mode_via_config_file(self, monkeypatch, tmp_path):
        """aristotle-config.json with prompt_mode=compact → compact prompt."""
        monkeypatch.setenv("OPENCODE_CONFIG_DIR", str(tmp_path))
        config_file = tmp_path / "aristotle-config.json"
        config_file.write_text('{"prompt_mode": "compact"}\n')

        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            project_directory="/tmp",
            user_language="en-US",
            session_file="/tmp/test.json",
        )
        assert "REFLECTOR.md" not in prompt
        assert "compact mode" in prompt

    def test_full_mode_by_default(self):
        """No config → default full mode."""
        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            project_directory="/tmp",
            user_language="en-US",
            session_file="/tmp/test.json",
        )
        assert "REFLECTOR.md" in prompt
        assert "compact mode" not in prompt

    def test_full_mode_explicit_via_env(self, monkeypatch):
        """ARISTOTLE_PROMPT_MODE=full → full prompt."""
        monkeypatch.setenv("ARISTOTLE_PROMPT_MODE", "full")
        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            project_directory="/tmp",
            user_language="en-US",
            session_file="/tmp/test.json",
        )
        assert "REFLECTOR.md" in prompt
        assert "compact mode" not in prompt

    def test_env_overrides_config_file(self, monkeypatch, tmp_path):
        """ARISTOTLE_PROMPT_MODE env overrides config file."""
        monkeypatch.setenv("OPENCODE_CONFIG_DIR", str(tmp_path))
        monkeypatch.setenv("ARISTOTLE_PROMPT_MODE", "compact")
        config_file = tmp_path / "aristotle-config.json"
        config_file.write_text('{"prompt_mode": "full"}\n')

        from aristotle_mcp._orch_prompts import _build_reflector_prompt
        prompt = _build_reflector_prompt(
            target_session_id="ses_test",
            focus_hint="last",
            sequence=1,
            project_directory="/tmp",
            user_language="en-US",
            session_file="/tmp/test.json",
        )
        assert "compact mode" in prompt  # env wins over config file
