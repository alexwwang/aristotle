#!/usr/bin/env bash
# seed-test-rules.sh — Create verified rules for Layer 4 live testing
#
# Creates rules with known intent_tags that /aristotle learn can discover.
# Must run from the coroutine-O worktree or installed skill directory.
#
# Usage: bash test/seed-test-rules.sh [--skip-cleanup]
set -euo pipefail

SKIP_CLEANUP=false
[[ "${1:-}" == "--skip-cleanup" ]] && SKIP_CLEANUP=true

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
pass_msg() { echo "${GREEN}[SEED]${NC} $1"; }
fail_msg() { echo "${RED}[SEED]${NC} $1"; exit 1; }
info_msg() { echo "${CYAN}[SEED]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../aristotle_mcp/server.py" ]; then
    SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
    SKILL_DIR="$HOME/.claude/skills/aristotle"
fi

info_msg "Using skill dir: $SKILL_DIR"

export ARISTOTLE_REPO_DIR=$(mktemp -d)
info_msg "Temp repo: $ARISTOTLE_REPO_DIR"

cleanup() {
    $SKIP_CLEANUP && { info_msg "Repo preserved: $ARISTOTLE_REPO_DIR"; return; }
    rm -rf "$ARISTOTLE_REPO_DIR"
}
trap cleanup EXIT

SEED_SCRIPT=$(cat << 'PYEOF'
import json, sys, os
os.environ["ARISTOTLE_REPO_DIR"] = sys.argv[1]

from aristotle_mcp.server import init_repo_tool, write_rule, stage_rule, commit_rule

init_repo_tool()

rules = [
    {
        "content": "## Prisma Connection Pool Timeout\n\nWhen Prisma throws P2024 in serverless, the root cause is connection pool exhaustion under concurrent Lambda invocations.\n\n**Rule**: Always configure `connection_limit` and `pool_timeout` in Prisma datasource URL for serverless environments.\n\n**Why**: Serverless functions share no process state, so each cold start creates new connections. Default pool size (num_cpus * 2 + 1) exceeds PostgreSQL's typical `max_connections` under load.\n\n**Example**: `DATABASE_URL=\"postgresql://user:pass@host/db?connection_limit=3&pool_timeout=10\"`",
        "category": "HALLUCINATION",
        "confidence": 0.9,
        "intent_domain": "database_operations",
        "intent_task_goal": "connection_pool_management",
        "error_summary": "Prisma P2024 connection pool timeout in serverless",
        "failed_skill": "prisma",
    },
    {
        "content": "## Express CORS Configuration\n\nWhen CORS errors appear in browser console but not in server logs, the middleware order is wrong.\n\n**Rule**: Always register CORS middleware before route handlers in Express.\n\n**Why**: Express processes middleware in registration order. Routes registered before CORS middleware bypass CORS headers.\n\n**Example**: `app.use(cors()); app.use('/api', routes);` not `app.use('/api', routes); app.use(cors());`",
        "category": "SYNTAX_API_ERROR",
        "confidence": 0.85,
        "intent_domain": "api_integration",
        "intent_task_goal": "cors_setup",
        "error_summary": "CORS errors despite correct middleware config",
        "failed_skill": "express",
    },
    {
        "content": "## Webpack Build Config Error\n\nWhen webpack build fails with 'Module not found' for local files, check resolve.alias vs resolve.modules.\n\n**Rule**: Use `resolve.alias` for path mapping, not `resolve.modules` for absolute imports.\n\n**Why**: `resolve.modules` replaces Node's default resolution, breaking npm package imports. `resolve.alias` only maps specific paths.\n\n**Example**: `resolve: { alias: { '@': path.resolve('src') } }`",
        "category": "PATTERN_VIOLATION",
        "confidence": 0.8,
        "intent_domain": "build_system",
        "intent_task_goal": "webpack_config",
        "error_summary": "Module not found after webpack resolve.modules config",
        "failed_skill": "webpack",
    },
]

created = []
for r in rules:
    w = write_rule(**r)
    if not w["success"]:
        print(f"FAIL: write_rule: {w['message']}", file=sys.stderr)
        sys.exit(1)
    stage_rule(w["file_path"])
    c = commit_rule(w["file_path"])
    if not c["success"]:
        print(f"FAIL: commit_rule: {c['message']}", file=sys.stderr)
        sys.exit(1)
    created.append(w["file_path"])

print(json.dumps({"count": len(created), "repo_dir": os.environ["ARISTOTLE_REPO_DIR"]}))
PYEOF
)

RESULT=$(uv run --project "$SKILL_DIR" python -c "$SEED_SCRIPT" "$ARISTOTLE_REPO_DIR" 2>&1)

if echo "$RESULT" | grep -q '"count"'; then
    COUNT=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['count'])")
    pass_msg "Created $COUNT verified rules"
    echo "$ARISTOTLE_REPO_DIR"
else
    fail_msg "Seed failed: $RESULT"
fi
