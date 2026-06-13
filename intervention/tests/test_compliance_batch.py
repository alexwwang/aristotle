from datetime import datetime

from compliance import ViolationEvent, VIOLATION_PRIORITY
from compliance_batch import intervene_batch, handle_merged, handle_compliance
from intervention_types import PipelineContext


def _make_event(vtype, files=None, phase=4, run_id="run-001"):
    return ViolationEvent(
        violation_type=vtype,
        phase=phase,
        severity=VIOLATION_PRIORITY.get(vtype, "P4"),
        timestamp=datetime.now().isoformat(),
        context={"phase": phase, "run_id": run_id},
        files=files if files is not None else [],
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
        current_phase=4,
        req_number="REQ-001",
        loop_round=1,
        metadata={"run_id": "run-001"},
    )
    defaults["metadata"].update(extra_metadata)
    defaults.update(ctx_overrides)
    return PipelineContext(**defaults)


class TestComplianceBatch:
    # VH-064
    def test_should_batch_three_compliance_events_in_one_call(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
            _make_event("KI_DOC_OUTDATED"),
        ]
        result = intervene_batch(events, _make_context())
        assert result.success is True

    # VH-065
    def test_should_set_rectified_on_each_event(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
        ]
        result = handle_merged(events, _make_context())
        assert result.success is True
        for e in events:
            assert e.rectified is True

    # VH-066
    def test_should_prevent_infinite_recursion_in_merged(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
        ]
        result = handle_merged(events, _make_context())
        assert result.success is True

    # VH-067
    def test_should_return_compliance_blocked_after_3_failures(self):
        ctx = _make_context(failure_count=3)
        result = handle_compliance(ctx)
        assert result.action == "blocked"

    # VH-068
    def test_should_return_auto_committed_when_no_events(self):
        ctx = _make_context()
        result = handle_compliance(ctx)
        assert result.action == "auto_committed"

    # VH-069
    def test_should_report_individual_success_failure_per_item(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
            _make_event("KI_DOC_OUTDATED"),
        ]
        result = intervene_batch(events, _make_context())
        assert len(result.items) == 3

    # VH-105
    def test_should_batch_uncommitted_review_and_missing_ki_assessment(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
            _make_event("KI_DOC_OUTDATED"),
            _make_event("MISSING_KI_ASSESSMENT"),
            _make_event("UNCOMMITTED_REVIEW"),
        ]
        result = intervene_batch(events, _make_context())
        assert len(result.items) == 5

    # VH-129
    def test_should_override_to_blocked_on_post_batch_commit_failed(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
        ]
        result = intervene_batch(events, _make_context(post_batch_commit_failed=True))
        assert result.action == "blocked"

    # VH-130
    def test_should_convert_batch_intervention_result_correctly(self):
        events = [
            _make_event("UNCOMMITTED_PHASE"),
            _make_event("MISSING_KI_DOC"),
        ]
        result = intervene_batch(events, _make_context())
        converted = result.to_intervention_results()
        assert len(converted) == 2
