"""CommitGuard — auto-commits uncommitted changes at phase boundaries."""

import logging
import subprocess
from aristotle_auto_reflection.intervention_types import CommitResult, PipelineContext

logger = logging.getLogger(__name__)


class CommitGuard:
    PHASE_NAMES = {
        1: "PHASE-1-DESIGN",
        2: "PHASE-2-SOLUTION",
        3: "PHASE-3-TEST-PLAN",
        4: "PHASE-4-RED",
        5: "PHASE-5-GREEN",
        6: "PHASE-6-PRETEST",
        7: "PHASE-7-AUDIT",
    }

    def ensure_committed(self, context: PipelineContext) -> CommitResult:
        """Stage and commit all tracked changes if the working tree is dirty."""
        if self._is_clean():
            return CommitResult(success=True, action="skip (empty diff)")
        msg = self._build_message(context)
        add_result = subprocess.run(["git", "add", "-u"], capture_output=True, text=True)
        if add_result.returncode != 0:
            return CommitResult(success=False, action=f"add failed: {add_result.stderr}")
        commit_result = subprocess.run(["git", "commit", "-m", msg], capture_output=True, text=True)
        if commit_result.returncode != 0:
            return CommitResult(success=False, action=f"commit failed: {commit_result.stderr}")
        hash_result = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
        return CommitResult(success=True, action="committed", hash=hash_result.stdout.strip())

    def _is_clean(self) -> bool:
        """Return True if both the working tree and index have no changes."""
        r1 = subprocess.run(["git", "diff", "--quiet"], capture_output=True)
        r2 = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True)
        return r1.returncode == 0 and r2.returncode == 0

    def _build_message(self, context: PipelineContext) -> str:
        """Construct a conventional commit message from pipeline context."""
        name = self.PHASE_NAMES.get(context.current_phase, f"PHASE-{context.current_phase}")
        if context.loop_round is not None:
            return f"{context.req_number}: {name} [Loop {context.loop_round}] auto-commit"
        return f"{context.req_number}: {name} auto-commit"
