---
name: aristotle
description: Aristotle — error reflection & learning agent. Activate with /aristotle. Triggers when the user says you were wrong, made a mistake, gave incorrect output, or corrects your work (e.g. "that's wrong", "not right", "you made an error", "不对", "搞错了", "错了", "纠正"). Also triggers in multi-agent scenarios when one agent detects errors in another agent's work during code review or task verification (e.g. "found an issue in", "this has a bug", "incorrect implementation", "this approach won't work", "this is wrong because", "review found errors in", "发现一个问题", "这里有个 bug", "实现有误", "这个方案不行", "检查发现了问题"). Spawns an isolated subagent to analyze sessions for model mistakes, perform 5-Why root-cause analysis, write preventive rules, then lets you review, confirm, or request revisions before rules are finalized.
metadata:
  emoji: "🦉"
  category: "meta-learning"
---

# Aristotle — Dispatcher

## CRITICAL: DO NOT load LEARN.md, REVIEW.md, or CHECKER.md for learn commands. All learn logic is handled by MCP orchestration tools. Only load REFLECT.md for reflect commands. NEVER mention internal mechanism names (MCP tool names, action names like fire_o, workflow_id, o_prompt, or intent/keywords fields) to the user — describe outcomes in plain language only.

## ROUTE

If command is "learn": call MCP `orchestrate_start(command, args_json)` → execute returned action.
Otherwise: follow Parse Arguments section directly.

## ACTION EXECUTION

### If action is `fire_o`:
1. Call task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
2. When background task notification arrives, call MCP `orchestrate_on_event("o_done", {workflow_id, result})`
3. Match the returned action and execute per this section

### If action is `notify`:
1. Extract the `message` field from MCP response
2. Display to user with 🦉 prefix
3. STOP

### If action is `done`:
STOP

## Parse Arguments

```
/aristotle learn <query>             → ROUTE: command="learn", args={query: "<query>"}
/aristotle learn --domain X --goal Y → ROUTE: command="learn", args={domain: "X", goal: "Y", query: "X Y"}
/aristotle [anything else]           → MANDATORY: Read REFLECT.md immediately and execute reflect protocol. Do NOT ask the user what they want — just load REFLECT.md.
```
