# Quick Fix & Rollback Guide

## Version Tags

| Tag | Commit | Description |
|-----|--------|-------------|
| `v1.4.0-rc1` | `9dd6e1b` | Phase 0 core extraction + Phase 2.3 P severity |
| `pre-phase0-merge` | `3b8cd2e` | Last stable before phase0 merge (safe rollback point) |

## Rollback

### Install previous version

```bash
cd /tmp/aristotle
git fetch --tags
git checkout pre-phase0-merge
bash install.sh
```

### Install latest version

```bash
cd /tmp/aristotle
git fetch --tags
git checkout v1.4.0-rc1
bash install.sh
```

### Revert specific commits on main

```bash
# Revert last N commits (safe, preserves history)
git revert --no-commit HEAD~N
git commit -m "revert: rollback to pre-XXX state"
git push origin main
```

## Smoke Test After Install

```bash
# 1. MCP server loads
uv run --project ~/.config/opencode/aristotle python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools), 'tools loaded')"
# Expected: "20 tools loaded"

# 2. Plugin builds
ls -la ~/.config/opencode/aristotle-plugin/dist/index.js
# Expected: file exists, ~130KB

# 3. Static checks
cd /tmp/aristotle && bash test.sh
# Expected: "All 103 checks passed!"

# 4. Python tests
uv run pytest test/ -v --tb=short
# Expected: 405 passed

# 5. TypeScript tests
bun run --filter '*' test
# Expected: core 167 + reflection 115 + watchdog 479 = 761 passed
```

## Common Issues

### Plugin not loading

```bash
# Check opencode.json has plugin entry
cat ~/.config/opencode/opencode.json | grep aristotle-plugin
# Expected: "file://$HOME/.config/opencode/aristotle-plugin/index.js"

# Rebuild plugin
cd /tmp/aristotle/plugin && bun run build
cp dist/index.js ~/.config/opencode/aristotle-plugin/dist/index.js
```

### MCP server not responding

```bash
# Check opencode.json has MCP config
cat ~/.config/opencode/opencode.json | grep -A5 '"aristotle"'
# Expected: command with "uv run --project"

# Test MCP manually
uv run --project ~/.config/opencode/aristotle python -c "from aristotle_mcp.server import mcp; print('OK')"
```

### Rule repo corruption

```bash
# Nuclear option — delete and reinit
rm -rf ~/.config/opencode/aristotle-repo
# Next /aristotle run will call init_repo automatically
```

## Test Matrix (v1.4.0-rc1)

| Suite | Count | Status |
|-------|-------|--------|
| Python pytest | 405 | PASS |
| Python static | 103 | PASS |
| TS core vitest | 167 | PASS |
| TS reflection vitest | 115 | PASS |
| TS watchdog vitest | 479 | PASS |
| TS watchdog tsc | 0 errors | PASS |
| Plugin build | 131.93 KB / 37 modules | PASS |
| Regression checks | 63 | PASS |
| **Total** | **1,332 + 103 static** | **ALL GREEN** |
