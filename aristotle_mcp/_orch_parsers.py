from __future__ import annotations

import re
from pathlib import Path

from aristotle_mcp._orch_state import _load_workflow, _save_workflow


def _parse_checker_result(result: str) -> tuple[int, int]:
    committed, staged = 0, 0
    for line in result.split("\n"):
        m = re.match(r"(?:committed|Committed)\s*[:=]\s*(\d+)", line, re.IGNORECASE)
        if m:
            committed = int(m.group(1))
        m = re.match(r"(?:staged|Staged)\s*[:=]\s*(\d+)", line, re.IGNORECASE)
        if m:
            staged = int(m.group(1))
    if committed == 0 and staged == 0:
        m = re.search(r"(\d+)\s+rules?\s+committed.*?(\d+)\s+staged?", result, re.IGNORECASE)
        if m:
            committed, staged = int(m.group(1)), int(m.group(2))
    return committed, staged


def _format_review_output(
    sequence: int,
    target_record: dict,
    draft_content: str,
    rules_result: dict,
) -> str:
    status = target_record.get("status", "?")
    target = target_record.get("target_label", "?")
    launched = target_record.get("launched_at", "?")[:16]

    lines = [
        f"🦉 Review #{sequence} — [{target}] {status} — {launched}",
        "",
    ]

    if draft_content:
        preview = draft_content[:2000]
        if len(draft_content) > 2000:
            preview += "\n... (truncated)"
        lines.append("## DRAFT Report")
        lines.append(preview)
        lines.append("")

    rules = rules_result.get("rules", [])
    count = rules_result.get("count", 0)
    if count > 0:
        lines.append(f"## Associated Rules ({count})")
        for i, r in enumerate(rules[:10], 1):
            meta = r.get("metadata", {})
            summary = meta.get("error_summary", r.get("path", "?"))
            cat = meta.get("category", "?")
            rstatus = meta.get("status", "?")
            lines.append(f"  {i}. [{cat}/{rstatus}] {summary}")
    else:
        lines.append("No associated rules found.")

    lines.append("")
    lines.append("Choose an action:")
    lines.append("  1. confirm — Accept all staging rules")
    lines.append("  2. reject — Reject this reflection")
    lines.append("  3. revise N — Revise rule #N (append feedback after colon)")
    lines.append("  4. re-reflect — Request deeper analysis")

    return "\n".join(lines)


def _parse_revised_rule(content: str) -> tuple[str | None, str | None]:
    lines = content.strip().split("\n")
    if not lines:
        return None, None

    rule_path = None
    content_start = 0
    for i, line in enumerate(lines):
        m = re.match(r"^FILE:\s*(.+)$", line.strip())
        if m:
            rule_path = m.group(1).strip()
            content_start = i + 1
            break

    if not rule_path:
        return None, None

    rule_content = "\n".join(lines[content_start:]).strip()
    if not rule_content:
        return None, None

    return rule_path, rule_content


def _do_search_and_notify(workflow_id: str) -> dict:
    """Execute list_rules with workflow's intent tags and return formatted notification."""
    from aristotle_mcp._tools_rules import list_rules

    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "workflow_id": workflow_id, "message": "🦉 Workflow state lost."}

    intent = workflow.get("intent_tags", {})
    keywords = workflow.get("keywords", "")

    params: dict = {"status_filter": "verified"}
    if intent.get("domain"):
        params["intent_domain"] = intent["domain"]
    if intent.get("task_goal"):
        params["intent_task_goal"] = intent["task_goal"]
    if keywords:
        params["keyword"] = keywords

    result = list_rules(**params)

    # Mark workflow done
    workflow["phase"] = "done"
    workflow["result_count"] = result.get("count", 0)
    _save_workflow(workflow_id, workflow)

    count = result.get("count", 0)
    if count == 0:
        msg = "🦉 No relevant lessons found for this query."
    else:
        rules = result.get("rules", [])
        lines = [f"🦉 Found {count} relevant lesson(s):"]
        for i, r in enumerate(rules[:5], 1):
            meta = r.get("metadata", {})
            summary = meta.get("error_summary", "No summary")
            cat = meta.get("category", "?")
            lines.append(f"  {i}. [{cat}] {summary}")
        msg = "\n".join(lines)

    return {
        "action": "notify",
        "workflow_id": workflow_id,
        "message": msg,
        "result_count": count,
    }
