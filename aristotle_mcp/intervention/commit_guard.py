"""CommitGuard — auto-commits uncommitted changes at phase boundaries."""

import logging
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

from .intervention_types import CommitResult, PipelineContext

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

    # conventional-commit type per phase: RED writes tests, GREEN implements,
    # PRETEST fixes, AUDIT is housekeeping, design phases produce docs
    PHASE_COMMIT_TYPES = {
        1: "docs",
        2: "docs",
        3: "docs",
        4: "test",
        5: "feat",
        6: "fix",
        7: "chore",
    }

    def __init__(self, project_root: str = ""):
        self.project_root = project_root
        self._commit_failures: Dict[str, int] = {}

    # ── helpers ──────────────────────────────────────────────────────

    def _key(self, run_id: str, phase: int) -> str:
        return f"{run_id}:{phase}"

    def _cwd(self) -> Optional[str]:
        return self.project_root if self.project_root else None

    def _bump_failure(self, key: str) -> None:
        self._commit_failures[key] = self._commit_failures.get(key, 0) + 1

    def failure_count(self, run_id: str, phase: int) -> int:
        return self._commit_failures.get(self._key(run_id, phase), 0)

    def _is_clean(self) -> bool:
        """Return True if the working tree has no changes (incl. untracked)."""
        if self.project_root and not Path(self.project_root).exists():
            return False
        try:
            r = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=self._cwd(),
                capture_output=True,
                text=True,
            )
            return r.returncode == 0 and r.stdout.strip() == ""
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            return False

    def _has_commits(self) -> bool:
        try:
            r = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD"],
                cwd=self._cwd(),
                capture_output=True,
            )
            return r.returncode == 0
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            return False

    def _diff_summary(self) -> str:
        """Summarize staged changes as 'a.py, b.py +N more (+x/-y)'. Empty on error."""
        try:
            r = subprocess.run(
                ["git", "diff", "--cached", "--numstat"],
                cwd=self._cwd(),
                capture_output=True,
                text=True,
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            return ""
        if r.returncode != 0 or not r.stdout.strip():
            return ""
        files: List[str] = []
        adds = 0
        dels = 0
        for line in r.stdout.strip().splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            a, d, path = parts[0], parts[1], parts[2]
            adds += int(a) if a.isdigit() else 0
            dels += int(d) if d.isdigit() else 0
            files.append(Path(path).name)
        if not files:
            return ""
        label = ", ".join(files[:3])
        if len(files) > 3:
            label += f" +{len(files) - 3} more"
        return f"{label} (+{adds}/-{dels})"

    # ── message ──────────────────────────────────────────────────────

    def _build_message(
        self,
        context: Optional[PipelineContext] = None,
        phase: Optional[int] = None,
        run_id: str = "",
        review_round: Optional[int] = None,
        loop_round: Optional[int] = None,
        diff: str = "",
    ) -> str:
        """Construct a semantic conventional commit message.

        Format: ``type(scope): LABEL [Loop N] — file.py, ... (+x/-y)``.
        """
        if context is not None:
            phase = context.current_phase
            run_id = run_id or context.req_number
            if loop_round is None:
                loop_round = context.loop_round
        if review_round is not None:
            ctype = "chore"
            label = f"REVIEW-R{review_round}"
        elif phase is not None:
            ctype = self.PHASE_COMMIT_TYPES.get(phase, "chore")
            label = self.PHASE_NAMES.get(phase, f"PHASE-{phase}")
            if loop_round is not None:
                label += f" [Loop {loop_round}]"
        else:
            ctype = "chore"
            label = "auto-commit"
        scope = f"({run_id})" if run_id else ""
        msg = f"{ctype}{scope}: {label}"
        if diff:
            msg += f" — {diff}"
        return msg

    # ── main entry ───────────────────────────────────────────────────

    def ensure_committed(
        self,
        context: Optional[PipelineContext] = None,
        phase: Optional[int] = None,
        run_id: str = "",
        review_round: Optional[int] = None,
    ) -> CommitResult:
        """Stage and commit all changes if the working tree is dirty.

        Accepts either a PipelineContext (coordinator path) or explicit
        phase/run_id/review_round kwargs (compliance path).
        """
        loop_round: Optional[int] = None
        if context is not None:
            phase = context.current_phase
            run_id = run_id or context.req_number
            loop_round = context.loop_round
        key = self._key(run_id, phase if phase is not None else 0)

        if self.project_root and not Path(self.project_root).exists():
            self._bump_failure(key)
            return CommitResult(success=False, committed=False, reason="project_root missing")

        if self._is_clean():
            has_commits = self._has_commits()
            if review_round is not None:
                msg = self._build_message(phase=phase, run_id=run_id, review_round=review_round, loop_round=loop_round)
                try:
                    commit_result = subprocess.run(
                        ["git", "commit", "--allow-empty", "-m", msg],
                        cwd=self._cwd(),
                        capture_output=True,
                        text=True,
                    )
                except (subprocess.SubprocessError, FileNotFoundError, OSError):
                    self._bump_failure(key)
                    return CommitResult(success=False, committed=False)
                if commit_result.returncode != 0:
                    self._bump_failure(key)
                    return CommitResult(success=False, committed=False)
                self._commit_failures[key] = 0
                return CommitResult(success=True, committed=True, action="committed")
            if not has_commits:
                self._bump_failure(key)
                return CommitResult(success=False, committed=False, reason="no commits and clean tree")
            self._commit_failures[key] = 0
            return CommitResult(success=True, committed=False, reason="clean_tree", action="skip (empty diff)")

        # dirty tree: stage everything, summarize, commit
        try:
            add_result = subprocess.run(
                ["git", "add", "-A"],
                cwd=self._cwd(),
                capture_output=True,
                text=True,
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            self._bump_failure(key)
            return CommitResult(success=False, committed=False, reason="add subprocess failed")

        if add_result.returncode != 0:
            self._bump_failure(key)
            return CommitResult(
                success=False,
                committed=False,
                reason=f"add failed: {add_result.stderr}",
                action=f"add failed: {add_result.stderr}",
            )

        diff = self._diff_summary()
        msg = self._build_message(
            phase=phase, run_id=run_id, review_round=review_round, loop_round=loop_round, diff=diff
        )

        try:
            commit_result = subprocess.run(
                ["git", "commit", "-m", msg],
                cwd=self._cwd(),
                capture_output=True,
                text=True,
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            self._bump_failure(key)
            return CommitResult(success=False, committed=False, reason="commit subprocess failed")

        if commit_result.returncode != 0:
            self._bump_failure(key)
            return CommitResult(
                success=False,
                committed=False,
                reason=f"commit failed: {commit_result.stderr}",
                action=f"commit failed: {commit_result.stderr}",
            )

        hash_result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=self._cwd(), capture_output=True, text=True
        )
        commit_hash = hash_result.stdout.strip() if hash_result.returncode == 0 else ""
        self._commit_failures[key] = 0
        return CommitResult(success=True, committed=True, action="committed", hash=commit_hash)
