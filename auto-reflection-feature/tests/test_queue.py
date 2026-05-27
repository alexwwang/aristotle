"""Tests for queue module."""
import os
import pytest
import sys
sys.path.insert(0, "/workspace/auto-reflection-feature/src")
from aristotle_auto_reflection.queue import DurableQueue
from aristotle_auto_reflection.intervention_types import ViolationEvent

class TestDurableQueue:
    def test_enqueue_and_dequeue(self):
        queue = DurableQueue(queue_dir="/tmp/test-queue")
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4}
        )
        queue.enqueue(event)
        events = queue.dequeue_all()
        assert len(events) == 1
        assert events[0].violation_type == "SKIP_RED_PHASE"

    def test_queue_survives_recreation(self):
        queue_dir = "/tmp/test-queue-survive"
        queue1 = DurableQueue(queue_dir=queue_dir)
        event = ViolationEvent(
            violation_type="MODIFIED_TEST",
            affected_file_path="tests/test.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "modify", "phase": 5}
        )
        queue1.enqueue(event)
        
        queue2 = DurableQueue(queue_dir=queue_dir)
        events = queue2.dequeue_all()
        assert len(events) == 1

    def test_affected_file_paths_round_trip(self):
        queue = DurableQueue(queue_dir="/tmp/test-queue-paths")
        event = ViolationEvent(
            violation_type="SKIP_RED_PHASE",
            affected_file_path="src/calc.py",
            timestamp="2026-05-25T10:00:00Z",
            context={"operation": "create", "phase": 4},
            affected_file_paths=["src/calc.py", "src/helper.py"],
        )
        queue.enqueue(event)
        events = queue.dequeue_all()
        assert len(events) == 1
        assert events[0].affected_file_paths == ["src/calc.py", "src/helper.py"]

    def test_backward_compat_no_affected_file_paths_in_json(self):
        import json
        queue_dir = "/tmp/test-queue-compat"
        queue = DurableQueue(queue_dir=queue_dir)
        old_data = {
            "violation_type": "MODIFIED_TEST",
            "affected_file_path": "tests/test.py",
            "timestamp": "2026-05-25T10:00:00Z",
            "context": {"operation": "modify", "phase": 5},
        }
        filepath = os.path.join(queue_dir, "0001.json")
        with open(filepath, "w") as f:
            json.dump(old_data, f)
        events = queue.dequeue_all()
        assert len(events) == 1
        assert events[0].affected_file_paths == []
