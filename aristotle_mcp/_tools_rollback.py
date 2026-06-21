"""Rollback tools — checkpoint stash management for Aristotle rule repo.

Provides create_rollback_point, rollback_to_checkpoint, cleanup_rollback_stashes,
and validate_path helper.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir

try:
    from aristotle_mcp._audit_log import append_audit_entry
except ImportError:
    def append_audit_entry(entry: dict) -> dict:  # type: ignore[misc]
        return {"success": True}

# ── Constants ──

STASH_WARNING_THRESHOLD: int = 5
STASH_HARD_LIMIT: int = 10
UNTRACKED_FILES_THRESHOLD: int = 100 * 1024 * 1024  # 100 MB
STASH_CLEANUP_KEEP: int = 3
ROLLBACK_STASH_PREFIX = "aristotle-rollback:"
ROLLBACK_TAG_PREFIX = "aristotle-rollback-cp/"


# ── Internal helpers ──


def _stash_list(repo_dir: Path) -> list[str]:
    """Return raw stash list entries."""
    r = subprocess.run(
        ["git", "stash", "list"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return []
    return r.stdout.strip().split("\n")


def _count_prefixed_stashes(repo_dir: Path) -> int:
    """Count stashes with the aristotle-rollback: prefix."""
    return sum(1 for s in _stash_list(repo_dir) if ROLLBACK_STASH_PREFIX in s)


def _prefixed_stash_indices(repo_dir: Path) -> list[int]:
    """Return stash indices (0-based) for aristotle-rollback stashes, newest first."""
    result: list[int] = []
    for idx, entry in enumerate(_stash_list(repo_dir)):
        if ROLLBACK_STASH_PREFIX in entry:
            result.append(idx)
    return result


def _find_stash_index_for_checkpoint(repo_dir: Path, name: str) -> int | None:
    """Find the stash index for a checkpoint name. Returns None if not found."""
    marker = f"{ROLLBACK_STASH_PREFIX}checkpoint-{name}"
    for idx, entry in enumerate(_stash_list(repo_dir)):
        if marker in entry:
            return idx
    return None


# ── Public API ──


def validate_path(filepath: str, repo_dir: Path) -> bool:
    """Validate a filepath is within repo_dir.

    Blocks path traversal (../), accepts valid relative and absolute paths
    within repo, and rejects symlink escapes.
    """
    p = Path(filepath)

    # Block path traversal via ../
    if ".." in p.parts:
        return False

    repo_resolved = repo_dir.resolve()

    # Check symlink BEFORE resolve (resolve follows symlinks, making is_symlink() always False)
    unresolved = repo_dir / p if not p.is_absolute() else p
    if unresolved.exists() and unresolved.is_symlink():
        target = unresolved.resolve()
        try:
            target.relative_to(repo_resolved)
        except ValueError:
            return False

    # Resolve to absolute
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (repo_dir / p).resolve()

    # Must be within repo (belt-and-suspenders with symlink check above)
    try:
        resolved.relative_to(repo_resolved)
    except ValueError:
        return False

    return True


def create_rollback_point(name: str, run_id: str = "") -> dict:
    """Create a git stash checkpoint with the aristotle-rollback: prefix.

    Args:
        name: Checkpoint name (must not be empty).
        run_id: Optional run ID for audit tracking.

    Returns:
        dict with success, stash_ref, and optional warning/message.
    """
    if not name:
        return {"success": False, "error": "Checkpoint name must not be empty"}

    repo_dir = resolve_repo_dir()

    # Ensure repo has at least one commit (stash requires it)
    has_head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
    )
    if has_head.returncode != 0:
        # No commits yet — create an initial empty commit
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", "initial checkpoint base"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )

    # Check stash hard limit
    count = _count_prefixed_stashes(repo_dir)
    if count >= STASH_HARD_LIMIT:
        return {
            "success": False,
            "error": f"Stash hard limit reached ({STASH_HARD_LIMIT}). "
            f"Run cleanup_rollback_stashes() to free space.",
        }

    # Create the stash
    stash_msg = f"{ROLLBACK_STASH_PREFIX}checkpoint-{name}"
    result = subprocess.run(
        ["git", "stash", "push", "-m", stash_msg, "--include-untracked"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        return {"success": False, "error": result.stderr.strip() or "git stash failed"}

    no_changes = (
        "No local changes to save" in result.stdout
        or "No local changes to save" in result.stderr
    )
    if no_changes:
        # Create a lightweight tag as checkpoint marker
        tag_name = f"{ROLLBACK_TAG_PREFIX}{name}"
        subprocess.run(
            ["git", "tag", "-f", tag_name],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )

        append_audit_entry({
            "tool": "create_rollback_point",
            "params": {"name": name, "run_id": run_id},
            "result": "success",
            "runId": run_id or "none",
            "message": "No changes to stash",
        })
        response: dict = {
            "success": True,
            "message": "No changes to stash",
            "stash_ref": None,
        }
        return response

    stash_list = _stash_list(repo_dir)
    stash_ref = "stash@{0}" if stash_list else None

    # Get unique stash commit hash for identification
    stash_hash = None
    if stash_ref:
        hash_result = subprocess.run(
            ["git", "stash", "list", "--format=%H", "-1"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )
        if hash_result.returncode == 0 and hash_result.stdout.strip():
            stash_hash = hash_result.stdout.strip()[:12]
            stash_ref = f"stash@{{0}}:{stash_hash}"

    # Check warning threshold
    new_count = _count_prefixed_stashes(repo_dir)
    warning = None
    if new_count > STASH_WARNING_THRESHOLD:
        warning = (
            f"Stash count ({new_count}) exceeds warning threshold "
            f"({STASH_WARNING_THRESHOLD}). Consider running "
            f"cleanup_rollback_stashes()."
        )

    # Write audit entry
    append_audit_entry({
        "tool": "create_rollback_point",
        "params": {"name": name, "run_id": run_id},
        "result": "success",
        "runId": run_id or "none",
        "stash_ref": stash_ref,
    })

    response = {"success": True, "stash_ref": stash_ref}
    if warning:
        response["warning"] = warning
    return response


def rollback_to_checkpoint(name: str, run_id: str = "") -> dict:
    """Apply the stash matching a checkpoint name.

    Uses git stash apply (not pop) to preserve stash on conflict.
    If no matching stash is found, restores working tree to HEAD.

    Args:
        name: Checkpoint name to roll back to.
        run_id: Optional run ID for audit tracking.

    Returns:
        dict with success, pipeline_reset_required, and optional warning/error.
    """
    repo_dir = resolve_repo_dir()

    # Check untracked files size (warning only)
    warning = None
    aristotle_dir = repo_dir / ".aristotle"
    total_size = sum(
        f.stat().st_size
        for f in aristotle_dir.rglob("*")
        if f.is_file()
    ) if aristotle_dir.exists() else 0
    total_size += sum(
        f.stat().st_size
        for f in repo_dir.iterdir()
        if f.is_file()
    )
    if total_size > UNTRACKED_FILES_THRESHOLD:
        warning = f"Large untracked files detected ({total_size} bytes). Rollback may take longer."

    stash_idx = _find_stash_index_for_checkpoint(repo_dir, name)
    tag_name = f"{ROLLBACK_TAG_PREFIX}{name}"
    tag_exists = subprocess.run(
        ["git", "rev-parse", tag_name],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
    )
    has_tag = tag_exists.returncode == 0

    if stash_idx is not None:
        stash_ref = f"stash@{{{stash_idx}}}"
        apply_result = subprocess.run(
            ["git", "stash", "apply", stash_ref],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )

        if apply_result.returncode != 0:
            stderr = apply_result.stderr.strip()
            error_msg = stderr or "git stash apply failed"

            if "conflict" in stderr.lower():
                error_msg = f"Merge conflict during rollback: {stderr}"

            append_audit_entry({
                "tool": "rollback_to_checkpoint",
                "params": {"name": name, "run_id": run_id},
                "result": "error",
                "runId": run_id or "none",
                "error": error_msg,
            })

            response: dict = {"success": False, "error": error_msg}
            if warning:
                response["warning"] = warning
            return response
    elif has_tag:
        audit_path = repo_dir / ".aristotle" / "audit.jsonl"
        audit_backup = audit_path.read_text() if audit_path.exists() else ""
        checkout_result = subprocess.run(
            ["git", "checkout", tag_name, "--", "."],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )
        if checkout_result.returncode != 0:
            if audit_backup:
                audit_path.parent.mkdir(parents=True, exist_ok=True)
                audit_path.write_text(audit_backup)
            append_audit_entry({
                "tool": "rollback_to_checkpoint",
                "params": {"name": name, "run_id": run_id},
                "result": "error",
                "runId": run_id or "none",
                "error": f"git checkout failed: {checkout_result.stderr.strip()}",
            })
            return {"success": False, "error": f"git checkout failed: {checkout_result.stderr.strip()}"}
        subprocess.run(
            ["git", "clean", "-fd"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )
        if audit_backup:
            audit_path.parent.mkdir(parents=True, exist_ok=True)
            audit_path.write_text(audit_backup)
    else:
        error_result = {
            "success": False,
            "error": f"Checkpoint '{name}' not found in stash list",
        }
        append_audit_entry({
            "tool": "rollback_to_checkpoint",
            "params": {"name": name, "run_id": run_id},
            "result": "error",
            "runId": run_id or "none",
            "error": error_result["error"],
        })
        return error_result

    append_audit_entry({
        "tool": "rollback_to_checkpoint",
        "params": {"name": name, "run_id": run_id},
        "result": "success",
        "runId": run_id or "none",
    })

    response = {"success": True, "pipeline_reset_required": True}
    if warning:
        response["warning"] = warning
    return response


def cleanup_rollback_stashes(keep: int = STASH_CLEANUP_KEEP) -> dict:
    """Remove oldest aristotle-rollback stashes, keeping the newest ones.

    Args:
        keep: Number of newest prefixed stashes to keep.
              0 = delete all. Must be non-negative integer.

    Returns:
        dict with success and removed_count.
    """
    # Validate keep parameter
    if not isinstance(keep, int) or keep < 0:
        return {
            "success": False,
            "error": f"'keep' must be a non-negative integer, got {keep!r}",
        }

    repo_dir = resolve_repo_dir()

    # Get prefixed stash indices (newest first, i.e. 0, 1, 2...)
    indices = _prefixed_stash_indices(repo_dir)

    if not indices:
        append_audit_entry({
            "tool": "cleanup_rollback_stashes",
            "params": {"keep": keep},
            "result": "success",
            "runId": "none",
            "message": "No prefixed stashes to clean up",
        })
        return {"success": True, "removed_count": 0}

    # Determine which to keep (newest = lowest index)
    # indices are already in order: 0, 1, 2, ... (stash@{0} is newest)
    to_keep = set(indices[:keep])
    to_remove = [i for i in indices if i not in to_keep]

    if not to_remove:
        append_audit_entry({
            "tool": "cleanup_rollback_stashes",
            "params": {"keep": keep},
            "result": "success",
            "runId": "none",
            "removed_count": 0,
        })
        return {"success": True, "removed_count": 0}

    # Drop stashes from highest index first (to avoid index shifting)
    removed = 0
    for idx in sorted(to_remove, reverse=True):
        drop_result = subprocess.run(
            ["git", "stash", "drop", f"stash@{{{idx}}}"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
        )
        if drop_result.returncode == 0:
            removed += 1

    append_audit_entry({
        "tool": "cleanup_rollback_stashes",
        "params": {"keep": keep},
        "result": "success",
        "runId": "none",
        "removed_count": removed,
    })

    return {"success": True, "removed_count": removed}


def register_rollback_tools(mcp) -> None:
    """Register rollback tools with the MCP server."""
    mcp.tool()(create_rollback_point)
    mcp.tool()(rollback_to_checkpoint)
    mcp.tool()(cleanup_rollback_stashes)
