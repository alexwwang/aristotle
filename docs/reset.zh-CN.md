# Aristotle 数据重置指南

> 反思数据完整清单与逐项重置方法。

## 目录结构

```
~/.config/opencode/
├── aristotle-sessions/              # Bridge 插件数据
│   ├── .bridge-active               # 插件活跃标记（退出自动清理）
│   ├── bridge-workflows.json        # 工作流状态（LRU 50）
│   ├── {sessionId}_snapshot.json    # 会话快照（7 天自动清理）
│   ├── .trigger-reflect.json        # 反思触发文件（处理后自动删除）
│   └── .trigger-abort.json          # 中止触发文件（处理后自动删除）
├── aristotle-repo/                  # 规则仓库（git 管理）
│   ├── user/                        # 全局规则
│   ├── projects/{hash}/             # 项目特定规则
│   ├── rejected/                    # 已拒绝规则
│   └── .workflows/                  # MCP 工作流状态（24h/48h 自动清理）
├── aristotle-state.json             # 反思记录（最多 50 条）
└── aristotle-drafts/                # DRAFT 报告（最多 50 个）
    └── rec_{N}.md
```

## 逐项重置操作

| # | 数据 | 路径 | 重置命令 | 说明 |
|---|------|------|---------|------|
| 1 | 快照文件 | `aristotle-sessions/*_snapshot.json` | `rm ~/.config/opencode/aristotle-sessions/*_snapshot.json` | 自动 7 天清理；手动全删不影响运行 |
| 2 | DRAFT 文件 | `aristotle-drafts/rec_*.md` | `rm -rf ~/.config/opencode/aristotle-drafts/` | 超过 50 条自动裁剪最旧的 |
| 3 | 反思状态+计数器 | `aristotle-state.json` | `rm ~/.config/opencode/aristotle-state.json` | 删除后计数器归零，下次从 rec_1 开始 |
| 4 | 工作流状态 | `aristotle-sessions/bridge-workflows.json` | `rm ~/.config/opencode/aristotle-sessions/bridge-workflows.json` | LRU 50 条；删除后插件启动时重建 |
| 5 | MCP 工作流 | `aristotle-repo/.workflows/` | `rm -rf ~/.config/opencode/aristotle-repo/.workflows/` | 24h/48h 自动清理 |
| 6 | Bridge marker | `aristotle-sessions/.bridge-active` | `rm ~/.config/opencode/aristotle-sessions/.bridge-active` | 退出自动清理；删除后 MCP 降级为非 Bridge 模式 |
| 7 | 触发文件 | `aristotle-sessions/.trigger-*.json` | `rm ~/.config/opencode/aristotle-sessions/.trigger-*.json` | 处理后自动删除；残留可安全手动清理 |
| 8 | 已验证规则 | `aristotle-repo/user/*.md` | `cd ~/.config/opencode/aristotle-repo && git rm user/*.md && git commit -m "reset: clear rules"` | git 管理，需 git 操作 |
| 9 | 已拒绝规则 | `aristotle-repo/rejected/` | `cd ~/.config/opencode/aristotle-repo && rm -rf rejected/ && git add -A && git commit` | git 管理 |
| 10 | 项目规则 | `aristotle-repo/projects/{hash}/` | 同上，`git rm -rf projects/` | 每个项目独立子目录 |

## 一键全量重置

```bash
# 清理所有运行时数据（不影响规则仓库）
rm -f ~/.config/opencode/aristotle-sessions/bridge-workflows.json
rm -f ~/.config/opencode/aristotle-sessions/.bridge-active
rm -f ~/.config/opencode/aristotle-sessions/*_snapshot.json
rm -f ~/.config/opencode/aristotle-sessions/.trigger-*.json
rm -f ~/.config/opencode/aristotle-state.json
rm -rf ~/.config/opencode/aristotle-drafts/
rm -rf ~/.config/opencode/aristotle-repo/.workflows/
```

## 一键全量重置（含规则）

```bash
# 在上方全量重置基础上，额外清除规则仓库
cd ~/.config/opencode/aristotle-repo
git rm -rf user/ rejected/ projects/
git commit -m "reset: clear all rules and rejected rules"
```

## 仅重置计数器（保留规则）

```bash
# 反思序列计数器在 aristotle-state.json 中
# 删除后下次反思从 rec_1 重新开始
rm ~/.config/opencode/aristotle-state.json
rm -rf ~/.config/opencode/aristotle-drafts/
```

## 仅重置规则（保留运行时数据）

```bash
cd ~/.config/opencode/aristotle-repo
git rm -rf user/ rejected/ projects/
git commit -m "reset: clear all rules"
```

## 查看当前数据量

```bash
# 反思记录数
cat ~/.config/opencode/aristotle-state.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} records')"

# DRAFT 文件数
ls ~/.config/opencode/aristotle-drafts/ 2>/dev/null | wc -l

# 快照文件数
ls ~/.config/opencode/aristotle-sessions/*_snapshot.json 2>/dev/null | wc -l

# 规则数（含 pending/staging/verified）
cd ~/.config/opencode/aristotle-repo && git ls-files user/ projects/ | wc -l

# 工作流状态
cat ~/.config/opencode/aristotle-sessions/bridge-workflows.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} workflows')"
```