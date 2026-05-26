"""InterventionCoordinator stub — Phase 4 TDD Red."""
from aristotle_auto_reflection.intervention_types import InterventionResult


class TDDViolationError(Exception):
    def __init__(self, event, plan, result: InterventionResult = None):
        self.event = event
        self.plan = plan
        self.result = result
        super().__init__(f"TDDViolationError: {plan.instruction if plan else 'unknown'}")


class InterventionCoordinator:
    def __init__(self, context):
        self.context = context
        self.prompt_validator = None
        self.rollback_engine = None
        self.ki_doc = None
        self.commit_guard = None

    def intervene(self, event) -> None:
        raise NotImplementedError("InterventionCoordinator.intervene stub")

    def intervene_batch(self, events) -> None:
        raise NotImplementedError("InterventionCoordinator.intervene_batch stub")

    def _build_plan(self, event):
        raise NotImplementedError("InterventionCoordinator._build_plan stub")

    def _is_valid_event(self, event) -> bool:
        raise NotImplementedError("InterventionCoordinator._is_valid_event stub")

    def _needs_prompt_validation(self, event) -> bool:
        raise NotImplementedError("InterventionCoordinator._needs_prompt_validation stub")

    def _handle_merged(self, events):
        raise NotImplementedError("InterventionCoordinator._handle_merged stub")

    def _compute_assessment(self):
        raise NotImplementedError("InterventionCoordinator._compute_assessment stub")
