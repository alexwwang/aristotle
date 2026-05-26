"""RollbackEngine stub — Phase 4 TDD Red."""
import subprocess
import os
from aristotle_auto_reflection.intervention_types import RollbackResult


class RollbackEngine:
    def rollback(self, event, plan, context) -> RollbackResult:
        raise NotImplementedError("RollbackEngine.rollback stub")

    def _delete_implementation(self, event, context) -> RollbackResult:
        raise NotImplementedError("RollbackEngine._delete_implementation stub")

    def _restore_test(self, event, context) -> RollbackResult:
        raise NotImplementedError("RollbackEngine._restore_test stub")

    def _validate_path(self, filepath: str) -> bool:
        raise NotImplementedError("RollbackEngine._validate_path stub")

    def _is_tracked(self, filepath: str) -> bool:
        raise NotImplementedError("RollbackEngine._is_tracked stub")
