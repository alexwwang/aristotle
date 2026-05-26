"""KiDocManager stub — Phase 4 TDD Red."""


class KiDocManager:
    def __init__(self, ki_doc_path: str):
        self.ki_doc_path = ki_doc_path

    def record_intervention(self, event, plan, rollback_result, validation_result=None):
        raise NotImplementedError("KiDocManager.record_intervention stub")

    def ensure_assessment(self, phase, next_phase, status, issues, priority_counts=None):
        raise NotImplementedError("KiDocManager.ensure_assessment stub")

    def ensure_updated(self, last_intervention_ts):
        raise NotImplementedError("KiDocManager.ensure_updated stub")

    def record_merge(self, events, context):
        raise NotImplementedError("KiDocManager.record_merge stub")

    def _parse_newest_timestamp(self):
        raise NotImplementedError("KiDocManager._parse_newest_timestamp stub")

    def _append(self, entry):
        raise NotImplementedError("KiDocManager._append stub")
