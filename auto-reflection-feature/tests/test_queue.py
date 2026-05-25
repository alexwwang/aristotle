"""Tests for queue module."""
import pytest
import sys
sys.path.insert(0, "/workspace/auto-reflection-feature/src")
from aristotle_auto_reflection.queue import DurableQueue
from aristotle_auto_reflection.watchdog import ViolationEvent

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
