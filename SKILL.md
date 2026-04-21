---
name: aristotle
description: Aristotle — error reflection & learning agent. Activate with /aristotle. Triggers when the user says you were wrong, made a mistake, gave incorrect output, or corrects your work (e.g. "that's wrong", "not right", "you made an error", "不对", "搞错了", "错了", "纠正"). Also triggers in multi-agent scenarios when one agent detects errors in another agent's work during code review or task verification (e.g. "found an issue in", "this has a bug", "incorrect implementation", "this approach won't work", "this is wrong because", "review found errors in", "发现一个问题", "这里有个 bug", "实现有误", "这个方案不行", "检查发现了问题"). Spawns an isolated subagent to analyze sessions for model mistakes, perform 5-Why root-cause analysis, write preventive rules, then lets you review, confirm, or request revisions before rules are finalized.
metadata:
  emoji: "🦉"
  category: "meta-learning"
---

# Aristotle — Dispatcher

## CRITICAL: DO NOT load LEARN.md, REVIEW.md, or CHECKER.md for learn commands. All learn logic is handled by MCP orchestration tools. Only load REFLECT.md for reflect commands.

## ROUTE

Parse command → call MCP `orchestrate_start(command, args_json)` → execute returned action.

## EVENT LOOP

On background task notification:
call MCP `orchestrate_on_event("o_done", {workflow_id, result})` → execute returned action.

## ACTIONS

- `fire_o` → task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
  Then: call MCP `orchestrate_on_event("o_fired", {workflow_id})` → execute returned action.
- `notify` → Extract the `message` field from MCP response and display it to the user verbatim. Prefix with 🦉. → STOP
- `done` → STOP

## Parse Arguments

```
/aristotle learn <query>             → ROUTE: command="learn", args={query: "<query>"}
/aristotle learn --domain X --goal Y → ROUTE: command="learn", args={domain: "X", goal: "Y"}
/aristotle [anything else]           → Read REFLECT.md and execute reflect protocol
```
