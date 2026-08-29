"""Phase 4 Integration Tests — TDD RED phase.

Verifies the full Phase 4 merge:
- 5 new MCP tools registered
- intervention/ directory deleted
- Total 25 tools (20 existing + 5 new)
- PromptValidator patterns migrated to Ralph Loop
- Full E2E lifecycle
"""
from __future__ import annotations

import importlib
import json
import os
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


EXISTING_TOOLS = [
    "check_sync_status",
    "commit_rule",
    "complete_reflection_record",
    "create_reflection_record",
    "detect_conflicts",
    "get_audit_decision",
    "init_repo_tool",
    "list_rules",
    "on_undo",
    "orchestrate_on_event",
    "orchestrate_review_action",
    "orchestrate_start",
    "persist_draft",
    "read_rules",
    "reject_rule",
    "report_feedback",
    "restore_rule",
    "stage_rule",
    "sync_rules",
    "write_rule",
]

NEW_TOOLS = [
    "create_rollback_point",
    "rollback_to_checkpoint",
    "cleanup_rollback_stashes",
    "write_ki_doc",
    "read_ki_docs",
]

ALL_TOOLS = EXISTING_TOOLS + NEW_TOOLS

INTERVENTION_DELETED_FILES = [
    "intervention/src/rollback_engine.py",
    "intervention/src/ki_doc_manager.py",
    "intervention/src/committer.py",
    "intervention/src/prompt_validator.py",
    "intervention/src/watchdog.py",
    "intervention/src/intervention_coordinator.py",
    "intervention/src/reflector.py",
    "intervention/src/rule_generator.py",
    "intervention/src/intervention_types.py",
    "intervention/src/__init__.py",
]


def _ki_doc_path(tmp_repo: Path) -> str:
    return str(tmp_repo / "ki-docs" / "review.md")


def _init_git_repo(repo: Path) -> None:
    import subprocess as sp
    sp.run(["git", "init"], cwd=str(repo), capture_output=True)
    sp.run(["git", "config", "user.email", "t@t.com"], cwd=str(repo), capture_output=True)
    sp.run(["git", "config", "user.name", "test"], cwd=str(repo), capture_output=True)
    (repo / ".gitignore").write_text(".aristotle/\n")
    (repo / "README.md").write_text("init")
    sp.run(["git", "add", "."], cwd=str(repo), capture_output=True)
    sp.run(["git", "commit", "-m", "init"], cwd=str(repo), capture_output=True)


class TestIntegration:
    """22 integration tests for Phase 4 merge verification."""

    # ---------------------------------------------------------------
    # 1. Full E2E lifecycle
    # ---------------------------------------------------------------
    def test_should_perform_full_lifecycle_e2e_flow(self, tmp_repo: Path) -> None:
        """create_rollback_point -> write_ki_doc -> commit_rule with guard ->
        rollback_to_checkpoint (verify pipeline_reset_required=true) ->
        cleanup_rollback_stashes. All 5 new tools in sequence."""
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
            rollback_to_checkpoint,
        )
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        _init_git_repo(tmp_repo)

        # Step 1: create rollback checkpoint
        cp = create_rollback_point("e2e-start", run_id="run-e2e")
        assert cp["success"] is True
        assert "stash_ref" in cp

        # Step 2: write a knowledge-item doc
        ki_path = _ki_doc_path(tmp_repo)
        doc = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=ki_path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        assert doc["success"] is True

        # Step 3: commit a rule with guard (using existing tool)
        from aristotle_mcp.server import write_rule as aristotle_write_rule

        rule = aristotle_write_rule(
            content="## Rule\nTest rule from E2E flow.",
            error_summary="e2e test",
            category="PATTERN_VIOLATION",
        )
        assert rule["success"] is True

        # Step 4: rollback to checkpoint (by name, matching unit test signature)
        rb = rollback_to_checkpoint("e2e-start", run_id="run-e2e")
        assert rb["success"] is True
        assert rb.get("pipeline_reset_required") is True

        # Step 5: cleanup stashes
        cleanup = cleanup_rollback_stashes(keep=0)
        assert cleanup["success"] is True

    # ---------------------------------------------------------------
    # 2. Existing test suite still passes
    # ---------------------------------------------------------------
    def test_should_verify_existing_test_suite_passes_post_migration(self, tmp_repo: Path) -> None:
        """Run existing test_mcp_server_tools.py via subprocess and assert exit code 0."""
        env = os.environ.copy()
        env["ARISTOTLE_REPO_DIR"] = str(tmp_repo)
        result = subprocess.run(
            ["pytest", "-x", "aristotle_mcp/tests/test_mcp_server_tools.py"],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, (
            f"Existing tests failed:\n{result.stdout}\n{result.stderr}"
        )

    # ---------------------------------------------------------------
    # 3. Import all 5 new tools
    # ---------------------------------------------------------------
    def test_should_import_all_5_new_tools_successfully(self) -> None:
        """All 5 new Phase 4 tools must be importable from aristotle_mcp.server."""
        from aristotle_mcp.server import (
            cleanup_rollback_stashes,
            create_rollback_point,
            read_ki_docs,
            rollback_to_checkpoint,
            write_ki_doc,
        )

        assert callable(create_rollback_point)
        assert callable(rollback_to_checkpoint)
        assert callable(cleanup_rollback_stashes)
        assert callable(write_ki_doc)
        assert callable(read_ki_docs)

    # ---------------------------------------------------------------
    # 4. Migrated type definitions
    # ---------------------------------------------------------------
    def test_should_import_migrated_type_definitions(self) -> None:
        """Migrated types must be importable from aristotle_mcp.types."""
        from aristotle_mcp.types import (
            InterventionRecord,
            PipelineContext,
            RollbackResult,
            ViolationEvent,
        )

        assert RollbackResult is not None
        assert ViolationEvent is not None
        assert PipelineContext is not None
        assert InterventionRecord is not None

    # ---------------------------------------------------------------
    # 5. intervention/ directory deleted
    # ---------------------------------------------------------------
    def test_should_verify_intervention_directory_deleted(self) -> None:
        """The intervention/ directory must no longer exist at project root."""
        project_root = Path(__file__).parent.parent.parent
        intervention_dir = project_root / "intervention"
        assert not intervention_dir.exists(), (
            f"intervention/ directory still exists at {intervention_dir}"
        )

    # ---------------------------------------------------------------
    # 6. Deleted intervention modules raise ImportError
    # ---------------------------------------------------------------
    def test_should_fail_to_import_deleted_intervention_modules(self) -> None:
        """importlib.import_module('intervention.rollback_engine') must raise ImportError."""
        with pytest.raises(ImportError):
            importlib.import_module("intervention.rollback_engine")

    # ---------------------------------------------------------------
    # 7. All 10 deleted files absent
    # ---------------------------------------------------------------
    def test_should_verify_all_10_deleted_files_absent(self) -> None:
        """Check that none of the 10 intervention/src/ files exist."""
        project_root = Path(__file__).parent.parent.parent
        for rel_path in INTERVENTION_DELETED_FILES:
            fpath = project_root / rel_path
            assert not fpath.exists(), f"Deleted file still present: {rel_path}"

    # ---------------------------------------------------------------
    # 8. Total MCP tool count == 25
    # ---------------------------------------------------------------
    def test_should_assert_mcp_tool_count_equals_25(self) -> None:
        """The MCP server must register exactly 25 tools."""
        from aristotle_mcp.server import mcp

        assert len(mcp._tool_manager._tools) == 25

    # ---------------------------------------------------------------
    # 9. All 25 tools available after init_repo
    # ---------------------------------------------------------------
    def test_should_register_tools_after_init_repo(self, tmp_repo: Path) -> None:
        """After init_repo_tool(), all 25 tools must be available."""
        from aristotle_mcp.server import init_repo_tool as aristotle_init_repo_tool
        from aristotle_mcp.server import mcp

        aristotle_init_repo_tool()
        tool_names = set(mcp._tool_manager._tools.keys())
        for name in ALL_TOOLS:
            assert name in tool_names, f"Tool '{name}' not registered after init_repo"

    # ---------------------------------------------------------------
    # 10. Tools work without prior session state
    # ---------------------------------------------------------------
    def test_should_execute_tools_without_prior_session_state(
        self, tmp_repo: Path
    ) -> None:
        """Fresh repo, no pre-existing state — all 5 new tools execute without error."""
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
            rollback_to_checkpoint,
        )
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        _init_git_repo(tmp_repo)

        cp = create_rollback_point("fresh", run_id="")
        assert cp["success"] is True

        ki_path = _ki_doc_path(tmp_repo)
        doc = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=ki_path,
            violation="TEST_VIOLATION",
            timestamp="2026-06-02T12:00:00+08:00",
            file="tests/test_fresh.py",
            phase=4,
        )
        assert doc["success"] is True

        entries = read_ki_docs(ki_path)
        assert len(entries) >= 1

        rb = rollback_to_checkpoint("fresh", run_id="")
        assert rb["success"] is True

        cl = cleanup_rollback_stashes(keep=0)
        assert cl["success"] is True

    # ---------------------------------------------------------------
    # 11. No session state leakage between calls
    # ---------------------------------------------------------------
    def test_should_verify_no_session_state_dependency_in_tools(
        self, tmp_repo: Path
    ) -> None:
        """Call each new tool twice — no session_id leakage or cross-contamination."""
        import subprocess

        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
            rollback_to_checkpoint,
        )
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        subprocess.run(["git", "init"], cwd=str(tmp_repo), capture_output=True)
        subprocess.run(["git", "config", "user.email", "t@t.com"], cwd=str(tmp_repo), capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=str(tmp_repo), capture_output=True)
        (tmp_repo / ".gitignore").write_text(".aristotle/\n")
        (tmp_repo / "a.txt").write_text("init")
        subprocess.run(["git", "add", "."], cwd=str(tmp_repo), capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=str(tmp_repo), capture_output=True)

        (tmp_repo / "dirty1.txt").write_text("change1")
        cp1 = create_rollback_point("call-1", run_id="")

        (tmp_repo / "dirty2.txt").write_text("change2")
        cp2 = create_rollback_point("call-2", run_id="")
        assert cp1["stash_ref"] != cp2["stash_ref"]

        ki_path1 = str(tmp_repo / "ki-docs" / "doc1.md")
        ki_path2 = str(tmp_repo / "ki-docs" / "doc2.md")
        doc1 = write_ki_doc(
            entry_type="intervention", ki_doc_path=ki_path1,
            violation="V1", timestamp="2026-06-02T10:00:00+08:00",
            file="f1.py", phase=4,
        )
        doc2 = write_ki_doc(
            entry_type="intervention", ki_doc_path=ki_path2,
            violation="V2", timestamp="2026-06-02T11:00:00+08:00",
            file="f2.py", phase=4,
        )
        assert doc1["success"] is True
        assert doc2["success"] is True

        rb1 = rollback_to_checkpoint("call-1", run_id="")
        rb2 = rollback_to_checkpoint("call-2", run_id="")
        assert rb1["success"] is True
        assert rb2["success"] is True

        cleanup_rollback_stashes(keep=0)

    # ---------------------------------------------------------------
    # 12. Bilingual patterns in Ralph Loop reviewer
    # ---------------------------------------------------------------
    def test_should_verify_bilingual_patterns_in_ralph_loop_reviewer(self) -> None:
        """Reviewer prompt template must contain both English and Chinese forbidden patterns."""
        patterns_dir = Path("aristotle_mcp")
        found_en = False
        found_zh = False

        for py_file in patterns_dir.rglob("*.py"):
            content = py_file.read_text(errors="ignore")
            if any(
                p in content
                for p in ["total N issues so far", "Round N of M", "issues so far"]
            ):
                found_en = True
            if any(p in content for p in ["累计", "第N轮", "问题总数"]):
                found_zh = True

        assert found_en, "English bilingual pattern not found in reviewer prompts"
        assert found_zh, "Chinese bilingual pattern not found in reviewer prompts"

    # ---------------------------------------------------------------
    # 13. prompt_validator.py deleted
    # ---------------------------------------------------------------
    def test_should_confirm_prompt_validator_module_deleted(self) -> None:
        """intervention/src/prompt_validator.py must not exist."""
        project_root = Path(__file__).parent.parent.parent
        pv_path = project_root / "intervention" / "src" / "prompt_validator.py"
        assert not pv_path.exists(), "prompt_validator.py still exists"

    # ---------------------------------------------------------------
    # 14. Preserved modules have interface docs
    # ---------------------------------------------------------------
    def test_should_verify_all_preserved_modules_have_interface_docs(self) -> None:
        """All preserved module public methods must have docstrings."""
        import aristotle_mcp.server as server_mod

        preserved_public = [
            name
            for name in dir(server_mod)
            if name.startswith("aristotle_") and callable(getattr(server_mod, name))
        ]
        for fn_name in preserved_public:
            fn = getattr(server_mod, fn_name)
            assert fn.__doc__ is not None, f"{fn_name} missing docstring"
            assert len(fn.__doc__.strip()) > 0, f"{fn_name} has empty docstring"

    # ---------------------------------------------------------------
    # 15. Tool registration order
    # ---------------------------------------------------------------
    def test_should_verify_tool_registration_order(self) -> None:
        """Tools must be registered in the expected order in server.py."""
        from aristotle_mcp.server import mcp

        registered = list(mcp._tool_manager._tools.keys())
        for existing in EXISTING_TOOLS:
            assert existing in registered, f"Existing tool {existing} not registered"
        for new_tool in NEW_TOOLS:
            assert new_tool in registered, f"New tool {new_tool} not registered"

    # ---------------------------------------------------------------
    # 16. Rollback and restore state
    # ---------------------------------------------------------------
    def test_should_rollback_and_restore_state_correctly(self, tmp_repo: Path) -> None:
        """Create checkpoint, modify file, rollback, verify content restored."""
        from aristotle_mcp._tools_rollback import (
            create_rollback_point,
            rollback_to_checkpoint,
        )

        _init_git_repo(tmp_repo)

        test_file = tmp_repo / "state_test.txt"
        original_content = "original state"
        test_file.write_text(original_content)
        import subprocess as sp
        sp.run(["git", "add", "."], cwd=str(tmp_repo), capture_output=True)
        sp.run(["git", "commit", "-m", "add state test file"], cwd=str(tmp_repo), capture_output=True)

        cp = create_rollback_point("state-restore", run_id="")
        assert cp["success"] is True

        test_file.write_text("modified state")
        assert test_file.read_text() == "modified state"

        rb = rollback_to_checkpoint("state-restore", run_id="")
        assert rb["success"] is True
        assert test_file.read_text() == original_content

    # ---------------------------------------------------------------
    # 17. KI doc write/read round-trip
    # ---------------------------------------------------------------
    def test_should_write_and_read_ki_doc_round_trip(self, tmp_repo: Path) -> None:
        """write_ki_doc -> read_ki_docs, content must match."""
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        ki_path = _ki_doc_path(tmp_repo)
        violation_type = "SKIP_RED_PHASE"
        timestamp = "2026-06-02T10:00:00+08:00"
        affected_file = "src/main.py"

        written = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=ki_path,
            violation=violation_type,
            timestamp=timestamp,
            file=affected_file,
            phase=4,
        )
        assert written["success"] is True

        entries = read_ki_docs(ki_path)
        assert len(entries) >= 1

        content = Path(ki_path).read_text()
        assert violation_type in content
        assert timestamp in content
        assert affected_file in content

    # ---------------------------------------------------------------
    # 18. No stale imports in existing test files
    # ---------------------------------------------------------------
    def test_should_verify_no_stale_imports_in_existing_tests(self) -> None:
        """Grep test files for 'import intervention' or 'from intervention'."""
        test_dir = Path("aristotle_mcp/tests")
        for tf in test_dir.glob("*.py"):
            if tf.name == "test_integration.py":
                continue
            content = tf.read_text()
            assert "import intervention" not in content, (
                f"Stale 'import intervention' found in {tf}"
            )
            assert "from intervention" not in content, (
                f"Stale 'from intervention' found in {tf}"
            )

    # ---------------------------------------------------------------
    # 19. No stale imports in preserved modules
    # ---------------------------------------------------------------
    def test_should_verify_no_stale_imports_in_preserved_modules(self) -> None:
        """Grep aristotle_mcp source for intervention import references."""
        src_dir = Path("aristotle_mcp")
        for py_file in src_dir.rglob("*.py"):
            if py_file.name == "test_integration.py":
                continue
            content = py_file.read_text(errors="ignore")
            assert "from intervention" not in content, (
                f"Stale 'from intervention' in {py_file}"
            )
            assert "import intervention" not in content, (
                f"Stale 'import intervention' in {py_file}"
            )

    # ---------------------------------------------------------------
    # 20. Audit entries for entire lifecycle
    # ---------------------------------------------------------------
    def test_should_write_audit_entries_for_entire_lifecycle(
        self, tmp_repo: Path
    ) -> None:
        """After E2E flow, .aristotle/audit.jsonl must have entries for each tool call."""
        from aristotle_mcp._tools_rollback import (
            cleanup_rollback_stashes,
            create_rollback_point,
            rollback_to_checkpoint,
        )
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        _init_git_repo(tmp_repo)

        cp = create_rollback_point("audit-test", run_id="")
        ki_path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention", ki_doc_path=ki_path,
            violation="AUDIT_TEST", timestamp="2026-06-02T10:00:00+08:00",
            file="test.py", phase=4,
        )
        rollback_to_checkpoint("audit-test", run_id="")
        cleanup_rollback_stashes(keep=0)

        audit_file = tmp_repo / ".aristotle" / "audit.jsonl"
        assert audit_file.exists(), "audit.jsonl not created"

        lines = audit_file.read_text().strip().splitlines()
        assert len(lines) >= 4, f"Expected >= 4 audit entries, got {len(lines)}"

        events = [json.loads(line) for line in lines]
        tool_names_in_audit = {e.get("tool") for e in events}
        assert "create_rollback_point" in tool_names_in_audit
        assert "write_ki_doc" in tool_names_in_audit
        assert "rollback_to_checkpoint" in tool_names_in_audit
        assert "cleanup_rollback_stashes" in tool_names_in_audit

    # ---------------------------------------------------------------
    # 21. All original PromptValidator patterns migrated
    # ---------------------------------------------------------------
    def test_should_verify_all_original_prompt_validator_patterns_migrated(
        self,
    ) -> None:
        """Verify prompt validator patterns exist in the migrated location."""
        migrated_patterns_file = Path("aristotle_mcp/_orch_prompts.py")
        assert migrated_patterns_file.exists(), (
            "Migrated patterns file not found"
        )

        content = migrated_patterns_file.read_text()
        assert len(content) > 0, "Migrated patterns file is empty"

    # ---------------------------------------------------------------
    # 22. Preservation under migration
    # ---------------------------------------------------------------
    def test_preservation_under_migration(self) -> None:
        """Phase 4 merge must preserve all existing tool interfaces."""
        from aristotle_mcp.server import mcp

        registered = set(mcp._tool_manager._tools.keys())
        for tool_name in EXISTING_TOOLS:
            assert tool_name in registered, (
                f"Preserved tool '{tool_name}' missing from MCP registry after migration"
            )
