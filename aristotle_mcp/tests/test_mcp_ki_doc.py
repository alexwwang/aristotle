"""Tests for aristotle_mcp._tools_ki_doc — KI Doc write/read tools (TDD RED phase).

Tests the two MCP tools:
- write_ki_doc(entry_type, ki_doc_path, **kwargs)
- read_ki_docs(ki_doc_path, filter=None, freshness_check=False)

Constants:
- KI_FRESHNESS_THRESHOLD = 86400  # 24h in seconds
- Default header: "# Review Records\\n\\n"
- ViolationEvent: {violation_type, affected_file_path, timestamp, context}
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ki_doc_path(tmp_repo: Path) -> str:
    """Return a temp KI doc path under the repo."""
    return str(tmp_repo / "ki-docs" / "review.md")


def _sample_violation_event(
    violation_type: str = "SKIP_RED_PHASE",
    path: str = "src/main.py",
    ts: str = "2026-06-02T10:00:00+08:00",
    phase: int = 4,
) -> dict:
    return {
        "violation_type": violation_type,
        "affected_file_path": path,
        "timestamp": ts,
        "context": {"phase": phase},
    }


# ---------------------------------------------------------------------------
# 1. Intervention entry
# ---------------------------------------------------------------------------
class TestKiDocTools:
    def test_should_write_intervention_entry(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        assert result["success"] is True

        content = Path(path).read_text()
        assert "SKIP_RED_PHASE" in content
        assert "2026-06-02T10:00:00+08:00" in content
        assert "src/main.py" in content
        assert "4" in content

    # -----------------------------------------------------------------------
    # 2. Assessment entry
    # -----------------------------------------------------------------------
    def test_should_write_assessment_entry(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        result = write_ki_doc(
            entry_type="assessment",
            ki_doc_path=path,
            phase=4,
            next_phase=5,
            status="PASS",
            issues=["slow test"],
        )
        assert result["success"] is True

        content = Path(path).read_text()
        assert "assessment" in content
        assert "PASS" in content
        assert "4" in content
        assert "5" in content

    # -----------------------------------------------------------------------
    # 2.1. Assessment with empty status creates doc with header
    # -----------------------------------------------------------------------
    def test_should_create_assessment_when_status_empty(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        result = write_ki_doc(
            entry_type="assessment",
            ki_doc_path=path,
            phase=3,
            next_phase=4,
            status="",
        )
        assert result["success"] is True

        content = Path(path).read_text()
        assert content.startswith("# Review Records\n")

    # -----------------------------------------------------------------------
    # 3. Merge entry
    # -----------------------------------------------------------------------
    def test_should_write_merge_entry(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        events = [
            _sample_violation_event("SKIP_RED_PHASE", "src/a.py", "2026-06-02T10:00:00+08:00", 4),
            _sample_violation_event("MISSING_TEST", "src/b.py", "2026-06-02T10:01:00+08:00", 4),
            _sample_violation_event("FORBIDDEN_PATTERN", "src/c.py", "2026-06-02T10:02:00+08:00", 5),
        ]
        result = write_ki_doc(
            entry_type="merge",
            ki_doc_path=path,
            events=events,
            context={"phase": 4, "requirement": "All tests must pass before merge"},
        )
        assert result["success"] is True

        content = Path(path).read_text()
        assert "SKIP_RED_PHASE" in content
        assert "MISSING_TEST" in content
        assert "FORBIDDEN_PATTERN" in content
        assert "4" in content
        assert "All tests must pass before merge" in content

    # -----------------------------------------------------------------------
    # 4. Read all KI docs
    # -----------------------------------------------------------------------
    def test_should_read_all_ki_docs(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        write_ki_doc(
            entry_type="assessment",
            ki_doc_path=path,
            phase=4,
            next_phase=5,
            status="PASS",
        )

        entries = read_ki_docs(path)
        assert len(entries) == 2

    # -----------------------------------------------------------------------
    # 4.1. Nonexistent file returns empty list
    # -----------------------------------------------------------------------
    def test_should_return_empty_list_for_nonexistent_ki_doc(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import read_ki_docs

        path = _ki_doc_path(tmp_repo)
        # File does not exist yet
        entries = read_ki_docs(path)
        assert entries == []

    # -----------------------------------------------------------------------
    # 5. Filter by type AND phase
    # -----------------------------------------------------------------------
    def test_should_read_ki_docs_with_filter(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="MISSING_TEST",
            timestamp="2026-06-02T11:00:00+08:00",
            file="src/util.py",
            phase=5,
        )
        write_ki_doc(
            entry_type="assessment",
            ki_doc_path=path,
            phase=4,
            next_phase=5,
            status="PASS",
        )

        entries = read_ki_docs(path, filter={"type": "intervention", "phase": 4})
        assert len(entries) == 1
        assert "SKIP_RED_PHASE" in str(entries[0])

    # -----------------------------------------------------------------------
    # 5.1. Filter by since timestamp
    # -----------------------------------------------------------------------
    def test_should_filter_ki_docs_by_since_timestamp(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="OLD_VIOLATION",
            timestamp="2026-06-01T08:00:00+08:00",
            file="src/old.py",
            phase=2,
        )
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="NEW_VIOLATION",
            timestamp="2026-06-03T14:00:00+08:00",
            file="src/new.py",
            phase=4,
        )

        entries = read_ki_docs(path, filter={"since": "2026-06-02T12:00:00+08:00"})
        assert len(entries) == 1
        assert "NEW_VIOLATION" in str(entries[0])

    # -----------------------------------------------------------------------
    # 6. Freshness check — recent doc is fresh
    # -----------------------------------------------------------------------
    def test_should_check_freshness(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime())
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp=now_iso,
            file="src/main.py",
            phase=4,
        )

        result = read_ki_docs(path, freshness_check=True)
        assert result["fresh"] is True

    # -----------------------------------------------------------------------
    # 6.1. Stale doc (older than 24h)
    # -----------------------------------------------------------------------
    def test_should_return_stale_when_doc_is_old(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        old_ts = "2026-01-01T00:00:00+08:00"
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="OLD_PHASE_SKIP",
            timestamp=old_ts,
            file="src/old.py",
            phase=2,
        )

        result = read_ki_docs(path, freshness_check=True)
        assert result["fresh"] is False

    # -----------------------------------------------------------------------
    # 7. Create doc with header if missing
    # -----------------------------------------------------------------------
    def test_should_create_doc_with_header_if_missing(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        assert not Path(path).exists()

        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )

        content = Path(path).read_text()
        assert content.startswith("# Review Records\n")

    # -----------------------------------------------------------------------
    # 8. Create parent directory if missing
    # -----------------------------------------------------------------------
    def test_should_create_parent_directory_if_missing(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = str(tmp_repo / "deep" / "nested" / "ki-docs" / "review.md")
        assert not Path(path).parent.exists()

        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        assert result["success"] is True
        assert Path(path).exists()

    # -----------------------------------------------------------------------
    # 9. Return success on write
    # -----------------------------------------------------------------------
    def test_should_return_success_on_write(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        assert result == {"success": True}

    # -----------------------------------------------------------------------
    # 10. IOError returns structured error
    # -----------------------------------------------------------------------
    def test_should_return_none_on_io_error(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        # Use a path that will cause I/O error (directory as file)
        bad_path = str(tmp_repo)
        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=bad_path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        assert result["success"] is False
        assert "error" in result
        assert "I/O error" in result["error"]

    # -----------------------------------------------------------------------
    # 11. Parse newest timestamp
    # -----------------------------------------------------------------------
    def test_should_parse_newest_timestamp(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, _parse_newest_timestamp

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="OLD",
            timestamp="2026-06-01T08:00:00+08:00",
            file="src/a.py",
            phase=2,
        )
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="NEW",
            timestamp="2026-06-03T14:00:00+08:00",
            file="src/b.py",
            phase=4,
        )
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="MID",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/c.py",
            phase=3,
        )

        newest = _parse_newest_timestamp(path)
        assert newest is not None
        assert "2026-06-03" in newest

    # -----------------------------------------------------------------------
    # 12. Nonexistent doc is treated as fresh
    # -----------------------------------------------------------------------
    def test_should_treat_nonexistent_doc_as_fresh(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import read_ki_docs

        path = _ki_doc_path(tmp_repo)
        result = read_ki_docs(path, freshness_check=True)
        assert result["fresh"] is True

    # -----------------------------------------------------------------------
    # 13. Round-trip write → read
    # -----------------------------------------------------------------------
    def test_should_round_trip_write_and_read(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )

        entries = read_ki_docs(path)
        assert len(entries) == 1
        entry_str = str(entries[0])
        assert "SKIP_RED_PHASE" in entry_str
        assert "src/main.py" in entry_str

    # -----------------------------------------------------------------------
    # 14. Intervention with rollback info
    # -----------------------------------------------------------------------
    def test_should_include_rollback_info_in_intervention(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
            rollback_result={"commit": "abc1234", "status": "success"},
        )

        entries = read_ki_docs(path)
        assert len(entries) == 1
        entry_str = str(entries[0])
        assert "rollback" in entry_str.lower()
        assert "abc1234" in entry_str

    # -----------------------------------------------------------------------
    # 15. Intervention with validation_result (forbidden patterns)
    # -----------------------------------------------------------------------
    def test_should_include_forbidden_patterns_in_intervention(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="FORBIDDEN_PATTERN",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
            validation_result={"matches": ["TODO", "FIXME"], "count": 2},
        )

        entries = read_ki_docs(path)
        assert len(entries) == 1
        entry_str = str(entries[0])
        assert "TODO" in entry_str
        assert "FIXME" in entry_str

    # -----------------------------------------------------------------------
    # 16. Audit entry on write
    # -----------------------------------------------------------------------
    def test_should_write_audit_entry_on_ki_doc_write(self, tmp_repo: Path) -> None:
        from unittest.mock import patch

        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)

        with patch("aristotle_mcp._audit_log.append_audit_entry") as mock_audit:
            write_ki_doc(
                entry_type="intervention",
                ki_doc_path=path,
                violation="SKIP_RED_PHASE",
                timestamp="2026-06-02T10:00:00+08:00",
                file="src/main.py",
                phase=4,
            )
            mock_audit.assert_called_once()
            call_args = mock_audit.call_args
            assert call_args[0][0] == "ki_doc_write" or call_args[1].get("action") == "ki_doc_write" or "ki_doc" in str(call_args)

    # -----------------------------------------------------------------------
    # 17. Audit entry on read
    # -----------------------------------------------------------------------
    def test_should_write_audit_entry_on_ki_doc_read(self, tmp_repo: Path) -> None:
        from unittest.mock import patch

        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )

        with patch("aristotle_mcp._audit_log.append_audit_entry") as mock_audit:
            read_ki_docs(path)
            mock_audit.assert_called_once()
            call_args = mock_audit.call_args
            assert "ki_doc" in str(call_args)

    # -----------------------------------------------------------------------
    # 18. Empty events list in merge entry
    # -----------------------------------------------------------------------
    def test_should_handle_empty_events_list_in_merge_entry(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        result = write_ki_doc(
            entry_type="merge",
            ki_doc_path=path,
            events=[],
            context={"phase": 4, "requirement": "empty merge test"},
        )
        assert result["success"] is True

        entries = read_ki_docs(path)
        assert len(entries) == 1
        assert "merge" in str(entries[0]).lower()

    # -----------------------------------------------------------------------
    # 19. Reject invalid entry_type
    # -----------------------------------------------------------------------
    def test_should_reject_invalid_entry_type(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        with pytest.raises((ValueError, TypeError)):
            write_ki_doc(
                entry_type="invalid_type",
                ki_doc_path=path,
            )

    # -----------------------------------------------------------------------
    # 20. Malformed doc (no parseable timestamps) is treated as fresh
    # -----------------------------------------------------------------------
    def test_should_treat_malformed_doc_as_fresh(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import read_ki_docs

        path = _ki_doc_path(tmp_repo)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text("# Review Records\n\nSome garbage content without timestamps\n")

        result = read_ki_docs(path, freshness_check=True)
        assert result["fresh"] is True

    # -----------------------------------------------------------------------
    # 21. Large violation list (100+ events) in merge entry
    # -----------------------------------------------------------------------
    def test_should_handle_large_violation_list_in_merge_entry(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        events = [
            _sample_violation_event(
                f"VIOLATION_{i}",
                f"src/file_{i}.py",
                f"2026-06-02T10:{i % 60:02d}:00+08:00",
                i % 5 + 1,
            )
            for i in range(150)
        ]
        result = write_ki_doc(
            entry_type="merge",
            ki_doc_path=path,
            events=events,
            context={"phase": 4, "requirement": "bulk merge test"},
        )
        assert result["success"] is True

        entries = read_ki_docs(path)
        assert len(entries) >= 1

    # -----------------------------------------------------------------------
    # 22. Non-UTF-8 content on read
    # -----------------------------------------------------------------------
    def test_should_handle_non_utf8_content_gracefully(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import read_ki_docs

        path = _ki_doc_path(tmp_repo)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b"\x80\x81\x82\xff non-utf8 content")

        entries = read_ki_docs(path)
        # Should return an error structure or empty, not raise
        assert isinstance(entries, (list, dict))

    # -----------------------------------------------------------------------
    # 23. Filter matching no entries returns empty list
    # -----------------------------------------------------------------------
    def test_should_return_empty_list_when_filter_matches_no_entries(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc, read_ki_docs

        path = _ki_doc_path(tmp_repo)
        write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )

        entries = read_ki_docs(path, filter={"type": "assessment", "phase": 99})
        assert entries == []

    # -----------------------------------------------------------------------
    # 24. Reject entry with missing required fields
    # -----------------------------------------------------------------------
    def test_should_reject_entry_with_missing_required_fields(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        with pytest.raises((ValueError, TypeError)):
            write_ki_doc(
                entry_type="intervention",
                ki_doc_path=path,
                # Missing required: violation, timestamp, file, phase
            )

    # -----------------------------------------------------------------------
    # 25. Append to corrupted file preserves original
    # -----------------------------------------------------------------------
    def test_should_append_to_corrupted_file(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        corrupted = b"\x00\x01\x02 corrupted binary content"
        Path(path).write_bytes(corrupted)
        original_content = Path(path).read_bytes()

        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation="SKIP_RED_PHASE",
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        # Should fail or handle gracefully without modifying the file
        if result.get("success") is False:
            assert Path(path).read_bytes() == original_content
        else:
            # If it succeeded, the file should still be readable
            assert Path(path).exists()

    # -----------------------------------------------------------------------
    # 26. Non-UTF-8 encodable content (surrogate characters)
    # -----------------------------------------------------------------------
    def test_should_handle_non_utf8_encodable_content(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        path = _ki_doc_path(tmp_repo)
        # Surrogate characters that cannot be encoded to UTF-8
        surrogate_violation = "bad \udcff char"

        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path=path,
            violation=surrogate_violation,
            timestamp="2026-06-02T10:00:00+08:00",
            file="src/main.py",
            phase=4,
        )
        # Should handle gracefully — either succeeds with sanitized content
        # or returns an error
        assert isinstance(result, dict)
        assert "success" in result

    # -----------------------------------------------------------------------
    # 27. Reject path traversal in ki_doc_path
    # -----------------------------------------------------------------------
    def test_should_reject_path_traversal(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path="../../etc/passwd",
            violation="x",
            timestamp="2026-01-01T00:00:00+00:00",
            file="f",
            phase=1,
        )
        assert result["success"] is False
        assert "traversal" in result.get("error", "").lower() or "not allowed" in result.get("error", "").lower()

    # -----------------------------------------------------------------------
    # 28. Reject absolute path outside repo
    # -----------------------------------------------------------------------
    def test_should_reject_absolute_path_outside_repo(self, tmp_repo: Path) -> None:
        from aristotle_mcp._tools_ki_doc import write_ki_doc

        result = write_ki_doc(
            entry_type="intervention",
            ki_doc_path="/etc/passwd",
            violation="x",
            timestamp="2026-01-01T00:00:00+00:00",
            file="f",
            phase=1,
        )
        assert result["success"] is False
