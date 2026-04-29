---
name: aristotle
description: Aristotle — error reflection & learning agent. Activate with /aristotle. Triggers when the user says you were wrong, made a mistake, gave incorrect output, or corrects your work (e.g. "that's wrong", "not right", "you made an error", "不对", "搞错了", "错了", "纠正"). Also triggers in multi-agent scenarios when one agent detects errors in another agent's work during code review or task verification (e.g. "found an issue in", "this has a bug", "incorrect implementation", "this approach won't work", "this is wrong because", "review found errors in", "发现一个问题", "这里有个 bug", "实现有误", "这个方案不行", "检查发现了问题"). Spawns an isolated subagent to analyze sessions for model mistakes, perform 5-Why root-cause analysis, write preventive rules, then lets you review, confirm, or request revisions before rules are finalized.
metadata:
  emoji: "🦉"
  category: "meta-learning"
---
# Aristotle — Dispatcher
## CRITICAL: DO NOT load REFLECT.md, REVIEW.md, LEARN.md, or CHECKER.md. All logic is handled by MCP orchestration tools. NEVER mention internal mechanism names (MCP tool names, action names, workflow_id, prompt fields) to the user — describe outcomes in plain language only.
## ROUTE
```
cmd = first argument or ""
MATCH cmd:
  "learn"    → CALL orchestrate_start("learn", args_json) → execute ACTION
  "sessions" → CALL orchestrate_start("sessions", "{}") → execute ACTION
  "review"   → CALL orchestrate_start("review", {sequence: N}) → execute ACTION → REVIEW FEEDBACK
  *          → GOTO PRE-RESOLVE
```
## PRE-RESOLVE (reflect only)
```
result = CALL orchestrate_start("reflect", {target_session_id: "", session_file: "",
  focus: "last", user_language: <detect>, project_directory: <cwd>})

MATCH result.action:
  "fire_sub"  → Bridge handles snapshot. execute ACTION. STOP.
  "pre_resolve_needed" → GOTO SNAPSHOT-EXTRACT
  "notify"    → Display result.message. STOP.
  other       → execute ACTION. STOP.

## SNAPSHOT-EXTRACT (non-Bridge / Claude Code only)
IF session_list is available:
  target_session_id = session_list()[0].id
  content = session_read(target_session_id)
  Bash("mkdir -p ~/.config/opencode/aristotle-sessions")
  Write snapshot JSON (schema v1, source: "llm-session-read") to
    ~/.config/opencode/aristotle-sessions/{target_session_id}_snapshot.json
  session_file = that path
ELSE:
  session_file = ""
IF any step fails: session_file = ""

result = CALL orchestrate_start("reflect", {target_session_id, session_file,
  focus: "last", user_language: <detect>, project_directory: <cwd>})
→ execute ACTION. STOP.
```
## ACTION EXECUTION
### If action is `pre_resolve_needed`:
GOTO SNAPSHOT-EXTRACT (in PRE-RESOLVE section above).
### If action is `fire_o`:
1. Call task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
2. When notification arrives, call MCP `orchestrate_on_event("o_done", {workflow_id, result})`
3. Execute returned action per this section
### If action is `fire_sub`:
1. If `notify_message` is present, display it to user first
2. Check `use_bridge` in response:
   - **If `use_bridge` is true (Bridge path — async, NON-BLOCKING)**:
     a. Call `aristotle_fire_o(workflow_id=response.workflow_id, o_prompt=response.sub_prompt, target_session_id=target_session_id)`
        - If fails or tool not found → fall through to blocking path (step 3)
     b. Display response message to user. Then **STOP — do NOT poll.**
        The Bridge plugin handles the entire R→C chain automatically via session.idle events.
        No further action needed from the main session.
   - **If `use_bridge` is absent or false (blocking path)**:
3. Call task(category="unspecified-low", load_skills=[], run_in_background=true, prompt=sub_prompt)
4. When notification arrives, call MCP `orchestrate_on_event("subagent_done", {workflow_id, session_id, result})` → execute returned action per this section
### If action is `notify`:
1. Display the `message` field to user
2. STOP
### If action is `done`:
STOP
## REVIEW FEEDBACK
After displaying review content from MCP, show this menu and wait for user input:
```
Choose an action:
1. confirm — Accept all rules as-is
2. reject — Reject this reflection
3. revise N — Revise rule #N (append feedback after colon, e.g. "revise 1: add example")
4. re-reflect — Request deeper analysis
```
Map user input: "confirm"→call MCP `orchestrate_review_action(workflow_id, "confirm")` | "reject"→call MCP `orchestrate_review_action(workflow_id, "reject")` | "revise N: feedback"→call MCP `orchestrate_review_action(workflow_id, "revise", feedback, {"rule_index": N})` | "re-reflect"→call MCP `orchestrate_review_action(workflow_id, "re_reflect")`. Execute the returned action per ACTION EXECUTION section.
## Parse Arguments
```
/aristotle learn <query>             → ROUTE: command="learn", args={query: "<query>"}
/aristotle learn --domain X --goal Y → ROUTE: command="learn", args={domain: "X", goal: "Y", query: "X Y"}
/aristotle sessions                  → ROUTE: command="sessions"
/aristotle review <N>                → ROUTE: command="review", args={sequence: N}
/aristotle [anything else]           → ROUTE: command="reflect" + PRE-RESOLVE
```
## PASSIVE TRIGGER

Monitor the conversation for these patterns:
1. You corrected your own output (acknowledged a mistake)
2. User pointed out an error and you agreed
3. You tried an approach, it failed, and you switched approaches

When any pattern is detected, suggest:
"🦉 I detected an error pattern. Run /aristotle to reflect and prevent similar mistakes."
Do NOT auto-trigger. Only suggest.
