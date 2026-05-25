"""Watchdog intervention with rollback support."""
from dataclasses import dataclass
from typing import Optional, Dict, Any
import os

@dataclass
class RemediationPlan:
    target_phase: int
    action: str
    auto_fix: bool

class TDDViolationError(Exception):
    """Raised when LLM violates TDD protocol."""
    def __init__(self, event, plan: RemediationPlan):
        self.event = event
        self.plan = plan
        msg = f"[{self._phase_name(plan.target_phase)}] {plan.action}"
        super().__init__(msg)
    
    def _phase_name(self, phase: int) -> str:
        names = {1: "PHASE-1-DESIGN", 2: "PHASE-2-SOLUTION", 3: "PHASE-3-TEST",
                 4: "PHASE-4-RED", 5: "PHASE-5-GREEN", 6: "PHASE-6-PRETEST", 
                 7: "PHASE-7-AUDIT"}
        return names.get(phase, f"PHASE-{phase}")

class WatchdogIntervener:
    """Intervene on violations with automatic rollback."""
    
    def intervene(self, event) -> None:
        """Main entry: detect violation type and route to handler."""
        phase = event.context.get("phase", 0)
        
        # Phase 1-3: Process violations (from Ralph Loop)
        if phase in (1, 2, 3):
            plan = self._handle_process_violation(event)
        # Phase 4-5: Behavioral violations (from file system)
        elif phase in (4, 5):
            plan = self._handle_behavioral_violation(event)
        else:
            plan = RemediationPlan(
                target_phase=phase,
                action="Unknown violation type",
                auto_fix=False
            )
        
        # Auto-fix if enabled
        if plan.auto_fix:
            self._auto_remediate(event, plan)
        
        # Always raise to block LLM
        raise TDDViolationError(event, plan)
    
    def _handle_process_violation(self, event) -> RemediationPlan:
        """Handle Phase 1-3 process violations."""
        vtype = event.violation_type
        phase = event.context.get("phase", 0)
        
        if vtype == "SKIP_REVIEW":
            return RemediationPlan(
                target_phase=phase,
                action=f"Execute Ralph Loop Review for Phase {phase}. Must achieve 2 rounds ZERO_C_H_M.",
                auto_fix=False
            )
        elif vtype == "INSUFFICIENT_REVIEW":
            rounds = event.context.get("rounds", 0)
            return RemediationPlan(
                target_phase=phase,
                action=f"Ralph Loop only ran {rounds} rounds. Required: 2 rounds ZERO_C_H_M.",
                auto_fix=False
            )
        elif vtype == "UNFIXED_ISSUES":
            issues = event.context.get("issues", [])
            return RemediationPlan(
                target_phase=phase,
                action=f"Fix {len(issues)} open issues before proceeding: {issues}",
                auto_fix=False
            )
        else:
            return RemediationPlan(
                target_phase=phase,
                action=f"Process violation in Phase {phase}: {vtype}",
                auto_fix=False
            )
    
    def _handle_behavioral_violation(self, event) -> RemediationPlan:
        """Handle Phase 4-5 behavioral violations."""
        vtype = event.violation_type
        
        remediations = {
            "SKIP_RED_PHASE": RemediationPlan(
                target_phase=4,
                action="Write failing tests before implementation. Test skeleton auto-created.",
                auto_fix=True
            ),
            "MODIFIED_TEST": RemediationPlan(
                target_phase=5,
                action="Test restored from git. Write implementation to make ORIGINAL test pass.",
                auto_fix=True
            ),
            "MISSING_TEST": RemediationPlan(
                target_phase=4,
                action="Test skeleton auto-created. Write failing test before implementation.",
                auto_fix=True
            )
        }
        return remediations.get(vtype, RemediationPlan(
            target_phase=4,
            action=f"Behavioral violation: {vtype}",
            auto_fix=False
        ))
    
    def _auto_remediate(self, event, plan: RemediationPlan) -> None:
        """Automatically fix the violation."""
        if event.violation_type == "SKIP_RED_PHASE":
            self._delete_implementation(event.affected_file_path)
            self._create_test_skeleton(event)
        elif event.violation_type == "MODIFIED_TEST":
            self._restore_test_from_git(event.affected_file_path)
        elif event.violation_type == "MISSING_TEST":
            self._create_test_skeleton(event)
    
    def _delete_implementation(self, filepath: str) -> None:
        """Delete implementation file."""
        if os.path.exists(filepath):
            os.remove(filepath)
    
    def _create_test_skeleton(self, event) -> str:
        """Create test file skeleton."""
        src_path = event.affected_file_path
        test_path = src_path.replace("src/", "tests/test_", 1)
        test_path = test_path.replace(".py", "_test.py")
        
        os.makedirs(os.path.dirname(test_path), exist_ok=True)
        with open(test_path, "w") as f:
            f.write(f"\"\"\"Tests for {os.path.basename(src_path)}.\"\"\"\n")
            f.write("import pytest\n\n")
            f.write("class TestPlaceholder:\n")
            f.write("    def test_should_fail(self):\n")
            f.write("        assert False, \"Write your test here\"\n")
        
        return test_path
    
    def _restore_test_from_git(self, filepath: str) -> None:
        """Restore test file from git HEAD."""
        import subprocess
        subprocess.run(["git", "checkout", "HEAD", "--", filepath], check=False)
