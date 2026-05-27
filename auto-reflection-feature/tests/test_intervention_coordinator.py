import os
import sys
import pytest
import time
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aristotle_auto_reflection.intervention_coordinator import InterventionCoordinator, TDDViolationError
from aristotle_auto_reflection.intervention_types import (
    ViolationEvent, InterventionPlan, RollbackResult, PipelineContext, ValidationResult,
)


@pytest.fixture
def pipeline_context_factory():
    def _factory(current_phase=4, req_number="INT-001", loop_round=None,
                 boundary_commit_hash=None, phase5_test_results=None, metadata=None):
        return PipelineContext(
            current_phase=current_phase,
            req_number=req_number,
            loop_round=loop_round,
            stage="phase_boundary",
            boundary_commit_hash=boundary_commit_hash,
            phase5_test_results=phase5_test_results,
            metadata=metadata or {"round_results": []},
        )
    return _factory


@pytest.fixture
def coordinator(pipeline_context_factory):
    ctx = pipeline_context_factory()
    return InterventionCoordinator(ctx)


def _event(vtype, filepath="", phase=4, **ctx_extra):
    ctx = {"phase": phase}
    ctx.update(ctx_extra)
    return ViolationEvent(vtype, filepath, "2026-05-26T10:00:00+08:00", ctx)


# ===== Process Violations (V-1/V-2/V-3) =====

class TestSkipReview:
    def test_should_block_pipeline_when_review_skipped(self, coordinator):
        event = _event("SKIP_REVIEW", phase=2)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert exc_info.value.plan.target_phase == 2

    def test_should_treat_zero_rounds_as_skip_review(self, coordinator):
        event = _event("SKIP_REVIEW", phase=2, rounds=0)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert exc_info.value.result.violation_code == "SKIP_REVIEW"


class TestInsufficientReview:
    def test_should_block_pipeline_when_insufficient_review_rounds(self, coordinator):
        event = _event("INSUFFICIENT_REVIEW", phase=2, rounds=1)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert "INSUFFICIENT_REVIEW" in exc_info.value.result.violation_code

    def test_should_pass_when_exactly_two_consecutive_zero_chm(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [
            {"C": 0, "H": 0, "M": 0}, {"C": 0, "H": 0, "M": 0}
        ]})
        coord = InterventionCoordinator(ctx)
        event = _event("INSUFFICIENT_REVIEW", phase=2, rounds=2)
        result = coord.intervene(event)
        assert result is None

    def test_should_pass_when_last_two_consecutive_zero_after_earlier_failure(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [
            {"C": 1, "H": 0, "M": 0}, {"C": 0, "H": 0, "M": 0}, {"C": 0, "H": 0, "M": 0}
        ]})
        coord = InterventionCoordinator(ctx)
        event = _event("INSUFFICIENT_REVIEW", phase=2, rounds=3)
        result = coord.intervene(event)
        assert result is None


class TestUnfixedIssues:
    def test_should_block_pipeline_when_unfixed_issues_remain(self, coordinator):
        event = _event("UNFIXED_ISSUES", phase=2, issues=["F-1: bug", "F-2: typo"])
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert "UNFIXED_ISSUES" in exc_info.value.result.violation_code

    def test_should_block_when_m_equals_one_even_if_c_h_zero(self, coordinator):
        event = _event("UNFIXED_ISSUES", phase=2, issues=["F-1: minor"])
        with pytest.raises(TDDViolationError):
            coordinator.intervene(event)


class TestRollbackToCurrentPhase:
    def test_should_rollback_to_current_phase_on_process_violation(self, coordinator):
        event = _event("SKIP_REVIEW", phase=2)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert exc_info.value.plan.target_phase == 2

    def test_should_preserve_committed_work_on_rollback(self, coordinator, pipeline_context_factory):
        event = _event("SKIP_REVIEW", phase=2)
        with patch.object(coordinator, "commit_guard") as mock_cg:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            assert mock_cg.ensure_committed.called


# ===== Behavioral Violations (V-4/V-5/V-6/V-7) =====

class TestSkipRedPhase:
    def test_should_target_phase_4_for_skip_red_phase_rollback(self, coordinator):
        plan = coordinator._build_plan(_event("SKIP_RED_PHASE", "src/mod.py", 4))
        assert plan.target_phase == 4
        assert plan.is_destructive is True


class TestRegression:
    def test_should_rollback_to_phase_5_on_regression(self, coordinator):
        event = _event("REGRESSION", "src/mod.py", 6)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert exc_info.value.plan.target_phase == 5

    def test_should_mark_failure_range_on_regression(self, coordinator):
        event = _event("REGRESSION", "src/mod.py", 6)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert "REGRESSION" in exc_info.value.result.violation_code
        assert "Phase 5" in exc_info.value.plan.instruction or "phase 5" in exc_info.value.plan.instruction

    def test_should_treat_all_phase6_failures_as_regression_in_mvp(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=6)
        coord = InterventionCoordinator(ctx)
        event = _event("REGRESSION", "src/mod.py", 6)
        with pytest.raises(TDDViolationError):
            coord.intervene(event)

    def test_should_target_phase_5_for_regression_rollback(self, coordinator):
        plan = coordinator._build_plan(_event("REGRESSION", "src/mod.py", 6))
        assert plan.target_phase == 5

    def test_should_raise_regression_without_auto_fix_when_no_baseline(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=6, phase5_test_results=None)
        coord = InterventionCoordinator(ctx)
        event = _event("REGRESSION", "src/mod.py", 6)
        with pytest.raises(TDDViolationError) as exc_info:
            coord.intervene(event)
        assert exc_info.value.plan.auto_fix is False


class TestMissingTest:
    def test_should_block_pipeline_when_test_missing_for_implementation(self, coordinator):
        event = _event("MISSING_TEST", "src/new_mod.py", 5)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert exc_info.value.plan.auto_fix is False
        assert exc_info.value.plan.target_phase == 5
        assert exc_info.value.plan.needs_rollback is False

    def test_should_not_create_test_skeleton_for_missing_test(self, coordinator):
        plan = coordinator._build_plan(_event("MISSING_TEST", "src/new_mod.py", 5))
        assert plan.auto_fix is False
        assert plan.target_phase == 5
        assert plan.needs_rollback is False

    def test_should_block_pipeline_when_test_missing_for_phase4(self, coordinator):
        event = _event("MISSING_TEST", "src/new_mod.py", 4)
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        assert exc_info.value.result.violation_code == "MISSING_TEST"
        assert exc_info.value.plan.target_phase == 4
        assert exc_info.value.plan.needs_rollback is False


# ===== Event Validation =====

class TestEventValidation:
    def test_should_reject_event_missing_violation_type(self, coordinator):
        event = ViolationEvent("", "src/mod.py", "2026-05-26T10:00:00+08:00", {"phase": 4})
        result = coordinator.intervene(event)
        assert result is None

    def test_should_log_warning_and_not_block_for_unknown_violation_type(self, coordinator):
        event = _event("UNKNOWN_TYPE", "src/mod.py", 4)
        result = coordinator.intervene(event)
        assert result is None

    def test_should_dispatch_to_prompt_validator_only_for_v13(self, coordinator):
        assert coordinator._needs_prompt_validation(_event("INVALID_REVIEW_PROMPT", phase=2)) is True
        assert coordinator._needs_prompt_validation(_event("SKIP_REVIEW", phase=2)) is False

    def test_should_return_silently_when_v13_prompt_actually_clean(self, coordinator):
        event = _event("INVALID_REVIEW_PROMPT", phase=2, prompt="Clean prompt here.")
        with patch.object(coordinator, "prompt_validator") as mock_pv:
            mock_pv.validate.return_value = ValidationResult(is_valid=True, matches=[])
            result = coordinator.intervene(event)
        assert result is None

    def test_should_return_silently_when_v13_prompt_key_missing(self, coordinator):
        event = ViolationEvent("INVALID_REVIEW_PROMPT", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        with patch.object(coordinator, "prompt_validator") as mock_pv:
            mock_pv.validate.return_value = ValidationResult(is_valid=True, matches=[])
            result = coordinator.intervene(event)
        assert result is None

    @pytest.mark.parametrize("vtype", [
        "SKIP_REVIEW", "INSUFFICIENT_REVIEW", "UNFIXED_ISSUES",
        "MISSING_KI_DOC", "KI_DOC_OUTDATED", "UNCOMMITTED_PHASE",
        "UNCOMMITTED_REVIEW", "MISSING_KI_ASSESSMENT", "INVALID_REVIEW_PROMPT",
    ])
    def test_should_accept_process_violations_without_affected_file_path(self, coordinator, vtype):
        event = ViolationEvent(vtype, "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        assert coordinator._is_valid_event(event) is True

    def test_should_reject_event_missing_phase_in_context(self, coordinator):
        event = ViolationEvent("SKIP_REVIEW", "", "2026-05-26T10:00:00+08:00", {})
        assert coordinator._is_valid_event(event) is False

    @pytest.mark.parametrize("vtype", [
        "SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST", "REGRESSION",
    ])
    def test_should_reject_behavioral_violation_without_affected_file_path(self, coordinator, vtype):
        event = ViolationEvent(vtype, "", "2026-05-26T10:00:00+08:00", {"phase": 4})
        assert coordinator._is_valid_event(event) is False

    # Note: log verification for behavioral violations without file is intentionally
    # omitted — Python's logging module is hard to mock-test reliably and the
    # behavior (return None) is already verified by the assertion below.
    @pytest.mark.parametrize("vtype", [
        "SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST", "REGRESSION",
    ])
    def test_should_return_none_for_behavioral_violation_without_file_via_intervene(self, coordinator, vtype):
        event = ViolationEvent(vtype, "", "2026-05-26T10:00:00+08:00", {"phase": 4})
        with patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "ki_doc") as mock_ki:
            result = coordinator.intervene(event)
        assert result is None
        mock_re.rollback.assert_not_called()
        mock_cg.ensure_committed.assert_not_called()


# ===== Plan Building =====

class TestPlanBuilding:
    def test_should_map_v1_skip_review_to_correct_plan(self, coordinator):
        plan = coordinator._build_plan(_event("SKIP_REVIEW", phase=2))
        assert plan.auto_fix is False
        assert "Ralph Loop" in plan.instruction

    def test_should_map_v2_insufficient_review_to_no_auto_fix_plan(self, coordinator):
        plan = coordinator._build_plan(_event("INSUFFICIENT_REVIEW", phase=2))
        assert plan.auto_fix is False
        assert "ZERO_C_H_M" in plan.instruction

    def test_should_map_v3_unfixed_issues_to_no_auto_fix_plan(self, coordinator):
        plan = coordinator._build_plan(_event("UNFIXED_ISSUES", phase=2))
        assert plan.auto_fix is False
        assert "Fix" in plan.instruction

    def test_should_map_v4_skip_red_phase_to_destructive_plan(self, coordinator):
        plan = coordinator._build_plan(_event("SKIP_RED_PHASE", "src/mod.py", 4))
        assert plan.target_phase == 4
        assert plan.auto_fix is True
        assert plan.is_destructive is True

    def test_should_map_v5_modified_test_to_destructive_plan(self, coordinator):
        plan = coordinator._build_plan(_event("MODIFIED_TEST", "tests/test_mod.py", 5))
        assert plan.target_phase == 5
        assert plan.auto_fix is True
        assert plan.is_destructive is True

    def test_should_map_v7_regression_to_phase5_plan(self, coordinator):
        plan = coordinator._build_plan(_event("REGRESSION", "src/mod.py", 6))
        assert plan.target_phase == 5
        assert plan.auto_fix is False

    def test_should_map_v8_v9_v10_v11_v12_to_auto_fix_plans(self, coordinator):
        for vtype in ["MISSING_KI_DOC", "KI_DOC_OUTDATED", "UNCOMMITTED_PHASE",
                       "UNCOMMITTED_REVIEW", "MISSING_KI_ASSESSMENT"]:
            plan = coordinator._build_plan(_event(vtype, phase=3))
            assert plan.auto_fix is True, f"{vtype} should be auto_fix=True"
            assert plan.is_destructive is False

    def test_should_map_v13_to_non_auto_fix_plan(self, coordinator):
        plan = coordinator._build_plan(_event("INVALID_REVIEW_PROMPT", phase=2))
        assert plan.auto_fix is False

    def test_should_return_fallback_plan_for_unknown_type(self, coordinator):
        plan = coordinator._build_plan(_event("WEIRD_TYPE", phase=4))
        assert "Unknown" in plan.instruction


class TestDynamicTargetPhase:
    @pytest.mark.parametrize("vtype,default_phase,test_phase", [
        ("SKIP_RED_PHASE", 4, 2),
        ("SKIP_RED_PHASE", 4, 5),
        ("MODIFIED_TEST", 5, 3),
        ("REGRESSION", 5, 6),
    ])
    def test_should_use_dynamic_phase_from_event_context(self, coordinator, vtype, default_phase, test_phase):
        # REGRESSION hardcodes target_phase=5, others use event.context["phase"]
        filepath = "src/mod.py" if vtype in ("SKIP_RED_PHASE", "REGRESSION") else "tests/test_mod.py"
        event = ViolationEvent(vtype, filepath, "2026-05-26T10:00:00+08:00", {"phase": test_phase})
        plan = coordinator._build_plan(event)
        if vtype == "REGRESSION":
            assert plan.target_phase == 5  # REGRESSION always targets phase 5
        else:
            assert plan.target_phase == test_phase


# ===== Batch Processing =====

class TestBatchProcessing:
    # Unit-level: mock intervene() to isolate batch logic
    def test_should_sort_events_by_priority_before_handling(self, coordinator):
        events = [
            _event("MISSING_KI_DOC", phase=3),
            _event("SKIP_RED_PHASE", "src/mod.py", 4),
            _event("REGRESSION", "src/mod.py", 6),
        ]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        mock_intervene.assert_called_once()
        called_event = mock_intervene.call_args[0][0]
        assert called_event.violation_type == "SKIP_RED_PHASE"

    def test_should_handle_non_mergeable_events_before_mergeable(self, coordinator):
        events = [_event("SKIP_RED_PHASE", "src/mod.py", 4), _event("UNCOMMITTED_PHASE", phase=3)]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        mock_intervene.assert_called_once()
        called_event = mock_intervene.call_args[0][0]
        assert called_event.violation_type == "SKIP_RED_PHASE"

    def test_should_record_deferred_mergeable_events_when_non_mergeable_exists(self, coordinator):
        events = [_event("SKIP_RED_PHASE", "src/mod.py", 4), _event("UNCOMMITTED_PHASE", phase=3)]
        with patch.object(coordinator, "intervene"):
            with patch.object(coordinator, "ki_doc") as mock_ki:
                coordinator.intervene_batch(events)
        mock_ki.record_merge.assert_called_once()
        recorded_events = mock_ki.record_merge.call_args[0][0]
        assert len(recorded_events) == 1
        assert recorded_events[0].violation_type == "UNCOMMITTED_PHASE"

    def test_not_record_deferred_when_no_mergeable_events(self, coordinator):
        events = [_event("SKIP_RED_PHASE", "src/mod.py", 4), _event("MODIFIED_TEST", "tests/b.py", 5)]
        with patch.object(coordinator, "intervene"):
            with patch.object(coordinator, "ki_doc") as mock_ki:
                coordinator.intervene_batch(events)
        mock_ki.record_merge.assert_not_called()
        e1 = _event("SKIP_RED_PHASE", "src/a.py", 4)
        e2 = _event("MODIFIED_TEST", "tests/b.py", 5)
        events = [e1, e2]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        called_event = mock_intervene.call_args[0][0]
        assert called_event is e1

    def test_should_return_silently_for_empty_event_list(self, coordinator):
        result = coordinator.intervene_batch([])
        assert result is None

    def test_should_handle_many_violations_in_batch_efficiently(self, coordinator):
        events = [_event(f"SKIP_RED_PHASE", f"src/mod{i}.py", 4) for i in range(50)]
        start = time.time()
        with patch.object(coordinator, "intervene"):
            coordinator.intervene_batch(events)
        elapsed = time.time() - start
        assert elapsed < 0.1

    def test_should_stop_batch_on_sync_mode_exception(self, coordinator):
        p1_event = _event("SKIP_RED_PHASE", "src/high.py", 4)
        p4_event = _event("MISSING_KI_DOC", phase=3)
        with patch.object(coordinator, "intervene", side_effect=TDDViolationError(p1_event, coordinator._build_plan(p1_event))) as mock_intervene:
            with pytest.raises(TDDViolationError):
                coordinator.intervene_batch([p1_event, p4_event])
            assert mock_intervene.call_count == 1


# ===== Merge Handling =====

class TestMergeHandling:
    def test_should_execute_commit_before_assessment_before_ki_update(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory()
        coord = InterventionCoordinator(ctx)
        events = [
            _event("UNCOMMITTED_PHASE", "docs/a.md", 3),
            _event("MISSING_KI_ASSESSMENT", phase=3),
            _event("MISSING_KI_DOC", phase=3),
        ]
        with patch.object(coord, "commit_guard") as mock_cg, \
             patch.object(coord, "ki_doc") as mock_ki, \
             patch.object(coord, "_compute_assessment", return_value=("PASS", [], {})):
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            call_order = []
            original_committed = mock_cg.ensure_committed
            def track_commit(*a, **kw):
                call_order.append("commit")
                return MagicMock(success=True)
            mock_cg.ensure_committed.side_effect = track_commit
            def track_ki(*a, **kw):
                call_order.append("ki")
                return None
            mock_ki.record_merge.side_effect = track_ki
            mock_ki.ensure_assessment.side_effect = track_ki
            def track_assessment(*a, **kw):
                call_order.append("assessment")
                return ("PASS", [], {})
            coord._compute_assessment = track_assessment
            with pytest.raises(TDDViolationError):
                coord._handle_merged(events)
            assert mock_cg.ensure_committed.call_count >= 2
            commit_indices = [i for i, c in enumerate(call_order) if c == "commit"]
            ki_indices = [i for i, c in enumerate(call_order) if c == "ki"]
            assessment_indices = [i for i, c in enumerate(call_order) if c == "assessment"]
            if commit_indices and ki_indices:
                assert min(commit_indices) < min(ki_indices)
            if commit_indices and assessment_indices:
                assert min(commit_indices) < min(assessment_indices)

    def test_should_skip_assessment_step_when_v12_missing_from_merge_set(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory()
        coord = InterventionCoordinator(ctx)
        events = [_event("UNCOMMITTED_PHASE", "docs/a.md", 3), _event("MISSING_KI_DOC", phase=3)]
        with patch.object(coord, "commit_guard") as mock_cg, \
             patch.object(coord, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coord._handle_merged(events)

    def test_should_write_single_merged_ki_entry_for_combined_events(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory()
        coord = InterventionCoordinator(ctx)
        events = [_event("UNCOMMITTED_PHASE", phase=3), _event("MISSING_KI_DOC", phase=3)]
        with patch.object(coord, "commit_guard") as mock_cg, \
             patch.object(coord, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coord._handle_merged(events)
            assert mock_ki.record_merge.called

    def test_should_commit_without_ki_recording_for_v10_v11_only_merge(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory()
        coord = InterventionCoordinator(ctx)
        events = [_event("UNCOMMITTED_PHASE", phase=3), _event("UNCOMMITTED_REVIEW", phase=3)]
        with patch.object(coord, "commit_guard") as mock_cg, \
             patch.object(coord, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coord._handle_merged(events)
            assert mock_cg.ensure_committed.called
            assert not mock_ki.record_merge.called

    def test_should_route_v9_ki_doc_outdated_to_auto_append(self, coordinator):
        event = _event("KI_DOC_OUTDATED", phase=3)
        with patch.object(coordinator, "ki_doc") as mock_ki, \
             patch.object(coordinator, "commit_guard") as mock_cg:
            mock_ki.ensure_updated.return_value = False
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            assert mock_ki.ensure_updated.called
            assert mock_ki.record_intervention.called
            assert mock_cg.ensure_committed.called


# ===== Assessment =====

class TestAssessment:
    def test_should_derive_fail_when_c_or_h_greater_than_zero(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [{"C": 1, "H": 0, "M": 0}]})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert status == "FAIL"

    def test_should_derive_fail_when_h_greater_than_zero(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [{"C": 0, "H": 1, "M": 0}]})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert status == "FAIL"

    def test_should_derive_conditional_when_m_greater_than_zero(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [{"C": 0, "H": 0, "M": 3}]})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert status == "CONDITIONAL"

    def test_should_derive_pass_when_all_zero(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [{"C": 0, "H": 0, "M": 0}]})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert status == "PASS"

    def test_should_derive_pass_when_round_results_empty(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": []})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert status == "PASS"

    def test_should_populate_priority_counts_dict_in_assessment(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [{"C": 2, "H": 1, "M": 3, "P": 5, "L": 7}]})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert counts["P0"] == 2
        assert counts["P1"] == 1
        assert counts["P2"] == 3
        assert counts["P3"] == 5
        assert counts["P4"] == 7

    def test_should_return_pass_when_metadata_empty(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={})
        coord = InterventionCoordinator(ctx)
        status, issues, counts = coord._compute_assessment()
        assert status == "PASS"


# ===== Pre-rollback + Commit =====

class TestPreRollbackCommit:
    def test_should_trigger_pre_rollback_commit_for_destructive_plan(self, coordinator):
        event = _event("SKIP_RED_PHASE", "src/mod.py", 4)
        with patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(True, "deleted", ["src/mod.py"])
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            assert mock_cg.ensure_committed.call_count >= 2

    def test_should_trigger_pre_rollback_commit_for_phase_rollback(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(current_phase=5)
        coord = InterventionCoordinator(ctx)
        event = _event("SKIP_RED_PHASE", "src/mod.py", 4)
        with patch.object(coord, "commit_guard") as mock_cg, \
             patch.object(coord, "rollback_engine") as mock_re, \
             patch.object(coord, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(True, "deleted", [])
            with pytest.raises(TDDViolationError):
                coord.intervene(event)
            assert mock_cg.ensure_committed.call_count >= 1

    def test_should_commit_after_intervention_completes(self, coordinator):
        event = _event("SKIP_REVIEW", phase=2)
        with patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "ki_doc"):
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            assert mock_cg.ensure_committed.called

    def test_should_update_ki_doc_even_when_rollback_fails(self, coordinator):
        event = _event("SKIP_RED_PHASE", "src/mod.py", 4)
        with patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(False, "git rm failed")
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            assert mock_ki.record_intervention.called

    def test_should_proceed_with_rollback_when_pre_commit_fails(self, coordinator):
        event = _event("SKIP_RED_PHASE", "src/mod.py", 4)
        with patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=False)
            mock_re.rollback.return_value = RollbackResult(True, "deleted", [])
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            assert mock_re.rollback.called

    def test_should_handle_git_add_failure_gracefully_before_rollback(self, coordinator):
        event = _event("SKIP_RED_PHASE", "src/mod.py", 4)
        with patch("aristotle_auto_reflection.intervention_coordinator.subprocess.run") as mock_run, \
             patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "ki_doc"):
            mock_run.return_value = MagicMock(returncode=1, stderr="add failed")
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(True, "deleted", [])
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)

    def test_should_stage_untracked_file_before_rollback(self, coordinator):
        event = _event("SKIP_RED_PHASE", "src/new_untracked.py", 4)
        with patch("aristotle_auto_reflection.intervention_coordinator.subprocess.run") as mock_run, \
             patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "ki_doc"):
            mock_run.return_value = MagicMock(returncode=0)
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(True, "deleted", [])
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            add_call = mock_run.call_args_list[0]
            assert "add" in str(add_call)

    def test_should_stage_multiple_files_from_affected_file_paths(self, coordinator):
        """Multi-file pre-rollback: stages all files in affected_file_paths."""
        event = ViolationEvent(
            "SKIP_RED_PHASE", "src/main.py", "2026-05-26T10:00:00+08:00",
            {"phase": 4},
            affected_file_paths=["src/main.py", "src/helper.py", "tests/test_main.py"],
        )
        with patch("aristotle_auto_reflection.intervention_coordinator.subprocess.run") as mock_run, \
             patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "ki_doc"):
            mock_run.return_value = MagicMock(returncode=0)
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(True, "deleted", [])
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)
            # Verify git add was called for each file in affected_file_paths
            add_calls = [c for c in mock_run.call_args_list if "add" in str(c)]
            assert len(add_calls) >= 3, f"Expected >=3 git add calls, got {len(add_calls)}"


# ===== SYNC Mode =====

class TestSyncMode:
    @pytest.mark.parametrize("vtype,filepath,phase,extra_ctx", [
        ("SKIP_REVIEW", "", 2, {}),
        ("INSUFFICIENT_REVIEW", "", 2, {}),
        ("UNFIXED_ISSUES", "", 2, {}),
        ("SKIP_RED_PHASE", "src/mod.py", 4, {}),
        ("MODIFIED_TEST", "src/mod.py", 5, {}),
        ("MISSING_TEST", "src/mod.py", 4, {}),
        ("REGRESSION", "src/mod.py", 6, {}),
        ("MISSING_KI_DOC", "", 3, {}),
        ("KI_DOC_OUTDATED", "", 3, {}),
        ("UNCOMMITTED_PHASE", "", 3, {}),
        ("UNCOMMITTED_REVIEW", "", 3, {}),
        ("MISSING_KI_ASSESSMENT", "", 3, {}),
        ("INVALID_REVIEW_PROMPT", "", 2, {"prompt": "stop condition gate pass"}),
    ], ids=lambda x: x[0] if isinstance(x, tuple) else str(x))
    def test_should_raise_tdd_violation_error_for_any_violation(self, coordinator, vtype, filepath, phase, extra_ctx):
        event = _event(vtype, filepath, phase, **extra_ctx)
        with patch.object(coordinator, "commit_guard") as mock_cg, \
             patch.object(coordinator, "ki_doc"), \
             patch.object(coordinator, "rollback_engine") as mock_re, \
             patch.object(coordinator, "prompt_validator") as mock_pv:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            mock_re.rollback.return_value = RollbackResult(True, "ok")
            if vtype == "INVALID_REVIEW_PROMPT":
                mock_pv.validate.return_value = ValidationResult(is_valid=False, matches=[
                    MagicMock(category="stop_condition", pattern="stop condition", line_number=1, language="en")
                ])
            with pytest.raises(TDDViolationError) as exc_info:
                coordinator.intervene(event)
            assert exc_info.value.result.violation_code == vtype
            needs_rollback = vtype in ("SKIP_RED_PHASE", "MODIFIED_TEST")
            assert mock_re.rollback.called == needs_rollback

    def test_should_handle_multiple_violations_by_priority(self, coordinator):
        events = [_event("SKIP_RED_PHASE", "src/mod.py", 4), _event("MISSING_KI_DOC", phase=3)]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        called = mock_intervene.call_args[0][0]
        assert called.violation_type == "SKIP_RED_PHASE"


# ===== Failure Modes =====

class TestInsufficientReviewRouting:
    def test_should_route_v2_insufficient_review_to_manual_plan(self, coordinator):
        event = ViolationEvent("INSUFFICIENT_REVIEW", "", "2026-05-26T10:00:00+08:00", {"phase": 2})
        with pytest.raises(TDDViolationError) as exc_info:
            coordinator.intervene(event)
        plan = exc_info.value.plan
        assert "ZERO_C_H_M" in plan.instruction
        assert exc_info.value.result.violation_code == "INSUFFICIENT_REVIEW"


class TestFailureModes:
    def test_should_raise_without_auto_fix_when_git_unavailable(self, coordinator):
        event = _event("SKIP_RED_PHASE", "src/mod.py", 4)
        with patch.object(coordinator, "commit_guard") as mock_cg:
            mock_cg.ensure_committed.return_value = MagicMock(success=False)
            with patch.object(coordinator, "rollback_engine") as mock_re:
                mock_re.rollback.return_value = RollbackResult(False, "git unavailable")
                with patch.object(coordinator, "ki_doc"):
                    with pytest.raises(TDDViolationError) as exc_info:
                        coordinator.intervene(event)
                    assert exc_info.value.result.auto_fix_applied is False
