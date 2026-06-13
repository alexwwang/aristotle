from intervention_types import ViolationEvent, PipelineContext
from intervention_coordinator import InterventionCoordinator
from pending_subagent_tracker import PendingSubagentTracker
from handlers import Handlers


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


class TestViolationHandlingIntegration:
    # VH-094
    def test_should_recover_from_crash_during_child_pipeline_start(self):
        ctx = _make_context()
        event = _event("MODIFIED_TEST", filepath="tests/test_example.py",
                       parent_suspended=True, child_start_in_progress=True)
        coord = InterventionCoordinator(ctx)
        result = coord.intervene(event)
        assert result.action == "quarantined"
        assert result.pipeline_action == "suspended"

    # VH-095
    def test_should_recover_pending_subagent_tracker_after_crash(self):
        tracker = PendingSubagentTracker()
        result = tracker.register("T-5:run-001", "T-5", {"occurrences": 3})
        assert result.status == "pending"
        assert result.key == "T-5:run-001"

    # VH-096
    def test_should_handle_orphaned_t2_during_t5_wait(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-5:run-001", "T-5", {"occurrences": 3})
        tracker.register("T-2:run-001", "T-2", {"prompt": "review"})
        fail_result = tracker.fail("T-2:run-001", error="orphaned")
        assert fail_result.status == "failed"
        assert "orphaned" in fail_result.error

    # VH-097
    def test_should_handle_watchdog_reconnection_during_t5_briefing(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-5:run-001", "T-5", {"occurrences": 3})
        result = tracker.reconnect("T-5:run-001", "T-5", {"occurrences": 3})
        assert result.status == "pending"
        assert result.key == "T-5:run-001"
        assert result.reconnected is True

    # VH-098
    def test_should_handle_max_depth_suspend_failure(self):
        h = Handlers()
        event = _event("MODIFIED_TEST", filepath="tests/test_example.py", max_depth_exceeded=True)
        ctx = _make_context()
        result = h.handle_modified_test(event, ctx)
        assert result.action == "quarantined"
        assert result.pipeline_action == "suspended"

    # VH-099
    def test_should_handle_quarantine_failure_during_violation_handling(self):
        h = Handlers()
        event = _event("MODIFIED_TEST", filepath="tests/test_example.py", quarantine_partial_failure=True)
        ctx = _make_context()
        result = h.handle_modified_test(event, ctx)
        assert result.action == "quarantined"
        assert result.pipeline_action == "suspended"
