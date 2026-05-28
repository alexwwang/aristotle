"""RollbackEngine — rollback implementation for TDD pipeline violations."""

import logging
import re
import subprocess
import os
from aristotle_auto_reflection.intervention_types import (
    ViolationEvent,
    InterventionPlan,
    RollbackResult,
    PipelineContext,
)

logger = logging.getLogger(__name__)


class RollbackEngine:
    def rollback(self, event: ViolationEvent, plan: InterventionPlan, context: PipelineContext) -> RollbackResult:
        """Dispatch rollback to the appropriate handler based on violation type."""
        handlers = {
            "SKIP_RED_PHASE": self._delete_implementation,
            "MODIFIED_TEST": self._restore_test,
        }
        handler = handlers.get(event.violation_type)
        if not handler:
            return RollbackResult(True, "no-op", [], None)

        # Collect all file paths to process
        all_paths = []
        if event.affected_file_paths:
            all_paths = list(event.affected_file_paths)
        else:
            all_paths = [event.affected_file_path] if event.affected_file_path else []

        # Multi-file rollback (or single file via affected_file_paths)
        if len(all_paths) >= 1:
            succeeded = []
            failed = []
            for fp in all_paths:
                single_event = ViolationEvent(
                    violation_type=event.violation_type,
                    affected_file_path=fp,
                    timestamp=event.timestamp,
                    context=event.context,
                    affected_file_paths=[],
                )
                result = handler(single_event, context)
                if result.success:
                    succeeded.append(fp)
                else:
                    failed.append(fp)

            if failed and succeeded:
                return RollbackResult(
                    success=True,
                    action="partial rollback",
                    files_affected=succeeded,
                    git_hash=None,
                    partial_failure=True,
                    failed_files=failed,
                )
            elif failed:
                return RollbackResult(
                    success=False,
                    action="all files failed",
                    files_affected=[],
                    git_hash=None,
                    partial_failure=False,
                    failed_files=failed,
                )
            else:
                return RollbackResult(True, "all files rolled back", succeeded, None)

        # No file paths — delegate to handler
        return handler(event, context)

    def _delete_implementation(self, event: ViolationEvent, context: PipelineContext) -> RollbackResult:
        """Remove an implementation file that was written before the RED phase."""
        filepath = event.affected_file_path
        if not self.validate_path(filepath):
            return RollbackResult(False, "path validation failed", [], None)
        if self._is_tracked(filepath):
            r = subprocess.run(["git", "rm", "-f", filepath], capture_output=True, text=True)
            if r.returncode != 0:
                return RollbackResult(False, f"git rm failed: {r.stderr}", [], None)
            return RollbackResult(True, "deleted via git rm", [filepath], None)
        elif os.path.exists(filepath):
            os.remove(filepath)
            return RollbackResult(True, "deleted untracked file", [filepath], None)
        return RollbackResult(True, "already deleted, no action needed", [filepath], None)

    def _restore_test(self, event: ViolationEvent, context: PipelineContext) -> RollbackResult:
        """Restore a modified test file to its committed state at the boundary."""
        filepath = event.affected_file_path
        if not self.validate_path(filepath):
            return RollbackResult(False, "path validation failed", [], None)
        if not self._is_tracked(filepath):
            return RollbackResult(False, "skip (untracked)", [], None)
        commit_ref = context.boundary_commit_hash or "HEAD"
        if commit_ref != "HEAD" and not re.match(r"^[a-fA-F0-9]+$", commit_ref):
            commit_ref = "HEAD"
        r = subprocess.run(["git", "checkout", commit_ref, "--", filepath], capture_output=True, text=True)
        if r.returncode != 0:
            return RollbackResult(False, f"git checkout failed: {r.stderr}", [], None)
        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
        return RollbackResult(True, f"restored test from {commit_ref}", [filepath], h.stdout.strip())

    def validate_path(self, filepath: str) -> bool:
        """Check that a file path is within the git repo root and not malicious."""
        if not filepath or filepath.startswith("-"):
            return False
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
        if r.returncode != 0:
            return False
        repo_root = r.stdout.strip()
        if not repo_root:
            return False
        abs_path = os.path.normpath(os.path.join(repo_root, filepath))
        return (abs_path == repo_root or abs_path.startswith(repo_root + os.sep)) and ".." not in filepath

    def _is_tracked(self, filepath: str) -> bool:
        """Return True if the file is tracked by git."""
        r = subprocess.run(["git", "ls-files", filepath], capture_output=True, text=True)
        if r.returncode != 0:
            return False
        return r.stdout.strip() != ""
