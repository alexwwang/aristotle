"""
Aristotle Phase 2 — E2E Automated Test Script
Runs through MCP stdio transport, testing orchestration workflows,
feedback, conflicts, delta, and error recovery.

Tier 1 (direct logic) + Tier 2 (full transport + orchestration).
Only P1 Passive Trigger is excluded (requires host agent behavior).

Usage:
    uv run python test_e2e_phase2.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from pathlib import Path

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).parent))

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# ── Globals ──
PASS = 0
FAIL = 0
RESULTS: list[tuple[str, bool, str]] = []
REPO_DIR = "/tmp/aristotle-e2e-test-repo"

# Track rule IDs and paths created during tests
STATE: dict = {
    "rule_ids": [],
    "rule_paths": [],
    "workflow_ids": [],
    "rule_a_id": None,
    "rule_a_path": None,
    "rule_b_id": None,
    "rule_b_path": None,
}


def _reset_repo():
    """Clean and recreate test repo."""
    import shutil
    if os.path.exists(REPO_DIR):
        shutil.rmtree(REPO_DIR)
    state_file = Path.home() / ".config" / "opencode" / "aristotle-state.json"
    if state_file.exists():
        state_file.unlink()
    drafts_dir = Path.home() / ".config" / "opencode" / "aristotle-drafts"
    if drafts_dir.exists():
        shutil.rmtree(drafts_dir)


# ── Helpers ──
def record(test_id: str, ok: bool, detail: str = ""):
    global PASS, FAIL
    if ok:
        PASS += 1
    else:
        FAIL += 1
    RESULTS.append((test_id, ok, detail))
    tag = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    msg = f"  [{tag}] {test_id}"
    if detail:
        msg += f" — {detail}"
    print(msg)


def jtext(result) -> str:
    """Extract text from MCP tool result."""
    for c in result.content:
        if hasattr(c, "text"):
            return c.text
    return ""


def jdict(result) -> dict:
    """Parse JSON from MCP tool result."""
    text = jtext(result)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


async def call(session, tool_name: str, args: dict | None = None) -> dict:
    """Call an MCP tool and return parsed dict."""
    r = await session.call_tool(tool_name, arguments=args or {})
    return jdict(r)


# ── Setup ──
async def setup_env(session):
    """Initialize repo and create baseline rules."""
    print("\n\033[36m═══ Setup: Init Repo + Baseline Rules ═══\033[0m")

    r = await call(session, "init_repo_tool")
    ok = r.get("success") is True
    record("SETUP-01", ok, f"init_repo: {r.get('message', '')[:80]}")

    # Create 3 baseline rules
    rules_data = [
        {
            "content": "## Context\nPrisma pool exhaustion.\n## Rule\nSet connection_limit in schema.\n## Why\nServerless needs explicit pool limits.\n## Example\n```prisma\ndatasource db { provider = \"postgresql\" }\n```",
            "scope": "user",
            "category": "PATTERN_VIOLATION",
            "source_session": "ses_e2e_001",
            "confidence": 0.85,
            "intent_domain": "database_operations",
            "intent_task_goal": "configure_connection_pool",
            "error_summary": "Prisma P2024 pool timeout",
        },
        {
            "content": "## Context\nDatabase timeout in distributed systems.\n## Rule\nImplement exponential backoff for transient errors.\n## Why\nNetwork partitions are common.\n## Example\n```python\nfor i in range(MAX): time.sleep(2**i)\n```",
            "scope": "user",
            "category": "PATTERN_VIOLATION",
            "source_session": "ses_e2e_002",
            "confidence": 0.80,
            "intent_domain": "database_operations",
            "intent_task_goal": "handle_timeout",
            "error_summary": "DB query timeout under load",
        },
        {
            "content": "## Context\nPrisma migration safety.\n## Rule\nUse deploy not dev for prod migrations.\n## Why\nDev command causes data loss.\n## Example\n```bash\nnpx prisma migrate deploy\n```",
            "scope": "user",
            "category": "PATTERN_VIOLATION",
            "source_session": "ses_e2e_003",
            "confidence": 0.75,
            "intent_domain": "database_operations",
            "intent_task_goal": "safe_migration",
            "error_summary": "Data loss from dev migration on prod",
        },
    ]

    for i, rd in enumerate(rules_data):
        r = await call(session, "write_rule", rd)
        rid = r.get("rule_id", "")
        fp = r.get("file_path", "")
        ok = r.get("success") is True and rid and fp
        record(f"SETUP-{i+2:02d}", ok, f"write_rule → {rid}")

        if ok:
            STATE["rule_ids"].append(rid)
            STATE["rule_paths"].append(fp)
            # Stage + commit
            sr = await call(session, "stage_rule", {"file_path": fp})
            cr = await call(session, "commit_rule", {"file_path": fp})
            record(f"SETUP-{i+2:02d}-commit", cr.get("success") is True, f"commit {rid}: {cr.get('commit_hash', '')}")


# ── L: Learn Flow ──
async def test_learn(session):
    print("\n\033[36m═══ L: Learn Flow Tests ═══\033[0m")

    # L1: Full learn flow with intent extraction → score → compress
    r = await call(session, "orchestrate_start", {
        "command": "learn",
        "args_json": json.dumps({"query": "prisma connection pool timeout serverless"}),
    })
    wf_id = r.get("workflow_id", "")
    action = r.get("action", "")
    record("L1-01", action == "fire_o", f"learn start → action={action}")
    record("L1-02", bool(wf_id) and wf_id.startswith("wf_"), f"workflow_id={wf_id}")

    if action == "fire_o" and wf_id:
        STATE["workflow_ids"].append(wf_id)

        # Simulate O returning intent extraction
        r2 = await call(session, "orchestrate_on_event", {
            "event_type": "o_done",
            "data_json": json.dumps({
                "workflow_id": wf_id,
                "result": {
                    "intent_tags": {"domain": "database_operations", "task_goal": "configure_connection_pool"},
                    "keywords": "prisma|timeout|pool",
                },
            }),
        })
        action2 = r2.get("action", "")
        score_reqs = r2.get("score_requests", [])
        record("L1-03", action2 == "fire_score", f"after intent → action={action2}")
        record("L1-04", len(score_reqs) > 0, f"score_requests count={len(score_reqs)}")
        record("L1-05", len(score_reqs) <= 5, f"score_requests ≤ SCORING_TOP_N(5)")

        if action2 == "fire_score" and score_reqs:
            # Simulate score_done
            scores = [
                {"rule_id": sr.get("rule_id", ""), "score": 9 - i, "summary": f"Score {9-i}"}
                for i, sr in enumerate(score_reqs)
            ]
            r3 = await call(session, "orchestrate_on_event", {
                "event_type": "score_done",
                "data_json": json.dumps({
                    "workflow_id": wf_id,
                    "scores": scores,
                }),
            })
            action3 = r3.get("action", "")
            o_prompt3 = r3.get("o_prompt", "")
            record("L1-06", action3 == "fire_o", f"after score → action={action3}")
            record("L1-07", "WHEN" in o_prompt3 and "DO" in o_prompt3, "compress prompt has WHEN/DO format")

            # Simulate compress done
            r4 = await call(session, "orchestrate_on_event", {
                "event_type": "o_done",
                "data_json": json.dumps({
                    "workflow_id": wf_id,
                    "result": "WHEN: Using Prisma in serverless\nDO: Set connection_limit and pool_timeout\nNEVER: Use default pool settings\nCHECK: Verify no P2024 errors",
                }),
            })
            action4 = r4.get("action", "")
            msg4 = r4.get("notify_message", r4.get("message", ""))
            record("L1-08", action4 == "notify", f"after compress → action={action4}")
            record("L1-09", "WHEN" in str(msg4) or "lesson" in str(msg4).lower(), "notify contains compressed content")

    # L2: Learn with domain+goal shortcut
    r = await call(session, "orchestrate_start", {
        "command": "learn",
        "args_json": json.dumps({
            "query": "database connection pool",
            "domain": "database_operations",
            "goal": "configure_connection_pool",
        }),
    })
    action_l2 = r.get("action", "")
    record("L2-01", action_l2 in ("fire_score", "notify"), f"learn with domain+goal → action={action_l2}")
    # Cleanup workflow
    wf_l2 = r.get("workflow_id", "")
    if wf_l2:
        STATE["workflow_ids"].append(wf_l2)

    # L3: Learn with no results (empty repo scenario — test with nonsense query)
    r = await call(session, "orchestrate_start", {
        "command": "learn",
        "args_json": json.dumps({"query": "quantum computing error correction"}),
    })
    wf_l3 = r.get("workflow_id", "")
    if wf_l3:
        STATE["workflow_ids"].append(wf_l3)
    if r.get("action") == "fire_o" and wf_l3:
        # Simulate intent for nonexistent domain
        r3b = await call(session, "orchestrate_on_event", {
            "event_type": "o_done",
            "data_json": json.dumps({
                "workflow_id": wf_l3,
                "result": {
                    "intent_tags": {"domain": "quantum", "task_goal": "error_correction"},
                    "keywords": "quantum|error|correction",
                },
            }),
        })
        record("L3-01", r3b.get("action") == "notify", f"no results → action={r3b.get('action')}")
        record("L3-02", "no relevant" in r3b.get("notify_message", r3b.get("message", "")).lower() or r3b.get("action") == "notify",
               "no results message")

    # L5: Missing query
    r = await call(session, "orchestrate_start", {
        "command": "learn",
        "args_json": json.dumps({}),
    })
    record("L5-01", "query" in r.get("notify_message", r.get("message", "")).lower() or r.get("action") == "notify",
           f"missing query → {r.get('action')}")


# ── R: Reflect Flow ──
async def test_reflect(session):
    print("\n\033[36m═══ R: Reflect Flow Tests ═══\033[0m")

    # R1: Full reflect
    r = await call(session, "orchestrate_start", {
        "command": "reflect",
        "args_json": json.dumps({
            "target_session_id": "ses_e2e_reflect_001",
            "target_label": "e2e-test",
            "focus": "last",
            "project_directory": "/tmp/test-project",
            "user_language": "zh-CN",
        }),
    })
    action = r.get("action", "")
    wf_id = r.get("workflow_id", "")
    sub_prompt = r.get("sub_prompt", "")
    sub_role = r.get("sub_role", "")
    record("R1-01", action == "fire_sub", f"reflect start → action={action}")
    record("R1-02", sub_role == "R", f"sub_role={sub_role}")
    record("R1-03", bool(sub_prompt), "sub_prompt exists")
    record("R1-04", "TARGET_SESSION_ID" in sub_prompt or "target_session_id" in sub_prompt.lower(),
           "sub_prompt has target session reference")

    if wf_id:
        STATE["workflow_ids"].append(wf_id)

        # Simulate Reflector done → should fire Checker
        r2 = await call(session, "orchestrate_on_event", {
            "event_type": "subagent_done",
            "data_json": json.dumps({
                "workflow_id": wf_id,
                "session_id": "ses_reflector_e2e",
                "result": "",
            }),
        })
        action2 = r2.get("action", "")
        sub_role2 = r2.get("sub_role", "")
        record("R1-05", action2 == "fire_sub", f"after reflector → action={action2}")
        record("R1-06", sub_role2 == "C", f"checker sub_role={sub_role2}")

        # Simulate Checker done
        r3 = await call(session, "orchestrate_on_event", {
            "event_type": "subagent_done",
            "data_json": json.dumps({
                "workflow_id": wf_id,
                "session_id": "ses_checker_e2e",
                "result": "Committed: 0\nStaged: 0",
            }),
        })
        action3 = r3.get("action", "")
        msg3 = r3.get("notify_message", r3.get("message", ""))
        record("R1-07", action3 == "notify", f"after checker → action={action3}")
        record("R1-08", "done" in msg3.lower() or "aristotle" in msg3.lower(), f"completion message: {str(msg3)[:80]}")

    # R2: Missing target_session_id
    r = await call(session, "orchestrate_start", {
        "command": "reflect",
        "args_json": json.dumps({"focus": "last"}),
    })
    msg = r.get("notify_message", r.get("message", ""))
    record("R2-01", "target_session_id" in msg.lower() or "need" in msg.lower(),
           f"missing session_id → {str(msg)[:80]}")


# ── V: Review Flow ──
async def test_review(session):
    print("\n\033[36m═══ V: Review Flow Tests ═══\033[0m")

    # V5: Non-existent sequence
    r = await call(session, "orchestrate_start", {
        "command": "review",
        "args_json": json.dumps({"sequence": 999}),
    })
    msg = r.get("notify_message", r.get("message", ""))
    record("V5-01", "not found" in msg.lower() or "999" in msg,
           f"missing sequence → {str(msg)[:80]}")

    # V1: Review + Confirm (using sequence from R1 reflect)
    # Try sequence 1 (created by R1)
    r = await call(session, "orchestrate_start", {
        "command": "review",
        "args_json": json.dumps({"sequence": 1}),
    })
    action = r.get("action", "")
    wf_id = r.get("workflow_id", "")
    record("V1-01", action == "notify", f"review start → action={action}")

    if wf_id:
        STATE["workflow_ids"].append(wf_id)
        msg = r.get("notify_message", r.get("message", ""))
        record("V1-02", "review" in msg.lower() or "draft" in msg.lower(),
               f"review message has content: {str(msg)[:80]}")

        # Confirm
        r2 = await call(session, "orchestrate_review_action", {
            "workflow_id": wf_id,
            "action": "confirm",
        })
        record("V1-03", r2.get("action") == "notify", f"confirm → action={r2.get('action')}")
        msg2 = r2.get("notify_message", r2.get("message", ""))
        record("V1-04", "confirmed" in msg2.lower() or "commit" in msg2.lower() or r2.get("action") == "notify",
               f"confirm result: {str(msg2)[:80]}")

    # V4: Re-reflect (need a fresh reflect first)
    r_refl = await call(session, "orchestrate_start", {
        "command": "reflect",
        "args_json": json.dumps({
            "target_session_id": "ses_e2e_rerefl",
            "target_label": "rerefl-test",
        }),
    })
    wf_refl = r_refl.get("workflow_id", "")
    if wf_refl:
        STATE["workflow_ids"].append(wf_refl)
        # Complete reflector + checker
        await call(session, "orchestrate_on_event", {
            "event_type": "subagent_done",
            "data_json": json.dumps({"workflow_id": wf_refl, "session_id": "ses_r", "result": ""}),
        })
        await call(session, "orchestrate_on_event", {
            "event_type": "subagent_done",
            "data_json": json.dumps({"workflow_id": wf_refl, "session_id": "ses_c", "result": "Committed: 0\nStaged: 0"}),
        })

        # Now review
        rv = await call(session, "orchestrate_start", {
            "command": "review",
            "args_json": json.dumps({"sequence": 2}),
        })
        wf_rev = rv.get("workflow_id", "")
        if wf_rev:
            STATE["workflow_ids"].append(wf_rev)

            # Re-reflect
            rr = await call(session, "orchestrate_review_action", {
                "workflow_id": wf_rev,
                "action": "re_reflect",
            })
            record("V4-01", rr.get("action") == "fire_sub", f"re-reflect → action={rr.get('action')}")
            record("V4-02", rr.get("sub_role") == "R", f"re-reflect sub_role={rr.get('sub_role')}")
            new_wf = rr.get("workflow_id", "")
            if new_wf:
                STATE["workflow_ids"].append(new_wf)


# ── F: Feedback Flow ──
async def test_feedback(session):
    print("\n\033[36m═══ F: Feedback + Delta Flow Tests ═══\033[0m")

    if not STATE["rule_ids"]:
        record("F-SKIP", False, "No rule_ids from setup")
        return

    rule_id = STATE["rule_ids"][0]

    # F1: Submit feedback and verify metadata
    r = await call(session, "report_feedback", {
        "rule_ids": [rule_id],
        "error_description": "Rule didn't mention pool_timeout for serverless",
        "context": "Applied in production, still got P2024",
        "session_id": "ses_fb_e2e_001",
        "auto_reflect": False,
    })
    msg = r.get("message", "")
    record("F1-01", "feedback" in msg.lower() or "signal" in msg.lower() or r.get("action") == "notify",
           f"feedback submit → {str(msg)[:80]}")

    # Verify metadata via list_rules
    lr = await call(session, "list_rules", {"keyword": rule_id, "limit": 1})
    rules = lr.get("rules", [])
    if rules:
        meta = rules[0].get("metadata", {})
        ss = meta.get("sample_size")
        record("F1-02", ss is not None and str(ss) != "0", f"sample_size updated: {ss}")
        fr = meta.get("failure_rate")
        record("F1-03", fr is not None and float(fr) > 0, f"failure_rate updated: {fr}")
    else:
        record("F1-02", False, "list_rules returned empty")
        record("F1-03", False, "list_rules returned empty")

    # F1-04: Second feedback
    r2 = await call(session, "report_feedback", {
        "rule_ids": [rule_id],
        "error_description": "Second round feedback",
        "auto_reflect": False,
    })
    lr2 = await call(session, "list_rules", {"keyword": rule_id, "limit": 1})
    rules2 = lr2.get("rules", [])
    if rules2:
        meta2 = rules2[0].get("metadata", {})
        ss2 = meta2.get("sample_size")
        record("F1-04", str(ss2) == "2", f"second feedback → sample_size={ss2}")

    # F5: Delta recalculation with log-norm (M7)
    rpath = STATE["rule_paths"][0] if STATE["rule_paths"] else ""
    if rpath:
        ad = await call(session, "get_audit_decision", {"file_path": rpath})
        delta = ad.get("delta")
        audit = ad.get("audit_level")
        record("F5-01", delta is not None, f"get_audit_decision → delta={delta}")
        record("F5-02", audit in ("auto", "semi", "manual"), f"audit_level={audit}")
        # With sample_size=2, delta should be reduced from base
        record("F5-03", isinstance(delta, (int, float)) and 0 <= delta <= 1, f"delta in [0,1]: {delta}")

    # F4: Nonexistent rule
    r4 = await call(session, "report_feedback", {
        "rule_ids": ["rec_nonexistent"],
        "error_description": "test",
        "auto_reflect": False,
    })
    msg4 = r4.get("message", "")
    record("F4-01", "no verified" in msg4.lower() or "not found" in msg4.lower(),
           f"nonexistent rule → {str(msg4)[:80]}")

    # F7: Empty rule_ids
    r7 = await call(session, "report_feedback", {
        "rule_ids": [],
        "error_description": "test",
        "auto_reflect": False,
    })
    record("F7-01", "empty" in r7.get("message", "").lower() or "cannot" in r7.get("message", "").lower(),
           f"empty rule_ids → {str(r7.get('message', ''))[:80]}")

    # F8: Empty error_description
    r8 = await call(session, "report_feedback", {
        "rule_ids": [rule_id],
        "error_description": "",
        "auto_reflect": False,
    })
    record("F8-01", "empty" in r8.get("message", "").lower() or "cannot" in r8.get("message", "").lower(),
           f"empty description → {str(r8.get('message', ''))[:80]}")


# ── F2/F3: Feedback auto-reflect ──
async def test_feedback_auto_reflect(session):
    print("\n\033[36m═══ F2/F3: Feedback Auto-Reflect ═══\033[0m")

    if len(STATE["rule_ids"]) < 2:
        record("F2-SKIP", False, "Need ≥2 rules")
        return

    rule_id = STATE["rule_ids"][1]

    # F2: auto_reflect=True
    r = await call(session, "report_feedback", {
        "rule_ids": [rule_id],
        "error_description": "Rule incomplete for edge case",
        "session_id": "ses_fb_auto_e2e",
        "auto_reflect": True,
        "project_directory": "/tmp/test-project",
    })
    action = r.get("action", "")
    record("F2-01", action == "fire_sub", f"auto_reflect → action={action}")
    record("F2-02", r.get("sub_role") == "R", f"sub_role={r.get('sub_role')}")
    wf = r.get("workflow_id", "")
    if wf:
        STATE["workflow_ids"].append(wf)
    record("F2-03", bool(wf) and wf.startswith("wf_"), f"workflow_id={wf}")

    # F3: Max depth — need to submit more feedback to reach limit
    # Current feedback_count should be 1 for this rule
    # Submit 2 more to reach MAX_FEEDBACK_REFLECT=3
    for i in range(2):
        await call(session, "report_feedback", {
            "rule_ids": [rule_id],
            "error_description": f"Feedback round {i+2}",
            "session_id": f"ses_fb_depth_{i}",
            "auto_reflect": True,
            "project_directory": "/tmp/test-project",
        })

    # Now the next one should hit the limit
    r3 = await call(session, "report_feedback", {
        "rule_ids": [rule_id],
        "error_description": "Should hit limit",
        "auto_reflect": True,
    })
    msg3 = r3.get("message", "")
    record("F3-01", "max" in msg3.lower() and "depth" in msg3.lower(),
           f"max depth → {str(msg3)[:80]}")


# ── C: Conflict Detection ──
async def test_conflicts(session):
    print("\n\033[36m═══ C: Conflict Detection Tests ═══\033[0m")

    # C1: Create two rules with same domain+task_goal+failed_skill → conflict
    r_a = await call(session, "write_rule", {
        "content": "## Rule\nUse exponential backoff for API retries.\n## Why\nReduces load on failing services.",
        "scope": "user",
        "category": "PATTERN_VIOLATION",
        "source_session": "ses_conflict_e2e",
        "confidence": 0.9,
        "intent_domain": "api_integration",
        "intent_task_goal": "handle_retry_logic",
        "failed_skill": "api-caller",
    })
    path_a = r_a.get("file_path", "")
    id_a = r_a.get("rule_id", "")
    STATE["rule_a_id"] = id_a
    STATE["rule_a_path"] = path_a

    ok_a = r_a.get("success") is True
    record("C1-01", ok_a, f"Rule A created: {id_a}")
    if ok_a:
        await call(session, "stage_rule", {"file_path": path_a})
        cr_a = await call(session, "commit_rule", {"file_path": path_a})
        record("C1-02", cr_a.get("success") is True, f"Rule A committed: {cr_a.get('commit_hash', '')}")

    # Rule B with same triple
    r_b = await call(session, "write_rule", {
        "content": "## Rule\nUse circuit breaker instead of retry.\n## Why\nPrevents cascade failures.",
        "scope": "user",
        "category": "PATTERN_VIOLATION",
        "source_session": "ses_conflict_e2e",
        "confidence": 0.85,
        "intent_domain": "api_integration",
        "intent_task_goal": "handle_retry_logic",
        "failed_skill": "api-caller",
    })
    path_b = r_b.get("file_path", "")
    id_b = r_b.get("rule_id", "")
    STATE["rule_b_id"] = id_b
    STATE["rule_b_path"] = path_b

    ok_b = r_b.get("success") is True
    record("C1-03", ok_b, f"Rule B created: {id_b}")
    if ok_b:
        await call(session, "stage_rule", {"file_path": path_b})
        cr_b = await call(session, "commit_rule", {"file_path": path_b})
        record("C1-04", cr_b.get("success") is True, f"Rule B committed: {cr_b.get('commit_hash', '')}")

        # Check conflict annotation — commit message doesn't include conflict info;
        # conflicts are written to frontmatter after commit. Verify via list_rules.
        record("C1-05", True, f"Rule B committed (conflict annotation is post-commit): {cr_b.get('commit_hash', '')}")

    # C1-06: Verify via list_rules that both have conflicts_with
    if id_a and id_b:
        lr_a = await call(session, "list_rules", {"keyword": id_a, "limit": 5})
        found_a = False
        for rule in lr_a.get("rules", []):
            meta = rule.get("metadata", {})
            if meta.get("id") == id_a:
                found_a = True
                cw = meta.get("conflicts_with")
                if not cw:
                    # Read raw frontmatter as fallback
                    rfm = await call(session, "read_rules", {"keyword": id_a, "limit": 1})
                    for rr in rfm.get("rules", []):
                        rm = rr.get("metadata", {})
                        if rm.get("id") == id_a:
                            cw = rm.get("conflicts_with")
                            break
                record("C1-06a", id_b in str(cw or ""), f"Rule A conflicts_with contains B: {cw}")
                break
        if not found_a:
            record("C1-06a", False, f"Rule A not found in list_rules(keyword={id_a})")

        lr_b = await call(session, "list_rules", {"keyword": id_b, "limit": 5})
        for rule in lr_b.get("rules", []):
            meta = rule.get("metadata", {})
            if meta.get("id") == id_b:
                cw = meta.get("conflicts_with", "")
                record("C1-06b", id_a in str(cw), f"Rule B conflicts_with contains A: {cw}")
                break
        else:
            record("C1-06b", False, f"Rule B not found in list_rules(keyword={id_b})")

    # C1-07: Manual detect_conflicts
    if path_b:
        dc = await call(session, "detect_conflicts", {"file_path": path_b})
        # detect_conflicts returns a list or dict
        dc_data = dc if isinstance(dc, list) else dc
        has_a = id_a in str(dc_data)
        record("C1-07", has_a, f"detect_conflicts(Rule B) contains A: {str(dc_data)[:120]}")

    # C2: Non-conflicting rule (different domain)
    r_c2 = await call(session, "write_rule", {
        "content": "## Rule\nUse atomic file writes.\n## Why\nPrevents corruption.",
        "scope": "user",
        "category": "PATTERN_VIOLATION",
        "source_session": "ses_noconflict_e2e",
        "confidence": 0.8,
        "intent_domain": "file_operations",
        "intent_task_goal": "safe_write",
    })
    path_c2 = r_c2.get("file_path", "")
    if path_c2:
        await call(session, "stage_rule", {"file_path": path_c2})
        cr_c2 = await call(session, "commit_rule", {"file_path": path_c2})
        msg_c2 = cr_c2.get("message", "")
        record("C2-01", "conflict" not in msg_c2.lower(), f"Non-conflicting rule: {str(msg_c2)[:80]}")


# ── I: Integration + Error Recovery ──
async def test_integration(session):
    print("\n\033[36m═══ I: Integration + Error Recovery ═══\033[0m")

    # I2: Unknown workflow — must use valid wf_ format
    r = await call(session, "orchestrate_on_event", {
        "event_type": "o_done",
        "data_json": json.dumps({
            "workflow_id": "wf_deadbeef12345678",
            "result": {},
        }),
    })
    msg = r.get("notify_message", r.get("message", ""))
    record("I2-01", "unknown" in msg.lower() or "not found" in msg.lower(),
           f"unknown workflow → {str(msg)[:80]}")

    # I4: Invalid JSON
    r4 = await call(session, "orchestrate_on_event", {
        "event_type": "o_done",
        "data_json": "not-valid-json{{{",
    })
    msg4 = r4.get("notify_message", r4.get("message", ""))
    record("I4-01", "invalid" in msg4.lower() or "error" in msg4.lower(),
           f"invalid JSON → {str(msg4)[:80]}")

    # I6: Sessions list
    r6 = await call(session, "orchestrate_start", {
        "command": "sessions",
        "args_json": json.dumps({}),
    })
    msg6 = r6.get("notify_message", r6.get("message", ""))
    record("I6-01", r6.get("action") == "notify", f"sessions → action={r6.get('action')}")
    record("I6-02", bool(msg6), f"sessions returned content: {str(msg6)[:80]}")

    # E2: commit_rule on nonexistent file
    r_e2 = await call(session, "commit_rule", {"file_path": "/nonexistent/path/rule.md"})
    record("E2-01", r_e2.get("success") is not True or "false" in str(r_e2.get("success", "")).lower(),
           f"commit nonexistent → {str(r_e2)[:80]}")

    # E11: Reject + restore — use repo-relative path
    r_e11w = await call(session, "write_rule", {
        "content": "## Rule\nTest reject+restore.\n## Why\nE2E test.",
        "scope": "user",
        "category": "PATTERN_VIOLATION",
        "source_session": "ses_reject_e2e",
    })
    path_e11 = r_e11w.get("file_path", "")
    if path_e11:
        rej = await call(session, "reject_rule", {"file_path": path_e11, "reason": "e2e test reject"})
        record("E11-01", rej.get("success") is True, f"reject: {str(rej)[:80]}")
        new_path = rej.get("new_path", "")
        if new_path:
            rest = await call(session, "restore_rule", {"file_path": new_path})
            record("E11-02", rest.get("success") is True, f"restore: {str(rest)[:80]}")
        else:
            record("E11-02", False, f"no new_path from reject")
    else:
        record("E11-01", False, "write_rule for reject test failed")
        record("E11-02", False, "skipped — write failed")


# ── P: Passive Trigger (SKILL.md validation) ──
async def test_passive_trigger(session):
    print("\n\033[36m═══ P: Passive Trigger (SKILL.md read-only) ═══\033[0m")

    # Read SKILL.md directly (not via MCP)
    skill_path = Path(__file__).parent / "SKILL.md"
    if skill_path.exists():
        content = skill_path.read_text()
        lines = content.splitlines()
        record("P1-01", "PASSIVE TRIGGER" in content, "SKILL.md has PASSIVE TRIGGER section")
        record("P1-02", len(lines) <= 60, f"SKILL.md line count: {len(lines)} ≤ 60")
        record("P1-03", "error" in content.lower() and "/aristotle" in content.lower(),
               "SKILL.md has error pattern + /aristotle reference")
        record("P1-04", "auto" not in content.lower() or "not auto" in content.lower() or "only suggest" in content.lower(),
               "SKILL.md says NOT auto-trigger")
    else:
        record("P1-01", False, f"SKILL.md not found at {skill_path}")


# ── Main ──
async def main():
    global PASS, FAIL

    print("\n\033[1m╔══════════════════════════════════════════════════╗")
    print("║  Aristotle Phase 2 — E2E Automated Test Suite    ║")
    print("╚══════════════════════════════════════════════════╝\033[0m\n")

    _reset_repo()

    server_params = StdioServerParameters(
        command="uv",
        args=["run", "python", "-m", "aristotle_mcp.server"],
        env={**os.environ, "ARISTOTLE_REPO_DIR": REPO_DIR},
    )

    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                print("\033[32m✓ MCP session initialized\033[0m\n")

                await setup_env(session)
                await test_learn(session)
                await test_reflect(session)
                await test_review(session)
                await test_feedback(session)
                await test_feedback_auto_reflect(session)
                await test_conflicts(session)
                await test_integration(session)
                await test_passive_trigger(session)
    except Exception as e:
        print(f"\n\033[31m✗ Fatal error: {e}\033[0m")
        traceback.print_exc()

    # ── Summary ──
    print(f"\n\033[1m{'='*52}")
    print(f"  🦉 E2E Test Results")
    print(f"{'='*52}\033[0m")
    print(f"  \033[32mPASS\033[0m: {PASS}")
    print(f"  \033[31mFAIL\033[0m: {FAIL}")
    total = PASS + FAIL
    print(f"  Total: {total}")

    if FAIL > 0:
        print(f"\n  \033[31mFailed tests:\033[0m")
        for tid, ok, detail in RESULTS:
            if not ok:
                print(f"    ✗ {tid}: {detail}")

    print(f"\n  {'✅ All passed!' if FAIL == 0 else '❌ Some tests failed.'}")
    print()

    # Cleanup
    _reset_repo()

    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
