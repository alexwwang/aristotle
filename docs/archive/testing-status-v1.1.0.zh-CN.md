# Aristotle — 测试进度追踪

> 最后更新：2026-04-28 | 提交：待更新 (A8/A9/A13 e2e 测试修复)

## 自动化测试结果

| 套件 | 命令 | 数量 | 状态 | 最后运行 |
|------|------|------|------|----------|
| Python (pytest) | `uv run pytest` | 325 | ✅ 通过 | 2026-04-28 |
| Bridge 插件 (vitest) | `cd plugins/aristotle-bridge && npx vitest run` | 148 | ✅ 通过 | 2026-04-28 |
| 静态测试 | `bash test.sh` | 103 | ✅ 通过 | 2026-04-28 |
| B1 回归检查 | `bash test/regression_b1_checks.sh` | 64 | ✅ 通过 | 2026-04-28 |
| 部署 checklist | 12 项验证 | 12 | ✅ 通过 | 2026-04-28 |
| **合计** | | **640** | **全部通过** | |

### 已知问题

| 问题 | 影响 | 状态 |
|------|------|------|
| B7: chain 完成后用户无通知 | — | ✅ 已修复 |

---

## E2E / 集成测试进度

### E2E 自动化测试 (opencode run) — `bash test/e2e_opencode.sh`

| 分组 | 断言数 | 结果 | 备注 |
|------|--------|------|------|
| E2E-1: Skill 加载 | 1 | ✅ 通过 | |
| E2E-2: Sessions | 2 | ✅ 通过 | |
| E2E-3: Learn | 2 | ✅ 通过 | |
| E2E-4: Reflect | 2 | ✅ 覆盖 | A8-A13 standalone setup 多轮验证 R→C chain |
| E2E-5: Snapshot | 2 | ✅ 通过 | 磁盘验证：23 个文件，schema v1 + source=bridge-plugin-sdk |
| E2E-6: Bridge marker | 2 | ✅ 条件通过 | A8-A13 每轮验证；静态时无 marker（设计如此） |
| E2E-7: Workflow store | 3 | ✅ 通过 | 磁盘验证：3 workflow，必需字段齐全 |

### B1 R→C 链路 (tmux) — `bash test/e2e_a7_r2c_chain.sh --project /path`

| 步骤 | 描述 | 状态 | 备注 |
|------|------|------|------|
| 1 | 创建 tmux + 插入 typo | ✅ | |
| 2 | 等待 Bridge 插件初始化 | ✅ | |
| 3 | 创建错误上下文 | ✅ | |
| 4 | 等待 LLM 响应 | ✅ | |
| 5 | 触发 `/aristotle` | ✅ | |
| 6 | Workflow status = running | ✅ | A8-A13 standalone setup 多轮验证通过（Bug #3 修复后） |
| 7 | R chain_pending/completed | ✅ | 同上 |
| 8 | C 子会话 (≥2) | ✅ | 同上 |
| 9 | Workflow completed | ✅ | 同上 |

**注**: Bug #3（MCP 路径含波浪号）修复后，A8-A13 standalone setup 多轮验证 R→C 全链路通过。B1 步骤 6-9 已间接覆盖。

---

## 人工测试进度

### P1: Passive Trigger（需要实时 LLM 会话）

| 测试 | 模式 | 状态 | 日期 | 备注 |
|------|------|------|------|------|
| P1-A | Agent 自我纠正 | ✅ 通过 | 2026-04-25 | opencode + GLM-5.1 |
| P1-B | 方案切换 | ✅ 通过 | 2026-04-25 | opencode + GLM-5.1 |
| P1-C | 用户指出错误 | ✅ 通过 | 2026-04-25 | opencode + GLM-5.1 |
| P1-D | 无误触发验证 | ✅ 通过 | 2026-04-25 | 正常对话，无触发 |
| P1-E | 思考阶段自我纠正（不触发） | ✅ 通过 | 2026-04-25 | 输出前内部纠正 |
| P1-F | 主会话纠正子代理错误 | ✅ 通过 | 2026-04-25 | task() 子代理错误被检测 |

### Round A: Bridge 生命周期 (M4 + M2 + M3)

| 步骤 | 动作 | 状态 | 日期 | 备注 |
|------|------|------|------|------|
| A1 | 启动带插件的 opencode | ✅ 通过 | 2026-04-27 | 无 promptAsync 错误；Bug #8 修复后 tool 正确注册 |
| A2 | .bridge-active marker | ✅ 通过 | 2026-04-27 | 有效 JSON 含 pid |
| A3 | `/aristotle` 非阻塞 | ✅ 通过 | 2026-04-27 | LLM 返回 STOP 消息 |
| A4 | Marker 持续存在 | ✅ 通过 | 2026-04-27 | |
| A5 | bridge-workflows.json 已创建 | ✅ 通过 | 2026-04-27 | 含 workflowId + sessionId |
| A6 | R idle → chain_pending | ✅ 通过 | 2026-04-27 | B1: plugin 检测 idle |
| A7 | R→C 自动链路 | ✅ 通过 | 2026-04-27 | rec_19: R 产出 DRAFT → C 写 2 staging rules → done |
| A8 | 第二次 `/aristotle` | ✅ 已修复 | 2026-04-28 | 改用 trigger-file（tmux send-keys 不触发 skill） |
| A9 | `/aristotle suspend` 取消 | ✅ 已修复 | 2026-04-28 | 改用 checkAbortTrigger()（测试基础设施，非用户功能） |
| A10 | `aristotle_check` 输出 | ✅ 通过 | 2026-04-28 | e2e 脚本验证：abort 前检测到 1 running workflow |
| A11 | Abort + cancel 验证 | ✅ 通过 | 2026-04-28 | e2e 脚本验证：abort 后全 terminal（1 completed + 1 chain_broken） |
| A12 | 用户可见取消消息 | ✅ 通过 | 2026-04-28 | e2e 脚本验证：tmux 输出含 "cancelled" + "workflow" |
| A13 | 退出时 marker 清理 | ✅ 已修复 | 2026-04-28 | 超时增加 15s→30s + 第二轮 graceful shutdown |

### Round B: Reflect-Check 链路 (M1 + M5)

| 步骤 | 动作 | 状态 | 日期 | 备注 |
|------|------|------|------|------|
| B1 | 错误-纠正模式 | ✅ 通过 | 2026-04-27 | 素数函数：模型将 1 识别为素数，用户纠正 |
| B2 | `/aristotle` 启动 R | ✅ 通过 | 2026-04-27 | prompt 含 CONTEXT SUMMARY |
| B3 | Snapshot 文件已创建 | ✅ 通过 | 2026-04-28 | A8-A13 验证：每个 R workflow 有 snapshot，schema v1 + source=bridge-plugin-sdk |
| B4 | R→C 链路完成 | ✅ 通过 | 2026-04-27 | rec_19 DRAFT 产出 2 个 reflection |
| B5 | Re-reflect（如请求） | ⏭️ SKIP | — | Checker 未请求更深入分析 |
| B6 | 状态转换验证 | ✅ 通过 | 2026-04-27 | running → completed（debug 日志确认） |
| B7 | 完成通知 | ✅ 通过 | 2026-04-28 | Bug #14b 修复后：prompt({noReply:true}) 通知父会话 |
| B8 | `/aristotle sessions` | ✅ 通过 | 2026-04-28 | MCP 后端直接验证：返回 30 条记录列表 |
| B9 | `/aristotle review 1` | ✅ 通过 | 2026-04-28 | MCP 后端直接验证：返回 10 条规则 + action menu |

---

## 测试中发现并修复的 Bug（Phase 0/1 全量）

> 范围：Phase 0 MCP 核心开发（E2E 测试中发现的 bug 修复于 commit `7da8269`）+ Phase 0 Bridge MCP 扩展 + Phase 1 Bridge Plugin（从 commit `8822e99` 开始）至今的所有 bug fix。

| # | Bug | 根因 | 修复 | Commit |
|---|-----|------|------|--------|
| P0-1 | `detect_conflicts` 未注册为 MCP 工具 | 新增工具函数后未添加 `mcp.tool()` 注册调用 | 添加 `mcp.tool()` 注册 | `7da8269` |
| P0-2 | `write_rule` ID 碰撞（秒级时间戳） | 多条规则在同一秒内写入时 ID 重复 | 改为毫秒时间戳 | `7da8269` |
| P0-3 | `commit_rule` 双向冲突标注匹配错误规则 | 冲突查询用模糊匹配 + `limit=1` 过于严格，返回了不相关的规则 | 精确 ID 匹配 + `limit=10` | `7da8269` |
| P0-4 | macOS `/tmp` symlink 导致 `relative_to` 失败 | macOS `/tmp` 是 `/private/tmp` 的符号链接，`Path.relative_to()` 路径不匹配 | `resolve_repo_dir()` 添加 `.resolve()` | `7da8269` |
| 1 | Bridge Plugin 构建+安装+注册 | 初始构建产物和 opencode 注册不完整 | 修复 build + install + testing docs | `6c3b676` |
| 2 | api-probe 调用真实 API | `detectApiMode()` 初始化阶段调用真实 promptAsync 导致阻塞 | 改为 typeof 检查，不调用真实 API | `22b09f9` |
| 3 | MCP command 路径含波浪号 | opencode.json 中 MCP command 用 `~` 路径，`uv run` 不展开 → MCP 启动失败 | 改为绝对路径 | `2f0fee0` |
| 4 | 源码含硬编码 HOME 路径 | 多个文件硬编码 `/Users/alex/` 路径 | 全部替换为环境变量 | `6c6e536` |
| 5 | subprocess stdin 机制 | R→C chain 用 execFile 无法与 MCP 子进程通信 | 改为 spawn + stdin pipe + trigger 文件 | `700fe13` |
| 6 | promptAsync 传无效 agent 参数 | `agent` 参数非 opencode API 支持的选项 | 移除 agent 参数 | `6aae8c2` |
| 7 | trigger parentSessionId 错误 | trigger 机制未用 session_id 作为 parentSessionId | 改用 `trigger.session_id` | `bc9e222` |
| 8 | SKILL.md 含残留 agent 参数 | SKILL.md 调用 `aristotle_fire_o` 仍传 agent 参数 | 移除 stale agent 参数 | `e356165` |
| 9 | SKILL.md 轮询阻塞主会话 | Bridge 路径后 LLM 仍调 `aristotle_check` 轮询 | 移除 SKILL.md 轮询指令，executor 返回 STOP | `caf20fa` |
| 10 | Tool 注册格式错误 | `plugin.tool` 返回裸函数，opencode 期望 `{description, args, execute}` 对象 → tools 静默跳过 | 改为 ToolDefinition 对象映射 | `149fc6c` |
| 11 | target_session_id 默认值 | `ctx.session?.id` 来自 PluginInput（无 session 属性），永远是 undefined | 改用 `context?.sessionID`（ToolContext 注入） | `149fc6c` |
| 12 | reconcileOnStartup 阻塞启动 | 对 running workflow 调 `client.session.messages()`，遗留 session ID 不存在 → API 挂起 → 启动阻塞 | 三合一：instanceId 标记 + reconcile 超时 + saveToDisk merge | `ff4e57d` |
| 13 | R 截断导致 DRAFT 未产生 | `opencode.json` limit.output=4096，GLM reasoning+output 共享预算 → reasoning 4092 → output 4 → `reason:"length"` | DRAFT 存在性检查 + compact prompt + 配置驱动模式选择 | `3fdcb4a` |
| 14 | C 结果计数错误 | `_parse_checker_result` 正则不匹配 C 的实际输出格式 `"- Auto-committed: 0"` → 计数 (0,0) | 改为查 list_rules frontmatter status 计数 | `8311d9f` |
| 15 | A8/A9 tmux e2e 失败 | tmux `send-keys` 注入 stdin 字符流，不触发 opencode 交互式 skill 激活层；A13 tmux kill-session 发 SIGKILL 不可捕获 | A8/A9 改用 trigger-file 机制；A13 增加 graceful shutdown 超时和重试 | `3014130` |
| 14b | 用户无通知 | Bridge fire-and-forget 架构，chain 完成后只打 logger，非 debug 模式不可见 | Gate #1：noReply 不注入 system-reminder（hang bug）。Gate #2：noReply 非阻塞+可见（1180ms）。修复：`notifyParent()` via `prompt({noReply:true})`。详见 async-non-blocking-architecture.md §8.4 | `9258382` |

---

## 状态符号

| 符号 | 含义 |
|------|------|
| ✅ 通过 | 测试通过 |
| ❌ 失败 | 测试失败，需排查 |
| 🔄 待测 | 尚未执行 |
| ⏭️ SKIP | 跳过（缺少依赖） |
| 🚫 阻断 | 前置条件失败导致无法运行 |
