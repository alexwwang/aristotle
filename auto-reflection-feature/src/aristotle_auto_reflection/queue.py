"""Durable queue for MCP unavailability."""
import os
import json
import glob
from typing import List
from aristotle_auto_reflection.intervention_types import ViolationEvent

class DurableQueue:
    def __init__(self, queue_dir: str):
        self.queue_dir = queue_dir
        os.makedirs(queue_dir, exist_ok=True)
    
    def _next_id(self) -> str:
        existing = glob.glob(os.path.join(self.queue_dir, "*.json"))
        if not existing:
            return "0001"
        numbers = [int(os.path.basename(f).split(".")[0]) for f in existing]
        return "%04d" % (max(numbers) + 1)
    
    def enqueue(self, event: ViolationEvent) -> None:
        event_id = self._next_id()
        filepath = os.path.join(self.queue_dir, f"{event_id}.json")
        data = {
            "violation_type": event.violation_type,
            "affected_file_path": event.affected_file_path,
            "timestamp": event.timestamp,
            "context": event.context,
            "affected_file_paths": event.affected_file_paths,
        }
        with open(filepath, "w") as f:
            json.dump(data, f)
    
    def dequeue_all(self) -> List[ViolationEvent]:
        events = []
        files = sorted(glob.glob(os.path.join(self.queue_dir, "*.json")))
        for filepath in files:
            with open(filepath) as f:
                data = json.load(f)
            events.append(ViolationEvent(
                violation_type=data["violation_type"],
                affected_file_path=data["affected_file_path"],
                timestamp=data["timestamp"],
                context=data["context"],
                affected_file_paths=data.get("affected_file_paths", []),
            ))
        for filepath in files:
            os.remove(filepath)
        return events
