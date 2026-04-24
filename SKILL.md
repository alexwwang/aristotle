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
Otherwise: run PRE-RESOLVE below, then call MCP `orchestrate_start("reflect", {target_session_id, focus, project_directory, user_language, session_file})` → execute returned action.
## PRE-RESOLVE (reflect only)
Before calling MCP for reflect:
1. Call session_list(). Resolve target_session_id: no argument→current; "last"→second; "session ses_xxx"→ses_xxx; "recent N"→index N. Handle edge cases: empty→STOP; N too large→closest. Detect user_language (en-US), project_directory, and --focus ("last").
2. Extract session content:
   a. Ensure directory: Bash("mkdir -p ~/.config/opencode/aristotle-sessions")
   b. Check if snapshot file already exists for target_session_id: `~/.config/opencode/aristotle-sessions/{target_session_id}_snapshot.json`
      - If exists → skip to step 2f
   c. Call t_session_search(sessionId=target_session_id, limit=50)
   d. Filter to user/assistant roles only
   e. Format as JSON (schema version 1):
      - total_messages = filtered.length
      - source: "t_session_search"
      - content per message: max 4000 chars
      - messages array: max 200 entries
      - Write using Write tool to `~/.config/opencode/aristotle-sessions/{target_session_id}_snapshot.json`
      - After write, read back to verify JSON validity
   f. Set session_file to the file path
   g. If extraction fails at any step, set session_file=""
## ACTION EXECUTION
### If action is `fire_o`:
1. Call task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
2. When notification arrives, call MCP `orchestrate_on_event("o_done", {workflow_id, result})`
3. Execute returned action per this section
### If action is `fire_sub`:
1. If `notify_message` is present, display it to user first
2. Check `use_bridge` in response:
   - **If `use_bridge` is true (Bridge path)**:
     a. Try calling `aristotle_fire_o(workflow_id=response.workflow_id, o_prompt=response.sub_prompt, target_session_id=target_session_id)`
        - If succeeds → capture response.session_id as bridge_session_id, proceed to step b
        - If fails or tool not found → fall through to blocking path (step 3)
     b. Return to user: "🦉 Task launched. I'll check results when ready."
     c. MULTI-STAGE LOOP (reflect→check→… may require multiple rounds):
        ```
        while true:
          - Call aristotle_check(workflow_id)
          - If status="running" → continue polling (each poll is a tool round-trip with inherent ~1-3s delay, no extra sleep needed)
          - If status="completed" → extract result, proceed to step d
          - If status="error" → report error to user, BREAK
          - If status="cancelled" → report "Workflow was cancelled", BREAK
          - If status="undone" → report "Workflow was undone", BREAK
          - Max polls per stage: 50
        ```
     d. Call MCP `orchestrate_on_event("subagent_done", {workflow_id, result: result, session_id: bridge_session_id})`
     e. If response.action === "fire_sub":
        - Call `aristotle_fire_o(workflow_id, o_prompt=response.sub_prompt, agent=response.sub_role)`
        - Update bridge_session_id = response.session_id
        - GOTO step c (poll next stage)
     f. If response.action === "notify":
        - Display response.message to user, DONE
     g. If response.action === "done":
        - DONE
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

## After any /undo command

1. Call `aristotle_check()` with NO arguments to get all active workflows:
   └─ Returns: `{ active: [{workflow_id, status, started_at}] }`
2. For each active workflow with status "running":
   a. Call `aristotle_abort(workflow_id)` to cancel the background task
   b. Call MCP `on_undo(workflow_id, undo_scope="session", timestamp=<current Unix ms>)`
3. Report to user: "🦉 Cancelled N active Aristotle workflow(s): wf-xxx, wf-yyy"
4. If no active workflows: silently continue
