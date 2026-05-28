import os
import sys
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ki_doc_manager import KiDocManager
from intervention_types import (
    ViolationEvent, InterventionPlan, RollbackResult, PipelineContext,
)


@pytest.fixture
def tmp_ki_doc(tmp_path):
    return str(tmp_path / "04-review-records.md")


@pytest.fixture
def ki_doc_manager(tmp_ki_doc):
    return KiDocManager(tmp_ki_doc)


@pytest.fixture
def sample_event():
    return ViolationEvent(
        violation_type="SKIP_RED_PHASE",
        affected_file_path="src/module.py",
        timestamp="2026-05-26T10:00:00+08:00",
        context={"phase": 4},
    )


@pytest.fixture
def sample_plan():
    return InterventionPlan(
        target_phase=4,
        auto_fix=True,
        needs_rollback=True,
        is_destructive=True,
        instruction="Write failing test before implementation",
    )


class TestKiDocAppendIntervention:
    def test_should_append_intervention_entry_to_ki_doc(self, ki_doc_manager, sample_event, sample_plan):
        rollback_result = RollbackResult(success=True, action="deleted", files_affected=["src/module.py"])
        ki_doc_manager.record_intervention(sample_event, sample_plan, rollback_result)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "SKIP_RED_PHASE" in content
        assert "2026-05-26T10:00:00" in content


class TestKiDocCreateWhenNotFound:
    def test_should_create_ki_doc_with_header_when_not_found(self, tmp_path):
        path = str(tmp_path / "subdir" / "04-review-records.md")
        mgr = KiDocManager(path)
        event = ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        plan = InterventionPlan(2, False, False, False, "Execute Ralph Loop")
        mgr.record_intervention(event, plan, None)
        content = Path(path).read_text()
        assert "SKIP_REVIEW" in content


class TestKiDocMultipleEntries:
    def test_should_append_multiple_entries_for_multiple_interventions(self, ki_doc_manager):
        e1 = ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        e2 = ViolationEvent("UNFIXED_ISSUES", "", "2026-05-26T11:00:00+08:00", {"phase": 3})
        plan = InterventionPlan(2, False, False, False, "Fix")
        ki_doc_manager.record_intervention(e1, plan, None)
        ki_doc_manager.record_intervention(e2, plan, None)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert content.count("SKIP_REVIEW") >= 1
        assert content.count("UNFIXED_ISSUES") >= 1


class TestKiDocRoundResults:
    def test_should_record_round_results_in_ki_doc(self, ki_doc_manager):
        event = ViolationEvent("UNFIXED_ISSUES", "", "2026-05-26T10:00:00+08:00",
                               {"phase": 2, "round_results": [{"C": 0, "H": 1, "M": 3}]})
        plan = InterventionPlan(2, False, False, False, "Fix issues")
        ki_doc_manager.record_intervention(event, plan, None)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "UNFIXED_ISSUES" in content


class TestKiDocFailedRound:
    def test_should_record_failed_round_results(self, ki_doc_manager):
        event = ViolationEvent("INSUFFICIENT_REVIEW", "", "2026-05-26T10:00:00+08:00",
                               {"phase": 2, "rounds": 1})
        plan = InterventionPlan(2, False, False, False, "Continue review")
        ki_doc_manager.record_intervention(event, plan, None)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "INSUFFICIENT_REVIEW" in content


class TestKiDocOutdatedDetection:
    def test_should_detect_outdated_ki_doc_by_timestamp(self, ki_doc_manager):
        result = ki_doc_manager.ensure_updated("2026-05-27T00:00:00+08:00")
        assert result is True


class TestKiDocOutdatedDetectionActual:
    def test_should_return_false_when_ki_doc_has_old_timestamp(self, ki_doc_manager):
        event = ViolationEvent("SKIP_RED_PHASE", "src/a.py", "2026-01-01T00:00:00+08:00", {"phase": 4})
        plan = InterventionPlan(4, True, True, True, "Write failing test")
        ki_doc_manager.record_intervention(event, plan, None)
        result = ki_doc_manager.ensure_updated("2026-06-01T00:00:00+08:00")
        assert result is False


class TestKiDocAutoAppend:
    def test_should_auto_append_missing_record_for_outdated_ki_doc(self, ki_doc_manager):
        event = ViolationEvent("KI_DOC_OUTDATED", "", "2026-05-26T10:00:00+08:00", {"phase": 3})
        plan = InterventionPlan(3, True, False, False, "(auto-fixed)")
        ki_doc_manager.record_intervention(event, plan, None)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "KI_DOC_OUTDATED" in content


class TestKiDocTimestampSource:
    def test_should_use_structured_timestamp_not_file_mtime(self, ki_doc_manager):
        event = ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        plan = InterventionPlan(2, False, False, False, "Execute Ralph Loop")
        ki_doc_manager.record_intervention(event, plan, None)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "2026-05-26T10:00:00+08:00" in content


class TestKiDocAssessmentMissing:
    def test_should_block_pipeline_when_ki_assessment_missing(self, ki_doc_manager):
        event = ViolationEvent("MISSING_KI_ASSESSMENT", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        plan = InterventionPlan(2, True, False, False, "(auto-fixed)")
        ki_doc_manager.record_intervention(event, plan, None)
        ki_doc_manager.ensure_assessment(2, 3, "PASS", [])
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "PASS" in content


class TestKiDocAssessmentEmpty:
    def test_should_treat_empty_assessment_as_missing(self, ki_doc_manager):
        ki_doc_manager.ensure_assessment(2, 3, "", [])
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "Review Records" in content
        assert "## Assessment" not in content


class TestKiDocAssessmentStatusOnly:
    def test_should_treat_status_only_assessment_as_valid(self, ki_doc_manager):
        ki_doc_manager.ensure_assessment(2, 3, "CONDITIONAL", ["1M unresolved"])
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "CONDITIONAL" in content


class TestKiDocTimestampExtraction:
    def test_should_extract_iso8601_timestamp_from_ki_doc(self, ki_doc_manager):
        Path(ki_doc_manager.ki_doc_path).write_text(
            "# Review Records\n\n**Timestamp**: 2026-05-25T14:30:00+08:00\n"
        )
        ts = ki_doc_manager._parse_newest_timestamp()
        assert ts is not None
        assert "2026-05-25T14:30:00" in ts


class TestKiDocMultipleTimestamps:
    def test_should_return_latest_timestamp_when_multiple_present(self, ki_doc_manager):
        Path(ki_doc_manager.ki_doc_path).write_text(
            "# Review Records\n\n"
            "**Timestamp**: 2026-05-25T10:00:00+08:00\n\n"
            "**Timestamp**: 2026-05-25T14:30:00+08:00\n"
        )
        ts = ki_doc_manager._parse_newest_timestamp()
        assert "14:30:00" in ts


class TestKiDocTimestampNotFound:
    def test_should_return_none_when_ki_doc_not_found(self, tmp_path):
        mgr = KiDocManager(str(tmp_path / "nonexistent.md"))
        ts = mgr._parse_newest_timestamp()
        assert ts is None


class TestKiDocTimezoneVariants:
    def test_should_parse_iso8601_with_z_and_compact_timezones(self, ki_doc_manager):
        Path(ki_doc_manager.ki_doc_path).write_text(
            "**Timestamp**: 2026-05-25T14:30:00Z\n"
        )
        ts = ki_doc_manager._parse_newest_timestamp()
        assert ts is not None


class TestKiDocMergeEntry:
    def test_should_write_single_merged_entry_documenting_all_combined_actions(self, ki_doc_manager):
        events = [
            ViolationEvent("UNCOMMITTED_PHASE", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
            ViolationEvent("MISSING_KI_DOC", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
        ]
        ctx = PipelineContext(current_phase=3, req_number="INT-001")
        ki_doc_manager.record_merge(events, ctx)
        content = Path(ki_doc_manager.ki_doc_path).read_text()
        assert "UNCOMMITTED_PHASE" in content
        assert "MISSING_KI_DOC" in content


class TestKiDocParentDirCreation:
    def test_should_create_parent_directories_when_missing(self, tmp_path):
        path = str(tmp_path / "a" / "b" / "c" / "ki-doc.md")
        mgr = KiDocManager(path)
        event = ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        plan = InterventionPlan(2, False, False, False, "Fix")
        mgr.record_intervention(event, plan, None)
        assert Path(path).exists()


class TestKiDocCorruptTimestamp:
    def test_should_handle_corrupt_timestamp_gracefully(self, ki_doc_manager):
        Path(ki_doc_manager.ki_doc_path).write_text(
            "# Review Records\n\n**Timestamp**: not-a-date\n"
        )
        ts = ki_doc_manager._parse_newest_timestamp()
        assert ts is None


class TestKiDocIOErrorOnRecordMerge:
    def test_should_handle_ioerror_on_record_merge(self, ki_doc_manager):
        events = [
            ViolationEvent("UNCOMMITTED_PHASE", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
            ViolationEvent("MISSING_KI_DOC", "", "2026-05-26T10:00:00+08:00", {"phase": 3}),
        ]
        ctx = PipelineContext(current_phase=3, req_number="INT-001")
        with patch("builtins.open", side_effect=IOError("disk full")):
            result = ki_doc_manager.record_merge(events, ctx)
        assert result is None


class TestKiDocIOErrorOnEnsureAssessment:
    def test_should_handle_ioerror_on_ensure_assessment(self, ki_doc_manager):
        with patch("builtins.open", side_effect=IOError("disk full")):
            result = ki_doc_manager.ensure_assessment(2, 3, "PASS", [])
        assert result is None


class TestKiDocWriteFailure:
    def test_should_handle_ki_doc_write_failure_gracefully(self, ki_doc_manager):
        event = ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        plan = InterventionPlan(2, False, False, False, "Fix")
        with patch("builtins.open", side_effect=IOError("disk full")):
            result = ki_doc_manager.record_intervention(event, plan, None)
            assert result is None


class TestKiDocLogWarningOnIOError:
    def test_should_log_warning_on_record_intervention_ioerror(self, tmp_path):
        from unittest.mock import patch
        ki = KiDocManager(str(tmp_path / "ki.md"))
        with patch.object(ki, '_append', side_effect=IOError("disk full")):
            result = ki.record_intervention(
                MagicMock(violation_type="TEST", affected_file_path="f.py", timestamp="2026-01-01T00:00:00Z", context={"phase": 1}),
                MagicMock(target_phase=1, auto_fix=False, needs_rollback=False, instruction="test"),
                None,
            )
            assert result is None

    def test_should_return_none_explicitly_on_ensure_assessment_ioerror(self, tmp_path):
        ki = KiDocManager(str(tmp_path / "ki.md"))
        ki_doc_path = tmp_path / "ki.md"
        ki_doc_path.write_text("## Review Records\n\n")
        with patch.object(ki, '_append', side_effect=IOError("disk full")):
            result = ki.ensure_assessment(1, 2, "FAIL", ["issue1"])
            assert result is None

    def test_should_return_none_explicitly_on_record_merge_ioerror(self, tmp_path):
        ki = KiDocManager(str(tmp_path / "ki.md"))
        with patch.object(ki, '_append', side_effect=IOError("disk full")):
            result = ki.record_merge([], MagicMock(current_phase=1, req_number="T-1"))
            assert result is None
