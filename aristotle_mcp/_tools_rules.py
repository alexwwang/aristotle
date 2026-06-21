"""
Rule lifecycle tools — init, write, read, stage, commit, reject, restore, list, detect_conflicts, get_audit_decision.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir, resolve_learnings_file, RISK_MAP, AUDIT_THRESHOLDS
from aristotle_mcp.evolution import compute_delta
from aristotle_mcp.git_ops import git_init, git_add_and_commit, git_show_exists, git_show, git_log, git_status
from aristotle_mcp.models import RuleMetadata, RuleFile, to_frontmatter_string, from_frontmatter_dict
from aristotle_mcp.frontmatter import stream_filter_rules
from aristotle_mcp.migration import init_repo as _init_repo


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _project_hash(project_path: str) -> str:
    return hashlib.sha256(Path(project_path).resolve().as_posix().encode()).hexdigest()[:8]


def _resolve_scope_dir(scope: str, project_path: str | None, repo_dir: Path) -> Path:
    if scope == "user":
        return repo_dir / "user"
    if scope == "project":
        if not project_path:
            raise ValueError("project_path required for project scope")
        return repo_dir / "projects" / _project_hash(project_path)
    raise ValueError(f"Invalid scope: {scope}")


def _generate_rule_id(repo_dir: Path, scope: str, project_path: str | None) -> str:
    import time
    return f"rec_{int(time.time() * 1000)}"


def get_audit_decision(file_path: str) -> dict:
    repo_dir = resolve_repo_dir()
    full_path = repo_dir / file_path

    if not full_path.exists():
        from aristotle_mcp.frontmatter import _parse_frontmatter
        return {"error": f"File not found: {file_path}"}

    try:
        import yaml
        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return {"error": "No frontmatter found"}
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return {"error": "Empty frontmatter"}
    except Exception as e:
        return {"error": f"Failed to parse frontmatter: {e}"}

    metadata = from_frontmatter_dict(fm)
    risk_level = RISK_MAP.get(metadata.category, "low")
    delta = compute_delta(metadata.confidence, risk_level)

    if delta >= AUDIT_THRESHOLDS["auto"]:
        level = "auto"
    elif delta >= AUDIT_THRESHOLDS["semi"]:
        level = "semi"
    else:
        level = "manual"

    return {
        "rule_id": metadata.id,
        "delta": round(delta, 4),
        "audit_level": level,
        "confidence": metadata.confidence,
        "risk_level": risk_level,
        "status": metadata.status,
    }


def init_repo_tool() -> dict:
    repo_dir = resolve_repo_dir()
    return _init_repo(repo_dir)


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
    rule_summary: str | None = None,
    reflection_sequence: int | None = None,
) -> dict:
    repo_dir = resolve_repo_dir()
    target_dir = _resolve_scope_dir(scope, project_path, repo_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    rule_id = _generate_rule_id(repo_dir, scope, project_path)
    risk_level = RISK_MAP.get(category, "low")
    now = _now_iso()

    intent_tags = None
    if intent_domain or intent_task_goal:
        intent_tags = {}
        if intent_domain:
            intent_tags["domain"] = intent_domain
        if intent_task_goal:
            intent_tags["task_goal"] = intent_task_goal

    metadata = RuleMetadata(
        id=rule_id,
        status="pending",
        scope=scope,
        project_hash=_project_hash(project_path) if scope == "project" else None,
        category=category,
        confidence=confidence,
        risk_level=risk_level,
        source_session=source_session,
        reflection_sequence=reflection_sequence,
        message_range=message_range,
        created_at=now,
        intent_tags=intent_tags,
        failed_skill=failed_skill,
        error_summary=error_summary,
        rule_summary=rule_summary,
    )

    fm = to_frontmatter_string(metadata)
    full_content = f"{fm}\n\n{content}\n"

    date_str = now[:10]
    safe_category = category.lower().replace(" ", "_") if category else "rule"
    filename = f"{date_str}_{safe_category}.md"
    file_path = target_dir / filename

    counter = 1
    while file_path.exists():
        file_path = target_dir / f"{date_str}_{safe_category}_{counter}.md"
        counter += 1

    file_path.write_text(full_content, encoding="utf-8")

    return {
        "success": True,
        "file_path": str(file_path.relative_to(repo_dir)),
        "rule_id": rule_id,
        "status": "pending",
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
    reflection_sequence: int | None = None,
) -> dict:
    repo_dir = resolve_repo_dir()
    results = stream_filter_rules(
        repo_dir,
        status_filter=status,
        keyword=keyword,
        category=category,
        scope=scope if scope != "all" else None,
        limit=limit,
        intent_domain=intent_domain,
        intent_task_goal=intent_task_goal,
        failed_skill=failed_skill,
        error_summary=error_summary,
        reflection_sequence=reflection_sequence,
    )

    rules = []
    for path in results:
        try:
            text = path.read_text(encoding="utf-8")
            m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
            if not m:
                continue
            import yaml
            fm = yaml.safe_load(m.group(1))
            if not fm:
                continue
            metadata = from_frontmatter_dict(fm)
            body = text[m.end():].strip()
            rules.append({
                "path": str(path.relative_to(repo_dir)),
                "metadata": {
                    "id": metadata.id,
                    "status": metadata.status,
                    "scope": metadata.scope,
                    "category": metadata.category,
                    "confidence": metadata.confidence,
                    "risk_level": metadata.risk_level,
                    "intent_tags": metadata.intent_tags,
                    "failed_skill": metadata.failed_skill,
                    "error_summary": metadata.error_summary,
                    "rule_summary": metadata.rule_summary,
                },
                "content_preview": body[:200] + "..." if len(body) > 200 else body,
            })
        except Exception:
            continue

    return {"success": True, "count": len(rules), "rules": rules}


def stage_rule(file_path: str) -> dict:
    repo_dir = resolve_repo_dir()
    full_path = repo_dir / file_path

    if not full_path.exists():
        return {"success": False, "message": f"File not found: {file_path}"}

    try:
        import yaml
        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return {"success": False, "message": "No frontmatter found"}
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return {"success": False, "message": "Empty frontmatter"}

        fm["status"] = "staging"
        new_fm = "---\n"
        for k, v in fm.items():
            if v is not None:
                new_fm += f"{k}: {v}\n"
        new_fm += "---\n"
        body = text[m.end():]
        full_path.write_text(new_fm + body, encoding="utf-8")
    except Exception as e:
        return {"success": False, "message": f"Failed to update frontmatter: {e}"}

    return {"success": True, "file_path": file_path, "status": "staging"}


def commit_rule(
    file_path: str,
    message: str | None = None,
    skip_guard: bool = False,
    enable_guard: bool = False,
) -> dict:
    repo_dir = resolve_repo_dir()
    full_path = repo_dir / file_path

    if not full_path.exists():
        return {"success": False, "message": f"File not found: {file_path}"}

    try:
        import yaml
        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return {"success": False, "message": "No frontmatter found"}
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return {"success": False, "message": "Empty frontmatter"}

        fm["status"] = "verified"
        fm["verified_at"] = _now_iso()
        fm["verified_by"] = "auto"

        new_fm = "---\n"
        for k, v in fm.items():
            if v is not None:
                new_fm += f"{k}: {v}\n"
        new_fm += "---\n"
        body = text[m.end():]
        full_path.write_text(new_fm + body, encoding="utf-8")
    except Exception as e:
        return {"success": False, "message": f"Failed to update frontmatter: {e}"}

    commit_msg = message or f"verify: {file_path}"
    result = git_add_and_commit(repo_dir, file_path, commit_msg)

    return {
        "success": result["success"],
        "file_path": file_path,
        "status": "verified",
        "commit_hash": result.get("commit_hash"),
        "message": result.get("message", ""),
    }


def reject_rule(file_path: str, reason: str = "") -> dict:
    repo_dir = resolve_repo_dir()
    full_path = repo_dir / file_path

    if not full_path.exists():
        return {"success": False, "message": f"File not found: {file_path}"}

    try:
        import yaml
        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return {"success": False, "message": "No frontmatter found"}
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return {"success": False, "message": "Empty frontmatter"}

        scope = fm.get("scope", "user")
        rule_id = fm.get("id", "unknown")
        fm["status"] = "rejected"
        fm["rejected_at"] = _now_iso()
        fm["rejected_reason"] = reason

        new_fm = "---\n"
        for k, v in fm.items():
            if v is not None:
                new_fm += f"{k}: {v}\n"
        new_fm += "---\n"
        body = text[m.end():]

        scope_dir = "user" if scope == "user" else f"projects/{fm.get('project_hash', 'unknown')}"
        rejected_dir = repo_dir / "rejected" / scope_dir
        rejected_dir.mkdir(parents=True, exist_ok=True)
        rejected_path = rejected_dir / Path(file_path).name

        rejected_path.write_text(new_fm + body, encoding="utf-8")
        full_path.unlink()

        git_add_and_commit(repo_dir, str(rejected_path.relative_to(repo_dir)), f"reject: {rule_id} — {reason}")
        try:
            git_add_and_commit(repo_dir, file_path, f"reject: remove {rule_id}")
        except Exception:
            pass
    except Exception as e:
        return {"success": False, "message": f"Failed: {e}"}

    return {"success": True, "file_path": str(rejected_path.relative_to(repo_dir)), "status": "rejected"}


def restore_rule(file_path: str, new_status: str = "pending") -> dict:
    repo_dir = resolve_repo_dir()
    full_path = repo_dir / file_path

    if not full_path.exists():
        return {"success": False, "message": f"File not found: {file_path}"}

    try:
        import yaml
        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return {"success": False, "message": "No frontmatter found"}
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return {"success": False, "message": "Empty frontmatter"}

        scope = fm.get("scope", "user")
        fm["status"] = new_status
        fm["rejected_at"] = None
        fm["rejected_reason"] = None

        new_fm = "---\n"
        for k, v in fm.items():
            if v is not None:
                new_fm += f"{k}: {v}\n"
        new_fm += "---\n"
        body = text[m.end():]

        scope_dir = "user" if scope == "user" else f"projects/{fm.get('project_hash', 'unknown')}"
        restore_dir = repo_dir / scope_dir
        restore_dir.mkdir(parents=True, exist_ok=True)
        restore_path = restore_dir / Path(file_path).name

        restore_path.write_text(new_fm + body, encoding="utf-8")
        full_path.unlink()

        git_add_and_commit(repo_dir, str(restore_path.relative_to(repo_dir)), f"restore: {Path(file_path).name} as {new_status}")
        try:
            git_add_and_commit(repo_dir, file_path, f"restore: remove from rejected")
        except Exception:
            pass
    except Exception as e:
        return {"success": False, "message": f"Failed: {e}"}

    return {"success": True, "file_path": str(restore_path.relative_to(repo_dir)), "status": new_status}


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
    reflection_sequence: int | None = None,
) -> dict:
    repo_dir = resolve_repo_dir()
    results = stream_filter_rules(
        repo_dir,
        status_filter=status_filter,
        keyword=keyword,
        category=category,
        scope=scope if scope != "all" else None,
        limit=limit,
        intent_domain=intent_domain,
        intent_task_goal=intent_task_goal,
        failed_skill=failed_skill,
        error_summary=error_summary,
        reflection_sequence=reflection_sequence,
    )

    items = []
    for path in results:
        try:
            text = path.read_text(encoding="utf-8")
            m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
            if not m:
                continue
            import yaml
            fm = yaml.safe_load(m.group(1))
            if not fm:
                continue
            metadata = from_frontmatter_dict(fm)
            items.append({
                "path": str(path.relative_to(repo_dir)),
                "id": metadata.id,
                "status": metadata.status,
                "category": metadata.category,
                "scope": metadata.scope,
                "confidence": metadata.confidence,
                "rule_summary": metadata.rule_summary,
                "intent_tags": metadata.intent_tags,
            })
        except Exception:
            continue

    return {"success": True, "count": len(items), "rules": items}


def detect_conflicts(file_path: str) -> list[str]:
    repo_dir = resolve_repo_dir()
    full_path = repo_dir / file_path

    if not full_path.exists():
        return []

    try:
        import yaml
        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return []
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return []

        new_metadata = from_frontmatter_dict(fm)
        new_domain = (new_metadata.intent_tags or {}).get("domain")
        new_task = (new_metadata.intent_tags or {}).get("task_goal")
        new_skill = new_metadata.failed_skill

        if not (new_domain and new_task and new_skill):
            return []

        conflicts = []
        all_rules = stream_filter_rules(repo_dir, status_filter="verified", limit=500)
        for path in all_rules:
            if str(path) == str(full_path):
                continue
            try:
                rtext = path.read_text(encoding="utf-8")
                rm = re.match(r"^---\s*\n(.*?)\n---", rtext, re.DOTALL)
                if not rm:
                    continue
                rfm = yaml.safe_load(rm.group(1))
                if not rfm:
                    continue
                rmeta = from_frontmatter_dict(rfm)
                r_domain = (rmeta.intent_tags or {}).get("domain")
                r_task = (rmeta.intent_tags or {}).get("task_goal")
                r_skill = rmeta.failed_skill

                if r_domain == new_domain and r_task == new_task and r_skill == new_skill:
                    conflicts.append(str(path.relative_to(repo_dir)))
            except Exception:
                continue

        return conflicts
    except Exception:
        return []


def register_rules_tools(mcp) -> None:
    mcp.tool()(init_repo_tool)
    mcp.tool()(write_rule)
    mcp.tool()(read_rules)
    mcp.tool()(stage_rule)
    mcp.tool()(commit_rule)
    mcp.tool()(reject_rule)
    mcp.tool()(restore_rule)
    mcp.tool()(list_rules)
    mcp.tool()(detect_conflicts)
    mcp.tool()(get_audit_decision)
