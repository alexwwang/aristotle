# Aristotle Roadmap

> P1–P4 + GEAR 编排已完成。Phase 2（M1/M5-M9）已完成并通过 e2e 验证。Phase 0 Bridge MCP 扩展 + Phase 1 Bridge Plugin 已完成。当前测试总量：318 pytest + 100 vitest + 104 static。本文档记录后续开发计划。

---

## V1.1 — 体验优化

### V1.1a 触发关键词外置化

**现状：** SKILL.md 已重写为统一 MCP dispatcher（从 90 行精简到 60 行）。触发关键词仍保留在 SKILL.md description 中用于自动建议，但路由逻辑已改为基于 MCP 工具调用。

**目标：** 将关键词提取到 `TRIGGERS.md`，支持在使用中积累用户对错误的表达习惯。

**方案要点：**
- 新建 `TRIGGERS.md`：包含 reflect 触发词 + 多 agent 错误检测词，分语言/分场景
- SKILL.md description 保留 2-3 个核心触发词，详细列表引用 TRIGGERS.md
- REFLECT.md STEP F1 的 Passive Trigger 部分从 TRIGGERS.md 读取完整列表

**改动文件：** `TRIGGERS.md`（新建）、`SKILL.md`、`REFLECT.md`

**注：** SKILL.md 调度器重写已完成（M2），但 TRIGGERS.md 外置化未实施。

### ~~V1.1b Subagent session_read 兼容性~~ — 已解决

**原现状：** Reflector 使用 `session_read()` 读取会话内容，部分 model/provider 不暴露该工具。

**解决方案：** Bridge Plugin 的 PRE-RESOLVE snapshot 提取器在主会话（有 `session_read` 访问权）中提取错误上下文快照，通过 `session_file` 传给 Reflector 子代理。Reflector 不再需要 `session_read`，直接从快照文件读取。

**改动文件：** `_orch_start.py`（`session_file` 字段）、`_orch_prompts.py`（prompt 模板）、`plugins/aristotle-bridge/src/snapshot-extractor.ts`

### V1.1c 多模型 E2E 测试

**现状：** live-test.sh 只验证用户指定模型。

**目标：** 覆盖主流 provider/model 组合。

**改动文件：** `test/live-test.sh`

---

## V1.2 — Phase 2 收尾

### V1.2a 代码推送与合并

**现状：** Phase 2 全部代码在 `test-coverage` 分支，2 个 commit 未推到远程。
- `567b793` feat: implement Phase 2 modules (M1/M5/M6/M7/M8/M9) with 66 new tests
- `7da8269` fix: 4 bugs found by e2e testing + add e2e test script

### V1.2b 人工 P1 Passive Trigger 测试

**现状：** 69/70 e2e 场景已自动化。P1（Passive Trigger 宿主 agent 行为验证）需人工操作。

**步骤：**
1. 在 Claude Code/OpenCode 中安装 Aristotle skill
2. 制造错误纠正场景（自我纠正 / 用户纠正 / 方案切换）
3. 验证 agent 是否建议 `Run /aristotle to reflect`
4. 验证正常对话不误触发

### V1.2c Phase 2.1 集成测试

**目标：** 端到端工作流验证（含真实 LLM 交互），覆盖自动化测试无法验证的 LLM-in-the-loop 场景。

**关键场景：**
- Learn 完整流程：`o_prompt` → 真实 LLM → 合法 intent_tags JSON → score → compress
- Reflect：Reflector/Checker 子 agent 实际产出质量
- Review Revise：O 收到修改指令后正确改写规则文件

---

## V1.3 — 进化等级（设计阶段）

> 需先回答以下问题再实施。不急于编码。

### V1.3a needs_sync 自动闭环

**现状：** `check_sync_status` 能检测未同步规则，但需手动调用 `sync_rules`。

**目标：** 检测到未同步规则后自动 commit。

### V1.3b LLM 语义冲突检测

**现状：** `detect_conflicts` 基于精确 triple 匹配（domain + task_goal + failed_skill）。

**目标：** 用 embedding 替代精确匹配，检测语义层面的规则冲突。

### V1.3c 自动触发 Passive Trigger

**现状：** SKILL.md Passive Trigger 段落只建议用户运行 `/aristotle`，不自动调用。

**目标：** 从建议升级为可选的自动调用模式。

### V1.3d 未决问题

1. **进化的对象** — GEAR 五个 agent 全部 stateless。调整 threshold 不能提升能力，只减少人工审核。真正该进化的是什么？
   - R 的产出质量？（需要 R 能参考自己过去写过的规则）
   - C 的审核能力？（需要 C 能读取"审核教训"类规则）
   - 管线整体可靠性？（需要比 verify/reject 比率更可靠的信号）

2. **反馈信号来源** — `verified/(verified+rejected)` 反映用户行为模式，不是系统质量。可选信号：
   - L 应用规则后仍然出错的反馈率（LEARN.md L6 error feedback）
   - 规则被 L 命中的频率（高命中 + 低 error feedback = 好规则）
   - 用户主动修订规则（revised 状态）的比率

3. **进化结果作用位置**
   - Threshold 调整（GEAR 原方案）
   - 协议文档自动更新（CHECKER.md 增加校验维度）
   - 规则库补充"审核教训"（新规则类别：audit_lesson vs error_rule）

4. **是否为 C 建立独立规则体系**
   - 当前规则库只有"给 L 的执行规则"
   - C 能否从规则库学习？需要什么格式？
   - 是否需要区分 `user/rules/` 和 `user/audit_lessons/`？

### 前置条件

- 收集足够的使用数据（至少 50 条 verified 规则 + 10 次 error feedback）
- L6 error feedback 机制经过实战验证
- 上述 4 个问题有明确答案

---

## V1.4 — 架构改进（OpenCode 限制相关）

> 以下改进依赖 OpenCode 平台能力，部分可能需要上游变更。

### V1.4a 子进程 session 注册为可交互

**现状：** `task()` 创建的 session 非交互式，用户无法通过 `opencode -s <id>` 切入并继续对话。

**目标：** 支持从主 session 直接切入子代理 session 进行确认/反馈。

**依赖：** OpenCode 上游支持（GitHub Issues #4422, #16303, #11012）

### V1.4b 启动时上下文优化

**现状：** `/aristotle` 触发时，SKILL.md 完整内容注入父上下文。

**目标：** 父上下文最多一行状态提示，完整协议只传递给子代理。

**已部分实现：** SKILL.md 已精简到 60 行（统一 MCP dispatcher），但仍有优化空间。

---

## Done

| Version | Phase | Content | Archive |
|---------|-------|---------|---------|
| v0.1 | — | 架构改进方案（SKILL.md 瘦身、session 管理、模型选择） | `archive/plan-v0.1.md` |
| v0.2 | — | 架构改进待办清单（context 污染、session 注册、模型对话框） | `archive/todo-v0.2.md` |
| v1.0 | P1 | Schema 升级 & MCP 工具补齐（8 tools, frontmatter, multi-dimension search） | `archive/progress-v1.0.md` |
| v1.0 | P2 | Skill 层集成（REVIEW.md MCP 化, REFLECTOR.md 输出扩展, C 角色 schema 校验） | `archive/progress-v1.0.md` |
| v1.0 | P3 | L + S 增量学习服务（LEARN.md, 被动触发, sync 自愈, 10 tools） | `archive/progress-v1.0.md` |
| v1.0 | P4 | Δ 决策因子（evolution.py, get_audit_decision, V3c 动态审核, 11 tools, 104 tests） | `archive/progress-v1.0.md` |
| v1.1 | M1 | MCP 编排核心 — orchestrate_start, orchestrate_on_event, orchestrate_review_action, workflow 状态机 | `a3ab41a` |
| v1.1 | M2 | SKILL 调度器重写 — 统一 MCP dispatcher（60 行），PRE-RESOLVE + REVIEW FEEDBACK | `a3ab41a` |
| v1.1 | M3 | 子代理提示词模板 — REFLECTOR/CHECKER/REVISE prompt, SKILL_DIR 配置 | `a3ab41a` |
| v1.1 | M4 | 测试方案 — reflect/review/sessions/端到端测试，218 pytest + 98 static | `a3ab41a` |
| v1.2 | Phase 2 | M1补丁/M5-M9 全模块实现 + 4 bug fix + e2e 自动化测试（295 pytest + 104 static + 70 e2e） | `7da8269` |
| v1.2 | Phase 0 Bridge | MCP 侧扩展：`session_file` 传入、`.bridge-active` marker 检测产出 `use_bridge` 标志、`on_undo` tool、`_orch_event.py` undone 状态短路 + 9 E2E 集成测试（含 e2e→pytest 迁移 14 条，309→318 pytest） | — |
| v1.2 | Phase 1 Bridge | Bridge Plugin 7 模块 + SKILL.md 集成（PRE-RESOLVE + fire_sub Bridge 路径 + /undo 规则）— 100 vitest | — |

---

## Nice to Have

- `count_matches` 跨平台测试（Alpine BusyBox / macOS BSD grep）
- 规则过期/修剪机制
- REFLECTOR.md 多语言输出优化（中英混合场景的 category 映射）
