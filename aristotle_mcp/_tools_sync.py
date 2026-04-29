from __future__ import annotations

from pathlib import Path

from aristotle_mcp.config import (
    VALID_SCOPES,
    project_hash,
    resolve_repo_dir,
)
from aristotle_mcp.frontmatter import (
    load_rule_file,
    stream_filter_rules,
)
from aristotle_mcp.git_ops import git_show_exists

from aristotle_mcp.git_ops import _run as _git_run


def check_sync_status(scope: str = "all", project_path: str | None = None) -> dict:
    """Check for verified rules that exist on disk but are not committed to git.

    Scans all verified rule files and compares against git HEAD. Returns
    a list of unsynced files that need sync_rules() to repair.

    Args:
        scope: "user", "project", or "all"
        project_path: Required for project scope

    Returns dict with success, total_verified, unsynced_count, unsynced_files.
    """
    if scope not in VALID_SCOPES and scope != "all":
        return {"success": False, "message": f"Invalid scope: {scope}"}

    if scope == "project" and not project_path:
        return {
            "success": False,
            "message": "project_path is required when scope is 'project'",
        }

    repo_path = resolve_repo_dir()
    if not (repo_path / ".git").is_dir():
        return {"success": False, "message": "Repository not initialized"}

    dirs: list[Path] = []
    if scope == "user":
        dirs.append(repo_path / "user")
    elif scope == "project":
        dirs.append(repo_path / "projects" / project_hash(project_path))
    else:
        dirs.append(repo_path / "user")
        if project_path:
            dirs.append(repo_path / "projects" / project_hash(project_path))

    unsynced: list[dict] = []
    total_verified = 0

    for base_dir in dirs:
        if not base_dir.exists():
            continue
        paths = stream_filter_rules(base_dir, status_filter="verified", limit=1000)
        total_verified += len(paths)

        for p in paths:
            try:
                rel_path = str(p.relative_to(repo_path))
            except ValueError:
                continue
            if not git_show_exists(repo_path, rel_path):
                data = load_rule_file(p)
                rule_id = data.get("metadata", {}).get("id", "unknown")
                unsynced.append({"path": rel_path, "rule_id": rule_id})

    return {
        "success": True,
        "total_verified": total_verified,
        "unsynced_count": len(unsynced),
        "unsynced_files": unsynced,
    }


def sync_rules(file_paths: list[str] | None = None) -> dict:
    """Commit unsynced verified rules to git.

    If file_paths is None, auto-detects all unsynced verified files
    via check_sync logic and commits them in a single batch.

    Args:
        file_paths: Optional list of repo-relative paths to sync.
                    If None, auto-detects all unsynced files.

    Returns dict with success, synced_count, commit_hash, message.
    """
    repo_path = resolve_repo_dir()
    if not (repo_path / ".git").is_dir():
        return {"success": False, "message": "Repository not initialized"}

    if file_paths is not None:
        targets = file_paths
    else:
        status = check_sync_status()
        if not status["success"]:
            return {
                "success": False,
                "message": f"Sync check failed: {status.get('message')}",
            }
        targets = [f["path"] for f in status["unsynced_files"]]

    if not targets:
        return {
            "success": True,
            "synced_count": 0,
            "commit_hash": None,
            "message": "No unsynced files to commit.",
        }

    for rel_path in targets:
        abs_path = repo_path / rel_path
        if not abs_path.exists():
            return {
                "success": False,
                "synced_count": 0,
                "commit_hash": None,
                "message": f"File not found: {rel_path}",
            }

    if file_paths is not None:
        for rel_path in targets:
            _git_run(repo_path, ["add", rel_path])
    else:
        _git_run(repo_path, ["add", "."])

    commit_env = {
        "GIT_AUTHOR_NAME": "Aristotle MCP",
        "GIT_AUTHOR_EMAIL": "aristotle-mcp@local",
        "GIT_COMMITTER_NAME": "Aristotle MCP",
        "GIT_COMMITTER_EMAIL": "aristotle-mcp@local",
    }
    commit_result = _git_run(
        repo_path,
        ["commit", "-m", f"sync: {len(targets)} unsynced verified rule(s) committed"],
        env_extra=commit_env,
    )
    if commit_result.returncode != 0:
        return {
            "success": False,
            "synced_count": 0,
            "commit_hash": None,
            "message": f"Commit failed: {commit_result.stderr.strip()}",
        }

    rev = _git_run(repo_path, ["rev-parse", "--short=7", "HEAD"])
    commit_hash = rev.stdout.strip() if rev.returncode == 0 else None

    return {
        "success": True,
        "synced_count": len(targets),
        "commit_hash": commit_hash,
        "message": f"Synced {len(targets)} rule(s) to git.",
    }


def register_sync_tools(mcp) -> None:
    """Register sync tools with the MCP server."""
    mcp.tool()(check_sync_status)
    mcp.tool()(sync_rules)
