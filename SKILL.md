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
If command is "learn": call MCP `orchestrate_start("learn", args_json)` → execute returned action.
If command is "sessions": call MCP `orchestrate_start("sessions", "{}")` → execute returned action.
If command is "review": call MCP `orchestrate_start("review", {sequence: N})` → execute returned action. After displaying review content, enter REVIEW FEEDBACK section.
Otherwise: run PRE-RESOLVE below, then call MCP `orchestrate_start("reflect", {target_session_id, focus, project_directory, user_language})` → execute returned action.
## PRE-RESOLVE (reflect only)
Before calling MCP for reflect:
1. Call session_list() to get sessions.
2. Resolve target_session_id:
   - No argument → current session (first in list, or last active)
   - "last" → second entry in session_list
   - "session ses_xxx" → ses_xxx directly
   - "recent N" → entry at index N (1-based, excluding current)
3. If session_list fails or is empty: display "🦉 Could not resolve target session. Use /aristotle session ses_xxx" and STOP.
4. If "recent N" exceeds available: use closest available, display "🦉 Only M sessions available."
5. Detect user_language from recent messages (default: "en-US").
6. Get project_directory from current working directory.
7. Extract focus from --focus flag (default: "last").
## ACTION EXECUTION
### If action is `fire_o`:
1. Call task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
2. When notification arrives, call MCP `orchestrate_on_event("o_done", {workflow_id, result})`
3. Execute returned action per this section
### If action is `fire_sub`:
1. If `notify_message` is present, display it to user first
2. Call task(category="unspecified-low", load_skills=[], run_in_background=true, prompt=sub_prompt)
3. When notification arrives, call MCP `orchestrate_on_event("subagent_done", {workflow_id, session_id, result})` → execute returned action per this section
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
Map user input: "confirm"→call MCP `orchestrate_review_action(workflow_id, "confirm")` | "reject"→call MCP `orchestrate_review_action(workflow_id, "reject")` | "revise N: feedback"→call MCP `orchestrate_review_action(workflow_id, "revise", feedback, {"rule_index": N})` | "re-reflect"→call MCP `orchestrate_review_action(workflow_id, "re_reflect")`.
Execute the returned action per ACTION EXECUTION section.
## Parse Arguments
```
/aristotle learn <query>             → ROUTE: command="learn", args={query: "<query>"}
/aristotle learn --domain X --goal Y → ROUTE: command="learn", args={domain: "X", goal: "Y", query: "X Y"}
/aristotle sessions                  → ROUTE: command="sessions"
/aristotle review <N>                → ROUTE: command="review", args={sequence: N}
/aristotle [anything else]           → ROUTE: command="reflect" + PRE-RESOLVE
```
