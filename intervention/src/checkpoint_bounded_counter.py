"""CheckpointBoundedCounter — bounded counter for spreading violations.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""


class CheckpointBoundedCounter:
    def record_failure(self, violation_type: str, files: list) -> int:
        raise NotImplementedError

    def record_success(self, violation_type: str, files: list) -> int:
        raise NotImplementedError

    def get_count(self, violation_type: str, files: list) -> int:
        raise NotImplementedError
