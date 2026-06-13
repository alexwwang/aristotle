from intervention_coordinator import InterventionCoordinator
from intervention_types import ViolationEvent, PipelineContext, VIOLATION_PRIORITY


def _make_context(**overrides):
    defaults = dict(
        current_phase=5,
        req_number="REQ-001",
        loop_round=1,
        stage="phase_boundary",
        boundary_commit_hash="abc123",
        ki_doc_path="/tmp/ki.md",
        metadata={"round_results": []},
    )
    defaults.update(overrides)
    return PipelineContext(**defaults)


def _event(vtype, filepath="", phase=5, **ctx_extra):
    ctx = {"phase": phase}
    ctx.update(ctx_extra)
    return ViolationEvent(vtype, filepath, "2026-06-12T10:00:00Z", ctx)


class TestVHCoordinatorSignalDispatch:
    # VH-008
    def test_should_dispatch_regular_signal_through_priority_pipeline(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("SKIP_RED_PHASE", filepath="src/calc.py")
        result = coord.intervene(event)
        assert result.violation_code == "SKIP_RED_PHASE"

    # VH-009
    def test_should_dispatch_special_signal_through_special_handler(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        result = coord.intervene_from_signal("same-violation-3-in-10-rounds", {"run_id": "run-1", "phase": 5})
        assert result.violation_code != ""


class TestVHCoordinatorRectification:
    # VH-089
    def test_should_set_rectified_on_success_non_blocked(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("UNCOMMITTED_PHASE")
        coord.intervene(event)
        # Now the assertion will run and fail for the RIGHT reason (stub not implemented)
        assert event.rectified is True

    # VH-090
    def test_should_not_set_rectified_on_blocked_action(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("SKIP_REVIEW", phase=3)
        coord.intervene(event)
        assert event.rectified is False

    # VH-091
    def test_should_not_set_rectified_on_failed_handler(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("INVALID_REVIEW_PROMPT", prompt="stop condition for gate pass")
        coord.intervene(event)
        assert event.rectified is False

    # VH-092
    def test_should_not_set_rectified_when_event_not_registered_by_reference(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("SKIP_RED_PHASE", filepath="src/calc.py")
        coord.intervene(event)
        # Event not registered by reference — rectified should remain False
        assert event.rectified is False

    # VH-093
    def test_should_not_mutate_context_when_handler_attempts_it(self):
        ctx = _make_context()
        original_phase = ctx.current_phase
        coord = InterventionCoordinator(ctx)
        event = _event("SKIP_RED_PHASE", filepath="src/calc.py")
        coord.intervene(event)
        # Context should not be mutated by handler
        assert ctx.current_phase == original_phase


class TestVHCoordinatorProtocolSignals:
    # VH-119
    def test_should_route_all_4_protocol_signals_via_protocol_signals_dict(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        for signal in [
            "ralph-round-finding-valid-submission",
            "ralph-round-finding-severity-p",
            "ralph-prompt-contamination",
            "gpav-validation-failure",
        ]:
            result = coord.intervene_from_signal(signal, {"run_id": "run-1", "phase": 5})
            assert result.violation_code != ""

    # VH-120
    def test_should_prevent_protocol_signals_from_entering_priority_pipeline(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        result = coord.intervene_from_signal("ralph-round-finding-valid-submission", {"run_id": "run-1", "phase": 5})
        assert result.violation_code not in VIOLATION_PRIORITY
