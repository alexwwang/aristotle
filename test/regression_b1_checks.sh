#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# test/regression_b1_checks.sh — Regression checks for B1 fixes
#
# Every fix in B1 has a corresponding check here.
# This script should pass BEFORE any deployment.
#
# Phase D migration: checks now point to packages/core/ and
# packages/aristotle/ (the new code). Checks that grep old
# plugins/aristotle-bridge/src/ have been migrated or dissolved.
#
# Usage: bash test/regression_b1_checks.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

PASS=0
FAIL=0
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

check() {
    local desc="$1"
    shift
    if eval "$@" >/dev/null 2>&1; then
        echo "  ✅ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $desc"
        FAIL=$((FAIL + 1))
    fi
}

echo "═══ B1 Regression Checks (Phase D migrated) ═══"
echo ""

# ───────────────────────────────────────────────────────────────
# Fix: opencode.json MCP paths must NOT use tilde (~)
# Root cause: uv run --project does not expand ~, falls back to
# Python 3.8, ModuleNotFoundError, MCP startup failed
# Regressed once (commit 2f0fee0 fixed, later reverted)
# ───────────────────────────────────────────────────────────────
echo "── Config: opencode.json paths ──"

check "opencode.json MCP commands have no tilde paths" \
    'python3 -c "
import json
c = json.load(open(\"$HOME/.config/opencode/opencode.json\"))
for name, cfg in c.get(\"mcp\", {}).items():
    cmd = cfg.get(\"command\", [])
    for arg in cmd:
        if arg.startswith(\"~/\"):
            raise ValueError(f\"{name}: {arg}\")
"'

check "aristotle MCP uses absolute path" \
        "grep -q '\"/Users/.*aristotle\"' ~/.config/opencode/opencode.json"

# ───────────────────────────────────────────────────────────────
# Fix: _orch_event.py checking completion returns "done" not "notify"
# Root cause: all _fire_c_done_event tests asserted "notify"
# ───────────────────────────────────────────────────────────────
echo ""
echo "── MCP: checking completion returns 'done' ──"

check "_orch_event.py checking completion returns 'done'" \
    "grep -q '\"action\": \"done\"' '$ROOT_DIR/aristotle_mcp/_orch_event.py'"

check "_orch_event.py reflecting completion returns 'fire_sub' (not 'done')" \
    "! grep -q '\"action\": \"done\"' <<< \$(grep -A5 'phase.*reflecting' '$ROOT_DIR/aristotle_mcp/_orch_event.py')"

# ───────────────────────────────────────────────────────────────
# Fix: _cli.py exists and works
# ───────────────────────────────────────────────────────────────
echo ""
echo "── MCP: _cli.py subprocess entry point ──"

check "_cli.py exists" \
    "[ -f '$ROOT_DIR/aristotle_mcp/_cli.py' ]"

check "_cli.py reads from stdin (not argv for payload)" \
    "grep -q 'sys.stdin.read' '$ROOT_DIR/aristotle_mcp/_cli.py'"

check "_cli.py handles missing stdin gracefully" \
    "grep -q 'No data provided on stdin' '$ROOT_DIR/aristotle_mcp/_cli.py'"

# ───────────────────────────────────────────────────────────────
# Fix: types.ts has chain_pending and chain_broken
# Migrated: packages/core/src/types.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Core Types: status types ──"

TYPES="$ROOT_DIR/packages/core/src/types.ts"

check "types.ts includes chain_pending status" \
    "grep -q 'chain_pending' '$TYPES'"

check "types.ts includes chain_broken status" \
    "grep -q 'chain_broken' '$TYPES'"

# ───────────────────────────────────────────────────────────────
# Fix: workflow-store has new methods
# Migrated: packages/core/src/store/workflow-store.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Core WorkflowStore: methods ──"

STORE="$ROOT_DIR/packages/core/src/store/workflow-store.ts"

check "workflow-store has markChainPending" \
    "grep -q 'markChainPending' '$STORE'"

check "workflow-store has markChainBroken" \
    "grep -q 'markChainBroken' '$STORE'"

check "retrieve() handles chain_pending" \
    "grep -q \"chain_pending\" '$STORE'"

check "retrieve() handles chain_broken" \
    "grep -q \"chain_broken\" '$STORE'"

check "getActive includes chain_pending" \
    "grep -q 'chain_pending' '$STORE'"

check "evictOldestNonRunning protects chain_pending" \
    "grep -q 'chain_pending' '$STORE'"

check "reconcileOnStartup has 3-phase recovery" \
    "grep -q 'chain_broken' '$STORE'"

# ───────────────────────────────────────────────────────────────
# Fix: idle-handler uses subprocess + chain driving
# Migrated: packages/aristotle/src/idle-handler.ts
# Semantic change: execFile → spawn (Bug #11 fix preserved)
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Aristotle: idle-handler chain driving ──"

IDLE="$ROOT_DIR/packages/aristotle/src/idle-handler.ts"

check "idle-handler has callMCP subprocess method" \
    "grep -q 'callMCP' '$IDLE'"

check "idle-handler uses spawn (subprocess, Bug #11 fix)" \
    "grep -q 'spawn' '$IDLE'"

check "idle-handler uses stdin for payload (not argv)" \
    "grep -q 'child.stdin.write' '$IDLE'"

check "idle-handler checks launchResult.status" \
    "grep -q 'launchResult.status' '$IDLE'"

check "fire_sub branches do NOT call markCompleted after launch" \
    "! grep -A2 'fire_sub' '$IDLE' | grep -q 'markCompleted'"

check "notify action goes to markChainBroken (not markCompleted)" \
    "grep -A10 \"action === 'notify'\" '$IDLE' | grep -q 'markChainBroken'"

check "mcpProjectDir log is debug level (not info)" \
    "! grep -q 'logger.info.*mcpProjectDir' '$IDLE'"

check "cancelled status is checked in catch block" \
    "grep -q 'cancelled' '$IDLE'"

# ───────────────────────────────────────────────────────────────
# Fix: index.ts passes executor + sessionsDir
# Architecture changed: index.ts is now role entry in packages/aristotle/
# IdleEventHandler receives options object with sessionsDir and mcpDir
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Aristotle: role integration ──"

INDEX="$ROOT_DIR/packages/aristotle/src/index.ts"

check "IdleEventHandler receives sessionsDir and mcpDir" \
    "grep -q 'sessionsDir.*mcpDir' '$INDEX'"

check "aristotle_abort handles chain_broken" \
    "grep -q 'chain_broken' '$ROOT_DIR/packages/aristotle/src/tools.ts'"

check "aristotle_abort handles chain_pending" \
    "grep -q 'chain_pending' '$ROOT_DIR/packages/aristotle/src/tools.ts'"

# ───────────────────────────────────────────────────────────────
# Fix: logger.ts exists and uses stderr
# Migrated: packages/core/src/logger.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Core: logger ──"

LOGGER="$ROOT_DIR/packages/core/src/logger.ts"

check "logger.ts exists" \
    "[ -f '$LOGGER' ]"

check "logger outputs to stderr (console.error)" \
    "grep -q 'console.error' '$LOGGER'"

check "logger uses unknown[] not any[]" \
    "! grep -q 'any\[\]' '$LOGGER'"

# ───────────────────────────────────────────────────────────────
# Fix: MCP project dir resolution exists and is testable
# Migrated: packages/aristotle/src/config.ts (detectMcpDir)
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Aristotle: MCP dir detection ──"

CONFIG="$ROOT_DIR/packages/aristotle/src/config.ts"

check "MCP dir resolver function exists (detectMcpDir)" \
    "grep -q 'function detectMcpDir' '$CONFIG'"

# ───────────────────────────────────────────────────────────────
# Fix: Install dir synced with dev dir
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Deploy: install dir sync ──"

INSTALL_DIR="$HOME/.config/opencode/aristotle"

check "install dir exists" \
    "[ -d '$INSTALL_DIR' ]"

check "install dir has _cli.py" \
    "[ -f '$INSTALL_DIR/aristotle_mcp/_cli.py' ]"

check "install dir _orch_event.py returns 'done' for checking" \
    "grep -q '\"action\": \"done\"' '$INSTALL_DIR/aristotle_mcp/_orch_event.py'"

check "bridge plugin deployed to opencode" \
    "[ -f '$HOME/.config/opencode/aristotle-bridge/index.js' ]"

# ───────────────────────────────────────────────────────────────
# Fix: test assertions updated for notify→done
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Tests: assertions match B1 changes ──"

check "test_count_propagation.py uses 'done' for c_done" \
    "grep -q \"action.*==.*done\" '$ROOT_DIR/test/test_count_propagation.py'"

check "test_e2e_bridge_integration.py uses 'done' for checking completion" \
    "grep -q \"action.*==.*done\" '$ROOT_DIR/test/test_e2e_bridge_integration.py'"

check "test_reflect_workflow.py clears .bridge-active marker" \
    "grep -q 'bridge-active' '$ROOT_DIR/test/test_reflect_workflow.py'"

check "no stale 'action==notify' assertions for _fire_c_done_event" \
    "! grep -A1 '_fire_c_done_event' '$ROOT_DIR/test/test_reflect_workflow.py' | grep -q '\"notify\"'"

# ───────────────────────────────────────────────────────────────
# Fix: Bug #11 — idle-handler uses spawn (not execFile) for subprocess
# Root cause: Node.js async child_process APIs don't support input option
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bug #11: spawn instead of execFile ──"

check "idle-handler imports spawn from child_process" \
    "grep -q 'spawn' '$IDLE'"

check "idle-handler has runSubprocess method with stdin" \
    "grep -q 'child.stdin.write' '$IDLE'"

check "idle-handler does NOT use execFile with input option" \
    "! grep -q 'execFile.*input' '$IDLE'"

# ───────────────────────────────────────────────────────────────
# Fix: Bug #12 — promptAsync does NOT pass agent parameter
# Root cause: opencode doesn't recognize 'R'/'C' as agent names, silently
# fails (returns 204 but LLM loop never starts). Regressed from Bug #9.
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bug #12: promptAsync no agent parameter ──"

EXECUTOR_CORE="$ROOT_DIR/packages/core/src/executor/index.ts"

check "core executor promptAsync body has only parts" \
    "grep -A3 'promptAsync' '$EXECUTOR_CORE' | grep -q 'parts'"

check "core executor does NOT pass agent to promptAsync" \
    "! grep -q '{ agent, parts }' '$EXECUTOR_CORE'"

# ───────────────────────────────────────────────────────────────
# Fix: Tool registration format (ToolDefinition with Zod)
# Root cause: plugin.tool was a function returning bare async functions.
# opencode expects plain object with {description, args: Zod, execute}.
# LLM could never see plugin tools.
# Migrated: packages/aristotle/src/tools.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Tool registration: ToolDefinition format ──"

TOOLS="$ROOT_DIR/packages/aristotle/src/tools.ts"

check "tool is plain object with description field" \
    "grep -q 'description:' '$TOOLS'"

check "aristotle_fire_o has args with z.string" \
    "grep -q 'z.string' '$TOOLS'"

check "aristotle_fire_o has execute function" \
    "grep -q 'execute:' '$TOOLS'"

# ───────────────────────────────────────────────────────────────
# Fix: target_session_id defaults to context.sessionID
# Root cause: ctx.session?.id is always undefined (PluginInput has no
# session property). Fixed to use ToolContext.sessionID (2nd execute arg).
# Migrated: packages/aristotle/src/tools.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── target_session_id default ──"

check "fire_o uses context?.sessionID" \
    "grep -q 'context?.sessionID' '$TOOLS'"

check "fire_o defaults targetSessionId to sessionId" \
    "grep -q 'targetSessionId.*sessionId' '$TOOLS' || grep -q 'target_session_id.*sessionId' '$TOOLS'"

check "fire_o does NOT use ctx.session?.id" \
    "! grep -q 'ctx.session?.id' '$TOOLS'"

# ───────────────────────────────────────────────────────────────
# Fix: Bug #13 — reconcileOnStartup instance isolation + timeout
# Root cause: reconcile queried ALL running workflows including other
# instances'. No timeout → hung on stale sessions → blocked startup.
# Migrated: packages/core/src/store/workflow-store.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bug #13: instance isolation + timeout ──"

check "WorkflowState has instanceId field" \
    "grep -q 'instanceId' '$TYPES'"

check "WorkflowStore constructor accepts instanceId" \
    "grep 'constructor' '$STORE' | grep -q 'instanceId'"

check "reconcileOnStartup filters by instanceId" \
    "grep -q 'instanceId === this.instanceId' '$STORE'"

check "reconcile has 3 instanceId filters (all phases)" \
    "test $(grep -c 'instanceId === this.instanceId' "$STORE") -ge 3"

check "reconcile uses withTimeout for running phase" \
    "grep -q 'withTimeout' '$STORE'"

check "reconcile marks error on empty response" \
    "grep -q 'Empty or invalid session response' '$STORE'"

check "reconcile marks error when no assistant messages" \
    "grep -q 'Session has no assistant response' '$STORE'"

check "saveToDisk does read-before-write merge" \
    "grep -q 'readDiskMap' '$STORE'"

check "saveToDisk merge only preserves other instances" \
    "grep -q 'instanceId !== this.instanceId' '$STORE'"

check "register calls saveToDiskRaw after eviction" \
    "grep -q 'saveToDiskRaw' '$STORE'"

check "index.ts generates instanceId with randomUUID" \
    "grep -q 'randomUUID' '$INDEX'"

# ───────────────────────────────────────────────────────────────
# Fix: executor return message does NOT instruct polling
# Root cause: "Call aristotle_check to poll status" caused LLM to
# block main session with repeated check calls.
# Migrated: packages/aristotle/src/executor.ts
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Executor: no polling instruction ──"

ARISTOTLE_EXECUTOR="$ROOT_DIR/packages/aristotle/src/executor.ts"

check "executor message does not say to poll with check" \
    "! grep -q 'Call.*aristotle_check.*poll.*status' '$ARISTOTLE_EXECUTOR'"

check "executor message tells LLM to STOP" \
    "grep -q 'STOP' '$ARISTOTLE_EXECUTOR'"

# ───────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────
echo ""
echo "═══ Results: $PASS passed, $FAIL failed ═══"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
