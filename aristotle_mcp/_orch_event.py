from __future__ import annotations

import json
import re

from aristotle_mcp.config import resolve_repo_dir
from aristotle_mcp.frontmatter import read_frontmatter_raw, update_frontmatter_field
from aristotle_mcp._orch_prompts import _build_checker_prompt
from aristotle_mcp._orch_state import _load_workflow, _save_workflow
from aristotle_mcp._orch_parsers import _parse_checker_result, _parse_revised_rule, _do_search_and_notify
from aristotle_mcp._tools_rules import list_rules, stage_rule, get_audit_decision, commit_rule
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

    # Phase 0: undone/cancelled workflow short-circuit
    if workflow.get("status") in ("undone", "cancelled"):
        reason = "undone" if workflow.get("status") == "undone" else "cancelled"
        return {"action": "notify", "workflow_id": workflow_id,
                "message": f"🦉 Workflow {workflow_id} was {reason}. Event ignored."}

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

    # ═══ 3. Learn flow: o_done + compressing ═══
    if event_type == "o_done" and workflow.get("phase") == "compressing":
        compressed = data.get("result", "")
        if isinstance(compressed, dict):
            compressed = json.dumps(compressed)
        compressed = str(compressed)
        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)
        count = workflow.get("result_count", 0)
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Found {count} relevant lesson(s) (scored & compressed):\n\n{compressed}",
        }

    # ═══ 4. o_done catch-all ═══
    if event_type == "o_done":
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Unexpected o_done in phase '{workflow.get('phase')}'.",
        }

    # ═══ M5: score_done + scoring ═══
    if event_type == "score_done" and workflow.get("phase") == "scoring":
        from aristotle_mcp._orch_parsers import _parse_scores, _format_scored_rules_for_compress
        from aristotle_mcp._orch_prompts import _build_compress_prompt
        from aristotle_mcp.config import COMPRESS_TOP_N, COMPRESS_RULE_MAX_CHARS, COMPRESS_MAX_CHARS

        scores = _parse_scores(data)

        # Degradation: all default scores → single-round fallback
        if all(s["score"] == 5 and not s["summary"] for s in scores):
            workflow["phase"] = "done"
            _save_workflow(workflow_id, workflow)
            candidates = workflow.get("candidates", [])
            lines = [f"🦉 Found {workflow.get('result_count', 0)} relevant lesson(s):"]
            for i, c in enumerate(candidates[:5], 1):
                lines.append(f"  {i}. {c.get('path', '?')}")
            return {"action": "notify", "workflow_id": workflow_id, "message": "\n".join(lines)}

        scored_text = _format_scored_rules_for_compress(scores, workflow)
        workflow["phase"] = "compressing"
        workflow["scores"] = scores
        _save_workflow(workflow_id, workflow)

        o_prompt = _build_compress_prompt(
            query=workflow.get("query", ""),
            scored_rules_text=scored_text,
            top_n=COMPRESS_TOP_N,
            rule_max_chars=COMPRESS_RULE_MAX_CHARS,
            max_chars=COMPRESS_MAX_CHARS,
        )
        return {"action": "fire_o", "workflow_id": workflow_id, "o_prompt": o_prompt}

    # ═══ 5. Reflect flow: subagent_done + reflecting ═══
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

    # ═══ 6. Reflect flow: subagent_done + checking ═══
    if event_type == "subagent_done" and workflow.get("phase") == "checking":
        result = data.get("result", "")
        if isinstance(result, dict):
            result = json.dumps(result)

        committed, staged = _parse_checker_result(str(result))
        sequence = workflow.get("sequence")

        # ── M1: collect committed rule paths ──
        target_session = workflow.get("target_session_id", "")
        rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)
        rule_paths = []
        for r in rules_result.get("rules", []):
            meta_r = r.get("metadata", {})
            if (meta_r.get("status") in ("staging", "verified")
                    and meta_r.get("source_session") == target_session
                    and r.get("path")):
                rule_paths.append(r["path"])

        # Write paths to reflection record
        from aristotle_mcp._tools_reflection import _update_record_field
        _update_record_field(sequence, "committed_rule_paths", rule_paths)

        workflow["committed_rule_paths"] = rule_paths

        # ── M9: collect conflict warnings from committed rules ──
        conflict_warnings = []
        for rp in rule_paths:
            resolved, _ = _safe_resolve(rp)
            if not resolved or not resolved.exists():
                continue
            fm = read_frontmatter_raw(resolved) or {}
            cw = fm.get("conflicts_with")
            if cw:
                if isinstance(cw, str):
                    try:
                        cw = json.loads(cw)
                    except (json.JSONDecodeError, TypeError):
                        cw = []
                if cw:
                    rule_id = fm.get("id", "unknown")
                    conflict_warnings.append(
                        f"⚠️ Rule {rule_id} conflicts with: {', '.join(cw)}"
                    )
        workflow["conflict_warnings"] = conflict_warnings

        status = "auto_committed" if staged == 0 else "partial_commit"
        complete_reflection_record(
            sequence=sequence,
            status=status,
            rules_count=committed + staged,
        )

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        msg = f"🦉 Aristotle done. {committed} rules committed, {staged} staged."
        if conflict_warnings:
            msg += "\n" + "\n".join(conflict_warnings)
        msg += f"\n   Review: /aristotle review {sequence}"

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": msg,
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
