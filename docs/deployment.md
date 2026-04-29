# Aristotle Production Deployment Checklist

每次修改代码后，必须逐项验证。任何一项 FAIL 都意味着生产环境未更新。

> For test commands to run *before* deploy, see [testing.md §8.1](testing.md#81-test-commands).

## 1. Bridge Plugin

| # | 检查项 | 验证命令 | 预期结果 |
|---|--------|----------|----------|
| 1.1 | 部署文件存在 | `ls ~/.config/opencode/aristotle-bridge/index.js` | 文件存在 |
| 1.2 | 大小匹配源码构建 | `wc -c ~/.config/opencode/aristotle-bridge/index.js` vs `wc -c plugins/aristotle-bridge/dist/index.js` | 字节数一致 |
| 1.3 | 内容一致 | `diff ~/.config/opencode/aristotle-bridge/index.js plugins/aristotle-bridge/dist/index.js` | 无差异 |
| 1.4 | 使用 spawn（非 execFile） | `grep -c spawn ~/.config/opencode/aristotle-bridge/index.js` | ≥1 |
| 1.5 | 无 execFile/promisify | `grep -c 'execFile\|promisify' ~/.config/opencode/aristotle-bridge/index.js` | 0 |
| 1.6 | promptAsync 不传 agent | `grep -c 'agent, parts' ~/.config/opencode/aristotle-bridge/index.js` | 0 |
| 1.7 | trigger 用 session_id 作 parent | `grep 'trigger.session_id' ~/.config/opencode/aristotle-bridge/index.js` | 有匹配 |

## 2. MCP 安装 (~/.config/opencode/aristotle/)

| # | 检查项 | 验证命令 | 预期结果 |
|---|--------|----------|----------|
| 2.1 | 源文件同步 | `diff <(ls aristotle_mcp/) <(ls ~/.config/opencode/aristotle/aristotle_mcp/)` | 无差异 |
| 2.2 | _cli.py 一致 | `diff aristotle_mcp/_cli.py ~/.config/opencode/aristotle/aristotle_mcp/_cli.py` | 无差异 |
| 2.3 | _orch_start.py 一致 | `diff aristotle_mcp/_orch_start.py ~/.config/opencode/aristotle/aristotle_mcp/_orch_start.py` | 无差异 |
| 2.4 | _orch_event.py 一致 | `diff aristotle_mcp/_orch_event.py ~/.config/opencode/aristotle/aristotle_mcp/_orch_event.py` | 无差异 |
| 2.5 | venv 存在 | `ls ~/.config/opencode/aristotle/.venv/bin/python` | 文件存在 |
| 2.6 | 模块可导入 | `cd ~/.config/opencode/aristotle && uv run python -c "from aristotle_mcp.server import mcp; print('OK')"` | 输出 OK |
| 2.7 | _cli.py 支持 orchestrate_start | `grep 'orchestrate_start' ~/.config/opencode/aristotle/aristotle_mcp/_cli.py` | 有匹配 |

## 3. opencode.json 配置

| # | 检查项 | 验证命令 | 预期结果 |
|---|--------|----------|----------|
| 3.1 | Plugin 注册 | `jq '.plugin[]' ~/.config/opencode/opencode.json \| grep aristotle` | 有匹配 |
| 3.2 | MCP 注册 | `jq '.mcp.aristotle' ~/.config/opencode/opencode.json` | 有配置 |
| 3.3 | MCP 用绝对路径 | `jq '.mcp.aristotle.command' ~/.config/opencode/opencode.json \| grep '~'` | 无匹配 |
| 3.4 | aristotle_* 权限 | `jq '.permission["aristotle_*"]' ~/.config/opencode/opencode.json` | "allow" |
| 3.5 | JSON 合法 | `python3 -c "import json; json.load(open('$(echo ~)/.config/opencode/opencode.json'))"` | 无报错 |

## 4. SKILL.md

| # | 检查项 | 验证命令 | 预期结果 |
|---|--------|----------|----------|
| 4.1 | 文件存在 | `ls ~/.config/opencode/skills/aristotle/SKILL.md` | 文件存在 |
| 4.2 | 与源码一致 | `diff SKILL.md ~/.config/opencode/skills/aristotle/SKILL.md` | 无差异 |
| 4.3 | 无 agent 参数引用 | `grep 'agent=response.sub_role' ~/.config/opencode/skills/aristotle/SKILL.md` | 无匹配 |
| 4.4 | 包含 Bridge 路径 | `grep 'aristotle_fire_o' ~/.config/opencode/skills/aristotle/SKILL.md` | 有匹配 |

## 5. 目录结构

| # | 检查项 | 验证命令 | 预期结果 |
|---|--------|----------|----------|
| 5.1 | Sessions 目录 | `ls -d ~/.config/opencode/aristotle-sessions/` | 目录存在 |
| 5.2 | Drafts 目录 | `ls -d ~/.config/opencode/aristotle-drafts/` | 目录存在 |
| 5.3 | REFLECTOR.md 存在 | `ls $ARISTOTLE_PROJECT_DIR/REFLECTOR.md` | 文件存在 |
| 5.4 | CHECKER.md 存在 | `ls $ARISTOTLE_PROJECT_DIR/CHECKER.md` | 文件存在 |

## 6. Git 状态

| # | 检查项 | 验证命令 | 预期结果 |
|---|--------|----------|----------|
| 6.1 | 无未提交的部署文件变更 | `git status --short plugins/aristotle-bridge/ aristotle_mcp/ SKILL.md` | 无输出 |
| 6.2 | dist/index.js 是最新构建 | `git diff HEAD -- plugins/aristotle-bridge/dist/index.js` | 无差异 |

---

## 快速验证命令（一键跑全部）

```bash
cd $ARISTOTLE_PROJECT_DIR && bash -c '
PASS=0; FAIL=0
check() { if eval "$2" > /dev/null 2>&1; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1"; FAIL=$((FAIL+1)); fi; }
check "1.2 plugin size match"  "diff ~/.config/opencode/aristotle-bridge/index.js plugins/aristotle-bridge/dist/index.js"
check "1.5 no execFile"        "test $(grep -c execFile ~/.config/opencode/aristotle-bridge/index.js) -eq 0"
check "1.6 no agent in prompt" "test $(grep -c \"agent, parts\" ~/.config/opencode/aristotle-bridge/index.js) -eq 0"
check "2.2 _cli.py sync"       "diff aristotle_mcp/_cli.py ~/.config/opencode/aristotle/aristotle_mcp/_cli.py"
check "2.3 _orch_start sync"   "diff aristotle_mcp/_orch_start.py ~/.config/opencode/aristotle/aristotle_mcp/_orch_start.py"
check "2.6 module importable"  "cd ~/.config/opencode/aristotle && uv run python -c \"from aristotle_mcp.server import mcp\""
check "3.4 permission set"     "grep aristotle_\\* ~/.config/opencode/opencode.json"
check "4.2 SKILL.md sync"      "diff SKILL.md ~/.config/opencode/skills/aristotle/SKILL.md"
check "4.3 no agent param"     "test $(grep -c agent=response.sub_role ~/.config/opencode/skills/aristotle/SKILL.md) -eq 0"
check "5.1 sessions dir"       "ls -d ~/.config/opencode/aristotle-sessions/"
check "5.3 REFLECTOR.md"       "ls $ARISTOTLE_PROJECT_DIR/REFLECTOR.md"
echo ""; echo "Result: $PASS passed, $FAIL failed"
test $FAIL -eq 0
'
```

## 部署操作清单

每次改代码后按顺序执行：

```bash
# 1. 构建插件
cd $ARISTOTLE_PROJECT_DIR/plugins/aristotle-bridge && bun build src/index.ts --outdir dist --target node --format esm --external @opencode-ai/plugin

# 2. 部署插件
cp plugins/aristotle-bridge/dist/index.js ~/.config/opencode/aristotle-bridge/index.js

# 3. 同步 MCP
mkdir -p ~/.config/opencode/aristotle/aristotle_mcp
cp -r $ARISTOTLE_PROJECT_DIR/aristotle_mcp/* ~/.config/opencode/aristotle/aristotle_mcp/
cp $ARISTOTLE_PROJECT_DIR/pyproject.toml ~/.config/opencode/aristotle/pyproject.toml
cp $ARISTOTLE_PROJECT_DIR/uv.lock ~/.config/opencode/aristotle/uv.lock

# 4. 同步 SKILL.md
cp $ARISTOTLE_PROJECT_DIR/SKILL.md ~/.config/opencode/skills/aristotle/SKILL.md

# 5. 跑 checklist
# 见上方"快速验证命令"

# 6. 清理状态（可选）
echo '[]' > ~/.config/opencode/aristotle-sessions/bridge-workflows.json
rm -f ~/.config/opencode/aristotle-sessions/.bridge-active

# 7. 重启 opencode（config/SKILL.md 启动时加载）
```
