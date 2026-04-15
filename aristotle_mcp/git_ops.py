from __future__ import annotations

import os
import subprocess
from pathlib import Path


def _run(
    repo_path: Path, args: list[str], env_extra: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        cwd=str(repo_path),
        env=env,
    )


def git_init(repo_path: Path) -> dict:
    if (repo_path / ".git").is_dir():
        return {"success": True, "message": "Already a git repository."}
    result = _run(repo_path, ["init"])
    if result.returncode == 0:
        return {"success": True, "message": result.stdout.strip()}
    return {"success": False, "message": result.stderr.strip()}


def git_add_and_commit(repo_path: Path, file_pattern: str, message: str) -> dict:
    add = _run(repo_path, ["add", file_pattern])
    if add.returncode != 0:
        return {"success": False, "message": add.stderr.strip(), "commit_hash": None}

    commit_env = {
        "GIT_AUTHOR_NAME": "Aristotle MCP",
        "GIT_AUTHOR_EMAIL": "aristotle-mcp@local",
        "GIT_COMMITTER_NAME": "Aristotle MCP",
        "GIT_COMMITTER_EMAIL": "aristotle-mcp@local",
    }
    commit = _run(repo_path, ["commit", "-m", message], env_extra=commit_env)
    if commit.returncode != 0:
        return {"success": False, "message": commit.stderr.strip(), "commit_hash": None}

    rev = _run(repo_path, ["rev-parse", "--short=7", "HEAD"])
    short_hash = rev.stdout.strip() if rev.returncode == 0 else None
    return {
        "success": True,
        "message": commit.stdout.strip(),
        "commit_hash": short_hash,
    }


def git_show(repo_path: Path, ref: str, file_path: str) -> dict:
    result = _run(repo_path, ["show", f"{ref}:{file_path}"])
    if result.returncode != 0:
        return {"success": False, "content": None, "message": result.stderr.strip()}
    return {"success": True, "content": result.stdout, "message": "OK"}


def git_log(repo_path: Path, n: int = 10) -> dict:
    result = _run(repo_path, ["log", f"-n{n}", "--pretty=format:%h|%an|%ai|%s"])
    if result.returncode != 0:
        return {"success": False, "commits": [], "message": result.stderr.strip()}

    commits = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append(
                {
                    "hash": parts[0],
                    "author": parts[1],
                    "date": parts[2],
                    "message": parts[3],
                }
            )
    return {"success": True, "commits": commits, "message": "OK"}


def git_status(repo_path: Path) -> dict:
    result = _run(repo_path, ["status", "--porcelain"])
    if result.returncode != 0:
        return {
            "success": False,
            "staged": [],
            "untracked": [],
            "modified": [],
            "message": result.stderr.strip(),
        }

    staged: list[str] = []
    untracked: list[str] = []
    modified: list[str] = []

    for line in result.stdout.strip().splitlines():
        if not line:
            continue
        index = line[:1]
        worktree = line[1:2]
        filepath = line[3:]

        if index in ("A", "M", "D", "R", "C"):
            staged.append(filepath)
        elif worktree == "?":
            untracked.append(filepath)
        elif worktree in ("M", "D"):
            modified.append(filepath)

    return {
        "success": True,
        "staged": staged,
        "untracked": untracked,
        "modified": modified,
        "message": "OK",
    }
