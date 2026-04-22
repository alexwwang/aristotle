# Aristotle Roadmap

> P1–P4 + GEAR 编排已完成（17 MCP tools, 218 pytest + 98 static）。本文档记录后续开发计划。

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

### V1.1b Subagent session_read 兼容性

**现状：** Reflector 使用 `session_read()` 读取会话内容，部分 model/provider 不暴露该工具。

**目标：** 提供优雅降级路径。

**方案要点：**
- 检测 `session_read` 是否可用
- 不可用时回退到 `session_list` + `session_info` 获取元数据
- 输出提示："🦉 当前模型不支持 session 读取，建议使用 --model 参数指定兼容模型"

### V1.1c 多模型 E2E 测试

**现状：** live-test.sh 只验证用户指定模型。

**目标：** 覆盖主流 provider/model 组合。

**改动文件：** `test/live-test.sh`

---

## V1.2 — 进化等级（设计阶段）

> 需先回答以下问题再实施。不急于编码。

### 未决问题

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

## V1.3 — 架构改进（OpenCode 限制相关）

> 以下改进依赖 OpenCode 平台能力，部分可能需要上游变更。

### V1.3a 子进程 session 注册为可交互

**现状：** `task()` 创建的 session 非交互式，用户无法通过 `opencode -s <id>` 切入并继续对话。

**目标：** 支持从主 session 直接切入子代理 session 进行确认/反馈。

**依赖：** OpenCode 上游支持（GitHub Issues #4422, #16303, #11012）

### V1.3b 启动时上下文优化

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

---

## Nice to Have

- `count_matches` 跨平台测试（Alpine BusyBox / macOS BSD grep）
- 规则过期/修剪机制
- REFLECTOR.md 多语言输出优化（中英混合场景的 category 映射）
