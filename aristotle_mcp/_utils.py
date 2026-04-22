from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir


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
