"""CheckpointBoundedCounter — 2-checkpoint relative window counter for re-detection."""


class CheckpointBoundedCounter:
    THRESHOLD = 4

    def __init__(self) -> None:
        self._counts: dict = {}
        self._consecutive_clean: dict = {}

    @staticmethod
    def _key(violation_type: str, files: list) -> tuple:
        return (violation_type, tuple(sorted(files)))

    def record_failure(self, violation_type: str, files: list) -> int:
        key = self._key(violation_type, files)
        self._counts[key] = self._counts.get(key, 0) + 1
        self._consecutive_clean[key] = 0
        return self._counts[key]

    def record_success(self, violation_type: str, files: list) -> int:
        key = self._key(violation_type, files)
        count = self._counts.get(key, 0)
        if count == 0:
            return 0
        if count >= 3:
            self._counts[key] = 0
            self._consecutive_clean[key] = 0
            return 0
        self._consecutive_clean[key] = self._consecutive_clean.get(key, 0) + 1
        if self._consecutive_clean[key] >= 2:
            self._counts[key] = 0
            self._consecutive_clean[key] = 0
        return self._counts[key]

    def get_count(self, violation_type: str, files: list) -> int:
        return self._counts.get(self._key(violation_type, files), 0)

    def checkpoint(self) -> None:
        pass
