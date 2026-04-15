from __future__ import annotations

import re
from pathlib import Path

from aristotle_mcp.config import (
    DEFAULT_RISK_LEVEL,
    GITIGNORE_CONTENT,
    REPO_DIR_STRUCTURE,
    RISK_MAP,
    project_hash,
    resolve_learnings_file,
)
from aristotle_mcp.frontmatter import write_rule_file
from aristotle_mcp.git_ops import git_add_and_commit, git_init
from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

_ENTRY_RE = re.compile(r"\[(\d{4}-\d{2}-\d{2})\]\s+(\w+)\s+—\s+(.+)")


def parse_learnings_file(file_path: Path) -> list[dict]:
    if not file_path.exists():
        return []
    text = file_path.read_text(encoding="utf-8")
    if "## [" not in text:
        return []

    parts = text.split("## [")
    entries: list[dict] = []
    for part in parts[1:]:
        lines = part.split("\n", 1)
        heading_line = lines[0]
        rest = lines[1] if len(lines) > 1 else ""

        m = _ENTRY_RE.match("[" + heading_line)
        if not m:
            continue

        date = m.group(1)
        category = m.group(2)
        title = m.group(3).strip()

        # Trim trailing --- separator
        body = re.sub(r"\n---\s*$", "", rest).strip()

        entries.append(
            {"date": date, "category": category, "title": title, "body": body}
        )

    return entries


def init_repo(repo_path: Path) -> dict:
    repo_path.mkdir(parents=True, exist_ok=True)

    for subdir in REPO_DIR_STRUCTURE:
        (repo_path / subdir).mkdir(parents=True, exist_ok=True)

    gitignore_path = repo_path / ".gitignore"
    gitignore_path.write_text(GITIGNORE_CONTENT, encoding="utf-8")

    init_result = git_init(repo_path)
    if not init_result["success"]:
        return init_result

    return git_add_and_commit(
        repo_path, ".gitignore", "chore: initialize aristotle rule repository"
    )


def migrate_learnings(repo_path: Path, project_path: str | None = None) -> dict:
    scope = "project" if project_path is not None else "user"

    learnings_file = resolve_learnings_file(scope, project_path)
    rules = parse_learnings_file(learnings_file)

    if not rules:
        return {
            "success": True,
            "migrated_count": 0,
            "scope": scope,
            "message": f"No rules found to migrate ({scope}).",
        }

    if scope == "user":
        target_dir = repo_path / "user"
    else:
        target_dir = repo_path / "projects" / project_hash(project_path)

    target_dir.mkdir(parents=True, exist_ok=True)

    used_names: set[str] = set()
    for idx, rule in enumerate(rules, start=1):
        base_name = f"{rule['date']}_{rule['category'].lower()}"
        name = base_name
        if name in used_names:
            name = f"{base_name}_{idx}"
        used_names.add(name)

        file_path = target_dir / f"{name}.md"

        p_hash = project_hash(project_path) if scope == "project" else None
        ts = f"{rule['date']}T00:00:00+00:00"

        metadata = RuleMetadata(
            id=f"mig_{idx}",
            status="verified",
            scope=scope,
            project_hash=p_hash,
            category=rule["category"],
            confidence=0.7,
            risk_level=RISK_MAP.get(rule["category"], DEFAULT_RISK_LEVEL),
            source_session=None,
            message_range=None,
            created_at=ts,
            verified_at=ts,
            verified_by="migration",
            rejected_at=None,
            rejected_reason=None,
        )

        body = (
            f"## [{rule['date']}] {rule['category']} — {rule['title']}\n{rule['body']}"
        )
        write_rule_file(file_path, metadata.__dict__, body)

    commit_result = git_add_and_commit(
        repo_path,
        ".",
        f"chore: migrate existing learnings from flat markdown\n\nMigrated {len(rules)} {scope}-level rules.\nAll rules set to status=verified with confidence=0.7.",
    )

    if not commit_result["success"]:
        return {
            "success": False,
            "migrated_count": len(rules),
            "scope": scope,
            "message": f"Files written but commit failed: {commit_result['message']}",
        }

    backup_path = learnings_file.with_suffix(".md.bak")
    learnings_file.rename(backup_path)

    return {
        "success": True,
        "migrated_count": len(rules),
        "scope": scope,
        "message": f"Migrated {len(rules)} {scope}-level rules. Original backed up to {backup_path}.",
    }
