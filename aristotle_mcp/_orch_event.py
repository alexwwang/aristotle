from __future__ import annotations

import json
import re

from aristotle_mcp.config import resolve_repo_dir
from aristotle_mcp.frontmatter import read_frontmatter_raw, update_frontmatter_field
from aristotle_mcp._orch_prompts import _build_checker_prompt
from aristotle_mcp._orch_state import _load_workflow, _save_workflow
from aristotle_mcp._orch_parsers import _parse_checker_result, _parse_revised_rule, _do_search_and_notify
from aristotle_mcp._tools_rules import stage_rule, get_audit_decision, commit_rule
from aristotle_mcp._tools_reflection import create_reflection_record, complete_reflection_record
from aristotle_mcp._utils import _safe_resolve


def orchestrate_on_event(event_type: str, data_json: str) -> dict:
    """Receive event notification, update state, return next action.

    Args:
        event_type: "o_done" | "subagent_done" | "score_done"
        data_json: JSON string with event data (must include workflow_id)

    Returns dict with action, workflow_id, and optional fields.
    """
    try:
        data = json.loads(data_json)
    except (json.JSONDecodeError, TypeError):
        return {"action": "notify", "workflow_id": "", "message": "🦉 Invalid event data."}

    workflow_id = data.get("workflow_id", "")
    if not re.fullmatch(r"wf_[0-9a-f]{16}", workflow_id):
        return {"action": "notify", "workflow_id": workflow_id, "message": "🦉 Invalid workflow_id format."}
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "workflow_id": workflow_id, "message": f"🦉 Unknown workflow: {workflow_id}"}

    # ═══ 1. Learn flow: o_done + intent_extraction ═══
    if event_type == "o_done" and workflow.get("phase") == "intent_extraction":
        result = data.get("result", {})
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                result = {}

        intent_tags = result.get("intent_tags", {})
        keywords = result.get("keywords", "")

        workflow["phase"] = "search"
        workflow["intent_tags"] = intent_tags
        workflow["keywords"] = keywords
        _save_workflow(workflow_id, workflow)

        return _do_search_and_notify(workflow_id)

    # ═══ 2. Review flow: o_done + review ═══
    if event_type == "o_done" and workflow.get("phase") == "review":
        revised_content = data.get("result", "")
        if isinstance(revised_content, dict):
            revised_content = json.dumps(revised_content)

        rule_path, rule_content = _parse_revised_rule(str(revised_content))

        action_msg = ""
        if rule_path and rule_content:
            resolved, err = _safe_resolve(rule_path)
            if resolved and resolved.exists():
                original_fm = read_frontmatter_raw(resolved) or {}
                resolved.parent.mkdir(parents=True, exist_ok=True)
                resolved.write_text(rule_content, encoding="utf-8")

                if original_fm:
                    new_fm = read_frontmatter_raw(resolved) or {}
                    for key in ("created_at", "source_session", "scope", "project_hash"):
                        if key in original_fm and key not in new_fm:
                            update_frontmatter_field(resolved, key, original_fm[key])

                try:
                    stage_rule(file_path=rule_path)
                except Exception:
                    pass

                decision = get_audit_decision(file_path=rule_path)
                if decision.get("audit_level") == "auto":
                    try:
                        commit_rule(file_path=rule_path)
                        action_msg = f"✅ Rule revised and auto-committed: {rule_path}"
                    except Exception as e:
                        action_msg = f"⚠️ Rule revised but commit failed: {e}"
                else:
                    action_msg = f"📋 Rule revised and staged: {rule_path}"
            else:
                action_msg = f"⚠️ Rule file not found: {rule_path}"
        else:
            action_msg = "⚠️ Could not parse revised rule from output."

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": action_msg,
        }

    # ═══ 3. o_done catch-all ═══
    if event_type == "o_done":
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Unexpected o_done in phase '{workflow.get('phase')}'.",
        }

    # ═══ 4. Reflect flow: subagent_done + reflecting ═══
    if event_type == "subagent_done" and workflow.get("phase") == "reflecting":
        reflector_session_id = data.get("session_id", "")

        sequence = workflow.get("sequence")
        target_session_id = workflow.get("target_session_id")

        if not workflow.get("record_created"):
            create_reflection_record(
                target_session_id=target_session_id,
                target_label=workflow.get("target_label", "unknown"),
                reflector_session_id=reflector_session_id,
            )
            workflow["record_created"] = True

            rr_count = workflow.get("re_reflect_count", 0)
            if rr_count > 0:
                state_path = resolve_repo_dir().parent / "aristotle-state.json"
                if state_path.exists():
                    records = json.loads(state_path.read_text(encoding="utf-8"))
                    if records:
                        records[-1]["re_reflect_count"] = rr_count
                        state_path.write_text(
                            json.dumps(records, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )

        draft_file = str(
            resolve_repo_dir().parent / "aristotle-drafts" / f"rec_{sequence}.md"
        )

        c_prompt = _build_checker_prompt(
            sequence=sequence,
            draft_file=draft_file,
            project_directory=workflow.get("project_directory", ""),
        )

        workflow["phase"] = "checking"
        workflow["pending_role"] = "C"
        workflow["reflector_session_id"] = reflector_session_id
        _save_workflow(workflow_id, workflow)

        return {
            "action": "fire_sub",
            "workflow_id": workflow_id,
            "sub_prompt": c_prompt,
            "sub_role": "C",
        }

    # ═══ 5. Reflect flow: subagent_done + checking ═══
    if event_type == "subagent_done" and workflow.get("phase") == "checking":
        result = data.get("result", "")
        if isinstance(result, dict):
            result = json.dumps(result)

        committed, staged = _parse_checker_result(str(result))
        sequence = workflow.get("sequence")

        status = "auto_committed" if staged == 0 else "partial_commit"
        complete_reflection_record(
            sequence=sequence,
            status=status,
            rules_count=committed + staged,
        )

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Aristotle done. {committed} rules committed, {staged} staged.\n"
                       f"   Review: /aristotle review {sequence}",
        }

    # ═══ 6. Catch-all ═══
    return {
        "action": "notify",
        "workflow_id": workflow_id,
        "message": f"🦉 Unhandled event_type '{event_type}' in phase '{workflow.get('phase')}'.",
    }


def register_orch_event_tools(mcp) -> None:
    """Register orchestrate_on_event with the MCP server."""
    mcp.tool()(orchestrate_on_event)
