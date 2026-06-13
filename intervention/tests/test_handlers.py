import pytest
from handlers import Handlers
from intervention_types import PipelineContext, ViolationEvent


def _make_event(vtype, files=None, phase=5, run_id="run-001", **extra):
    return ViolationEvent(
        violation_type=vtype,
        affected_file_path=(files[0] if files else ""),
        timestamp="2026-06-12T10:00:00Z",
        context={"phase": phase, "run_id": run_id, **extra},
        affected_file_paths=files or [],
    )


_VALID_CTX_FIELDS = {"current_phase", "req_number", "loop_round", "stage",
                      "boundary_commit_hash", "ki_doc_path", "phase5_test_results", "metadata"}


def _make_context(**overrides):
    extra_metadata = {}
    ctx_overrides = {}
    for k, v in overrides.items():
        if k in _VALID_CTX_FIELDS:
            ctx_overrides[k] = v
        else:
            extra_metadata[k] = v
    defaults = dict(
        current_phase=5,
        req_number="REQ-001",
        loop_round=1,
        stage="phase_boundary",
        metadata={"run_id": "run-001"},
    )
    defaults["metadata"].update(extra_metadata)
    defaults.update(ctx_overrides)
    return PipelineContext(**defaults)


class TestHandlers:
    # VH-021
    def test_should_quarantine_modified_test_and_suspend_pipeline(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=["tests/test_example.py"])
        result = h.handle_modified_test(event, _make_context())
        assert result.action == "quarantined"
        assert result.pipeline_action == "suspended"

    # VH-022
    def test_should_start_child_pipeline_at_phase_4(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=["tests/test_example.py"])
        result = h.handle_modified_test(event, _make_context())
        assert result.child_run_id == "child-run-001"

    # VH-023
    def test_should_spawn_t7b_with_quarantined_files(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=["tests/test_example.py"])
        result = h.handle_modified_test(event, _make_context())
        assert result.subagent_spawn_request.get('template_id') == 'T-7b'

    # VH-024
    def test_should_handle_quarantine_failure_after_suspend(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=["tests/test_example.py"])
        result = h.handle_modified_test(event, _make_context(quarantine_failed=True))
        assert result.pipeline_action == "suspended"
        assert result.error is not None

    # VH-025
    def test_should_resume_parent_when_child_start_fails(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=["tests/test_example.py"])
        result = h.handle_modified_test(event, _make_context(child_start_failed=True))
        assert result.pipeline_action == "resumed"

    # VH-026
    def test_should_require_non_empty_files_for_modified_test(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=[])
        with pytest.raises(ValueError):
            h.handle_modified_test(event, _make_context())

    # VH-138
    def test_should_quarantine_all_and_single_suspend_for_simultaneous_modified_test_files(self):
        h = Handlers()
        event = _make_event("MODIFIED_TEST", files=["tests/a.py", "tests/b.py", "tests/c.py"])
        result = h.handle_modified_test(event, _make_context())
        assert result.pipeline_action == "suspended"

    # VH-027
    def test_should_suspend_pipeline_for_missing_test(self):
        h = Handlers()
        event = _make_event("MISSING_TEST", files=["src/business_code.py"])
        result = h.handle_missing_test(event, _make_context())
        assert result.pipeline_action == "suspended"

    # VH-028
    def test_should_keep_business_code_in_workspace(self):
        h = Handlers()
        event = _make_event("MISSING_TEST", files=["src/business_code.py"])
        result = h.handle_missing_test(event, _make_context())
        assert result.action != "quarantined"

    # VH-029
    def test_should_spawn_t7b_with_workspace_files(self):
        h = Handlers()
        event = _make_event("MISSING_TEST", files=["src/business_code.py"])
        result = h.handle_missing_test(event, _make_context())
        assert result.subagent_spawn_request.get('template_id') == 'T-7b'

    # VH-030
    def test_should_start_child_pipeline_at_phase_4_for_missing_test(self):
        h = Handlers()
        event = _make_event("MISSING_TEST", files=["src/business_code.py"])
        result = h.handle_missing_test(event, _make_context())
        assert result.child_run_id == "child-run-001"

    # VH-031
    def test_should_resume_parent_when_child_start_fails_for_missing_test(self):
        h = Handlers()
        event = _make_event("MISSING_TEST", files=["src/business_code.py"])
        result = h.handle_missing_test(event, _make_context(child_start_failed=True))
        assert result.pipeline_action == "resumed"

    # VH-032
    def test_should_require_non_empty_files_for_missing_test(self):
        h = Handlers()
        event = _make_event("MISSING_TEST", files=[])
        with pytest.raises(ValueError):
            h.handle_missing_test(event, _make_context())

    # VH-036
    def test_should_instruct_when_regression_n_lt_3(self):
        h = Handlers()
        event = _make_event("REGRESSION", files=["src/auth.py"], regression_count=1)
        result = h.handle_regression(event, _make_context())
        assert result.action == "instructed"

    # VH-037
    def test_should_quarantine_suspend_and_spawn_t7b_when_regression_n_ge_3(self):
        h = Handlers()
        event = _make_event("REGRESSION", files=["src/auth.py"], regression_count=3)
        result = h.handle_regression(event, _make_context())
        assert result.action == "quarantined"

    # VH-038
    def test_should_ignore_regression_during_non_test_runner(self):
        h = Handlers()
        event = _make_event("REGRESSION", files=["src/auth.py"], source="non-test-runner")
        result = h.handle_regression(event, _make_context())
        assert result.action == "ignored"

    # VH-039
    def test_should_extract_parent_run_id_on_child_resume(self):
        h = Handlers()
        event = _make_event("REGRESSION", files=["src/auth.py"], parentRunId="parent-run-001")
        result = h.handle_regression(event, _make_context())
        assert result.parent_run_id == "parent-run-001"

    # VH-049
    def test_should_pause_and_spawn_t5_when_rounds_exceeded(self):
        h = Handlers()
        event = _make_event("UNFIXED_ISSUES", signal="ralph-rounds-exceeded", rounds=12)
        result = h.handle_unfixed_issues(event, _make_context())
        assert result.pipeline_action == "paused"

    # VH-050
    def test_should_block_and_instruct_when_gate_block(self):
        h = Handlers()
        event = _make_event("UNFIXED_ISSUES", signal="violation-gate-block")
        result = h.handle_unfixed_issues(event, _make_context())
        assert result.action == "blocked"

    # VH-051
    def test_should_require_allowed_signal_for_unfixed_issues(self):
        h = Handlers()
        event = _make_event("UNFIXED_ISSUES", signal="")
        with pytest.raises(ValueError):
            h.handle_unfixed_issues(event, _make_context())

    # VH-052
    def test_should_include_occurrences_in_t5_request(self):
        h = Handlers()
        event = _make_event("UNFIXED_ISSUES", signal="ralph-rounds-exceeded", rounds=12)
        result = h.handle_unfixed_issues(event, _make_context())
        assert result.subagent_spawn_request.get('occurrences') == 12

    # VH-136
    def test_should_count_rounds_cumulatively_across_resume_from_suspend(self):
        h = Handlers()
        event = _make_event("UNFIXED_ISSUES", signal="ralph-rounds-exceeded", rounds=20, pre_suspend_rounds=8)
        result = h.handle_unfixed_issues(event, _make_context())
        assert result.pipeline_action == "paused"
        assert result.cumulative_rounds == 20

    # VH-053
    def test_should_block_phase_advance_for_skip_review(self):
        h = Handlers()
        event = _make_event("SKIP_REVIEW", phase=3)
        result = h.handle_skip_review(event, _make_context())
        assert result.action == "blocked"

    # VH-054
    def test_should_instruct_round_for_insufficient_review(self):
        h = Handlers()
        event = _make_event("INSUFFICIENT_REVIEW", phase=3)
        result = h.handle_insufficient_review(event, _make_context())
        assert result.action == "instructed"

    # VH-055
    def test_should_deliver_instruction_to_main_agent(self):
        h = Handlers()
        event = _make_event("SKIP_REVIEW", phase=3)
        result = h.handle_skip_review(event, _make_context())
        assert result.action == "blocked"
        assert result.user_message is not None and result.user_message != ""

    # VH-056
    def test_should_block_and_log_invalid_review_prompt(self):
        h = Handlers()
        event = _make_event("INVALID_REVIEW_PROMPT", prompt="write tests for me")
        result = h.handle_invalid_review_prompt(event, _make_context())
        assert result.action == "blocked"

    # VH-057
    def test_should_deliver_block_instruction_for_invalid_review_prompt(self):
        h = Handlers()
        event = _make_event("INVALID_REVIEW_PROMPT", prompt="write tests for me")
        result = h.handle_invalid_review_prompt(event, _make_context())
        assert result.action == "blocked"
        assert result.user_message is not None and result.user_message != ""

    # VH-122
    def test_should_regenerate_clean_prompt_on_invalid_review_attempt_1(self):
        h = Handlers()
        event = _make_event("INVALID_REVIEW_PROMPT", prompt="write tests for me", regeneration_attempt=1)
        result = h.handle_invalid_review_prompt(event, _make_context())
        assert result.action == "regenerated"

    # VH-123
    def test_should_pause_pipeline_when_all_4_irp_regeneration_attempts_fail(self):
        h = Handlers()
        event = _make_event("INVALID_REVIEW_PROMPT", prompt="write tests for me", regeneration_attempt=4)
        result = h.handle_invalid_review_prompt(event, _make_context())
        assert result.pipeline_action == "paused"

    # VH-061
    def test_should_quarantine_files_on_skip_red_phase(self):
        h = Handlers()
        event = _make_event("SKIP_RED_PHASE", files=["src/calc.py"])
        result = h.handle_skip_red_phase(event, _make_context())
        assert result.action == "quarantined"

    # VH-062
    def test_should_notify_when_files_empty(self):
        h = Handlers()
        event = _make_event("SKIP_RED_PHASE", files=[])
        result = h.handle_skip_red_phase(event, _make_context())
        assert result.action == "notified"

    # VH-063
    def test_should_continue_pipeline_after_skip_red_phase(self):
        h = Handlers()
        event = _make_event("SKIP_RED_PHASE", files=["src/calc.py"])
        result = h.handle_skip_red_phase(event, _make_context())
        assert result.pipeline_action != "suspended"
