"""
Phase 4 stub — rule lifecycle tools.
Business code isolated to _phase5_ref/_tools_rules.py for TDD Red phase.
"""


def get_audit_decision(file_path: str) -> dict:
    raise NotImplementedError("Phase 4 stub")


def init_repo_tool() -> dict:
    from aristotle_mcp.config import resolve_repo_dir
    from aristotle_mcp.migration import init_repo
    repo_dir = resolve_repo_dir()
    return init_repo(repo_dir)


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
    raise NotImplementedError("Phase 4 stub")


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
    raise NotImplementedError("Phase 4 stub")


def stage_rule(file_path: str) -> dict:
    raise NotImplementedError("Phase 4 stub")


def commit_rule(
    file_path: str,
    message: str | None = None,
    skip_guard: bool = False,
    enable_guard: bool = False,
) -> dict:
    raise NotImplementedError("Phase 4 stub")


def reject_rule(file_path: str, reason: str = "") -> dict:
    raise NotImplementedError("Phase 4 stub")


def restore_rule(file_path: str, new_status: str = "pending") -> dict:
    raise NotImplementedError("Phase 4 stub")


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
    raise NotImplementedError("Phase 4 stub")


def detect_conflicts(file_path: str) -> list[str]:
    raise NotImplementedError("Phase 4 stub")


def register_rules_tools(mcp) -> None:
    pass
