from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from aristotle_mcp.config import (
    DEFAULT_RISK_LEVEL,
    RISK_MAP,
    VALID_SCOPES,
    VALID_STATUSES,
    project_hash,
    resolve_repo_dir,
)
from aristotle_mcp.frontmatter import (
    load_rule_file,
    read_frontmatter_raw,
    stream_filter_rules,
    update_frontmatter_field,
    write_rule_file,
)
from aristotle_mcp.git_ops import git_add_and_commit
from aristotle_mcp.migration import init_repo, migrate_learnings
from aristotle_mcp.models import RuleMetadata

mcp = FastMCP("aristotle-mcp")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_path(file_path: str) -> Path:
    p = Path(file_path)
    if p.is_absolute():
        return p
    return resolve_repo_dir() / p


def _unique_filename(directory: Path, base_name: str) -> Path:
    candidate = directory / f"{base_name}.md"
    if not candidate.exists():
        return candidate
    suffix = 1
    while True:
        candidate = directory / f"{base_name}_{suffix}.md"
        if not candidate.exists():
            return candidate
        suffix += 1


@mcp.tool()
def init_repo_tool() -> dict:
    """Initialize the Aristotle rule repository with Git version control.

    Creates the repo directory structure, initializes Git, and migrates
    any existing flat learnings files into the new format.

    Returns dict with success, message, and repo_path.
    """
    repo_path = resolve_repo_dir()
    result = init_repo(repo_path)
    if not result["success"]:
        return {
            "success": False,
            "message": f"Repo init failed: {result['message']}",
            "repo_path": str(repo_path),
        }

    migration = migrate_learnings(repo_path)
    return {
        "success": True,
        "message": (
            f"Repository initialized at {repo_path}. Migration: {migration['message']}"
        ),
        "repo_path": str(repo_path),
    }


@mcp.tool()
def write_rule(
    content: str,
    scope: str = "user",
    category: str = "",
    source_session: str | None = None,
    message_range: str | None = None,
    project_path: str | None = None,
) -> dict:
    """Write a new rule file to the repository.

    Args:
        content: The Markdown body of the rule (Context/Rule/Why/Example sections)
        scope: "user" for global rules, "project" for project-specific rules
        category: Error category (e.g. HALLUCINATION, PATTERN_VIOLATION)
        source_session: OpenCode session ID where the error was found
        message_range: Message range in the source session
        project_path: Required when scope is "project"

    Returns dict with success, message, file_path, rule_id.
    """
    if scope not in VALID_SCOPES:
        return {
            "success": False,
            "message": f"Invalid scope: {scope}. Must be one of {VALID_SCOPES}",
        }

    if scope == "project" and not project_path:
        return {
            "success": False,
            "message": "project_path is required when scope is 'project'",
        }

    repo_path = resolve_repo_dir()
    rule_id = f"rec_{int(time.time())}"
    p_hash = project_hash(project_path) if scope == "project" else None
    risk_level = RISK_MAP.get(category, DEFAULT_RISK_LEVEL)

    if scope == "user":
        target_dir = repo_path / "user"
    else:
        target_dir = repo_path / "projects" / p_hash

    target_dir.mkdir(parents=True, exist_ok=True)

    now = _now_iso()
    date_prefix = now[:10]
    cat_suffix = category.lower() if category else "general"
    base_name = f"{date_prefix}_{cat_suffix}"
    file_path = _unique_filename(target_dir, base_name)

    metadata = RuleMetadata(
        id=rule_id,
        status="pending",
        scope=scope,
        project_hash=p_hash,
        category=category,
        confidence=0.7,
        risk_level=risk_level,
        source_session=source_session,
        message_range=message_range,
        created_at=now,
    )

    result = write_rule_file(file_path, metadata.__dict__, content)
    if not result["success"]:
        return {
            "success": False,
            "message": result["message"],
            "file_path": None,
            "rule_id": rule_id,
        }

    return {
        "success": True,
        "message": f"Rule {rule_id} written to {file_path}",
        "file_path": str(file_path),
        "rule_id": rule_id,
    }


@mcp.tool()
def read_rules(
    scope: str = "all",
    status: str = "verified",
    category: str | None = None,
    keyword: str | None = None,
    project_path: str | None = None,
    limit: int = 50,
) -> dict:
    """Read rules by querying frontmatter with regex matching.

    The keyword parameter applies regex match against ALL frontmatter
    field values (scalar fields only).

    Args:
        scope: "user", "project", or "all"
        status: Filter by status ("verified", "pending", "all")
        category: Exact match on error category
        keyword: Regex pattern to match against frontmatter values
        project_path: Required when scope is "project"
        limit: Maximum number of results

    Returns dict with success, count, rules (list of {path, metadata, content}).
    """
    if scope not in VALID_SCOPES and scope != "all":
        return {"success": False, "message": f"Invalid scope: {scope}"}

    if status not in VALID_STATUSES and status != "all":
        return {"success": False, "message": f"Invalid status: {status}"}

    if scope == "project" and not project_path:
        return {
            "success": False,
            "message": "project_path is required when scope is 'project'",
        }

    repo_path = resolve_repo_dir()

    dirs: list[Path] = []
    if scope == "user":
        dirs.append(repo_path / "user")
    elif scope == "project":
        dirs.append(repo_path / "projects" / project_hash(project_path))
    else:
        dirs.append(repo_path / "user")
        if project_path:
            dirs.append(repo_path / "projects" / project_hash(project_path))

    status_filter = status
    include_rejected = status in ("all", "rejected")
    if include_rejected and status != "all":
        status_filter = "rejected"

    rules: list[dict] = []
    remaining = limit

    for base_dir in dirs:
        if remaining <= 0:
            break

        paths = stream_filter_rules(
            base_dir,
            status_filter=status_filter if status != "all" else "all",
            keyword=keyword,
            category=category,
            limit=remaining,
        )
        for p in paths:
            data = load_rule_file(p)
            rules.append(
                {
                    "path": str(p),
                    "metadata": data["metadata"],
                    "content": data["content"],
                }
            )
        remaining -= len(paths)

        if include_rejected:
            rejected_dir = _rejected_dir_for(base_dir, repo_path)
            if rejected_dir.exists() and remaining > 0:
                paths = stream_filter_rules(
                    rejected_dir,
                    status_filter="rejected",
                    keyword=keyword,
                    category=category,
                    limit=remaining,
                )
                for p in paths:
                    data = load_rule_file(p)
                    rules.append(
                        {
                            "path": str(p),
                            "metadata": data["metadata"],
                            "content": data["content"],
                        }
                    )
                remaining -= len(paths)

    return {"success": True, "count": len(rules), "rules": rules}


@mcp.tool()
def stage_rule(file_path: str) -> dict:
    """Mark a pending rule as staging (under review).

    Args:
        file_path: Path to the rule file (relative to repo root or absolute)

    Returns dict with success, message.
    """
    path = _resolve_path(file_path)
    if not path.exists():
        return {"success": False, "message": f"File not found: {path}"}

    result = update_frontmatter_field(path, "status", "staging")
    if not result["success"]:
        return {"success": False, "message": result["message"]}

    return {"success": True, "message": f"Rule staged: {path}"}


@mcp.tool()
def commit_rule(file_path: str, message: str | None = None) -> dict:
    """Verify a rule and commit it to Git.

    Updates status to "verified", sets verified_at timestamp and verified_by to "auto".
    Then performs git add and commit.

    Args:
        file_path: Path to the rule file (relative to repo root or absolute)
        message: Custom commit message (default: "rule: verify {rule_id}")

    Returns dict with success, message, commit_hash.
    """
    path = _resolve_path(file_path)
    if not path.exists():
        return {
            "success": False,
            "message": f"File not found: {path}",
            "commit_hash": None,
        }

    data = load_rule_file(path)
    metadata = data["metadata"]
    metadata["status"] = "verified"
    metadata["verified_at"] = _now_iso()
    metadata["verified_by"] = "auto"

    write_result = write_rule_file(path, metadata, data["content"])
    if not write_result["success"]:
        return {
            "success": False,
            "message": write_result["message"],
            "commit_hash": None,
        }

    repo_path = resolve_repo_dir()
    try:
        rel_path = str(path.relative_to(repo_path))
    except ValueError:
        rel_path = str(path)

    rule_id = metadata.get("id", "unknown")
    commit_msg = message or f"rule: verify {rule_id}"
    commit_result = git_add_and_commit(repo_path, rel_path, commit_msg)

    return {
        "success": commit_result["success"],
        "message": commit_result.get("message", "OK"),
        "commit_hash": commit_result.get("commit_hash"),
    }


@mcp.tool()
def reject_rule(file_path: str, reason: str = "") -> dict:
    """Reject a rule and move it to the rejected directory.

    The file is moved to rejected/{scope}/ preserving directory structure.

    Args:
        file_path: Path to the rule file
        reason: Reason for rejection

    Returns dict with success, message, new_path.
    """
    path = _resolve_path(file_path)
    if not path.exists():
        return {
            "success": False,
            "message": f"File not found: {path}",
            "new_path": None,
        }

    data = load_rule_file(path)
    metadata = data["metadata"]
    content = data["content"]

    repo_path = resolve_repo_dir()
    rule_id = metadata.get("id", "unknown")

    try:
        rel = path.relative_to(repo_path)
    except ValueError:
        return {"success": False, "message": "File is outside repo", "new_path": None}

    parts = rel.parts
    if parts[0] == "user":
        rejected_rel = Path("rejected") / "user" / rel.name
    elif parts[0] == "projects":
        rejected_rel = Path("rejected") / "projects" / parts[1] / rel.name
    else:
        rejected_rel = Path("rejected") / rel.name

    rejected_path = repo_path / rejected_rel
    rejected_path.parent.mkdir(parents=True, exist_ok=True)

    metadata["status"] = "rejected"
    metadata["rejected_at"] = _now_iso()
    metadata["rejected_reason"] = reason if reason else None

    write_result = write_rule_file(rejected_path, metadata, content)
    if not write_result["success"]:
        return {"success": False, "message": write_result["message"], "new_path": None}

    path.unlink()

    commit_msg = f"rule: reject {rule_id} — {reason[:50]}"
    git_add_and_commit(repo_path, ".", commit_msg)

    return {
        "success": True,
        "message": f"Rule {rule_id} rejected and moved to {rejected_path}",
        "new_path": str(rejected_path),
    }


@mcp.tool()
def list_rules(
    scope: str = "all",
    status_filter: str = "all",
    project_path: str | None = None,
    limit: int = 100,
) -> dict:
    """List all rules with their status and metadata.

    Lighter than read_rules — returns metadata only, no content bodies.

    Args:
        scope: "user", "project", or "all"
        status_filter: Filter by status
        project_path: Required for project scope
        limit: Maximum results

    Returns dict with success, count, rules (list of {path, metadata}).
    """
    if scope not in VALID_SCOPES and scope != "all":
        return {"success": False, "message": f"Invalid scope: {scope}"}

    if status_filter not in VALID_STATUSES and status_filter != "all":
        return {"success": False, "message": f"Invalid status_filter: {status_filter}"}

    if scope == "project" and not project_path:
        return {
            "success": False,
            "message": "project_path is required when scope is 'project'",
        }

    repo_path = resolve_repo_dir()

    dirs: list[Path] = []
    if scope == "user":
        dirs.append(repo_path / "user")
    elif scope == "project":
        dirs.append(repo_path / "projects" / project_hash(project_path))
    else:
        dirs.append(repo_path / "user")
        if project_path:
            dirs.append(repo_path / "projects" / project_hash(project_path))

    fm_status = status_filter if status_filter != "all" else "all"
    include_rejected = status_filter in ("all", "rejected")

    rules: list[dict] = []
    remaining = limit

    for base_dir in dirs:
        if remaining <= 0:
            break

        paths = stream_filter_rules(
            base_dir,
            status_filter=fm_status,
            limit=remaining,
        )
        for p in paths:
            fm = read_frontmatter_raw(p)
            rules.append({"path": str(p), "metadata": fm or {}})
        remaining -= len(paths)

        if include_rejected:
            rejected_dir = _rejected_dir_for(base_dir, repo_path)
            if rejected_dir.exists() and remaining > 0:
                paths = stream_filter_rules(
                    rejected_dir,
                    status_filter="rejected",
                    limit=remaining,
                )
                for p in paths:
                    fm = read_frontmatter_raw(p)
                    rules.append({"path": str(p), "metadata": fm or {}})
                remaining -= len(paths)

    return {"success": True, "count": len(rules), "rules": rules}


def _rejected_dir_for(base_dir: Path, repo_path: Path) -> Path:
    try:
        rel = base_dir.relative_to(repo_path)
    except ValueError:
        return repo_path / "rejected"
    parts = rel.parts
    if parts[0] == "user":
        return repo_path / "rejected" / "user"
    if parts[0] == "projects":
        return repo_path / "rejected" / "projects" / parts[1]
    return repo_path / "rejected"


if __name__ == "__main__":
    mcp.run()
