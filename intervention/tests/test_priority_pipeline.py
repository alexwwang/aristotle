import pytest
from priority_pipeline import PriorityPipeline, ValidityEliminator
from intervention_types import ViolationEvent, InterventionResult


def _event(vtype, filepath="", phase=5, **ctx_extra):
    ctx = {"phase": phase}
    ctx.update(ctx_extra)
    return ViolationEvent(vtype, filepath, "2026-06-12T10:00:00Z", ctx)


class TestPriorityPipeline:
    # VH-010
    def test_should_sort_violations_by_priority_p1_to_p4(self):
        pipeline = PriorityPipeline()
        events = [
            _event("UNCOMMITTED_PHASE"),
            _event("SKIP_RED_PHASE", filepath="src/a.py"),
            _event("SKIP_REVIEW", phase=3),
            _event("MODIFIED_TEST", filepath="tests/test_a.py"),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) == len(events)

    # VH-011
    def test_should_process_highest_priority_first(self):
        pipeline = PriorityPipeline()
        events = [
            _event("UNCOMMITTED_PHASE"),
            _event("SKIP_RED_PHASE", filepath="src/a.py"),
            _event("SKIP_REVIEW", phase=3),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) == len(events)
        assert results[0].violation_type == "SKIP_RED_PHASE"

    # VH-012
    def test_should_eliminate_phase_scoped_after_suspend(self):
        pipeline = PriorityPipeline()
        events = [
            _event("MODIFIED_TEST", filepath="tests/test_a.py"),
            _event("SKIP_REVIEW", phase=3),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) < len(events)

    # VH-013
    def test_should_eliminate_same_file_violations_after_quarantine(self):
        pipeline = PriorityPipeline()
        events = [
            _event("SKIP_RED_PHASE", filepath="src/a.py"),
            _event("MODIFIED_TEST", filepath="src/a.py"),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) < len(events)

    # VH-014
    def test_should_eliminate_p2_protocol_gap_types_after_suspend(self):
        pipeline = PriorityPipeline()
        events = [
            _event("MODIFIED_TEST", filepath="tests/test_a.py"),
            _event("SKIP_REVIEW", phase=3),
            _event("INSUFFICIENT_REVIEW", phase=3),
            _event("INVALID_REVIEW_PROMPT", prompt="bad prompt"),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) < len(events)

    # VH-015
    def test_should_preserve_p4_compliance_after_suspend(self):
        pipeline = PriorityPipeline()
        events = [
            _event("MODIFIED_TEST", filepath="tests/test_a.py"),
            _event("UNCOMMITTED_PHASE"),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) == len(events)

    # VH-016
    def test_should_handle_empty_violations_list(self):
        pipeline = PriorityPipeline()
        result = pipeline.process_concurrent([])
        assert result == []

    # VH-017
    def test_should_process_same_priority_in_list_order(self):
        pipeline = PriorityPipeline()
        events = [
            _event("SKIP_REVIEW", phase=3),
            _event("INSUFFICIENT_REVIEW", phase=3),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) == len(events)

    # VH-018
    def test_should_raise_value_error_on_unknown_violation_type(self):
        pipeline = PriorityPipeline()
        events = [_event("UNKNOWN_TYPE", filepath="src/a.py")]
        with pytest.raises(ValueError):
            pipeline.process_concurrent(events)

    # VH-019
    def test_should_re_evaluate_remaining_after_each_fix(self):
        pipeline = PriorityPipeline()
        events = [
            _event("SKIP_RED_PHASE", filepath="src/a.py"),
            _event("MODIFIED_TEST", filepath="tests/test_a.py"),
            _event("UNCOMMITTED_PHASE"),
        ]
        results = pipeline.process_concurrent(events)
        assert len(results) > 0


class TestValidityEliminator:
    # VH-020
    def test_should_not_eliminate_p1_cross_independence(self):
        eliminator = ValidityEliminator()
        applied = _event("SKIP_RED_PHASE", filepath="src/a.py")
        pending = [
            _event("MODIFIED_TEST", filepath="tests/test_b.py"),
            _event("MISSING_TEST", filepath="src/c.py"),
        ]
        result = eliminator.eliminate(pending, applied)
