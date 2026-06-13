"""
Phase 4 stub — rollback tools.
Business code isolated to _phase5_ref/_tools_rollback.py for TDD Red phase.
"""
from pathlib import Path

# Constants
STASH_WARNING_THRESHOLD: int = 5
STASH_HARD_LIMIT: int = 10
UNTRACKED_FILES_THRESHOLD: int = 100 * 1024 * 1024  # 100 MB
STASH_CLEANUP_KEEP: int = 3
ROLLBACK_STASH_PREFIX = "aristotle-rollback:"
ROLLBACK_TAG_PREFIX = "aristotle-rollback-cp/"


def validate_path(filepath: str, repo_dir: Path) -> bool:
    """Stub: validate filepath is within repo_dir."""
    raise NotImplementedError("Phase 4 stub — validate_path not implemented")


def create_rollback_point(name: str, run_id: str = "") -> dict:
    """Stub: create a git stash checkpoint."""
    raise NotImplementedError("Phase 4 stub — create_rollback_point not implemented")


def rollback_to_checkpoint(name: str, run_id: str = "") -> dict:
    """Stub: apply stash matching checkpoint name."""
    raise NotImplementedError("Phase 4 stub — rollback_to_checkpoint not implemented")


def cleanup_rollback_stashes(keep: int = STASH_CLEANUP_KEEP) -> dict:
    """Stub: prune oldest prefixed stashes."""
    raise NotImplementedError("Phase 4 stub — cleanup_rollback_stashes not implemented")


def register_rollback_tools(mcp) -> None:
    pass
