from __future__ import annotations

import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from aristotle_mcp.config import (
    AUDIT_THRESHOLDS,
    DEFAULT_RISK_LEVEL,
    RISK_MAP,
    VALID_SCOPES,
    VALID_STATUSES,
    WORKFLOW_DIR_NAME,
    project_hash,
    resolve_repo_dir,
)
from aristotle_mcp.evolution import compute_delta, decide_audit_level
from aristotle_mcp.frontmatter import (
    load_rule_file,
    read_frontmatter_raw,
    stream_filter_rules,
    update_frontmatter_field,
    write_rule_file,
)
from aristotle_mcp.git_ops import git_add_and_commit, git_show_exists
from aristotle_mcp.migration import init_repo, migrate_learnings
from aristotle_mcp.models import RuleMetadata

mcp = FastMCP("aristotle-mcp")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_path(file_path: str) -> Path:
    p = Path(file_path)
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (resolve_repo_dir() / p).resolve()

    repo_root = resolve_repo_dir().resolve()
    if not resolved.is_relative_to(repo_root):
        raise ValueError(f"Path escapes repo: {file_path}")
    return resolved


def _safe_resolve(file_path: str) -> tuple[Path | None, dict | None]:
    try:
        return _resolve_path(file_path), None
    except ValueError as e:
        return None, {"success": False, "message": str(e)}


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
def get_audit_decision(file_path: str) -> dict:
    """Compute Δ and return audit level decision for a staging rule.

    Reads the rule's confidence and risk_level from frontmatter,
    computes Δ = confidence × (1 - risk_weight), and maps to
    auto / semi / manual.

    Args:
        file_path: Path to the rule file (relative to repo root or absolute)

    Returns dict with delta, audit_level, thresholds.
    """
    path, err = _safe_resolve(file_path)
    if err:
        return err
    if not path.exists():
        return {"success": False, "message": f"File not found: {path}"}

    data = load_rule_file(path)
    metadata = data["metadata"]

    confidence = metadata.get("confidence", 0.7)
    risk_level = metadata.get("risk_level", DEFAULT_RISK_LEVEL)

    try:
        delta = compute_delta(confidence, risk_level)
    except ValueError as e:
        return {"success": False, "message": str(e)}

    audit_level = decide_audit_level(delta)

    return {
        "success": True,
        "rule_id": metadata.get("id", "unknown"),
        "delta": round(delta, 4),
        "audit_level": audit_level,
        "confidence": confidence,
        "risk_level": risk_level,
        "risk_weight": RISK_MAP.get(metadata.get("category", ""), risk_level),
        "thresholds": AUDIT_THRESHOLDS,
    }


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
    confidence: float = 0.7,
    intent_domain: str | None = None,
    intent_task_goal: str | None = None,
    failed_skill: str | None = None,
    error_summary: str | None = None,
) -> dict:
    """Write a new rule file to the repository.

    Args:
        content: The Markdown body of the rule (Context/Rule/Why/Example sections)
        scope: "user" for global rules, "project" for project-specific rules
        category: Error category (e.g. HALLUCINATION, PATTERN_VIOLATION)
        source_session: OpenCode session ID where the error was found
        message_range: Message range in the source session
        project_path: Required when scope is "project"
        intent_domain: Domain tag for intent classification (e.g. "text_analysis")
        intent_task_goal: Task goal tag for intent classification (e.g. "extract_entity")
        failed_skill: Associated skill ID that triggered the error
        error_summary: Concise error context summary
        confidence: R's confidence score (0.0-1.0). Default 0.7

    Returns dict with success, message, file_path, rule_id.
    """
    repo_path = resolve_repo_dir()
    if not (repo_path / ".git").is_dir():
        init_result = init_repo(repo_path)
        if not init_result["success"]:
            return {"success": False, "message": f"Repo not initialized and auto-init failed: {init_result['message']}"}

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

    rule_id = f"rec_{int(time.time())}"
    p_hash = project_hash(project_path) if scope == "project" else None
    risk_level = RISK_MAP.get(category, DEFAULT_RISK_LEVEL)

    if scope == "user":
        target_dir = repo_path / "user"
    else:
        target_dir = repo_path / "projects" / p_hash

    target_dir.mkdir(parents=True, exist_ok=True)

    intent_tags = None
    if intent_domain or intent_task_goal:
        intent_tags = {}
        if intent_domain:
            intent_tags["domain"] = intent_domain
        if intent_task_goal:
            intent_tags["task_goal"] = intent_task_goal

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
        confidence=confidence,
        risk_level=risk_level,
        source_session=source_session,
        message_range=message_range,
        created_at=now,
        intent_tags=intent_tags,
        failed_skill=failed_skill,
        error_summary=error_summary,
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
    intent_domain: str | None = None,
    intent_task_goal: str | None = None,
    failed_skill: str | None = None,
    error_summary: str | None = None,
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
        intent_domain: Regex match against intent_tags.domain
        intent_task_goal: Regex match against intent_tags.task_goal
        failed_skill: Regex match against failed_skill field
        error_summary: Regex match against error_summary field

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
            intent_domain=intent_domain,
            intent_task_goal=intent_task_goal,
            failed_skill=failed_skill,
            error_summary=error_summary,
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
                    intent_domain=intent_domain,
                    intent_task_goal=intent_task_goal,
                    failed_skill=failed_skill,
                    error_summary=error_summary,
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
    path, err = _safe_resolve(file_path)
    if err:
        return err
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
    path, err = _safe_resolve(file_path)
    if err:
        return {**err, "commit_hash": None}
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
    path, err = _safe_resolve(file_path)
    if err:
        return {**err, "new_path": None}
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
def restore_rule(file_path: str, new_status: str = "pending") -> dict:
    """Restore a rejected rule back to the active directory.

    Moves the file from rejected/{scope}/ back to the active directory,
    clears rejection metadata, and sets the new status.

    Args:
        file_path: Path to the rejected rule file (relative to repo root or absolute)
        new_status: Status to set after restore (default: "pending")

    Returns dict with success, message, new_path.
    """
    path, err = _safe_resolve(file_path)
    if err:
        return {**err, "new_path": None}
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

    try:
        rel = path.relative_to(repo_path)
    except ValueError:
        return {"success": False, "message": "File is outside repo", "new_path": None}

    parts = rel.parts
    if parts[0] != "rejected":
        return {
            "success": False,
            "message": "File is not in the rejected directory",
            "new_path": None,
        }

    if len(parts) >= 3 and parts[1] == "user":
        active_rel = Path("user") / parts[2]
    elif len(parts) >= 4 and parts[1] == "projects":
        active_rel = Path("projects") / parts[2] / parts[3]
    else:
        active_rel = Path(parts[-1])

    active_path = repo_path / active_rel
    active_path.parent.mkdir(parents=True, exist_ok=True)

    stem = active_path.stem
    active_path = _unique_filename(active_path.parent, stem)

    metadata["status"] = new_status
    metadata["rejected_at"] = None
    metadata["rejected_reason"] = None

    write_result = write_rule_file(active_path, metadata, content)
    if not write_result["success"]:
        return {"success": False, "message": write_result["message"], "new_path": None}

    path.unlink()

    rule_id = metadata.get("id", "unknown")
    commit_msg = f"rule: restore {rule_id}"
    git_add_and_commit(repo_path, ".", commit_msg)

    return {
        "success": True,
        "message": f"Rule {rule_id} restored to {active_path}",
        "new_path": str(active_path),
    }


@mcp.tool()
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


@mcp.tool()
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

    from aristotle_mcp.git_ops import _run as _git_run

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


@mcp.tool()
def list_rules(
    scope: str = "all",
    status_filter: str = "all",
    project_path: str | None = None,
    limit: int = 100,
    intent_domain: str | None = None,
    intent_task_goal: str | None = None,
    failed_skill: str | None = None,
    error_summary: str | None = None,
    category: str | None = None,
    keyword: str | None = None,
) -> dict:
    """List rules with metadata only (no content bodies).

    Supports the same search dimensions as read_rules but returns
    lightweight results — paths and frontmatter only. Use this for
    relevance scoring before selectively reading content.

    Args:
        scope: "user", "project", or "all"
        status_filter: Filter by status
        project_path: Required for project scope
        limit: Maximum results
        intent_domain: Regex match against intent_tags.domain
        intent_task_goal: Regex match against intent_tags.task_goal
        failed_skill: Regex match against failed_skill field
        error_summary: Regex match against error_summary field
        category: Exact match on error category
        keyword: Regex pattern to match against frontmatter values

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
            intent_domain=intent_domain,
            intent_task_goal=intent_task_goal,
            failed_skill=failed_skill,
            error_summary=error_summary,
            category=category,
            keyword=keyword,
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
                    intent_domain=intent_domain,
                    intent_task_goal=intent_task_goal,
                    failed_skill=failed_skill,
                    error_summary=error_summary,
                    category=category,
                    keyword=keyword,
                )
                for p in paths:
                    fm = read_frontmatter_raw(p)
                    rules.append({"path": str(p), "metadata": fm or {}})
                remaining -= len(paths)

    return {"success": True, "count": len(rules), "rules": rules}


@mcp.tool()
def persist_draft(sequence: int, content: str) -> dict:
    """Persist a DRAFT report to disk for later review and re-reflect.

    Args:
        sequence: State record sequence number
        content: Full DRAFT report markdown content

    Returns dict with success, file_path.
    """
    drafts_dir = resolve_repo_dir().parent / "aristotle-drafts"
    drafts_dir.mkdir(parents=True, exist_ok=True)
    file_path = drafts_dir / f"rec_{sequence}.md"
    # Atomic write
    tmp = file_path.with_suffix(".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.rename(file_path)
    return {"success": True, "file_path": str(file_path)}


@mcp.tool()
def create_reflection_record(
    target_session_id: str,
    target_label: str,
    reflector_session_id: str,
) -> dict:
    """Append a new reflection record to the state file.

    Auto-generates sequence number, handles 50-record pruning with
    DRAFT file cleanup, and returns the new record id.

    Args:
        target_session_id: The session being analyzed
        target_label: Short label (e.g. "current", "last", "passive-trigger")
        reflector_session_id: The Reflector subagent's session ID

    Returns dict with success, id, draft_file_path.
    """
    import json

    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)

    if state_path.exists():
        try:
            records = json.loads(state_path.read_text(encoding="utf-8"))
            if not isinstance(records, list):
                records = []
        except (json.JSONDecodeError, ValueError):
            records = []
    else:
        records = []

    n = len(records) + 1
    record_id = f"rec_{n}"
    drafts_dir = resolve_repo_dir().parent / "aristotle-drafts"
    draft_path = drafts_dir / f"rec_{n}.md"

    record = {
        "id": record_id,
        "reflector_session_id": reflector_session_id,
        "target_session_id": target_session_id,
        "target_label": target_label,
        "draft_file_path": str(draft_path),
        "launched_at": _now_iso(),
        "status": "processing",
        "rules_count": None,
    }

    records.append(record)

    while len(records) > 50:
        old = records.pop(0)
        old_draft = old.get("draft_file_path")
        if old_draft:
            old_path = Path(old_draft).expanduser()
            if old_path.exists():
                old_path.unlink()

    state_path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    actual_idx = None
    for i, r in enumerate(records):
        if r.get("reflector_session_id") == reflector_session_id:
            actual_idx = i + 1
            break

    return {
        "success": True,
        "id": record_id,
        "sequence": n,
        "review_index": actual_idx or len(records),
        "draft_file_path": str(draft_path),
        "total_records": len(records),
    }


@mcp.tool()
def complete_reflection_record(
    sequence: int,
    status: str,
    rules_count: int | None = None,
) -> dict:
    """Update a reflection record after Checker completes.

    Updates status, rules_count, and completed_at timestamp.

    Args:
        sequence: The record sequence number (from create_reflection_record)
        status: New status (auto_committed, partial_commit, checker_failed)
        rules_count: Number of rules processed

    Returns dict with success, message.
    """
    import json

    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    if not state_path.exists():
        return {"success": False, "message": "State file not found"}

    try:
        records = json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        return {"success": False, "message": "State file corrupted"}

    target_id = f"rec_{sequence}"
    found = False
    for record in records:
        if record.get("id") == target_id:
            record["status"] = status
            record["completed_at"] = _now_iso()
            if rules_count is not None:
                record["rules_count"] = rules_count
            found = True
            break

    if not found:
        return {"success": False, "message": f"Record {target_id} not found"}

    state_path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    return {"success": True, "message": f"Record {target_id} updated to {status}"}


# ═══════════════════════════════════════════════════════════
# Orchestration Tools (Function-Call-O MVP)
# ═══════════════════════════════════════════════════════════

O_INTENT_PROMPT = """You are a semantic analysis agent. Extract structured intent from the user's learning query.

USER QUERY:
```
{query}
```

Extract the following fields and return ONLY valid JSON (no markdown, no explanation):

{{
  "intent_tags": {{
    "domain": "<one of: file_operations, api_integration, database_operations, code_generation, build_system, testing, deployment, general>",
    "task_goal": "<short phrase describing the user's intended outcome>"
  }},
  "keywords": "<2-4 core technical terms joined by | for regex matching, e.g. prisma|timeout|pool>"
}}

Rules:
- domain must be one of the listed values
- task_goal should describe the user's intent, NOT the error
- keywords should capture the most distinctive technical terms
- Return ONLY the JSON object, nothing else
"""


def _workflow_dir() -> Path:
    return resolve_repo_dir() / WORKFLOW_DIR_NAME


def _save_workflow(workflow_id: str, state: dict) -> None:
    d = _workflow_dir()
    d.mkdir(parents=True, exist_ok=True)
    # Ensure .workflows/ is gitignored
    gitignore = resolve_repo_dir() / ".gitignore"
    if gitignore.exists():
        content = gitignore.read_text(encoding="utf-8")
        if ".workflows/" not in content:
            gitignore.write_text(content + ".workflows/\n", encoding="utf-8")
    path = d / f"{workflow_id}.json"
    state["updated_at"] = _now_iso()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _load_workflow(workflow_id: str) -> dict | None:
    path = _workflow_dir() / f"{workflow_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
        return None


def _build_intent_extraction_prompt(query: str) -> str:
    safe_query = query[:500]
    return O_INTENT_PROMPT.format(query=safe_query)


def _do_search_and_notify(workflow_id: str) -> dict:
    """Execute list_rules with workflow's intent tags and return formatted notification."""
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "workflow_id": workflow_id, "message": "🦉 Workflow state lost."}

    intent = workflow.get("intent_tags", {})
    keywords = workflow.get("keywords", "")

    params: dict = {"status_filter": "verified"}
    if intent.get("domain"):
        params["intent_domain"] = intent["domain"]
    if intent.get("task_goal"):
        params["intent_task_goal"] = intent["task_goal"]
    if keywords:
        params["keyword"] = keywords

    result = list_rules(**params)

    # Mark workflow done
    workflow["phase"] = "done"
    workflow["result_count"] = result.get("count", 0)
    _save_workflow(workflow_id, workflow)

    count = result.get("count", 0)
    if count == 0:
        msg = "🦉 No relevant lessons found for this query."
    else:
        rules = result.get("rules", [])
        lines = [f"🦉 Found {count} relevant lesson(s):"]
        for i, r in enumerate(rules[:5], 1):
            meta = r.get("metadata", {})
            summary = meta.get("error_summary", "No summary")
            cat = meta.get("category", "?")
            lines.append(f"  {i}. [{cat}] {summary}")
        msg = "\n".join(lines)

    return {
        "action": "notify",
        "workflow_id": workflow_id,
        "message": msg,
        "result_count": count,
    }


@mcp.tool()
def orchestrate_start(command: str, args_json: str = "{}") -> dict:
    """Analyze command, initialize workflow state, return first action.

    Args:
        command: Command type ("learn", "reflect", "review")
        args_json: JSON string with command parameters

    Returns dict with action ("fire_o"|"notify"|"done"),
        optional o_prompt, workflow_id, and optional message.
    """
    try:
        args = json.loads(args_json)
    except (json.JSONDecodeError, TypeError):
        return {
            "action": "notify",
            "workflow_id": "",
            "message": "🦉 Invalid arguments. Could not parse JSON.",
        }

    workflow_id = f"wf_{uuid.uuid4().hex[:16]}"

    if command == "learn":
        query = args.get("query", "")
        if not query:
            domain = args.get("domain", "")
            goal = args.get("goal", "")
            if domain and goal:
                query = f"{domain} {goal}"
            else:
                return {
                    "action": "notify",
                    "workflow_id": workflow_id,
                    "message": "🦉 Need a query to search. Usage: /aristotle learn <query>",
                }

        domain = args.get("domain")
        goal = args.get("goal")

        if domain and goal:
            # Explicit params mode — skip O, go straight to search
            _save_workflow(workflow_id, {
                "phase": "search",
                "command": "learn",
                "query": query,
                "intent_tags": {"domain": domain, "task_goal": goal},
            })
            return _do_search_and_notify(workflow_id)

        # Natural language mode — need LLM to extract intent
        _save_workflow(workflow_id, {
            "phase": "intent_extraction",
            "command": "learn",
            "query": query,
        })

        o_prompt = _build_intent_extraction_prompt(query)
        return {
            "action": "fire_o",
            "workflow_id": workflow_id,
            "o_prompt": o_prompt,
        }

    elif command == "reflect":
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": "🦉 Reflect flow not yet implemented in MVP.",
        }
    else:
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Unknown command: {command}",
        }


@mcp.tool()
def orchestrate_on_event(event_type: str, data_json: str) -> dict:
    """Receive event notification, update state, return next action.

    Args:
        event_type: "o_done" | "subagent_done" | "score_done"
        data_json: JSON string with event data (must include workflow_id)

    Returns dict with action, workflow_id, and optional fields.
    """
    try:
        data = json.loads(data_json)
    except (json.JSONDecodeError, TypeError):
        return {"action": "notify", "workflow_id": "", "message": "🦉 Invalid event data."}

    workflow_id = data.get("workflow_id", "")
    if not re.fullmatch(r"wf_[0-9a-f]{16}", workflow_id):
        return {"action": "notify", "workflow_id": workflow_id, "message": "🦉 Invalid workflow_id format."}
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "workflow_id": workflow_id, "message": f"🦉 Unknown workflow: {workflow_id}"}

    if event_type == "o_done" and workflow.get("phase") == "intent_extraction":
        result = data.get("result", {})
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                result = {}

        intent_tags = result.get("intent_tags", {})
        keywords = result.get("keywords", "")

        workflow["phase"] = "search"
        workflow["intent_tags"] = intent_tags
        workflow["keywords"] = keywords
        _save_workflow(workflow_id, workflow)

        return _do_search_and_notify(workflow_id)

    if event_type == "o_done" and workflow.get("phase") != "intent_extraction":
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Unexpected o_done in phase '{workflow.get('phase')}'.",
        }

    return {
        "action": "notify",
        "workflow_id": workflow_id,
        "message": f"🦉 Unhandled event_type '{event_type}' in phase '{workflow.get('phase')}'.",
    }


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
