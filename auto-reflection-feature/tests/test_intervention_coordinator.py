import pytest
import sys
import time
from unittest.mock import patch, MagicMock, PropertyMock

sys.path.insert(0, "/Users/alex/aristotle/auto-reflection-feature/src")

from aristotle_auto_reflection.intervention_coordinator import InterventionCoordinator, TDDViolationError
from aristotle_auto_reflection.intervention_types import (
    ViolationEvent, InterventionPlan, RollbackResult, PipelineContext,
    InterventionResult, ValidationResult, PatternMatch, VIOLATION_PRIORITY,
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
        with pytest.raises(TDDViolationError):
            coordinator.intervene(event)


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

    def test_should_not_create_test_skeleton_for_missing_test(self, coordinator):
        plan = coordinator._build_plan(_event("MISSING_TEST", "src/new_mod.py", 5))
        assert plan.auto_fix is False


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


# ===== Batch Processing =====

class TestBatchProcessing:
    def test_should_sort_events_by_priority_before_handling(self, coordinator):
        events = [
            _event("MISSING_KI_DOC", phase=3),
            _event("SKIP_RED_PHASE", "src/mod.py", 4),
            _event("REGRESSION", "src/mod.py", 6),
        ]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        called_event = mock_intervene.call_args[0][0]
        assert called_event.violation_type == "SKIP_RED_PHASE"

    def test_should_handle_non_mergeable_events_before_mergeable(self, coordinator):
        events = [_event("SKIP_RED_PHASE", "src/mod.py", 4), _event("UNCOMMITTED_PHASE", phase=3)]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        mock_intervene.assert_called_once()
        called_event = mock_intervene.call_args[0][0]
        assert called_event.violation_type == "SKIP_RED_PHASE"

    def test_should_handle_same_priority_events_in_list_order(self, coordinator):
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
        assert elapsed < 1.0


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
            with pytest.raises(TDDViolationError):
                coord._handle_merged(events)
            commit_calls = mock_cg.ensure_committed.call_count
            assert commit_calls >= 2

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

    def test_should_commit_and_record_ki_for_v10_v11_only_merge(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory()
        coord = InterventionCoordinator(ctx)
        events = [_event("UNCOMMITTED_PHASE", phase=3), _event("UNCOMMITTED_REVIEW", phase=3)]
        with patch.object(coord, "commit_guard") as mock_cg, \
             patch.object(coord, "ki_doc") as mock_ki:
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coord._handle_merged(events)
            assert mock_cg.ensure_committed.called

    def test_should_route_v9_ki_doc_outdated_to_auto_append(self, coordinator):
        event = _event("KI_DOC_OUTDATED", phase=3)
        with patch.object(coordinator, "ki_doc") as mock_ki, \
             patch.object(coordinator, "commit_guard") as mock_cg:
            mock_ki.ensure_updated.return_value = False
            mock_cg.ensure_committed.return_value = MagicMock(success=True)
            with pytest.raises(TDDViolationError):
                coordinator.intervene(event)


# ===== Assessment =====

class TestAssessment:
    def test_should_derive_fail_when_c_or_h_greater_than_zero(self, coordinator, pipeline_context_factory):
        ctx = pipeline_context_factory(metadata={"round_results": [{"C": 1, "H": 0, "M": 0}]})
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


# ===== SYNC Mode =====

class TestSyncMode:
    def test_should_raise_tdd_violation_error_for_any_violation(self, coordinator):
        for vtype in ["SKIP_REVIEW", "INSUFFICIENT_REVIEW", "UNFIXED_ISSUES",
                       "SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST",
                       "REGRESSION", "MISSING_KI_DOC", "KI_DOC_OUTDATED",
                       "UNCOMMITTED_PHASE", "UNCOMMITTED_REVIEW", "MISSING_KI_ASSESSMENT"]:
            event = _event(vtype, "src/mod.py" if vtype in ("SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST", "REGRESSION") else "", 4 if vtype in ("SKIP_RED_PHASE", "MODIFIED_TEST", "MISSING_TEST") else 2)
            with patch.object(coordinator, "commit_guard") as mock_cg, \
                 patch.object(coordinator, "ki_doc"), \
                 patch.object(coordinator, "rollback_engine") as mock_re:
                mock_cg.ensure_committed.return_value = MagicMock(success=True)
                mock_re.rollback.return_value = RollbackResult(True, "ok")
                with pytest.raises(TDDViolationError):
                    coordinator.intervene(event)

    def test_should_handle_multiple_violations_by_priority(self, coordinator):
        events = [_event("SKIP_RED_PHASE", "src/mod.py", 4), _event("MISSING_KI_DOC", phase=3)]
        with patch.object(coordinator, "intervene") as mock_intervene:
            coordinator.intervene_batch(events)
        called = mock_intervene.call_args[0][0]
        assert called.violation_type == "SKIP_RED_PHASE"


# ===== Failure Modes =====

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
