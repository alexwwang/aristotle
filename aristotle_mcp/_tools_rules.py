"""
Rule lifecycle tools — init, write, read, stage, commit, reject, restore, list, detect_conflicts, get_audit_decision.
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir, resolve_learnings_file, RISK_MAP, AUDIT_THRESHOLDS
from aristotle_mcp.evolution import compute_delta
from aristotle_mcp.git_ops import git_init, git_add_and_commit, git_show_exists, git_show, git_log, git_status
from aristotle_mcp.models import RuleMetadata, RuleFile, to_frontmatter_string, from_frontmatter_dict
from aristotle_mcp.frontmatter import stream_filter_rules
from aristotle_mcp.migration import init_repo as _init_repo
from aristotle_mcp._audit_log import append_audit_entry


def _validate_rule_for_commit(fm: dict) -> str | None:
    status = fm.get("status")
    if status != "staging":
        return f"Rule must be in 'staging' status before commit (current: {status})"
    category = fm.get("category")
    if not category or not str(category).strip():
        return "Rule category is required"
    confidence = fm.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return "Rule confidence must be a number between 0.0 and 1.0"
    if confidence < 0.0 or confidence > 1.0:
        return "Rule confidence must be between 0.0 and 1.0"
    error_summary = fm.get("error_summary")
    if error_summary is not None and len(str(error_summary)) > 200:
        return "Rule error_summary must be 200 characters or fewer"
    return None


def _commit_guard_block(file_path: str, message: str) -> dict:
    append_audit_entry(
        {
            "tool": "commit_rule",
            "runId": str(file_path),
            "result": "error",
            "params": {"file_path": str(file_path), "action": "guard_block"},
            "action": "guard_block",
            "error": message,
        }
    )
    return {"success": False, "message": message, "commit_hash": None}


def _commit_audit_pass(file_path: str, action: str) -> None:
    append_audit_entry(
        {
            "tool": "commit_rule",
            "runId": str(file_path),
            "result": "success",
            "params": {"file_path": str(file_path), "action": action},
            "action": action,
        }
    )


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


def _safe_path(repo_dir: Path, file_path: str | Path) -> Path | None:
    """Resolve a rule path inside repo_dir; return None if it escapes the repo."""
    p = Path(file_path)
    if not p.is_absolute():
        p = repo_dir / p
    try:
        p = p.resolve()
    except (OSError, RuntimeError):
        return None
    repo_root = repo_dir.resolve()
    if p == repo_root or repo_root in p.parents:
        return p
    return None


def _generate_rule_id(repo_dir: Path, scope: str, project_path: str | None) -> str:
    import time

    return f"rec_{int(time.time() * 1000)}"


def _generate_rule_id(repo_dir: Path, scope: str, project_path: str | None) -> str:
    import time

    return f"rec_{int(time.time() * 1000)}"


def get_audit_decision(file_path: str) -> dict:
    repo_dir = resolve_repo_dir()
    full_path = _safe_path(repo_dir, file_path)
    if full_path is None:
        return {"success": False, "message": f"Path escapes repo: {file_path}"}
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
    except Exception as e:
        return {"success": False, "message": f"Failed to parse frontmatter: {e}"}

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
        "success": True,
        "rule_id": metadata.id,
        "delta": round(delta, 4),
        "audit_level": level,
        "confidence": metadata.confidence,
        "risk_level": risk_level,
        "status": metadata.status,
        "thresholds": {
            "auto": AUDIT_THRESHOLDS["auto"],
            "semi": AUDIT_THRESHOLDS["semi"],
        },
    }


def _init_repo_tool_result(repo_dir: Path) -> dict:
    result = _init_repo(repo_dir)
    if result.get("success"):
        result["repo_path"] = str(repo_dir)
    return result


def init_repo_tool() -> dict:
    repo_dir = resolve_repo_dir()
    return _init_repo_tool_result(repo_dir)


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
    init_result = _init_repo(repo_dir)
    if not init_result.get("success"):
        return init_result
    try:
        target_dir = _resolve_scope_dir(scope, project_path, repo_dir)
    except ValueError as e:
        return {"success": False, "message": str(e)}
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
        "file_path": str(file_path),
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
            body = text[m.end() :].strip()
            rules.append(
                {
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
                        "success_rate": metadata.success_rate,
                        "failure_rate": metadata.failure_rate,
                        "sample_size": metadata.sample_size,
                        "feedback_count": metadata.feedback_count,
                        "reflection_sequence": metadata.reflection_sequence,
                        "source_session": metadata.source_session,
                        "conflicts_with": metadata.conflicts_with,
                    },
                    "content": body,
                    "content_preview": body[:200] + "..." if len(body) > 200 else body,
                }
            )
        except Exception:
            continue

    return {"success": True, "count": len(rules), "rules": rules}


def stage_rule(file_path: str) -> dict:
    repo_dir = resolve_repo_dir()
    full_path = _safe_path(repo_dir, file_path)
    if full_path is None:
        return {"success": False, "message": f"Path escapes repo: {file_path}"}
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
        body = text[m.end() :]
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
    full_path = _safe_path(repo_dir, file_path)
    if full_path is None:
        return {"success": False, "message": f"Path escapes repo: {file_path}", "commit_hash": None}
    if not full_path.exists():
        return {"success": False, "message": f"File not found: {file_path}", "commit_hash": None}

    try:
        import yaml

        text = full_path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return _commit_guard_block(str(full_path), "No frontmatter found")
        fm = yaml.safe_load(m.group(1))
        if not fm:
            return _commit_guard_block(str(full_path), "Empty frontmatter")
    except Exception as e:
        return _commit_guard_block(str(full_path), f"Failed to parse frontmatter: {e}")

    ci_mode = os.environ.get("ARISTOTLE_CI", "").strip() == "true"
    guard_active = ci_mode or (enable_guard and not skip_guard)

    if guard_active:
        error = _validate_rule_for_commit(fm)
        if error:
            return _commit_guard_block(str(full_path), error)

    try:
        fm["status"] = "verified"
        fm["verified_at"] = _now_iso()
        fm["verified_by"] = "auto"

        conflict_ids = detect_conflicts(str(full_path.relative_to(repo_dir)))
        if conflict_ids:
            existing_cw = fm.get("conflicts_with", [])
            if isinstance(existing_cw, str):
                import json as _json

                try:
                    existing_cw = _json.loads(existing_cw)
                except (ValueError, TypeError):
                    existing_cw = []
            if not isinstance(existing_cw, list):
                existing_cw = []
            merged = list(set(existing_cw) | set(conflict_ids))
            fm["conflicts_with"] = merged
            for cid in conflict_ids:
                _annotate_conflict_reverse(repo_dir, cid, fm.get("id", ""))

        new_fm = "---\n"
        for k, v in fm.items():
            if v is not None:
                new_fm += f"{k}: {v}\n"
        new_fm += "---\n"
        body = text[m.end() :]
        full_path.write_text(new_fm + body, encoding="utf-8")
    except Exception as e:
        return {"success": False, "message": f"Failed to update frontmatter: {e}"}

    action = "guard_pass" if guard_active else ("guard_bypass" if skip_guard else "commit")
    commit_msg = message or f"verify: {file_path}"
    result = git_add_and_commit(repo_dir, str(full_path.relative_to(repo_dir)), commit_msg)
    _commit_audit_pass(str(full_path), action)

    return {
        "success": result["success"],
        "file_path": str(full_path),
        "status": "verified",
        "commit_hash": result.get("commit_hash"),
        "message": result.get("message", ""),
    }


def reject_rule(file_path: str, reason: str = "") -> dict:
    repo_dir = resolve_repo_dir()
    full_path = _safe_path(repo_dir, file_path)
    if full_path is None:
        return {"success": False, "message": f"Path escapes repo: {file_path}"}
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
        body = text[m.end() :]

        scope_dir = "user" if scope == "user" else f"projects/{fm.get('project_hash', 'unknown')}"
        rejected_dir = repo_dir / "rejected" / scope_dir
        rejected_dir.mkdir(parents=True, exist_ok=True)
        rejected_path = rejected_dir / full_path.name

        rejected_path.write_text(new_fm + body, encoding="utf-8")
        full_path.unlink()

        git_add_and_commit(repo_dir, str(rejected_path.relative_to(repo_dir)), f"reject: {rule_id} — {reason}")
        try:
            git_add_and_commit(repo_dir, str(full_path.relative_to(repo_dir)), f"reject: remove {rule_id}")
        except Exception:
            pass
    except Exception as e:
        return {"success": False, "message": f"Failed: {e}"}

    return {
        "success": True,
        "file_path": str(rejected_path.relative_to(repo_dir)),
        "new_path": str(rejected_path),
        "status": "rejected",
    }


def restore_rule(file_path: str, new_status: str = "pending") -> dict:
    repo_dir = resolve_repo_dir()
    full_path = _safe_path(repo_dir, file_path)
    if full_path is None:
        return {"success": False, "message": f"Path escapes repo: {file_path}"}
    if not full_path.exists():
        return {"success": False, "message": f"File not found: {file_path}"}

    if "rejected" not in full_path.resolve().parts:
        return {"success": False, "message": f"File is not in the rejected directory: {file_path}"}

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
            if v is None:
                new_fm += f"{k}:\n"
            else:
                new_fm += f"{k}: {v}\n"
        new_fm += "---\n"
        body = text[m.end() :]

        scope_dir = "user" if scope == "user" else f"projects/{fm.get('project_hash', 'unknown')}"
        restore_dir = repo_dir / scope_dir
        restore_dir.mkdir(parents=True, exist_ok=True)
        restore_path = restore_dir / full_path.name

        restore_path.write_text(new_fm + body, encoding="utf-8")
        full_path.unlink()

        git_add_and_commit(
            repo_dir, str(restore_path.relative_to(repo_dir)), f"restore: {full_path.name} as {new_status}"
        )
        try:
            git_add_and_commit(repo_dir, str(full_path.relative_to(repo_dir)), f"restore: remove from rejected")
        except Exception:
            pass
    except Exception as e:
        return {"success": False, "message": f"Failed: {e}"}

    return {
        "success": True,
        "file_path": str(restore_path.relative_to(repo_dir)),
        "new_path": str(restore_path),
        "status": new_status,
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
            item = {
                "path": str(path.relative_to(repo_dir)),
                "id": metadata.id,
                "status": metadata.status,
                "category": metadata.category,
                "scope": metadata.scope,
                "confidence": metadata.confidence,
                "rule_summary": metadata.rule_summary,
                "intent_tags": metadata.intent_tags,
            }
            if hasattr(metadata, "reflection_sequence"):
                item["reflection_sequence"] = metadata.reflection_sequence
            item["metadata"] = {k: str(v) if hasattr(v, "isoformat") else v for k, v in fm.items()}
            items.append(item)
        except Exception:
            continue

    return {"success": True, "count": len(items), "rules": items}


def _annotate_conflict_reverse(repo_dir: Path, target_rule_id: str, source_rule_id: str) -> None:
    """Add source_rule_id to target rule's conflicts_with (bidirectional annotation)."""
    import yaml

    for md_path in repo_dir.rglob("*.md"):
        if md_path.name.startswith("_") or md_path.name == ".gitignore":
            continue
        try:
            text = md_path.read_text(encoding="utf-8")
            m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
            if not m:
                continue
            fm = yaml.safe_load(m.group(1))
            if not fm or fm.get("id") != target_rule_id:
                continue
            existing = fm.get("conflicts_with", [])
            if isinstance(existing, str):
                import json as _json

                try:
                    existing = _json.loads(existing)
                except (ValueError, TypeError):
                    existing = []
            if not isinstance(existing, list):
                existing = []
            if source_rule_id not in existing:
                existing.append(source_rule_id)
                fm["conflicts_with"] = existing
                new_fm = "---\n"
                for k, v in fm.items():
                    if v is not None:
                        new_fm += f"{k}: {v}\n"
                new_fm += "---\n"
                md_path.write_text(new_fm + text[m.end() :], encoding="utf-8")
            return
        except (OSError, UnicodeDecodeError, Exception):
            continue


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
                    conflicts.append(rmeta.id)
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
