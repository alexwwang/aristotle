#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# test/regression_b1_checks.sh — Regression checks for B1 fixes
#
# Every fix in B1 has a corresponding check here.
# This script should pass BEFORE any deployment.
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

echo "═══ B1 Regression Checks ═══"
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
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bridge Plugin: status types ──"

check "types.ts includes chain_pending status" \
    "grep -q 'chain_pending' '$ROOT_DIR/plugins/aristotle-bridge/src/types.ts'"

check "types.ts includes chain_broken status" \
    "grep -q 'chain_broken' '$ROOT_DIR/plugins/aristotle-bridge/src/types.ts'"

# ───────────────────────────────────────────────────────────────
# Fix: workflow-store.ts has new methods
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bridge Plugin: workflow-store methods ──"

STORE="$ROOT_DIR/plugins/aristotle-bridge/src/workflow-store.ts"

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
# Fix: idle-handler.ts uses subprocess + chain driving
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bridge Plugin: idle-handler chain driving ──"

IDLE="$ROOT_DIR/plugins/aristotle-bridge/src/idle-handler.ts"

check "idle-handler has callMCP subprocess method" \
    "grep -q 'callMCP' '$IDLE'"

check "idle-handler uses execFile (subprocess)" \
    "grep -q 'execFile' '$IDLE'"

check "idle-handler uses stdin for payload (not argv)" \
    "grep -q 'input: dataJson' '$IDLE'"

check "idle-handler checks launchResult.status" \
    "grep -q 'launchResult.status' '$IDLE'"

check "fire_sub branches do NOT call markCompleted after launch" \
    "! grep -A2 'fire_sub' '$IDLE' | grep -q 'markCompleted'"

check "notify action goes to markChainBroken (not markCompleted)" \
    "grep -A4 \"action === 'notify'\" '$IDLE' | grep -q 'markChainBroken'"

check "mcpProjectDir log is debug level (not info)" \
    "! grep -q 'logger.info.*mcpProjectDir' '$IDLE'"

check "cancelled status is checked in catch block" \
    "grep -q 'cancelled' '$IDLE'"

# ───────────────────────────────────────────────────────────────
# Fix: index.ts passes executor + sessionsDir
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bridge Plugin: index.ts integration ──"

INDEX="$ROOT_DIR/plugins/aristotle-bridge/src/index.ts"

check "IdleEventHandler receives 4 args (client, store, executor, sessionsDir)" \
    "grep -q 'executor.*sessionsDir' '$INDEX'"

check "aristotle_abort handles chain_broken" \
    "grep -q 'chain_broken' '$INDEX'"

check "aristotle_abort handles chain_pending" \
    "grep -q 'chain_pending' '$INDEX'"

# ───────────────────────────────────────────────────────────────
# Fix: logger.ts exists and uses stderr
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bridge Plugin: logger ──"

check "logger.ts exists" \
    "[ -f '$ROOT_DIR/plugins/aristotle-bridge/src/logger.ts' ]"

check "logger outputs to stderr (console.error)" \
    "grep -q 'console.error' '$ROOT_DIR/plugins/aristotle-bridge/src/logger.ts'"

check "logger uses unknown[] not any[]" \
    "! grep -q 'any\[\]' '$ROOT_DIR/plugins/aristotle-bridge/src/logger.ts'"

# ───────────────────────────────────────────────────────────────
# Fix: resolveMcpProjectDir exported for testing
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Bridge Plugin: resolveMcpProjectDir ──"

check "resolveMcpProjectDir is exported" \
    "grep -q 'export function resolveMcpProjectDir' '$IDLE'"

# ───────────────────────────────────────────────────────────────
# Fix: Install dir synced with dev dir
# ───────────────────────────────────────────────────────────────
echo ""
echo "── Deploy: install dir sync ──"

INSTALL_DIR="$HOME/.claude/skills/aristotle"

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
# Summary
# ───────────────────────────────────────────────────────────────
echo ""
echo "═══ Results: $PASS passed, $FAIL failed ═══"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
