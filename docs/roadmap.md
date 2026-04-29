# Aristotle Roadmap

> **v1.2.0 released.** Enhanced Review Phase UX — inspect N, show draft, enriched notifications. 当前测试总量：382 pytest + 162 vitest + 103 static + 64 regression = 711 total。详见 [testing.md](./testing.md)。

---

## V1.3 — 功能补全

### V1.3a 命令参数解析

**现状：** README 文档中声明了 `last`、`session ses_xxx`、`recent N`、`--focus <hint>` 命令，但 SKILL.md 的 PRE-RESOLVE 段落硬编码了 `target_session_id: ""` 和 `focus: "last"`，用户输入的参数被忽略。

**目标：** 在 SKILL.md 中添加参数解析逻辑，利用 `session_list()` API 解析目标会话。

**改动范围：** 仅 SKILL.md（~15 行解析指令），无需改动 MCP 或 Bridge 代码。

**实现方案：** 详见 `design_plan/pending-params-implementation.md`

### V1.3b 反思器模型配置

**现状：** 反思器使用宿主默认模型，无法单独优化成本或质量。

**目标：** 在 `aristotle-config.json` 中添加 `reflector_model` 配置项。

**改动范围：** `config.py`（新增 `get_reflector_model()`）+ `_orch_start.py`（透传 model）+ `executor.ts`（promptAsync 使用 model）+ SKILL.md（blocking 路径使用 model）。

**优先级链：** `ARISTOTLE_REFLECTOR_MODEL` env → `aristotle-config.json` → 宿主默认（与 `prompt_mode` 一致）

### V1.3c 触发关键词外置化

**现状：** SKILL.md 已重写为统一 MCP dispatcher（97 行）。触发关键词保留在 SKILL.md description 中用于自动建议。

**目标：** 将关键词提取到 `TRIGGERS.md`，支持在使用中积累用户对错误的表达习惯。

**改动文件：** `TRIGGERS.md`（新建）、`SKILL.md`、`REFLECT.md`

---

## V1.4 — 进化等级（设计阶段）

> 需先回答以下问题再实施。不急于编码。

### V1.4a needs_sync 自动闭环

**现状：** `check_sync_status` 能检测未同步规则，但需手动调用 `sync_rules`。

**目标：** 检测到未同步规则后自动 commit。

### V1.4b LLM 语义冲突检测

**现状：** `detect_conflicts` 基于精确 triple 匹配（domain + task_goal + failed_skill）。

**目标：** 用 embedding 替代精确匹配，检测语义层面的规则冲突。

### V1.4c 自动触发 Passive Trigger

**现状：** SKILL.md Passive Trigger 段落只建议用户运行 `/aristotle`，不自动调用。

**目标：** 从建议升级为可选的自动调用模式。

### V1.4d 未决问题

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

## V1.5 — 架构改进（OpenCode 限制相关）

> 以下改进依赖 OpenCode 平台能力，部分可能需要上游变更。

### V1.5a 子进程 session 注册为可交互

**现状：** `task()` 创建的 session 非交互式，用户无法通过 `opencode -s <id>` 切入并继续对话。

**目标：** 支持从主 session 直接切入子代理 session 进行确认/反馈。

**依赖：** OpenCode 上游支持（GitHub Issues #4422, #16303, #11012）

### V1.5b 启动时上下文优化

**现状：** `/aristotle` 触发时，SKILL.md 完整内容注入父上下文（5.6 KB）。

**已部分实现：** SKILL.md 已精简为统一 MCP dispatcher，渐进披露架构下其他协议文件按需加载。

---

## Done

| Version | Phase | Content |
|---------|-------|---------|
| v1.0 | P1–P4 | Schema 升级 & MCP 工具补齐 & Skill 层集成 & L+S 增量学习 & Δ 决策因子 |
| v1.1 | M1–M4 | GEAR 编排核心 — orchestrate_start/on_event/review_action, workflow 状态机, SKILL 调度器重写, 子代理提示词模板 |
| v1.1 | Phase 2 (M5–M9) | M1 补丁 + M5 两轮学习 + M6 反馈 + M7 Δ 归一化 + M8 校验 + M9 冲突检测 |
| v1.1 | Phase 0 Bridge | MCP 侧扩展：session_file 传入、.bridge-active 检测、use_bridge 标志、on_undo tool、9 E2E 集成测试 |
| v1.1 | Phase 1 Bridge | Bridge Plugin 9 模块 + SKILL.md 集成 + notifyParent 通知 + 162 vitest |
| v1.1 | 文档重构 | 安装路径统一、Bridge vs Blocking 对比、GEAR 协议映射、渐进披露 KB 大小、配置文件示例、RESET 指南 |
| **v1.2** | **Review UX** | **inspect N / show draft / 完善通知内容（Δ + audit_level + confidence + conflicts）/ staging_rule_paths / rule_summary 字段 / 57 新测试** |

---

## Nice to Have

- `count_matches` 跨平台测试（Alpine BusyBox / macOS BSD grep）
- 规则过期/修剪机制
- REFLECTOR.md 多语言输出优化（中英混合场景的 category 映射）
