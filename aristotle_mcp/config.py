from __future__ import annotations

import hashlib
import os
from pathlib import Path


DEFAULT_REPO_DIR = Path.home() / ".config" / "opencode" / "aristotle-repo"


def resolve_repo_dir() -> Path:
    env = os.environ.get("ARISTOTLE_REPO_DIR")
    return (Path(env) if env else DEFAULT_REPO_DIR).resolve()


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

# Phase 0: Session Snapshot Bridge
SESSIONS_DIR_NAME = "aristotle-sessions"


def resolve_sessions_dir() -> Path:
    return Path.home() / ".config" / "opencode" / SESSIONS_DIR_NAME


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


# ── Reflector prompt mode configuration ──


def _resolve_config_path() -> Path:
    """Resolve the Aristotle config file path."""
    config_dir = os.environ.get("OPENCODE_CONFIG_DIR")
    if config_dir:
        return Path(config_dir) / "aristotle-config.json"
    return Path.home() / ".config" / "opencode" / "aristotle-config.json"


def _read_aristotle_config() -> dict:
    """Read the Aristotle config file. Returns {} on failure."""
    config_path = _resolve_config_path()
    if not config_path.exists():
        return {}
    try:
        import json

        data = json.loads(config_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, ValueError, OSError):
        return {}


def _write_aristotle_config(config: dict) -> None:
    """Write the Aristotle config file."""
    import json

    config_path = _resolve_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def get_prompt_mode() -> str:
    """Determine the Reflector prompt mode.

    Priority:
    1. ARISTOTLE_PROMPT_MODE env var (highest)
    2. aristotle-config.json → prompt_mode field
    3. Default: "full"

    Returns one of: "full", "compact", "auto"
    - "full": Always use full REFLECTOR.md protocol (5-Why, detailed analysis)
    - "compact": Always use compact inline protocol (3-Why, max 2 reflections)
    - "auto": Decide based on model output limits (compact if ≤8192)
    """
    env_val = os.environ.get("ARISTOTLE_PROMPT_MODE", "").lower().strip()
    if env_val in ("full", "compact", "auto"):
        return env_val

    config = _read_aristotle_config()
    config_val = config.get("prompt_mode", "").lower().strip()
    if config_val in ("full", "compact", "auto"):
        return config_val

    return "full"


def resolve_prompt_mode() -> str:
    """Resolve the effective prompt mode, expanding "auto" to "full" or "compact".

    "auto" mode: reads ALL providers from opencode.json, takes the MINIMUM
    limit.output (conservative — if ANY provider has a low limit, use compact).
    If detection fails → "full" (fail-open).

    Returns "full" or "compact".
    """
    mode = get_prompt_mode()
    if mode != "auto":
        return mode

    # Auto mode: detect from opencode.json
    min_output = _read_min_model_output_limit()
    if min_output <= 0:
        return "full"  # detection failed → fail-open
    threshold = int(os.environ.get("ARISTOTLE_COMPACT_THRESHOLD", "8192"))
    return "compact" if min_output <= threshold else "full"


def _read_min_model_output_limit() -> int:
    """Read the minimum limit.output across all models in opencode.json.

    Returns 0 on any failure.
    """
    import json

    config_dir = os.environ.get("OPENCODE_CONFIG_DIR")
    if config_dir:
        config_path = Path(config_dir) / "opencode.json"
    else:
        config_path = Path.home() / ".config" / "opencode" / "opencode.json"

    if not config_path.exists():
        return 0

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError, OSError):
        return 0

    providers = data.get("provider", {})
    if not isinstance(providers, dict):
        return 0

    outputs = []
    for _prov_name, prov_config in providers.items():
        if not isinstance(prov_config, dict):
            continue
        models = prov_config.get("models", {})
        if not isinstance(models, dict):
            continue
        for _model_name, model_config in models.items():
            if not isinstance(model_config, dict):
                continue
            limit = model_config.get("limit", {})
            if isinstance(limit, dict):
                output = limit.get("output", 0)
                if isinstance(output, (int, float)) and output > 0:
                    outputs.append(int(output))

    return min(outputs) if outputs else 0
