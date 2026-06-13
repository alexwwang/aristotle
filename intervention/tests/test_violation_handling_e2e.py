from intervention_types import ViolationEvent, PipelineContext
from intervention_coordinator import InterventionCoordinator


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


class TestViolationHandlingE2E:
    # VH-100
    def test_full_a2_flow_from_detection_to_intervention(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("MODIFIED_TEST", filepath="tests/test_example.py",
                       files=["tests/test_example.py"])
        result = coord.intervene(event)
        assert result.action == "quarantined"
        assert result.pipeline_action == "suspended"

    # VH-101
    def test_full_a3_flow_from_detection_to_intervention(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("MISSING_TEST", filepath="src/business_code.py",
                       files=["src/business_code.py"])
        result = coord.intervene(event)
        assert result.pipeline_action == "suspended"

    # VH-102
    def test_full_regression_n_ge_3_flow_from_detection_to_intervention(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        event = _event("REGRESSION", filepath="src/auth.py",
                       files=["src/auth.py"], regression_count=3)
        result = coord.intervene(event)
        assert result.action == "quarantined"
        assert result.pipeline_action == "suspended"

    # VH-103
    def test_full_pattern_cycle_flow_from_detection_to_intervention(self):
        ctx = _make_context()
        coord = InterventionCoordinator(ctx)
        result = coord.intervene_from_signal("same-violation-3-in-10-rounds",
                                             {"run_id": "run-001", "phase": 5})
        assert result.action == "instructed"
