from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


@dataclass
class RuleFile:
    path: Path
    metadata: RuleMetadata
    content: str


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
    }
    for key, value in md.items():
        if value is not None:
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
    )


@dataclass
class ToolReturn:
    success: bool
    message: str
    data: dict | list | None = None
