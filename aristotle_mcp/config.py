from __future__ import annotations

import hashlib
import os
from pathlib import Path


DEFAULT_REPO_DIR = Path.home() / ".config" / "opencode" / "aristotle-repo"


def resolve_repo_dir() -> Path:
    env = os.environ.get("ARISTOTLE_REPO_DIR")
    return Path(env) if env else DEFAULT_REPO_DIR


def resolve_state_file() -> Path:
    return Path.home() / ".config" / "opencode" / "aristotle-state.json"


def resolve_learnings_file(scope: str, project_path: str | None = None) -> Path:
    if scope == "user":
        return Path.home() / ".config" / "opencode" / "aristotle-learnings.md"
    if project_path is None:
        raise ValueError("project_path required for project scope")
    return Path(project_path) / ".opencode" / "aristotle-project-learnings.md"


RISK_MAP: dict[str, str] = {
    "HALLUCINATION": "high",
    "SYNTAX_API_ERROR": "medium",
    "MISUNDERSTOOD_REQUIREMENT": "medium",
    "ASSUMED_CONTEXT": "medium",
    "PATTERN_VIOLATION": "low",
    "INCOMPLETE_ANALYSIS": "low",
    "WRONG_TOOL_CHOICE": "low",
    "OVERSIMPLIFICATION": "low",
}

DEFAULT_RISK_LEVEL = "medium"

RISK_WEIGHTS: dict[str, float] = {
    "high": 0.8,
    "medium": 0.5,
    "low": 0.2,
}

AUDIT_THRESHOLDS: dict[str, float] = {
    "auto": 0.7,
    "semi": 0.4,
}

VALID_STATUSES: tuple[str, ...] = ("pending", "staging", "verified", "rejected")

VALID_SCOPES: tuple[str, ...] = ("user", "project")

WORKFLOW_DIR_NAME = ".workflows"

GITIGNORE_CONTENT = """\
*.tmp
*.signal
.interaction/
.workflows/
"""

REPO_DIR_STRUCTURE: tuple[str, ...] = (
    "user",
    "projects",
    "rejected/user",
    "rejected/projects",
)


def project_hash(project_path: str) -> str:
    return hashlib.sha256(project_path.encode()).hexdigest()[:8]


SKILL_DIR = Path(
    os.environ.get(
        "ARISTOTLE_SKILL_DIR",
        str(Path(__file__).parent.parent),
    )
)

# ── Phase 2 constants ──
# M5: Learn Two-Round 检索
SCORING_TOP_N = 5
SCORE_PARALLEL_MAX = 3
COMPRESS_TOP_N = 3
COMPRESS_MAX_CHARS = 800
COMPRESS_RULE_MAX_CHARS = 200

# M6: Error Feedback
MAX_FEEDBACK_REFLECT = 3

# M7: Δ log-normalization
MAX_SAMPLES = 20
