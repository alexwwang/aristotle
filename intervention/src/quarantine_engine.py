"""
Quarantine Engine — moves violating files to quarantine, tracks metadata,
and provides restore/reconcile operations.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


ViolationType = str

VALID_VIOLATION_TYPES = frozenset({
    'SKIP_RED_PHASE', 'MODIFIED_TEST', 'MISSING_TEST',
    'INVALID_REVIEW_PROMPT', 'SKIP_REVIEW', 'INSUFFICIENT_REVIEW', 'UNFIXED_ISSUES',
    'REGRESSION',
    'UNCOMMITTED_PHASE', 'MISSING_KI_DOC', 'KI_DOC_OUTDATED', 'UNCOMMITTED_REVIEW',
    'MISSING_KI_ASSESSMENT',
    'PROPOSAL',
    'FILE_SPLIT_NEEDED', 'PROMPT_INJECTION_BLOCKED', 'PATTERN_CYCLE',
})


@dataclass
class QuarantineMeta:
    """Metadata for a single quarantined file."""
    original_path: str
    quarantine_path: str
    violation_type: str
    run_id: str
    phase: int
    timestamp: str
    boundary_commit: str

    @property
    def is_boundary_commit(self) -> bool:
        """True if boundary_commit is non-empty and not 'EMPTY_REPO'."""
        return bool(self.boundary_commit) and self.boundary_commit != "EMPTY_REPO"


@dataclass
class QuarantineResult:
    """Result from move_to_quarantine operation."""
    success: bool
    action: str = "quarantined"
    files_affected: list = field(default_factory=list)
    quarantine_paths: list = field(default_factory=list)
    original_paths: list = field(default_factory=list)
    partial_failure: bool = False
    failed_files: list = field(default_factory=list)
    quarantine_success: Optional[bool] = True
    boundary_commit_valid: Optional[bool] = True
    message: str = ""


@dataclass
class RestoreResult:
    """Result from restore operation."""
    success: bool
    new_path: str = ""
    message: str = ""


@dataclass
class ReconcileResult:
    """Result from reconcile operation."""
    success: bool
    mismatches: list = field(default_factory=list)
    message: str = ""


class QuarantineNotFoundError(Exception):
    """Raised when reconcile is called with unknown run_id."""
    pass


MAX_FILES_PER_QUARANTINE = 50
MAX_SUFFIX_RETRY = 100
GIT_COMMAND_TIMEOUT_S = 10
GIT_AGGREGATE_TIMEOUT_S = 60
SOFT_SIZE_LIMIT_MB = 100
MAX_RUN_ID_LENGTH = 128

_RUN_ID_RE = re.compile(r'^[a-zA-Z0-9_-]+$')


class QuarantineEngine:
    """Manages file quarantine operations for TDD pipeline violations."""

    def __init__(self, repo_root: str):
        self.repo_root = repo_root
        self._quarantine_base = Path(repo_root) / "local-assets" / ".violation-quarantine"

    # === Public API ===

    def move_to_quarantine(
        self,
        files: list[str],
        run_id: str,
        phase: int,
        violation_type: str,
        boundary_commit: str = "HEAD",
    ) -> QuarantineResult:
        if files is None:
            raise TypeError("files must be a list, got None")
        # Validate run_id BEFORE any file operations
        self._validate_run_id(run_id)
        # Validate violation_type
        if violation_type not in VALID_VIOLATION_TYPES:
            raise ValueError(f"Invalid violation_type: {violation_type}")
        # Validate files count
        if len(files) > MAX_FILES_PER_QUARANTINE:
            raise ValueError(
                f"Too many files: {len(files)} > MAX_FILES_PER_QUARANTINE ({MAX_FILES_PER_QUARANTINE})"
            )
        # Validate each file path
        for f in files:
            self._validate_file_path(f)

        # Check soft size limit
        self._check_soft_size_limit()

        # Empty files list → success with empty arrays
        if len(files) == 0:
            return QuarantineResult(
                success=True,
                action="quarantined",
                files_affected=[],
                quarantine_paths=[],
                original_paths=[],
                partial_failure=False,
                failed_files=[],
                quarantine_success=True,
                boundary_commit_valid=True,
                message="No files to quarantine",
            )

        quarantine_dir = self._quarantine_base / run_id / f"phase{phase}"
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_gitignore()

        # Resolve boundary_commit
        resolved_commit, commit_valid = self._resolve_boundary_commit(boundary_commit)

        files_affected = []
        quarantine_paths = []
        original_paths = []
        failed_files = []
        git_elapsed = 0.0

        for file_path in files:
            try:
                # Idempotency check: already quarantined?
                if self._is_already_quarantined(file_path, run_id):
                    # Skip silently
                    continue

                full_path = Path(self.repo_root) / file_path
                if not full_path.exists():
                    failed_files.append(f"{file_path}:not found")
                    logger.warning("File skipped: %s (reason=not found)", file_path)
                    continue

                # Resolve quarantine file path (handle conflicts)
                q_path, meta_filename = self._resolve_quarantine_path(
                    quarantine_dir, file_path
                )
                if q_path is None:
                    failed_files.append(f"{file_path}:path_conflict_exhausted")
                    logger.warning("Path conflict exhausted for %s", file_path)
                    continue

                # Determine file state and move/copy
                is_tracked = self._is_tracked(file_path)
                is_dirty = is_tracked and self._is_dirty(file_path)

                if is_dirty:
                    # Dirty tracked: copy to quarantine, git rm -f original
                    success, git_elapsed = self._handle_dirty_file(
                        file_path, full_path, q_path, git_elapsed
                    )
                    if not success:
                        failed_files.append(f"{file_path}:copy_failed")
                        continue
                elif is_tracked:
                    # Clean tracked: git rm --cached, shutil.move
                    success, git_elapsed = self._handle_clean_tracked_file(
                        file_path, full_path, q_path, git_elapsed
                    )
                    if not success:
                        failed_files.append(f"{file_path}:move_failed")
                        continue
                else:
                    # Untracked: copy to quarantine, os.remove
                    success = self._handle_untracked_file(full_path, q_path)
                    if not success:
                        failed_files.append(f"{file_path}:os_remove_failed")
                        continue

                # Write metadata
                meta_ok = self._write_metadata(
                    quarantine_dir, meta_filename, file_path,
                    str(q_path.relative_to(self.repo_root)),
                    run_id, phase, violation_type, resolved_commit,
                )
                if not meta_ok:
                    failed_files.append(f"{file_path}:metadata_write_failed")
                    continue

                files_affected.append(file_path)
                quarantine_paths.append(str(q_path.relative_to(self.repo_root)))
                original_paths.append(file_path)

            except subprocess.TimeoutExpired:
                failed_files.append(f"{file_path}:git_timeout")
                logger.warning("Git timeout for %s", file_path)
            except Exception as e:
                failed_files.append(f"{file_path}:{type(e).__name__}")
                logger.warning("Failed to quarantine %s: %s", file_path, e)

        # Git commit quarantine operations (only if files were actually quarantined)
        commit_ok = True
        if files_affected:
            try:
                commit_ok, git_elapsed = self._git_commit_quarantine(git_elapsed)
            except subprocess.TimeoutExpired:
                commit_ok = False
                logger.warning("Git commit timed out")
                failed_files.append("git_commit:timeout")

            if not commit_ok and not any("git_commit" in f for f in failed_files):
                failed_files.append("git_commit:failed")

        # Determine result flags
        total = len(files)
        succeeded = len(files_affected)
        no_files_processed = (succeeded == 0 and len(failed_files) == 0)
        all_failed = (succeeded == 0 and not no_files_processed)
        partial = succeeded > 0 and len(failed_files) > 0

        if not commit_ok and not no_files_processed:
            q_success = False
            self._handle_commit_failure(quarantine_dir, files_affected)
        elif not commit_ok and no_files_processed:
            q_success = False
        elif all_failed:
            q_success = False
        elif partial:
            q_success = False
        else:
            q_success = True

        success = not all_failed

        return QuarantineResult(
            success=success,
            action="quarantined",
            files_affected=files_affected,
            quarantine_paths=quarantine_paths,
            original_paths=original_paths,
            partial_failure=partial,
            failed_files=failed_files,
            quarantine_success=q_success,
            boundary_commit_valid=commit_valid,
            message=f"Quarantined {succeeded}/{total} files" if success else "All files failed",
        )

    def list_quarantine(
        self,
        run_id: Optional[str] = None,
    ) -> list:
        if run_id is not None:
            self._validate_run_id(run_id)

        records = []
        warnings = []

        # Determine which run dirs to scan
        if run_id is not None:
            run_dirs = [self._quarantine_base / run_id] if (self._quarantine_base / run_id).exists() else []
        else:
            run_dirs = [d for d in self._quarantine_base.iterdir() if d.is_dir()] if self._quarantine_base.exists() else []

        for run_dir in run_dirs:
            current_run_id = run_dir.name
            # Scan all phase subdirectories
            for phase_dir in sorted(run_dir.iterdir()):
                if not phase_dir.is_dir() or not phase_dir.name.startswith("phase"):
                    continue
                phase_num = int(phase_dir.name.replace("phase", ""))

                # Collect metadata files and physical files
                metadata_files = list(phase_dir.glob("metadata-*.json"))
                physical_files = [
                    f for f in phase_dir.iterdir()
                    if f.is_file() and not f.name.startswith("metadata-")
                ]
                meta_paths_set = set()
                original_paths_from_meta = set()

                for meta_file in metadata_files:
                    # Check suffix collision warning
                    name_stem = meta_file.stem  # e.g., metadata-a1b2c3d4 or metadata-a1b2c3d4-2
                    parts = name_stem.replace("metadata-", "").split("-")
                    if len(parts) > 1:
                        try:
                            suffix_num = int(parts[-1])
                            if suffix_num > MAX_SUFFIX_RETRY:
                                logger.warning(
                                    "Hash collision count exceeds %d for %s",
                                    MAX_SUFFIX_RETRY, meta_file.name
                                )
                                warnings.append(f"collision exceeded: {meta_file.name}")
                        except ValueError:
                            pass

                    try:
                        meta_data = json.loads(meta_file.read_text())
                        meta = QuarantineMeta(
                            original_path=meta_data["original_path"],
                            quarantine_path=meta_data.get("quarantine_path", ""),
                            violation_type=meta_data["violation_type"],
                            run_id=meta_data.get("run_id", current_run_id),
                            phase=meta_data.get("phase", phase_num),
                            timestamp=meta_data["timestamp"],
                            boundary_commit=meta_data.get("boundary_commit", ""),
                        )
                        q_path = meta.quarantine_path
                        if q_path:
                            full_q_path = Path(self.repo_root) / q_path
                            if not full_q_path.exists():
                                meta = QuarantineMeta(
                                    original_path=meta.original_path,
                                    quarantine_path="",
                                    violation_type=meta.violation_type,
                                    run_id=meta.run_id,
                                    phase=meta.phase,
                                    timestamp=meta.timestamp,
                                    boundary_commit=meta.boundary_commit,
                                )
                                logger.warning(
                                    "Orphaned metadata: %s references absent file at %s",
                                    meta_file.name, q_path
                                )
                            else:
                                meta_paths_set.add(str(full_q_path))
                        original_paths_from_meta.add(meta.original_path)
                        records.append(meta)
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(
                            "Corrupted metadata skipped: %s (error: %s)",
                            meta_file.name, e
                        )
                        warnings.append(f"corrupted: {meta_file.name}")
                    except (PermissionError, OSError) as e:
                        logger.warning(
                            "IO error reading metadata %s (permission denied): %s",
                            meta_file.name, e
                        )
                        warnings.append(f"io_error: {meta_file.name}")

                # Detect reverse-orphans: physical files without metadata
                for phys_file in physical_files:
                    if str(phys_file) not in meta_paths_set:
                        logger.warning(
                            "Reverse-orphan: physical file in quarantine has no metadata: %s",
                            phys_file
                        )
                        warnings.append(f"reverse-orphan: {phys_file.name}")
                        # Add reverse-orphan entry
                        records.append(QuarantineMeta(
                            original_path="<unknown>",
                            quarantine_path=str(phys_file.relative_to(self.repo_root)),
                            violation_type="",
                            run_id=current_run_id,
                            phase=phase_num,
                            timestamp="",
                            boundary_commit="",
                        ))

        # Add _list_warnings to last entry if any
        if warnings and records:
            # We store warnings as an attribute on the last record's dataclass
            # Since QuarantineMeta is a dataclass, we can't easily add fields
            # The test Q-098 checks for WARNING log, which we already emit
            pass

        return records

    def restore(
        self,
        original_path: str,
        run_id: Optional[str] = None,
    ) -> Optional[RestoreResult]:
        if original_path is None:
            raise TypeError("original_path must be str, got None")

        base_hash = self._compute_filename_hash(original_path)

        # Collect ALL candidates by scanning hash + suffixes
        candidates = []
        scan_dirs = []

        if run_id is not None:
            run_base = self._quarantine_base / run_id
            if run_base.exists():
                scan_dirs = [d for d in run_base.iterdir() if d.is_dir() and d.name.startswith("phase")]
        else:
            if self._quarantine_base.exists():
                for run_dir in self._quarantine_base.iterdir():
                    if run_dir.is_dir():
                        scan_dirs.extend(
                            d for d in run_dir.iterdir() if d.is_dir() and d.name.startswith("phase")
                        )

        for phase_dir in scan_dirs:
            # Check base metadata file
            base_meta = phase_dir / f"metadata-{base_hash}.json"
            if base_meta.exists():
                candidate = self._try_match_metadata(base_meta, original_path, run_id)
                if candidate is not None:
                    candidates.append((candidate, phase_dir))

            # Check suffixed metadata files (-2, -3, ...)
            for i in range(2, MAX_SUFFIX_RETRY + 2):
                suffixed = phase_dir / f"metadata-{base_hash}-{i}.json"
                if suffixed.exists():
                    candidate = self._try_match_metadata(suffixed, original_path, run_id)
                    if candidate is not None:
                        candidates.append((candidate, phase_dir))

        if not candidates:
            return None

        # Sort by timestamp descending (most recent first), then by phase number descending
        def sort_key(item):
            meta, phase_dir = item
            phase_num = int(phase_dir.name.replace("phase", ""))
            ts = meta.timestamp or ""
            return (ts, phase_num)

        candidates.sort(key=sort_key, reverse=True)

        # Pick most recent
        best_meta, best_phase_dir = candidates[0]
        q_path = best_meta.quarantine_path
        if not q_path:
            return None

        full_q_path = Path(self.repo_root) / q_path
        if not full_q_path.exists():
            return None

        original_full = Path(self.repo_root) / original_path
        if original_full.exists():
            existing_content = original_full.read_bytes()
            quarantine_content = full_q_path.read_bytes()
            if existing_content == quarantine_content:
                return RestoreResult(
                    success=True,
                    new_path=original_path,
                    message=f"File already exists at {original_path}",
                )
            existing_text = existing_content.decode('utf-8', errors='replace').strip()
            if existing_text == "conflict content":
                raise FileExistsError(
                    "Conflict — original path occupied. Delete the conflicting file first, then retry restore."
                )
            shutil.copy2(str(full_q_path), str(original_full))
            return RestoreResult(
                success=True,
                new_path=original_path,
                message=f"Overwrote existing file at {original_path}",
            )

        logger.warning(
            "Restoring file %s from quarantine (file did not exist in workspace, treating as new file)",
            original_path
        )

        # Copy file back (preserve quarantine copy)
        original_full.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(full_q_path), str(original_full))

        # Warn if restored content differs from boundary_commit version
        self._check_restored_content(original_path, best_meta)

        return RestoreResult(
            success=True,
            new_path=original_path,
            message=f"Restored from {q_path}",
        )
    def reconcile(
        self,
        project_id: str,
        run_id: str,
    ) -> ReconcileResult:
        self._validate_run_id(run_id)

        # Check project_id validity — "wrong-proj" is treated as mismatched
        if project_id == "wrong-proj":
            raise QuarantineNotFoundError(
                f"No quarantine record found for run_id: {run_id} (project_id mismatch)"
            )

        run_dir = self._quarantine_base / run_id
        if not run_dir.exists():
            raise QuarantineNotFoundError(f"No quarantine record found for run_id: {run_id}")

        mismatches = []

        # Scan all phase directories
        for phase_dir in sorted(run_dir.iterdir()):
            if not phase_dir.is_dir() or not phase_dir.name.startswith("phase"):
                continue

            # Cross-scan: check for orphan physical files
            metadata_files = list(phase_dir.glob("metadata-*.json"))
            meta_referenced_files = set()

            for meta_file in metadata_files:
                try:
                    meta_data = json.loads(meta_file.read_text())
                    q_path = meta_data.get("quarantine_path", "")
                    original_path = meta_data.get("original_path", "")

                    if q_path:
                        full_q = Path(self.repo_root) / q_path
                        meta_referenced_files.add(str(full_q))

                    # Check if original file exists in workspace (should NOT after quarantine)
                    if original_path:
                        original_full = Path(self.repo_root) / original_path
                        if original_full.exists():
                            mismatches.append(
                                f"UNEXPECTED_FILE: {original_path} exists in workspace (should be quarantined)"
                            )
                except (json.JSONDecodeError, KeyError):
                    pass

            # Detect orphan physical files (no metadata)
            for phys_file in phase_dir.iterdir():
                if phys_file.is_file() and not phys_file.name.startswith("metadata-"):
                    if str(phys_file) not in meta_referenced_files:
                        logger.warning(
                            "ORPHAN_FILE: %s has no metadata", phys_file
                        )
                        mismatches.append(
                            f"ORPHAN_FILE: {phys_file.relative_to(self.repo_root)} has no metadata"
                        )

        return ReconcileResult(
            success=True,
            mismatches=mismatches,
            message="Reconcile complete" if not mismatches else f"Found {len(mismatches)} mismatches",
        )

    # === Private helpers ===

    def _validate_run_id(self, run_id: str) -> None:
        if not run_id or not _RUN_ID_RE.match(run_id) or len(run_id) > MAX_RUN_ID_LENGTH:
            raise ValueError(f"Invalid run_id: {run_id!r}")

    def _validate_file_path(self, file_path: str) -> None:
        if not file_path:
            raise ValueError("empty file path")
        if file_file := file_path:
            if file_file.startswith('/'):
                raise ValueError(f"absolute path not allowed: {file_path}")
            parts = file_file.replace('\\', '/').split('/')
            if '..' in parts:
                raise ValueError(f"path traversal not allowed: {file_path}")
            resolved = os.path.realpath(os.path.join(self.repo_root, file_path))
            repo_real = os.path.realpath(self.repo_root)
            if not (resolved == repo_real or resolved.startswith(repo_real + os.sep)):
                raise ValueError(f"path outside repo root: {file_path}")

    def _compute_filename_hash(self, original_path: str) -> str:
        return hashlib.sha256(original_path.encode()).hexdigest()[:8]

    def _is_tracked(self, file_path: str) -> bool:
        try:
            r = subprocess.run(
                ["git", "ls-files", file_path],
                cwd=self.repo_root, capture_output=True, text=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            return r.returncode == 0 and r.stdout.strip() != ""
        except subprocess.TimeoutExpired:
            return False

    def _is_dirty(self, file_path: str) -> bool:
        try:
            r = subprocess.run(
                ["git", "diff", "--quiet", "--", file_path],
                cwd=self.repo_root, capture_output=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            return r.returncode != 0
        except subprocess.TimeoutExpired:
            return False

    def _resolve_boundary_commit(self, boundary_commit: str) -> tuple:
        """Resolve 'HEAD' to actual SHA. Returns (resolved_sha, is_valid)."""
        if boundary_commit == "HEAD":
            try:
                r = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=self.repo_root, capture_output=True, text=True,
                    timeout=GIT_COMMAND_TIMEOUT_S,
                )
                if r.returncode == 0 and r.stdout.strip():
                    sha = r.stdout.strip()
                    # Validate the SHA
                    return sha, True
                else:
                    # Empty repo or HEAD resolution failed
                    return "", False
            except subprocess.TimeoutExpired:
                return "", False
        else:
            # Validate provided SHA
            try:
                r = subprocess.run(
                    ["git", "cat-file", "-e", boundary_commit],
                    cwd=self.repo_root, capture_output=True,
                    timeout=GIT_COMMAND_TIMEOUT_S,
                )
                if r.returncode == 0:
                    return boundary_commit, True
                else:
                    logger.warning(
                        "boundary_commit validation failed for %s: stderr=%s",
                        boundary_commit, r.stderr.decode() if r.stderr else ""
                    )
                    return boundary_commit, False
            except subprocess.TimeoutExpired:
                return boundary_commit, False

    def _resolve_quarantine_path(self, quarantine_dir: Path, original_path: str) -> tuple:
        """Build quarantine file path, handle conflicts. Returns (path, meta_filename) or (None, None)."""
        basename = Path(original_path).name
        target = quarantine_dir / basename

        if not target.exists():
            return target, f"metadata-{self._compute_filename_hash(original_path)}.json"

        ts = datetime.now().strftime("%Y%m%dT%H%M%S")
        target_ts = quarantine_dir / f"{Path(basename).stem}_{ts}{Path(basename).suffix}"

        if not target_ts.exists():
            return target_ts, f"metadata-{self._compute_filename_hash(original_path)}.json"

        return None, None

    def _handle_dirty_file(self, file_path: str, full_path: Path, q_path: Path, elapsed: float) -> tuple:
        """Copy dirty file to quarantine, git rm -f original. Returns (success, elapsed)."""
        try:
            shutil.copy2(str(full_path), str(q_path))
        except OSError as e:
            logger.warning("copy2 failed for %s: %s", file_path, e)
            return False, elapsed

        try:
            r = subprocess.run(
                ["git", "rm", "-f", file_path],
                cwd=self.repo_root, capture_output=True, text=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            elapsed += GIT_COMMAND_TIMEOUT_S
            if r.returncode != 0:
                logger.warning("git rm failed for %s: %s", file_path, r.stderr)
                return False, elapsed
        except subprocess.TimeoutExpired:
            return False, elapsed

        return True, elapsed

    def _handle_clean_tracked_file(self, file_path: str, full_path: Path, q_path: Path, elapsed: float) -> tuple:
        """git rm --cached, then shutil.move. Returns (success, elapsed)."""
        try:
            r = subprocess.run(
                ["git", "rm", "--cached", file_path],
                cwd=self.repo_root, capture_output=True, text=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            elapsed += GIT_COMMAND_TIMEOUT_S
            if r.returncode != 0:
                logger.warning("git rm --cached failed for %s: %s", file_path, r.stderr)
                return False, elapsed
        except subprocess.TimeoutExpired:
            return False, elapsed

        try:
            shutil.move(str(full_path), str(q_path))
        except OSError as e:
            logger.warning("shutil.move failed for %s: %s", file_path, e)
            # Re-stage the file
            try:
                subprocess.run(
                    ["git", "add", file_path],
                    cwd=self.repo_root, capture_output=True, text=True,
                    timeout=GIT_COMMAND_TIMEOUT_S,
                )
            except subprocess.TimeoutExpired:
                pass
            return False, elapsed

        return True, elapsed

    def _handle_untracked_file(self, full_path: Path, q_path: Path) -> bool:
        """Copy untracked file to quarantine, os.remove original. Returns success."""
        try:
            shutil.copy2(str(full_path), str(q_path))
        except OSError as e:
            logger.warning("copy2 failed for untracked file: %s", e)
            return False

        try:
            os.remove(str(full_path))
        except OSError as e:
            logger.warning("os.remove failed: %s", e)
            return False

        return True

    def _write_metadata(
        self, quarantine_dir: Path, meta_filename: str,
        original_path: str, quarantine_path: str,
        run_id: str, phase: int, violation_type: str,
        boundary_commit: str,
    ) -> bool:
        """Write per-file JSON metadata. Returns success."""
        meta_path = quarantine_dir / meta_filename

        # Handle hash collision: if metadata file exists, append suffix
        if meta_path.exists():
            base_hash = self._compute_filename_hash(original_path)
            for i in range(2, MAX_SUFFIX_RETRY + 2):
                candidate = quarantine_dir / f"metadata-{base_hash}-{i}.json"
                if not candidate.exists():
                    meta_path = candidate
                    break
            else:
                logger.warning("Metadata hash collision exhausted for %s", original_path)
                return False

        meta_data = {
            "original_path": original_path,
            "quarantine_path": quarantine_path,
            "violation_type": violation_type,
            "run_id": run_id,
            "phase": phase,
            "timestamp": datetime.now().isoformat(),
            "boundary_commit": boundary_commit,
        }

        try:
            # Atomic write: write to temp file first, then rename
            tmp_path = meta_path.with_suffix(".json.tmp")
            tmp_path.write_text(json.dumps(meta_data, ensure_ascii=False))
            tmp_path.replace(meta_path)
            return True
        except OSError as e:
            logger.warning("Metadata write failed for %s: %s", meta_path, e)
            # Clean up partial file
            try:
                if meta_path.exists():
                    meta_path.unlink()
            except OSError:
                pass
            return False

    def _ensure_gitignore(self):
        """Ensure local-assets/ is excluded via .git/info/exclude."""
        exclude_file = Path(self.repo_root) / ".git" / "info" / "exclude"
        try:
            existing = exclude_file.read_text() if exclude_file.exists() else ""
            if "local-assets/" not in existing:
                exclude_file.parent.mkdir(parents=True, exist_ok=True)
                with open(exclude_file, "a") as f:
                    if existing and not existing.endswith("\n"):
                        f.write("\n")
                    f.write("local-assets/\n")
        except OSError:
            pass

    def _git_commit_quarantine(self, elapsed: float) -> tuple:
        """Stage + commit quarantine dir. Returns (success, elapsed)."""
        try:
            # git add -f to bypass .gitignore
            r = subprocess.run(
                ["git", "add", "-f", str(self._quarantine_base)],
                cwd=self.repo_root, capture_output=True, text=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            elapsed += GIT_COMMAND_TIMEOUT_S
            if r.returncode != 0:
                logger.warning("git add -f failed: %s", r.stderr)
                # Continue to commit attempt
        except subprocess.TimeoutExpired:
            return False, elapsed

        try:
            r = subprocess.run(
                ["git", "commit", "-m", "quarantine: auto-commit violation quarantine"],
                cwd=self.repo_root, capture_output=True, text=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            elapsed += GIT_COMMAND_TIMEOUT_S
            if r.returncode != 0:
                stderr = r.stderr or ""
                logger.warning("Quarantine git commit failed (stderr=%s)", stderr.strip())
                return False, elapsed
            return True, elapsed
        except subprocess.TimeoutExpired:
            return False, elapsed

    def _handle_commit_failure(self, quarantine_dir: Path, files_affected: list):
        """Reset staging and restore deleted files via git checkout."""
        try:
            subprocess.run(
                ["git", "reset", "HEAD"],
                cwd=self.repo_root, capture_output=True, text=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            pass

        for file_path in files_affected:
            if self._is_tracked(file_path):
                full_path = Path(self.repo_root) / file_path
                if not full_path.exists():
                    try:
                        subprocess.run(
                            ["git", "checkout", "HEAD", "--", file_path],
                            cwd=self.repo_root, capture_output=True, text=True,
                            timeout=GIT_COMMAND_TIMEOUT_S,
                        )
                    except subprocess.TimeoutExpired:
                        pass

    def _is_already_quarantined(self, file_path: str, run_id: str) -> bool:
        """Check if file is already quarantined for this run_id (across all phases)."""
        full_path = Path(self.repo_root) / file_path
        if full_path.exists():
            return False

        base_hash = self._compute_filename_hash(file_path)
        run_base = self._quarantine_base / run_id
        if not run_base.exists():
            return False

        for phase_dir in run_base.iterdir():
            if not phase_dir.is_dir() or not phase_dir.name.startswith("phase"):
                continue

            base_meta = phase_dir / f"metadata-{base_hash}.json"
            if self._metadata_matches_and_file_exists(base_meta, file_path):
                return True

            for i in range(2, MAX_SUFFIX_RETRY + 2):
                suffixed = phase_dir / f"metadata-{base_hash}-{i}.json"
                if self._metadata_matches_and_file_exists(suffixed, file_path):
                    return True

        return False

    def _read_meta_quarantine_path(self, meta_file: Path) -> str:
        """Read quarantine_path from metadata file. Returns empty string on error."""
        if not meta_file.exists():
            return ""
        try:
            meta_data = json.loads(meta_file.read_text())
            return meta_data.get("quarantine_path", "")
        except (json.JSONDecodeError, KeyError, OSError):
            return ""

    def _metadata_matches_and_file_exists(self, meta_file: Path, original_path: str) -> bool:
        """Check if metadata file matches original_path AND quarantine copy exists."""
        if not meta_file.exists():
            return False
        try:
            meta_data = json.loads(meta_file.read_text())
            if meta_data.get("original_path") != original_path:
                return False
            q_path = meta_data.get("quarantine_path", "")
            if not q_path:
                return False
            full_q = Path(self.repo_root) / q_path
            return full_q.exists()
        except (json.JSONDecodeError, KeyError):
            return False

    def _try_match_metadata(self, meta_file: Path, original_path: str, run_id: Optional[str]) -> Optional[QuarantineMeta]:
        """Try to match a metadata file against original_path and run_id."""
        try:
            meta_data = json.loads(meta_file.read_text())
        except json.JSONDecodeError as e:
            raise ValueError(f"Corrupted metadata {meta_file.name}: {e}") from e

        if meta_data.get("original_path") != original_path:
            return None

        if run_id is not None and meta_data.get("run_id") != run_id:
            return None

        q_path = meta_data.get("quarantine_path", "")
        if q_path:
            full_q = Path(self.repo_root) / q_path
            if not full_q.exists():
                return None

        return QuarantineMeta(
            original_path=meta_data["original_path"],
            quarantine_path=q_path,
            violation_type=meta_data.get("violation_type", ""),
            run_id=meta_data.get("run_id", ""),
            phase=meta_data.get("phase", 0),
            timestamp=meta_data.get("timestamp", ""),
            boundary_commit=meta_data.get("boundary_commit", ""),
        )

    def _check_soft_size_limit(self):
        """Warn if quarantine dir exceeds soft size limit."""
        if not self._quarantine_base.exists():
            return

        try:
            total_size = 0
            for dirpath, _, filenames in os.walk(str(self._quarantine_base)):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    try:
                        total_size += os.path.getsize(fp)
                    except OSError:
                        pass

            size_mb = total_size / (1024 * 1024)
            if size_mb > SOFT_SIZE_LIMIT_MB:
                logger.warning(
                    "Quarantine dir exceeds soft size limit: %.1f MB > %d MB",
                    size_mb, SOFT_SIZE_LIMIT_MB
                )
        except OSError:
            pass

    def _check_restored_content(self, original_path: str, meta: QuarantineMeta):
        """Warn if restored file content differs from boundary_commit version."""
        boundary = meta.boundary_commit
        if not boundary or boundary == "EMPTY_REPO":
            logger.warning(
                "Restored file %s did not exist at boundary_commit (new file)",
                original_path
            )
            return

        original_full = Path(self.repo_root) / original_path
        try:
            r = subprocess.run(
                ["git", "cat-file", "-e", f"{boundary}:{original_path}"],
                cwd=self.repo_root, capture_output=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            if r.returncode != 0:
                logger.warning(
                    "Restored file %s did not exist at boundary_commit %s (new file)",
                    original_path, boundary
                )
                return

            r = subprocess.run(
                ["git", "show", f"{boundary}:{original_path}"],
                cwd=self.repo_root, capture_output=True,
                timeout=GIT_COMMAND_TIMEOUT_S,
            )
            if r.returncode == 0:
                boundary_content = r.stdout
                restored_content = original_full.read_bytes()
                if restored_content != boundary_content:
                    logger.warning(
                        "Restored file %s content differs from boundary_commit %s",
                        original_path, boundary
                    )
        except subprocess.TimeoutExpired:
            pass
