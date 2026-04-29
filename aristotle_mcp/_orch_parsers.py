from __future__ import annotations

import json
import re
from pathlib import Path

from aristotle_mcp._orch_state import _load_workflow, _save_workflow
from aristotle_mcp.config import SCORING_TOP_N


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
    """Execute list_rules with workflow's intent tags and return score requests or notification."""
    from aristotle_mcp._tools_rules import list_rules
    from aristotle_mcp._orch_prompts import _build_scoring_prompt

    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "workflow_id": workflow_id, "message": "🦉 Workflow state lost."}

    intent = workflow.get("intent_tags", {})
    keywords = workflow.get("keywords", "")
    query = workflow.get("query", "")

    params: dict = {"status_filter": "verified"}
    if intent.get("domain"):
        params["intent_domain"] = intent["domain"]
    if intent.get("task_goal"):
        params["intent_task_goal"] = intent["task_goal"]
    if keywords:
        params["keyword"] = keywords

    result = list_rules(**params)
    count = result.get("count", 0)

    if count == 0:
        workflow["phase"] = "done"
        workflow["result_count"] = 0
        _save_workflow(workflow_id, workflow)
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": "🦉 No relevant lessons found for this query.",
            "result_count": 0,
        }

    # Truncate to top candidates for scoring
    rules = result.get("rules", [])[:SCORING_TOP_N]
    candidates = []
    score_requests = []

    for i, r in enumerate(rules):
        rule_path = r.get("path", "")
        rule_id = r.get("id", f"candidate_{i}")
        candidates.append({"rule_id": rule_id, "path": rule_path, "metadata": r.get("metadata", {})})
        prompt = _build_scoring_prompt(
            query=query,
            domain=intent.get("domain", ""),
            task_goal=intent.get("task_goal", ""),
            rule_path=rule_path,
        )
        score_requests.append({"rule_id": rule_id, "prompt": prompt})

    workflow["phase"] = "scoring"
    workflow["candidates"] = candidates
    _save_workflow(workflow_id, workflow)

    notify_msg = f"🦉 Found {count} relevant lesson(s). Scoring top {len(candidates)}..."
    return {
        "action": "fire_score",
        "workflow_id": workflow_id,
        "score_requests": score_requests,
        "notify_message": notify_msg,
    }


def _parse_scores(score_done_data: dict) -> list[dict]:
    """Parse score results from subagent responses.

    Handles items that are strings (attempts json.loads) or dicts.
    Clamps score to 1-10, truncates summary to 120 chars, default score is 5.
    """
    raw_scores = score_done_data.get("scores", [])

    parsed = []
    for item in raw_scores:
        if isinstance(item, str):
            try:
                item = json.loads(item)
            except (json.JSONDecodeError, ValueError):
                item = {}
        if not isinstance(item, dict):
            item = {}
        score = item.get("score", 5)
        summary = item.get("summary", "")
        try:
            score = int(score)
        except (ValueError, TypeError):
            score = 5
        score = max(1, min(10, score))
        summary = str(summary)[:120]
        parsed.append({"rule_id": item.get("rule_id", ""), "score": score, "summary": summary})
    return parsed


def _format_scored_rules_for_compress(scores: list[dict], workflow: dict) -> str:
    """Format scored rules into a text block for the compression prompt.

    Sorts by score descending, reads file content, and formats each rule.
    """
    candidates = workflow.get("candidates", [])

    scored_candidates = []
    for s in scores:
        rule_id = s.get("rule_id", "")
        rule_path = ""
        for c in candidates:
            if c.get("rule_id") == rule_id:
                rule_path = c.get("path", "")
                break
        scored_candidates.append({
            "path": rule_path,
            "score": s.get("score", 5),
            "summary": s.get("summary", ""),
        })

    scored_candidates.sort(key=lambda x: x["score"], reverse=True)

    parts = []
    for sc in scored_candidates:
        path = sc["path"]
        content = ""
        if path:
            try:
                content = Path(path).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                content = "<file not readable>"
        parts.append(
            f"---\nRule: {path} (score: {sc['score']}/10)\nSummary: {sc['summary']}\n\n{content}"
        )

    return "\n".join(parts)
