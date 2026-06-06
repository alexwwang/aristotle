"""Tests for aristotle_mcp._audit_log — MCP Audit Log module (TDD RED phase).

These tests define the contract for the _audit_log module which does NOT
exist yet.  Every test will fail at runtime with ImportError — that is
intentional for TDD RED.

Functions expected from aristotle_mcp._audit_log:
    append_audit_entry(entry: dict) -> dict
    read_audit_entries() -> list[dict]

Constants expected from aristotle_mcp._audit_log:
    MCP_AUDIT_JSONL_LINE_LIMIT = 4096
    ERROR_SUMMARY_TRUNCATION = 500
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _audit_jsonl_path(tmp_repo: Path) -> Path:
    return tmp_repo / ".aristotle" / "audit.jsonl"


def _make_valid_entry(**overrides) -> dict:
    """Return a minimal valid McpAuditEntry dict with optional overrides."""
    entry: dict = {
        "timestamp": "2026-06-02T10:00:00+08:00",
        "tool": "commit_rule",
        "params": {"file_path": "test.md"},
        "result": "success",
        "runId": "run_123",
    }
    entry.update(overrides)
    return entry


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMcpAuditLog:

    # 1. Basic append --------------------------------------------------------

    def test_should_append_entry_to_jsonl(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry()
        result = append_audit_entry(entry)
        assert result["success"]

        lines = _audit_jsonl_path(tmp_repo).read_text().strip().splitlines()
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert parsed["tool"] == "commit_rule"
        assert parsed["result"] == "success"

    # 2. Line size enforcement -----------------------------------------------

    def test_should_enforce_4kb_line_limit(self, tmp_repo):
        from aristotle_mcp._audit_log import (
            append_audit_entry,
            MCP_AUDIT_JSONL_LINE_LIMIT,
        )

        big_params = {"data": "x" * MCP_AUDIT_JSONL_LINE_LIMIT}
        entry = _make_valid_entry(params=big_params)
        result = append_audit_entry(entry)
        assert result["success"]

        line = _audit_jsonl_path(tmp_repo).read_text().strip()
        assert len(line.encode("utf-8")) <= MCP_AUDIT_JSONL_LINE_LIMIT
        parsed = json.loads(line)
        assert parsed.get("truncated") is True

    # 3. Error field truncation ----------------------------------------------

    def test_should_truncate_error_field_at_500_chars(self, tmp_repo):
        from aristotle_mcp._audit_log import (
            append_audit_entry,
            ERROR_SUMMARY_TRUNCATION,
        )

        long_error = "e" * 600
        entry = _make_valid_entry(result="error", error=long_error)
        append_audit_entry(entry)

        parsed = json.loads(_audit_jsonl_path(tmp_repo).read_text().strip())
        # Unicode code-point count, not byte count
        assert len(parsed["error"]) <= ERROR_SUMMARY_TRUNCATION

    # 4. gitignore on init ---------------------------------------------------

    def test_should_add_audit_jsonl_to_gitignore_on_init(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool

        init_repo_tool()
        gitignore = tmp_repo / ".gitignore"
        assert gitignore.exists()
        content = gitignore.read_text()
        assert ".aristotle/audit.jsonl" in content

    # 5. Field validation ----------------------------------------------------

    def test_should_validate_mcp_audit_entry_fields(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry()
        result = append_audit_entry(entry)
        assert result["success"]

        parsed = json.loads(_audit_jsonl_path(tmp_repo).read_text().strip())
        assert isinstance(parsed["timestamp"], str)
        assert isinstance(parsed["tool"], str)
        assert isinstance(parsed["params"], dict)
        assert isinstance(parsed["result"], str)
        assert isinstance(parsed["runId"], str)

    # 6. Append mode (no overwrite) ------------------------------------------

    def test_should_append_in_append_mode(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry1 = _make_valid_entry(runId="run_001")
        entry2 = _make_valid_entry(runId="run_002", tool="read_rules")
        append_audit_entry(entry1)
        append_audit_entry(entry2)

        lines = _audit_jsonl_path(tmp_repo).read_text().strip().splitlines()
        assert len(lines) == 2
        assert json.loads(lines[0])["runId"] == "run_001"
        assert json.loads(lines[1])["runId"] == "run_002"

    # 7. Truncated flag set when truncated -----------------------------------

    def test_should_set_truncated_flag_when_truncated(self, tmp_repo):
        from aristotle_mcp._audit_log import (
            append_audit_entry,
            MCP_AUDIT_JSONL_LINE_LIMIT,
        )

        big_params = {"payload": "A" * MCP_AUDIT_JSONL_LINE_LIMIT}
        entry = _make_valid_entry(params=big_params)
        append_audit_entry(entry)

        parsed = json.loads(_audit_jsonl_path(tmp_repo).read_text().strip())
        assert parsed["truncated"] is True

    # 8. Truncated flag absent when under limit ------------------------------

    def test_should_not_set_truncated_flag_when_under_limit(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry()
        append_audit_entry(entry)

        parsed = json.loads(_audit_jsonl_path(tmp_repo).read_text().strip())
        assert parsed.get("truncated") in (False, None)

    # 9. Multi-byte chars in truncation --------------------------------------

    def test_should_handle_multi_byte_chars_in_truncation(self, tmp_repo):
        from aristotle_mcp._audit_log import (
            append_audit_entry,
            ERROR_SUMMARY_TRUNCATION,
        )

        # Chinese + emoji characters — each is >1 byte but 1 code point
        long_error = "错" * 600
        entry = _make_valid_entry(result="error", error=long_error)
        append_audit_entry(entry)

        parsed = json.loads(_audit_jsonl_path(tmp_repo).read_text().strip())
        assert len(parsed["error"]) <= ERROR_SUMMARY_TRUNCATION

    # 10. Auto-create directory -----------------------------------------------

    def test_should_create_directory_if_missing(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        assert not (tmp_repo / ".aristotle").exists()
        entry = _make_valid_entry()
        append_audit_entry(entry)
        assert (tmp_repo / ".aristotle").is_dir()
        assert _audit_jsonl_path(tmp_repo).exists()

    # 11. Return value --------------------------------------------------------

    def test_should_return_success_on_append(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry()
        result = append_audit_entry(entry)
        assert result["success"] is True

    # 12. Error field populated on error result -------------------------------

    def test_should_populate_error_field_on_error_result(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry(result="error", error="connection timeout")
        append_audit_entry(entry)

        parsed = json.loads(_audit_jsonl_path(tmp_repo).read_text().strip())
        assert parsed["result"] == "error"
        assert parsed["error"] == "connection timeout"

    # 13. Reject invalid result value -----------------------------------------

    def test_should_reject_invalid_result_value(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry(result="unknown")
        result = append_audit_entry(entry)
        assert result["success"] is False

    # 14. Graceful handling of None params ------------------------------------

    def test_should_handle_none_params_gracefully(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry(params=None)
        result = append_audit_entry(entry)
        assert result["success"] is False

    # 15. Reject entry without runId ------------------------------------------

    def test_should_reject_entry_without_runid(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry(runId=None)
        result = append_audit_entry(entry)
        assert result["success"] is False

    # 16. Reject empty tool name ----------------------------------------------

    def test_should_reject_entry_with_empty_tool_name(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry(tool="")
        result = append_audit_entry(entry)
        assert result["success"] is False

    # 17. Boundary cases (parametrized) --------------------------------------

    @pytest.mark.parametrize("target_size", [4095, 4096, 4097])
    def test_should_handle_4kb_boundary_cases(self, tmp_repo, target_size):
        from aristotle_mcp._audit_log import (
            append_audit_entry,
            MCP_AUDIT_JSONL_LINE_LIMIT,
        )

        # Build a base entry with {"d": ""}, measure its byte length, then
        # compute how many fill chars are needed so the final JSONL line
        # hits exactly *target_size* UTF-8 bytes.
        base_entry = _make_valid_entry(params={"d": ""})
        overhead = len(json.dumps(base_entry, ensure_ascii=False).encode("utf-8"))
        # +2 compensates for the two-quote empty string "" we are replacing
        fill_size = max(0, target_size - overhead + 2)
        if fill_size < 0:
            fill_size = 0
        fill_char = "x"
        entry = _make_valid_entry(params={"d": fill_char * fill_size})

        result = append_audit_entry(entry)
        assert result["success"]

        line = _audit_jsonl_path(tmp_repo).read_text().strip()
        actual_size = len(line.encode("utf-8"))

        if target_size <= MCP_AUDIT_JSONL_LINE_LIMIT:
            # Should not be truncated
            parsed = json.loads(line)
            assert parsed.get("truncated") in (False, None)
            assert actual_size <= MCP_AUDIT_JSONL_LINE_LIMIT
        else:
            # 4097 — must be truncated to fit 4KB
            assert actual_size <= MCP_AUDIT_JSONL_LINE_LIMIT
            parsed = json.loads(line)
            assert parsed.get("truncated") is True

    # 18. No duplicate gitignore entries -------------------------------------

    def test_should_not_duplicate_gitignore_entry_on_repeated_init(self, tmp_repo):
        from aristotle_mcp.server import init_repo_tool

        init_repo_tool()
        init_repo_tool()

        gitignore = (tmp_repo / ".gitignore").read_text()
        count = gitignore.count(".aristotle/audit.jsonl")
        assert count == 1

    # 19. Allow error result without error field ------------------------------

    def test_should_allow_error_result_without_error_field(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry

        entry = _make_valid_entry(result="error")
        entry.pop("error", None)
        result = append_audit_entry(entry)
        assert result["success"]

    # 20. Read existing entries -----------------------------------------------

    def test_should_read_existing_audit_entries(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry, read_audit_entries

        entry1 = _make_valid_entry(runId="run_001", tool="commit_rule")
        entry2 = _make_valid_entry(runId="run_002", tool="read_rules")
        append_audit_entry(entry1)
        append_audit_entry(entry2)

        entries = read_audit_entries()
        assert len(entries) == 2
        assert entries[0]["runId"] == "run_001"
        assert entries[0]["tool"] == "commit_rule"
        assert entries[1]["runId"] == "run_002"
        assert entries[1]["tool"] == "read_rules"

    # 21. Chronological order -------------------------------------------------

    def test_should_return_entries_in_chronological_order(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry, read_audit_entries

        entry1 = _make_valid_entry(
            runId="run_A",
            timestamp="2026-06-01T08:00:00+08:00",
        )
        entry2 = _make_valid_entry(
            runId="run_B",
            timestamp="2026-06-02T08:00:00+08:00",
        )
        entry3 = _make_valid_entry(
            runId="run_C",
            timestamp="2026-06-03T08:00:00+08:00",
        )
        append_audit_entry(entry1)
        append_audit_entry(entry2)
        append_audit_entry(entry3)

        entries = read_audit_entries()
        assert len(entries) == 3
        assert entries[0]["runId"] == "run_A"
        assert entries[1]["runId"] == "run_B"
        assert entries[2]["runId"] == "run_C"

    # 22. Empty file returns empty list ---------------------------------------

    def test_should_return_empty_list_for_empty_audit_file(self, tmp_repo):
        from aristotle_mcp._audit_log import read_audit_entries

        audit_dir = tmp_repo / ".aristotle"
        audit_dir.mkdir(parents=True, exist_ok=True)
        (_audit_jsonl_path(tmp_repo)).touch()

        entries = read_audit_entries()
        assert entries == []

    # 23. Graceful handling of corrupted JSONL --------------------------------

    def test_should_handle_corrupted_jsonl_gracefully(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry, read_audit_entries

        entry1 = _make_valid_entry(runId="run_good_1")
        append_audit_entry(entry1)

        # Append a corrupted line manually
        audit_path = _audit_jsonl_path(tmp_repo)
        with open(audit_path, "a") as f:
            f.write("THIS IS NOT VALID JSON {{{\n")

        entry3 = _make_valid_entry(runId="run_good_2")
        append_audit_entry(entry3)

        entries = read_audit_entries()
        assert len(entries) == 2
        assert entries[0]["runId"] == "run_good_1"
        assert entries[1]["runId"] == "run_good_2"

    # 24. Verify written field values round-trip ------------------------------

    def test_should_validate_audit_entry_content_values(self, tmp_repo):
        from aristotle_mcp._audit_log import append_audit_entry, read_audit_entries

        ts = "2026-06-02T10:00:00+08:00"
        tool = "commit_rule"
        params = {"file_path": "test.md", "confidence": 0.9}
        result_val = "success"
        run_id = "run_roundtrip_999"

        entry = _make_valid_entry(
            timestamp=ts,
            tool=tool,
            params=params,
            result=result_val,
            runId=run_id,
        )
        append_audit_entry(entry)

        entries = read_audit_entries()
        assert len(entries) == 1
        got = entries[0]
        assert got["timestamp"] == ts
        assert got["tool"] == tool
        assert got["params"] == params
        assert got["result"] == result_val
        assert got["runId"] == run_id
