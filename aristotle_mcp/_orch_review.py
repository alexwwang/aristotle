from __future__ import annotations

import json
import uuid
from pathlib import Path

from aristotle_mcp._orch_prompts import _build_reflector_prompt, _build_revise_prompt
from aristotle_mcp._orch_state import _load_workflow, _save_workflow, _next_sequence
from aristotle_mcp._tools_rules import list_rules, commit_rule, reject_rule
from aristotle_mcp._tools_reflection import complete_reflection_record
from aristotle_mcp._utils import _safe_resolve
from aristotle_mcp.frontmatter import read_frontmatter_raw


def orchestrate_review_action(
    workflow_id: str,
    action: str,
    feedback: str = "",
    data_json: str = "{}",
) -> dict:
    """Handle Review flow user feedback.

    Args:
        workflow_id: Workflow ID from orchestrate_start("review")
        action: "confirm" | "reject" | "revise" | "re_reflect" | "inspect" | "show draft"
        feedback: User feedback text (for revise)
        data_json: Extra data (e.g. {"rule_index": N})

    Returns dict with action, workflow_id, and optional fields.
    """
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "message": "🦉 Workflow not found."}

    if workflow.get("phase") != "review":
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Workflow not in review phase (current: {workflow.get('phase')}).",
        }

    sequence = workflow.get("sequence")

    if action == "confirm":
        target_session = workflow.get("target_session_id", "")

        rule_paths = workflow.get("committed_rule_paths", [])

        committed = 0
        failed = 0

        if rule_paths:
            # M1: use pre-recorded paths
            for rp in rule_paths:
                resolved, _ = _safe_resolve(rp)
                if not resolved or not resolved.exists():
                    failed += 1
                    continue
                fm = read_frontmatter_raw(resolved) or {}
                if fm.get("status") == "staging":
                    try:
                        commit_rule(file_path=rp)
                        committed += 1
                    except Exception:
                        failed += 1
                elif fm.get("status") == "verified":
                    committed += 1  # already committed by C
        else:
            # Legacy fallback: keyword search
            rules_result = list_rules(
                status_filter="all", keyword=target_session, limit=20
            )
            for r in rules_result.get("rules", []):
                meta = r.get("metadata", {})
                if meta.get("status") == "staging":
                    try:
                        commit_rule(file_path=r.get("path", ""))
                        committed += 1
                    except Exception:
                        failed += 1
                elif meta.get("status") == "verified":
                    committed += 1

        complete_reflection_record(
            sequence=sequence, status="auto_committed", rules_count=committed or None
        )

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"✅ Review confirmed. {committed} rules committed."
            + (f" ⚠️ {failed} failed." if failed else ""),
        }

    elif action == "reject":
        target_session = workflow.get("target_session_id", "")
        rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)
        rejected = 0
        for r in rules_result.get("rules", []):
            meta = r.get("metadata", {})
            if meta.get("status") in ("staging", "pending"):
                try:
                    reject_rule(file_path=r.get("path", ""))
                    rejected += 1
                except Exception:
                    pass

        complete_reflection_record(sequence=sequence, status="rejected")

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"❌ Reflection #{sequence} rejected. {rejected} rules removed.",
        }

    elif action == "revise":
        # staging_rule_paths replaces displayed_rules
        # TODO: remove displayed_rules fallback after one release cycle
        displayed_rules = workflow.get("staging_rule_paths") or workflow.get("displayed_rules", [])
        if not displayed_rules:
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 No rules available to revise.",
            }

        rule_index = 0
        try:
            extra = json.loads(data_json)
            rule_index = int(extra.get("rule_index", 0))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

        if not rule_index or rule_index < 1 or rule_index > len(displayed_rules):
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": f"🦉 Invalid rule index. Choose 1-{len(displayed_rules)}.",
            }

        rule_path = displayed_rules[rule_index - 1]
        resolved, err = _safe_resolve(rule_path)
        if not resolved or not resolved.exists():
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": f"🦉 Rule file not found: {rule_path}",
            }

        original_content = resolved.read_text(encoding="utf-8")

        target_record = workflow.get("target_record", {})
        draft_path = target_record.get("draft_file_path", "")
        draft_summary = ""
        if draft_path:
            dp = Path(draft_path).expanduser()
            if dp.exists():
                draft_summary = dp.read_text(encoding="utf-8")[:1500]

        o_prompt = _build_revise_prompt(
            rule_path, original_content, feedback, draft_summary
        )

        workflow["pending_role"] = "O"
        workflow["revise_rule_path"] = rule_path
        _save_workflow(workflow_id, workflow)

        return {
            "action": "fire_o",
            "workflow_id": workflow_id,
            "o_prompt": o_prompt,
        }

    elif action == "re_reflect":
        re_reflect_count = workflow.get("re_reflect_count", 0)
        if re_reflect_count >= 3:
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 Max re-reflect (3) reached. Use /aristotle to start fresh.",
            }

        new_workflow_id = f"wf_{uuid.uuid4().hex[:16]}"
        new_sequence = _next_sequence()

        target_session_id = workflow.get("target_session_id", "")
        r_prompt = _build_reflector_prompt(
            target_session_id=target_session_id,
            focus_hint=workflow.get("focus", "full"),
            sequence=new_sequence,
            project_directory=workflow.get("project_directory", ""),
            user_language=workflow.get("user_language", "en-US"),
        )

        _save_workflow(
            new_workflow_id,
            {
                "phase": "reflecting",
                "command": "reflect",
                "target_session_id": target_session_id,
                "sequence": new_sequence,
                "pending_role": "R",
                "record_created": False,
                "target_label": workflow.get("target_label", "unknown"),
                "project_directory": workflow.get("project_directory", ""),
                "focus": workflow.get("focus", "full"),
                "user_language": workflow.get("user_language", "en-US"),
                "parent_review_sequence": sequence,
                "parent_workflow_id": workflow_id,
                "re_reflect_count": re_reflect_count + 1,
            },
        )

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        return {
            "action": "fire_sub",
            "workflow_id": new_workflow_id,
            "sub_prompt": r_prompt,
            "sub_role": "R",
            "notify_message": f"🦉 Re-reflecting (#{re_reflect_count + 1}/3)...",
        }

    elif action == "inspect":
        staging_rule_paths = workflow.get("staging_rule_paths")
        if not staging_rule_paths:
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 Rule inspection not available for this workflow.",
            }

        rule_index = 0
        try:
            extra = json.loads(data_json)
            rule_index = int(extra.get("rule_index", 0))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

        if not rule_index or rule_index < 1 or rule_index > len(staging_rule_paths):
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": f"🦉 Invalid rule index. Choose 1-{len(staging_rule_paths)}.",
            }

        rule_path = staging_rule_paths[rule_index - 1]
        resolved, err = _safe_resolve(rule_path)
        if not resolved or not resolved.exists():
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 Rule file not found.",
            }

        try:
            body = resolved.read_text(encoding="utf-8")
        except Exception:
            body = "(rule file not readable)"

        # Check if the rule body (after frontmatter) is empty
        rule_body = body
        if body.startswith("---"):
            parts = body.split("---", 2)
            rule_body = parts[2].strip() if len(parts) >= 3 else body

        if not rule_body.strip():
            body = "(empty rule body)"

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": body,
        }

    elif action == "show draft":
        target_record = workflow.get("target_record", {})
        draft_path = target_record.get("draft_file_path", "")
        if not draft_path:
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 No DRAFT file path found.",
            }

        dp = Path(draft_path).expanduser()
        if not dp.exists():
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 DRAFT file not found.",
            }

        try:
            content = dp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "🦉 DRAFT file not readable.",
            }
        if not content.strip():
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "(empty DRAFT)",
            }

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": content,
        }

    else:
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Unknown review action: {action}",
        }


def register_orch_review_tools(mcp) -> None:
    """Register orchestrate_review_action with the MCP server."""
    mcp.tool()(orchestrate_review_action)
