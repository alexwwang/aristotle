import pytest
from main_agent_tracker import MainAgentTracker


class TestMainAgentTracker:
    # VH-076
    def test_should_track_4_consecutive_failures(self):
        tracker = MainAgentTracker()
        key = "main-agent:run-001"
        tracker.record_result(key, success=False)
        tracker.record_result(key, success=False)
        tracker.record_result(key, success=False)
        result = tracker.record_result(key, success=False)
        assert result.consecutive_failures == 4

    # VH-077
    def test_should_reset_counter_on_success(self):
        tracker = MainAgentTracker()
        key = "main-agent:run-001"
        tracker.record_result(key, success=False)
        tracker.record_result(key, success=True)
        result = tracker.is_degraded(key)
        assert result is False

    # VH-078
    def test_should_pause_pipeline_after_4_main_agent_failures(self):
        tracker = MainAgentTracker()
        key = "main-agent:run-001"
        for _ in range(4):
            tracker.record_result(key, success=False)
        result = tracker.is_degraded(key)
        assert result is True

    # VH-079
    def test_should_reject_key_with_colon_delimiter(self):
        tracker = MainAgentTracker()
        with pytest.raises(ValueError):
            tracker.record_result("invalid:key:with:colons", success=False)
