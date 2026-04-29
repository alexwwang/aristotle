from __future__ import annotations

import json
import time
from pathlib import Path

from aristotle_mcp.config import (
    AUDIT_THRESHOLDS,
    DEFAULT_RISK_LEVEL,
    RISK_MAP,
    RISK_WEIGHTS,
    VALID_SCOPES,
    VALID_STATUSES,
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
from aristotle_mcp.git_ops import git_add_and_commit
from aristotle_mcp.migration import init_repo, migrate_learnings
from aristotle_mcp.models import RuleMetadata
from aristotle_mcp._utils import (
    _now_iso,
    _safe_resolve,
    _unique_filename,
    _rejected_dir_for,
)


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

    # Read sample_size from frontmatter if present
    raw_ss = metadata.get("sample_size", None)
    sample_size = int(raw_ss) if raw_ss is not None else None
    delta = compute_delta(
        confidence=confidence,
        risk_level=risk_level,
        sample_size=sample_size,
    )

    audit_level = decide_audit_level(delta)

    return {
        "success": True,
        "rule_id": metadata.get("id", "unknown"),
        "delta": round(delta, 4),
        "audit_level": audit_level,
        "confidence": confidence,
        "risk_level": risk_level,
        "risk_weight": RISK_WEIGHTS.get(risk_level, 0.5),
        "thresholds": AUDIT_THRESHOLDS,
    }


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
            return {
                "success": False,
                "message": f"Repo not initialized and auto-init failed: {init_result['message']}",
            }

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

    rule_id = f"rec_{int(time.time() * 1000)}"
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

    # Conflict detection and bidirectional annotation
    conflicts = detect_conflicts(file_path)
    if conflicts:
        fm = read_frontmatter_raw(path) or {}
        new_id = fm.get("id", "")
        if new_id:
            data = load_rule_file(path)
            metadata = data["metadata"]
            metadata["conflicts_with"] = json.dumps(conflicts)
            write_rule_file(path, metadata, data["content"])

            for conflict_id in conflicts:
                # Search by rule_id precisely, then filter exact match
                existing = list_rules(keyword=conflict_id, limit=10)
                for er in existing.get("rules", []):
                    er_meta = er.get("metadata", {})
                    # Only update the rule whose id exactly matches conflict_id
                    if er_meta.get("id") != conflict_id:
                        continue
                    er_path = Path(er.get("path", ""))
                    if not er_path.exists():
                        continue
                    er_data = load_rule_file(er_path)
                    er_meta = er_data["metadata"]
                    cw = er_meta.get("conflicts_with", [])
                    if isinstance(cw, str):
                        try:
                            cw = json.loads(cw)
                        except (json.JSONDecodeError, TypeError):
                            cw = []
                    if cw is None:
                        cw = []
                    if new_id not in cw:
                        cw.append(new_id)
                        er_meta["conflicts_with"] = json.dumps(cw)
                        write_rule_file(er_path, er_meta, er_data["content"])
                    break  # Found and updated the exact rule

    return {
        "success": commit_result["success"],
        "message": commit_result.get("message", "OK"),
        "commit_hash": commit_result.get("commit_hash"),
    }


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


def detect_conflicts(file_path: str) -> list[str]:
    """Detect conflicting rules based on domain, task_goal, and failed_skill triple.

    A conflict exists when another verified rule shares the same
    domain, task_goal, and failed_skill.

    Args:
        file_path: Path to the rule file to check.

    Returns list of conflicting rule IDs.
    """
    path, err = _safe_resolve(file_path)
    if err:
        return []
    if not path.exists():
        return []

    fm = read_frontmatter_raw(path) or {}
    intent_tags = fm.get("intent_tags") or {}
    domain = intent_tags.get("domain")
    task_goal = intent_tags.get("task_goal")
    failed_skill = fm.get("failed_skill")

    if not domain or not task_goal:
        return []

    result = list_rules(
        status_filter="verified",
        intent_domain=domain,
        intent_task_goal=task_goal,
    )

    conflicts = []
    for r in result.get("rules", []):
        meta = r.get("metadata", {})
        if r.get("path") == str(path):
            continue
        if meta.get("failed_skill") == failed_skill:
            conflicts.append(meta.get("id"))

    return conflicts


def register_rules_tools(mcp) -> None:
    """Register all rule tools with the MCP server."""
    mcp.tool()(get_audit_decision)
    mcp.tool()(init_repo_tool)
    mcp.tool()(write_rule)
    mcp.tool()(read_rules)
    mcp.tool()(stage_rule)
    mcp.tool()(commit_rule)
    mcp.tool()(reject_rule)
    mcp.tool()(restore_rule)
    mcp.tool()(list_rules)
    mcp.tool()(detect_conflicts)
