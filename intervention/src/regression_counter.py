"""RegressionCounter — tracks regression counts per pipeline run.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""


class RegressionCounter:
    def increment(self, run_id: str) -> int:
        raise NotImplementedError

    def get_count(self, run_id: str) -> int:
        raise NotImplementedError

    def get_cumulative_count(self, run_id: str) -> int:
        raise NotImplementedError

    def reset(self, run_id: str) -> None:
        raise NotImplementedError

    def regression_counter_cleanup(self, run_id: str) -> dict:
        raise NotImplementedError
