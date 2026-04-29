"""Tests for aristotle_mcp.server — persist_draft, reflection records (create + complete)."""

from __future__ import annotations

import json
from pathlib import Path


class TestPersistDraft:
    def test_persist_draft_creates_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        result = persist_draft(sequence=1, content="# Test DRAFT")
        assert result["success"] is True
        assert "rec_1.md" in result["file_path"]
        content = Path(result["file_path"]).read_text()
        assert content == "# Test DRAFT"

    def test_persist_draft_overwrite(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        persist_draft(sequence=1, content="# Original")
        result = persist_draft(sequence=1, content="# Updated")
        assert result["success"] is True
        assert Path(result["file_path"]).read_text() == "# Updated"

    def test_persist_draft_creates_directory(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        result = persist_draft(sequence=1, content="# Test")
        assert result["success"] is True
        drafts_dir = tmp_path / "repo" / ".." / "aristotle-drafts"
        assert drafts_dir.resolve().exists()

    def test_persist_draft_atomic_write(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import persist_draft

        persist_draft(sequence=1, content="# Test")
        drafts_dir = (tmp_path / "repo").parent / "aristotle-drafts"
        tmp_files = list(drafts_dir.glob("*.tmp"))
        assert len(tmp_files) == 0


class TestCreateReflectionRecord:
    def test_create_first_record(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        result = create_reflection_record(
            target_session_id="ses_current",
            target_label="current",
            reflector_session_id="ses_reflector_001",
        )

        assert result["success"] is True
        assert result["id"] == "rec_1"
        assert result["sequence"] == 1
        assert result["review_index"] == 1
        assert result["total_records"] == 1

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1

        record = records[0]
        assert record["target_session_id"] == "ses_current"
        assert record["target_label"] == "current"
        assert record["reflector_session_id"] == "ses_reflector_001"
        assert record["status"] == "processing"
        assert record["rules_count"] is None
        assert "launched_at" in record
        assert "aristotle-drafts/rec_1.md" in record["draft_file_path"]

    def test_create_multiple_records_sequential_ids(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        r1 = create_reflection_record("ses_1", "session 1", "ref_1")
        r2 = create_reflection_record("ses_2", "session 2", "ref_2")
        r3 = create_reflection_record("ses_3", "session 3", "ref_3")

        assert r1["id"] == "rec_1"
        assert r1["sequence"] == 1
        assert r1["review_index"] == 1

        assert r2["id"] == "rec_2"
        assert r2["sequence"] == 2
        assert r2["review_index"] == 2

        assert r3["id"] == "rec_3"
        assert r3["sequence"] == 3
        assert r3["review_index"] == 3

        assert r3["total_records"] == 3

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 3
        assert [r["id"] for r in records] == ["rec_1", "rec_2", "rec_3"]

    def test_create_state_file_corrupted_recovers(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        state_path = tmp_path / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text("not valid json {{")

        result = create_reflection_record("ses_1", "test", "ref_1")
        assert result["success"] is True
        assert result["id"] == "rec_1"

        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1
        assert records[0]["id"] == "rec_1"

    def test_create_state_file_not_json_array_recovers(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        state_path = tmp_path / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text('{"key": "value"}')

        result = create_reflection_record("ses_1", "test", "ref_1")
        assert result["success"] is True
        assert result["id"] == "rec_1"

        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1
        assert records[0]["id"] == "rec_1"

    def test_pruning_at_50_records(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        for i in range(51):
            result = create_reflection_record(
                target_session_id=f"ses_{i}",
                target_label=f"label_{i}",
                reflector_session_id=f"ref_{i}",
            )

        assert result["total_records"] == 50

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 50

        record_ids = [r["id"] for r in records]
        assert "rec_1" not in record_ids
        assert record_ids[0] == "rec_2"
        assert record_ids[-1] == "rec_51"

    def test_pruning_deletes_old_draft_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        r1 = create_reflection_record("ses_1", "test", "ref_1")
        draft_path_1 = Path(r1["draft_file_path"])

        draft_path_1.parent.mkdir(parents=True, exist_ok=True)
        draft_path_1.write_text("# DRAFT content for rec_1")
        assert draft_path_1.exists()

        for i in range(2, 52):
            create_reflection_record(f"ses_{i}", f"label_{i}", f"ref_{i}")

        assert not draft_path_1.exists()

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 50

    def test_pruning_skips_missing_draft_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        r1 = create_reflection_record("ses_1", "test", "ref_1")
        draft_path_1 = Path(r1["draft_file_path"])
        assert not draft_path_1.exists()

        for i in range(2, 52):
            create_reflection_record(f"ses_{i}", f"label_{i}", f"ref_{i}")

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 50

    def test_review_index_correct_after_pruning(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        for i in range(1, 52):
            result = create_reflection_record(
                target_session_id=f"ses_{i}",
                target_label=f"label_{i}",
                reflector_session_id=f"ref_{i}",
            )

        assert result["id"] == "rec_51"
        assert result["review_index"] == 50
        assert result["total_records"] == 50

    def test_draft_file_path_format(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import create_reflection_record

        result = create_reflection_record("ses_1", "test", "ref_1")

        assert result["draft_file_path"].endswith("aristotle-drafts/rec_1.md")


class TestCompleteReflectionRecord:
    def test_complete_updates_status(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")

        result = complete_reflection_record(
            sequence=1, status="auto_committed", rules_count=3
        )

        assert result["success"] is True
        assert "auto_committed" in result["message"]

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert len(records) == 1

        record = records[0]
        assert record["status"] == "auto_committed"
        assert record["rules_count"] == 3
        assert "completed_at" in record

    def test_complete_partial_commit(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(
            sequence=1, status="partial_commit", rules_count=1
        )

        assert result["success"] is True

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "partial_commit"
        assert records[0]["rules_count"] == 1

    def test_complete_checker_failed(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(
            sequence=1, status="checker_failed", rules_count=0
        )

        assert result["success"] is True

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "checker_failed"
        assert records[0]["rules_count"] == 0

    def test_complete_without_rules_count(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(sequence=1, status="auto_committed")

        assert result["success"] is True

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        assert records[0]["status"] == "auto_committed"
        assert records[0]["rules_count"] is None

    def test_complete_nonexistent_record(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test", "ref_1")
        result = complete_reflection_record(sequence=99, status="auto_committed")

        assert result["success"] is False
        assert "not found" in result["message"]

    def test_complete_no_state_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import complete_reflection_record

        result = complete_reflection_record(sequence=1, status="auto_committed")

        assert result["success"] is False
        assert "not found" in result["message"]

    def test_complete_corrupted_state_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import complete_reflection_record

        state_path = tmp_path / "aristotle-state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text("corrupted {{")

        result = complete_reflection_record(sequence=1, status="auto_committed")

        assert result["success"] is False
        assert "corrupted" in result["message"]

    def test_complete_multiple_records_only_updates_target(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path / "repo"))
        from aristotle_mcp.server import (
            complete_reflection_record,
            create_reflection_record,
        )

        create_reflection_record("ses_1", "test1", "ref_1")
        create_reflection_record("ses_2", "test2", "ref_2")
        create_reflection_record("ses_3", "test3", "ref_3")

        result = complete_reflection_record(
            sequence=2, status="auto_committed", rules_count=3
        )

        assert result["success"] is True

        state_path = tmp_path / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))

        assert records[0]["status"] == "processing"
        assert records[1]["status"] == "auto_committed"
        assert records[1]["rules_count"] == 3
        assert records[2]["status"] == "processing"
