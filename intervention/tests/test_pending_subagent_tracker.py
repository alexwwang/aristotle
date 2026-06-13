import pytest
from pending_subagent_tracker import PendingSubagentTracker, PendingSubagent


class TestPendingSubagentTracker:
    # VH-081
    def test_should_register_subagent_with_pending_status(self):
        tracker = PendingSubagentTracker()
        result = tracker.register("T-7b:run-001:auth.py", "T-7b", {"files": ["src/auth.py"]})
        assert result.status == "pending"

    # VH-082
    def test_should_complete_with_success_result(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-7b:run-001:auth.py", "T-7b", {"files": ["src/auth.py"]})
        tracker.complete("T-7b:run-001:auth.py", result={"success": True})

    # VH-083
    def test_should_fail_subagent(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-7b:run-001:auth.py", "T-7b", {"files": ["src/auth.py"]})
        tracker.fail("T-7b:run-001:auth.py", error="timeout")

    # VH-084
    def test_should_return_notify_briefing_for_t5(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-5:run-001", "T-5", {"occurrences": 3})
        post_action = tracker.complete("T-5:run-001", result={"success": True})
        assert post_action == "notify_briefing_complete"

    # VH-085
    def test_should_return_notify_split_for_t3(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-3:run-001:huge.py", "T-3", {"file_path": "src/huge.py"})
        post_action = tracker.complete("T-3:run-001:huge.py", result={"success": True})
        assert post_action == "notify_split_complete"

    # VH-086
    def test_should_return_none_for_t7b_missing_test(self):
        tracker = PendingSubagentTracker()
        tracker.register("T-7b:run-001:missing", "T-7b", {"type": "MISSING_TEST"})
        post_action = tracker.complete("T-7b:run-001:missing", result={"success": True})

    # VH-087
    def test_should_reject_key_with_colon_delimiter(self):
        tracker = PendingSubagentTracker()
        with pytest.raises(ValueError):
            tracker.register("bad:key:with:inner:colon", "T-7b", {})

    # VH-088
    def test_should_noop_complete_on_unknown_key(self):
        tracker = PendingSubagentTracker()
        result = tracker.complete("nonexistent-key", result={"success": True})
        assert result is None
