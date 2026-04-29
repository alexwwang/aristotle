from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir, WORKFLOW_DIR_NAME
from aristotle_mcp._utils import _now_iso


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


def _next_sequence() -> int:
    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    if not state_path.exists():
        return 1
    try:
        records = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(records, list) or not records:
            return 1
        max_seq = 0
        for r in records:
            rid = r.get("id", "")
            if rid.startswith("rec_"):
                try:
                    max_seq = max(max_seq, int(rid[4:]))
                except ValueError:
                    pass
        return max_seq + 1
    except (json.JSONDecodeError, ValueError):
        return 1


def _ensure_repo_initialized() -> None:
    from aristotle_mcp._tools_rules import init_repo_tool
    repo_dir = resolve_repo_dir()
    if not (repo_dir / ".git").exists():
        init_repo_tool()


def _cleanup_stale_workflows(max_age_hours: int = 24) -> None:
    workflows_dir = resolve_repo_dir() / WORKFLOW_DIR_NAME
    if not workflows_dir.exists():
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours * 2)

    for wf_file in workflows_dir.glob("*.json"):
        try:
            wf = json.loads(wf_file.read_text(encoding="utf-8"))
            phase = wf.get("phase", "")
            updated = wf.get("updated_at", "")
            if not updated:
                continue
            updated_dt = datetime.fromisoformat(updated)

            if phase == "done" and updated_dt < cutoff:
                wf_file.unlink()
            elif phase in ("reflecting", "checking", "review",
                           "intent_extraction", "search", "init") and updated_dt < stale_cutoff:
                wf_file.unlink()
        except (json.JSONDecodeError, ValueError):
            pass
