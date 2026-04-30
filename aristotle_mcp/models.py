from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_conflicts_with(value: object) -> list:
    """Parse conflicts_with field. Returns empty list for None/invalid inputs."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        import json

        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, ValueError):
            return []
    return []


def _yaml_value(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if any(
        c in text
        for c in (
            ":",
            "#",
            "'",
            '"',
            "\n",
            "{",
            "}",
            "[",
            "]",
            ",",
            "&",
            "*",
            "?",
            "|",
            "-",
            "<",
            ">",
            "=",
            "!",
            "%",
            "@",
            "`",
        )
    ):
        escaped = text.replace("'", "''")
        return f"'{escaped}'"
    return text


@dataclass
class RuleMetadata:
    id: str
    status: str = "pending"
    scope: str = "user"
    project_hash: str | None = None
    category: str = ""
    confidence: float = 0.7
    risk_level: str = "medium"
    source_session: str | None = None
    message_range: str | None = None
    created_at: str = field(default_factory=_now_iso)
    verified_at: str | None = None
    verified_by: str | None = None
    rejected_at: str | None = None
    rejected_reason: str | None = None
    intent_tags: dict | None = None  # {"domain": "...", "task_goal": "..."}
    failed_skill: str | None = None  # 关联故障技能 ID
    error_summary: str | None = None  # 错误现场精简总结
    rule_summary: str | None = None  # One-line proposed rule summary (from DRAFT Key Findings)

    # M6/M7: Feedback Signal
    success_rate: float | None = None
    failure_rate: float | None = None
    sample_size: int | None = None
    feedback_count: int | None = None

    # M9: Rule Relations
    conflicts_with: list = field(default_factory=list)


@dataclass
class RuleFile:
    path: Path
    metadata: RuleMetadata
    content: str


def _yaml_dict_value(d: dict) -> str:
    nested_lines = []
    for k, v in d.items():
        nested_lines.append(f"  {k}: {_yaml_value(v)}")
    return "\n" + "\n".join(nested_lines)


def to_frontmatter_string(metadata: RuleMetadata) -> str:
    lines: list[str] = ["---"]
    md = {
        "id": metadata.id,
        "status": metadata.status,
        "scope": metadata.scope,
        "project_hash": metadata.project_hash,
        "category": metadata.category,
        "confidence": metadata.confidence,
        "risk_level": metadata.risk_level,
        "source_session": metadata.source_session,
        "message_range": metadata.message_range,
        "created_at": metadata.created_at,
        "verified_at": metadata.verified_at,
        "verified_by": metadata.verified_by,
        "rejected_at": metadata.rejected_at,
        "rejected_reason": metadata.rejected_reason,
        "intent_tags": metadata.intent_tags,
        "failed_skill": metadata.failed_skill,
        "error_summary": metadata.error_summary,
        "success_rate": metadata.success_rate,
        "failure_rate": metadata.failure_rate,
        "sample_size": metadata.sample_size if (metadata.sample_size or 0) > 0 else None,
        "feedback_count": metadata.feedback_count if (metadata.feedback_count or 0) > 0 else None,
        "rule_summary": metadata.rule_summary,
        "conflicts_with": metadata.conflicts_with,
    }
    for key, value in md.items():
        if value is not None:
            if isinstance(value, dict):
                if value:
                    lines.append(f"{key}:{_yaml_dict_value(value)}")
                else:
                    lines.append(f"{key}: null")
            else:
                lines.append(f"{key}: {_yaml_value(value)}")
    lines.append("---")
    return "\n".join(lines)


def from_frontmatter_dict(data: dict) -> RuleMetadata:
    return RuleMetadata(
        id=data.get("id", ""),
        status=data.get("status", "pending"),
        scope=data.get("scope", "user"),
        project_hash=data.get("project_hash"),
        category=data.get("category", ""),
        confidence=data.get("confidence", 0.7),
        risk_level=data.get("risk_level", "medium"),
        source_session=data.get("source_session"),
        message_range=data.get("message_range"),
        created_at=data.get("created_at", _now_iso()),
        verified_at=data.get("verified_at"),
        verified_by=data.get("verified_by"),
        rejected_at=data.get("rejected_at"),
        rejected_reason=data.get("rejected_reason"),
        intent_tags=data.get("intent_tags"),
        failed_skill=data.get("failed_skill"),
        error_summary=data.get("error_summary"),
        success_rate=data.get("success_rate"),
        failure_rate=data.get("failure_rate"),
        sample_size=int(data.get("sample_size", 0) or 0),
        feedback_count=int(data.get("feedback_count", 0) or 0),
        rule_summary=data.get("rule_summary"),
        conflicts_with=_parse_conflicts_with(data.get("conflicts_with")),
    )


@dataclass
class ToolReturn:
    success: bool
    message: str
    data: dict | list | None = None
