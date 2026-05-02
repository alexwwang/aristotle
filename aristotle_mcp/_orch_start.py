from __future__ import annotations

import json
import uuid
from pathlib import Path

from aristotle_mcp.config import resolve_repo_dir, resolve_sessions_dir
from aristotle_mcp._orch_prompts import (
    _build_intent_extraction_prompt,
    _build_reflector_prompt,
)
from aristotle_mcp._orch_state import (
    _cleanup_stale_workflows,
    _ensure_repo_initialized,
    _next_sequence,
    _save_workflow,
)
from aristotle_mcp._orch_parsers import (
    _do_search_and_notify,
    _enrich_rules_metadata,
    _format_review_output,
    _build_review_actions,
)
from aristotle_mcp._tools_rules import list_rules


def orchestrate_start(command: str, args_json: str = "{}") -> dict:
    """Analyze command, initialize workflow state, return first action.

    Args:
        command: Command type ("learn", "reflect", "review")
        args_json: JSON string with command parameters

    Returns dict with action ("fire_o"|"notify"|"done"),
        optional o_prompt, workflow_id, and optional message.
    """
    try:
        args = json.loads(args_json)
    except (json.JSONDecodeError, TypeError):
        return {
            "action": "notify",
            "workflow_id": "",
            "message": "🦉 Invalid arguments. Could not parse JSON.",
        }

    _ensure_repo_initialized()
    _cleanup_stale_workflows()

    workflow_id = f"wf_{uuid.uuid4().hex[:16]}"

    if command == "learn":
        query = args.get("query", "")
        if not query:
            domain = args.get("domain", "")
            goal = args.get("goal", "")
            if domain and goal:
                query = f"{domain} {goal}"
            else:
                return {
                    "action": "notify",
                    "workflow_id": workflow_id,
                    "message": "🦉 Need a query to search. Usage: /aristotle learn <query>",
                }

        domain = args.get("domain")
        goal = args.get("goal")

        if domain and goal:
            _save_workflow(
                workflow_id,
                {
                    "phase": "search",
                    "command": "learn",
                    "query": query,
                    "intent_tags": {"domain": domain, "task_goal": goal},
                },
            )
            return _do_search_and_notify(workflow_id)

        _save_workflow(
            workflow_id,
            {
                "phase": "intent_extraction",
                "command": "learn",
                "query": query,
            },
        )

        o_prompt = _build_intent_extraction_prompt(query)
        return {
            "action": "fire_o",
            "workflow_id": workflow_id,
            "o_prompt": o_prompt,
        }

    elif command == "reflect":
        target_session_id = args.get("target_session_id")
        focus = args.get("focus", "last")
        user_language = args.get("user_language", "en-US")
        project_directory = args.get("project_directory", "")
        session_file = args.get("session_file", "")

        # Detect Bridge plugin via marker file
        bridge_active = resolve_sessions_dir().joinpath(".bridge-active").exists()

        if not target_session_id:
            if bridge_active:
                pass  # Bridge handles session resolution via executor
            else:
                return {"action": "pre_resolve_needed"}

        sequence = _next_sequence()

        r_prompt = _build_reflector_prompt(
            target_session_id=target_session_id,
            focus_hint=focus,
            sequence=sequence,
            project_directory=project_directory,
            user_language=user_language,
            session_file=session_file,
        )

        _save_workflow(
            workflow_id,
            {
                "phase": "reflecting",
                "command": "reflect",
                "target_session_id": target_session_id,
                "sequence": sequence,
                "pending_role": "R",
                "record_created": False,
                "target_label": args.get("target_label", "unknown"),
                "project_directory": project_directory,
                "focus": focus,
                "user_language": user_language,
            },
        )

        return {
            "action": "fire_sub",
            "workflow_id": workflow_id,
            "sub_prompt": r_prompt,
            "sub_role": "R",
            "notify_message": f"🦉 Aristotle Reflector launched [{args.get('target_label', 'unknown')}].\n"
            "   Checker will validate automatically when done.",
            "use_bridge": bridge_active,
        }

    elif command == "review":
        try:
            sequence = int(args.get("sequence", 0))
        except (ValueError, TypeError):
            return {
                "action": "notify",
                "message": "🦉 Invalid sequence number. Usage: /aristotle review N",
            }
        if not sequence:
            return {"action": "notify", "message": "🦉 Usage: /aristotle review N"}

        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        if not state_path.exists():
            return {
                "action": "notify",
                "message": "🦉 No reflection records yet. Run /aristotle first.",
            }

        try:
            records = json.loads(state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            return {"action": "notify", "message": "🦉 State file corrupted."}

        target_id = f"rec_{sequence}"
        target_record = next((r for r in records if r.get("id") == target_id), None)

        if not target_record:
            return {
                "action": "notify",
                "message": f"🦉 Reflection #{sequence} not found. Run /aristotle sessions to list.",
            }

        draft_path = target_record.get("draft_file_path", "")
        draft_content = ""
        if draft_path:
            dp = Path(draft_path).expanduser()
            if dp.exists():
                draft_content = dp.read_text(encoding="utf-8")

        rules_result = list_rules(
            status_filter="all",
            reflection_sequence=sequence,
            limit=0,
        )

        staging_rules, verified_rules, audit_decisions = _enrich_rules_metadata(rules_result)

        staging_rule_paths = [r.get("path", "") for r in staging_rules]
        has_staging = len(staging_rules) > 0

        message = _format_review_output(
            sequence,
            target_record,
            draft_content,
            staging_rules,
            verified_rules,
            audit_decisions,
        )

        review_actions = _build_review_actions(workflow_id, has_staging_rules=has_staging)

        _save_workflow(
            workflow_id,
            {
                "phase": "review",
                "command": "review",
                "sequence": sequence,
                "target_record": target_record,
                "staging_rule_paths": staging_rule_paths,
                "target_session_id": target_record.get("target_session_id", ""),
                "committed_rule_paths": target_record.get("committed_rule_paths", []),
                "re_reflect_count": target_record.get("re_reflect_count", 0),
            },
        )

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": message,
            "review_actions": review_actions,
        }

    elif command == "sessions":
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        if not state_path.exists():
            return {"action": "notify", "message": "🦉 No reflection records yet."}

        try:
            records = json.loads(state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            return {"action": "notify", "message": "🦉 State file corrupted."}

        if not records:
            return {"action": "notify", "message": "🦉 No reflection records yet."}

        lines = ["🦉 Reflection Records:"]
        for i, r in enumerate(records):
            s = r.get("status", "?")
            target = r.get("target_label", "?")
            rules = r.get("rules_count", "?")
            launched = r.get("launched_at", "?")[:16]

            status_icon = {
                "auto_committed": "✅",
                "partial_commit": "📋",
                "processing": "⏳",
                "checker_failed": "❌",
                "rejected": "❌",
            }.get(s, "?")

            rec_id = r.get("id", f"rec_{i + 1}")
            lines.append(f"  #{rec_id.replace('rec_', '')} {status_icon} [{target}] {rules} rules — {launched}")

        return {
            "action": "notify",
            "message": "\n".join(lines),
        }

    else:
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Unknown command: {command}",
        }


def register_orch_start_tools(mcp) -> None:
    """Register orchestrate_start with the MCP server."""
    mcp.tool()(orchestrate_start)
