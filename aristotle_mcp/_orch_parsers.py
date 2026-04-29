from __future__ import annotations

import json
import re
from pathlib import Path

from aristotle_mcp._orch_state import _load_workflow, _save_workflow
from aristotle_mcp._tools_rules import get_audit_decision as _get_audit_decision
from aristotle_mcp.config import SCORING_TOP_N
from aristotle_mcp.models import _parse_conflicts_with  # noqa: F401 — used by _format_review_output

# Audit level → display label mapping (AC-4 requires exact labels)
_AUDIT_LABELS: dict[str, str] = {
    "auto": "automatic",
    "semi": "review suggested",
    "manual": "manual review required",
}


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
        m = re.search(
            r"(\d+)\s+rules?\s+committed.*?(\d+)\s+staged?", result, re.IGNORECASE
        )
        if m:
            committed, staged = int(m.group(1)), int(m.group(2))
    return committed, staged


def _format_review_output(
    sequence: int,
    target_record: dict,
    draft_content: str,
    staging_rules: list[dict],
    verified_rules: list[dict],
    audit_decisions: list[dict | None],
) -> str:
    """Format enhanced review notification with enriched data."""
    status = target_record.get("status", "?")
    target = target_record.get("target_label", "?")
    launched = (target_record.get("launched_at") or "?")[:16]

    lines = [
        f"🦉 Review #{sequence} — [{target}] {status} — {launched}",
        "",
    ]

    # Header: Δ and audit level
    non_none = [ad for ad in audit_decisions if ad is not None]
    if non_none:
        min_entry = min(non_none, key=lambda x: x.get("delta", 1.0))
        delta = min_entry.get("delta", 0.0)
        audit_level = min_entry.get("audit_level", "manual")
        label = _AUDIT_LABELS.get(audit_level, audit_level)
        lines.append(f"Δ {delta:.2f} → {label}")
        lines.append("")

    # DRAFT summary
    if draft_content:
        summary_lines, total_chars = _parse_draft_summary(draft_content)
        lines.append("## DRAFT Summary")
        for sl in summary_lines:
            lines.append(f"  {sl}")
        if total_chars > 0:
            lines.append(f"  ({total_chars} chars — use 'show draft' for full report)")
        lines.append("")

    # Staging rules (numbered)
    if staging_rules:
        lines.append("## Rules for Review")
        for i, r in enumerate(staging_rules, 1):
            meta = r.get("metadata", {})
            summary = meta.get("error_summary", r.get("path", "?"))
            cat = meta.get("category", "?")

            # Confidence and risk from audit_decisions (single source of truth)
            ad = audit_decisions[i - 1] if i - 1 < len(audit_decisions) else None
            conf = 0.7  # default
            risk = ""
            if ad is not None:
                conf = ad.get("confidence", 0.7)
                risk = ad.get("risk_level", "").upper()

            rule_line = f"  {i}. [{cat}] {summary}"
            conf_str = f"{conf:.2f}"
            if conf_str.endswith("0") and not conf_str.endswith("00"):
                conf_str = conf_str[:-1]  # "0.70" → "0.7", keep "0.00" as-is
            detail_parts = [f"conf {conf_str}"]
            if risk:
                detail_parts.append(risk)
            rule_line += f"  ({', '.join(detail_parts)})"
            lines.append(rule_line)

            # Conflicts
            raw_cw = meta.get("conflicts_with")
            if raw_cw is not None:
                parsed = _parse_conflicts_with(raw_cw)
                if parsed:
                    if len(parsed) > 3:
                        lines.append(f"     Conflicts with: {', '.join(parsed[:3])} +{len(parsed) - 3} more")
                    else:
                        lines.append(f"     Conflicts with: {', '.join(parsed)}")
    else:
        lines.append("## Rules for Review")
        lines.append("  No rules require review.")

    # Auto-committed rules (unnumbered)
    if verified_rules:
        lines.append("")
        lines.append("## Auto-committed")
        for r in verified_rules:
            meta = r.get("metadata", {})
            summary = meta.get("error_summary", r.get("path", "?"))
            cat = meta.get("category", "?")
            lines.append(f"  • [{cat}] {summary}")

    # Action menu
    lines.append("")
    lines.append("Choose an action:")
    lines.append("  1. confirm — Accept all staging rules")
    lines.append("  2. reject — Reject this reflection")
    lines.append("  3. revise N — Revise rule #N (append feedback after colon)")
    lines.append("  4. re-reflect — Request deeper analysis")
    lines.append("  5. inspect N — View full rule #N")
    lines.append("  6. show draft — View full DRAFT report")

    return "\n".join(lines)


def _parse_draft_summary(draft_content: str) -> tuple[list[str], int]:
    """Extract Key Findings from DRAFT content.

    Returns:
        (summary_lines, total_chars) where summary_lines is a list of
        lines to display and total_chars is the full DRAFT character count.
    """
    total_chars = len(draft_content)

    if not draft_content or not draft_content.strip():
        return (["DRAFT report is empty"], total_chars)

    lines = draft_content.split("\n")

    # Find "## Key Findings" heading (exact match on stripped line)
    kf_start = None
    for i, line in enumerate(lines):
        if line.strip() == "## Key Findings":
            kf_start = i + 1  # start collecting from next line
            break

    if kf_start is not None:
        # Collect list items until heading or non-list non-blank line
        findings = []
        for j in range(kf_start, len(lines)):
            line = lines[j]
            stripped = line.strip()
            if stripped.startswith("## "):
                break  # next heading — stop
            if not stripped:
                continue  # blank line — skip
            if stripped.startswith("- "):
                findings.append(stripped[2:])
            else:
                # Non-blank, non-list, non-heading line — terminate
                break

        if findings:
            return (findings, total_chars)

    # Fallback: first 3 non-empty lines
    non_empty = [line.strip() for line in lines if line.strip()]
    return (non_empty[:3], total_chars)


def _enrich_rules_metadata(rules_result: dict) -> tuple[list[dict], list[dict], list[dict | None]]:
    """Organize rules into staging/verified and compute audit decisions.

    Input: rules_result is the raw return from list_rules() — each rule
    has structure {path: str, metadata: dict}.

    Returns:
        (staging_rules, verified_rules, audit_decisions)
    """
    rules = rules_result.get("rules", [])

    staging_rules = []
    verified_rules = []

    for r in rules:
        meta = r.get("metadata", {})
        status = meta.get("status", "")
        if status == "staging":
            staging_rules.append(r)
        elif status == "verified":
            verified_rules.append(r)

    # Compute audit decisions for staging rules only
    audit_decisions: list[dict | None] = []
    for r in staging_rules:
        rule_path = r.get("path", "")
        try:
            result = _get_audit_decision(rule_path)
            if isinstance(result, dict) and result.get("success"):
                audit_decisions.append(result)
            else:
                audit_decisions.append(None)
        except (ValueError, TypeError, Exception):
            audit_decisions.append(None)

    return (staging_rules, verified_rules, audit_decisions)


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
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": "🦉 Workflow state lost.",
        }

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
        candidates.append(
            {"rule_id": rule_id, "path": rule_path, "metadata": r.get("metadata", {})}
        )
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

    notify_msg = (
        f"🦉 Found {count} relevant lesson(s). Scoring top {len(candidates)}..."
    )
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
        parsed.append(
            {"rule_id": item.get("rule_id", ""), "score": score, "summary": summary}
        )
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
        scored_candidates.append(
            {
                "path": rule_path,
                "score": s.get("score", 5),
                "summary": s.get("summary", ""),
            }
        )

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
