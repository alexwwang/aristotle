"""CommitGuard stub — Phase 4 TDD Red."""
from aristotle_auto_reflection.intervention_types import CommitResult


class CommitGuard:
    def ensure_committed(self, context) -> CommitResult:
        raise NotImplementedError("CommitGuard.ensure_committed stub")

    def _build_message(self, context) -> str:
        raise NotImplementedError("CommitGuard._build_message stub")

    def _is_clean(self) -> bool:
        raise NotImplementedError("CommitGuard._is_clean stub")
