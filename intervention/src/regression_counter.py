"""RegressionCounter — tracks per-cycle and cumulative regression counts per run_id."""


class RegressionCounter:
    PATTERN_CYCLE_THRESHOLD_CUMULATIVE = 9

    def __init__(self) -> None:
        self._per_cycle: dict = {}
        self._cumulative: dict = {}

    def increment(self, run_id: str) -> int:
        self._per_cycle[run_id] = self._per_cycle.get(run_id, 0) + 1
        self._cumulative[run_id] = self._cumulative.get(run_id, 0) + 1
        return self._per_cycle[run_id]

    def get_count(self, run_id: str) -> int:
        return self._per_cycle.get(run_id, 0)

    def get_cumulative_count(self, run_id: str) -> int:
        return self._cumulative.get(run_id, 0)

    def reset(self, run_id: str) -> None:
        self._per_cycle[run_id] = 0

    def regression_counter_cleanup(self, run_id: str) -> dict:
        removed = []
        if run_id in self._per_cycle:
            del self._per_cycle[run_id]
            removed.append(f"per_cycle:{run_id}")
        if run_id in self._cumulative:
            del self._cumulative[run_id]
            removed.append(f"cumulative:{run_id}")
        return {"success": True, "removed_keys": removed}

    def get_remap_state(self, run_id: str) -> dict:
        cumulative = self.get_cumulative_count(run_id)
        if cumulative >= self.PATTERN_CYCLE_THRESHOLD_CUMULATIVE:
            cycles = cumulative // self.PATTERN_CYCLE_THRESHOLD_CUMULATIVE
            return {"pattern": "repeated_violation", "cycle": cycles}
        return {}
