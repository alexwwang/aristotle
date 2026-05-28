# Watchdog-Intervention 架构设计文档

**状态**: 分析中  
**版本**: 1.0  
**日期**: 2025-05-28

---

## 1. 问题陈述

**当前状况**：项目同时存在两个"看门狗"系统：

1. `packages/watchdog/` — TypeScript，OpenCode 插件角色，~3000+ 行
2. `intervention/` — Python，独立库，~1500 行，243 测试

**核心疑问**：既然 TypeScript watchdog 已经存在，为什么还需要 Python intervention？

---

## 2. 系统对比分析

### 2.1 TypeScript Watchdog (`packages/watchdog/`)

**定位**：OpenCode 运行时插件（RoleRegistration）

**核心能力**：
- **Interceptor** (`interceptor.ts` 121 行): onToolBefore 钩子，拦截 tool 调用，阻止 TDD 违规
- **Observer** (`observer.ts` 253 行): onToolAfter 钩子，观察执行结果，检测降级
- **CheckpointHandler** (`checkpoint.ts` 487 行): 处理 `tdd_checkpoint` tool，管理状态机
- **Transitions** (`transitions.ts` 1179 行): 完整 TDD 状态机，验证所有阶段转换
- **PipelineStore**: 状态持久化
- **Schema**: 复杂数据模型（PipelineState, PhaseRecord, RalphLoopState）
- **Tools**: 提供 `tdd_checkpoint` 给 LLM 调用

**技术栈**: TypeScript, Zod schema, OpenCode Core API

**集成方式**: 作为 OpenCode 插件角色注册，直接挂钩执行流程

### 2.2 Python Intervention (`intervention/`)

**定位**：独立 Python 库（计划通过 MCP 集成）

**核心能力**：
- **ViolationFilter** (`watchdog.py` 19 行): 简单的违规过滤器（仅检查 phase 4-5 的行为违规）
- **InterventionCoordinator** (`intervention_coordinator.py` 365 行): 协调干预计划
- **CommitGuard**: 提交守卫
- **RollbackEngine**: Git 回滚
- **KiDocManager**: KI 文档管理
- **PromptValidator**: 双语提示验证
- **RuleGenerator**: 规则生成模板
- **Reflector**: MCP 集成 stub（未实现）

**技术栈**: Python, dataclasses, subprocess (git)

**集成方式**: 计划通过 MCP 暴露工具（当前未接入）

---

## 3. 关键发现

### 3.1 功能重叠

| 功能 | TypeScript Watchdog | Python Intervention | 结论 |
|------|---------------------|---------------------|------|
| 违规检测 | ✅ Interceptor + Observer | ✅ ViolationFilter (简化版) | **重叠** |
| 状态管理 | ✅ PipelineStore + StateCache | ❌ 无 | Watchdog 领先 |
| 阶段转换验证 | ✅ transitions.ts (1179 行) | ❌ 无 | Watchdog 领先 |
| Git 回滚 | ❌ 无 | ✅ RollbackEngine | Intervention 独有 |
| 提交守卫 | ❌ 无 | ✅ CommitGuard | Intervention 独有 |
| KI 文档管理 | ❌ 无 | ✅ KiDocManager | Intervention 独有 |
| 规则生成 | ❌ 无 | ✅ RuleGenerator | Intervention 独有 |
| MCP 集成 | ❌ 无 | 🔄 Reflector (stub) | 计划中 |

### 3.2 架构层级差异

```
┌─────────────────────────────────────────────────────────────┐
│  OpenCode 运行时                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  TypeScript Watchdog (RoleRegistration)              │   │
│  │  ├── Interceptor (onToolBefore) → 阻止违规操作       │   │
│  │  ├── Observer (onToolAfter) → 记录状态               │   │
│  │  ├── CheckpointHandler → 状态机管理                  │   │
│  │  └── tdd_checkpoint tool → LLM 调用入口              │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Python Intervention (计划通过 MCP)                  │   │
│  │  ├── ViolationFilter → 简化版检测                    │   │
│  │  ├── InterventionCoordinator → 干预策略              │   │
│  │  ├── RollbackEngine → Git 回滚                       │   │
│  │  └── ...                                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**核心矛盾**：
- Watchdog 是**运行时拦截器**，在违规发生**之前**阻止它
- Intervention 是**事后处理器**，在违规发生**之后**处理它
- 如果 Watchdog 工作正常，Intervention 的 ViolationFilter 永远不会触发

### 3.3 代码量对比

| 模块 | TypeScript Watchdog | Python Intervention |
|------|---------------------|---------------------|
| 核心逻辑 | ~3000+ 行 | ~1500 行 |
| 测试 | 大量 vitest | 243 pytest |
| 状态机 | 1179 行 (transitions) | 无 |
| 拦截能力 | 完整 (Interceptor+Observer) | 19 行过滤器 |

---

## 4. 设计决策

### 4.1 保留 Watchdog，重构 Intervention

**决策**：TypeScript Watchdog 是**唯一的运行时看门狗**。Python Intervention 需要重新定义角色。

**理由**：
1. Watchdog 已经集成到 OpenCode 执行流，是**唯一有效的拦截点**
2. Intervention 的 ViolationFilter 与 Watchdog Interceptor **功能重复但能力更弱**
3. Intervention 当前未接入 MCP，处于**孤儿状态**

### 4.2 Intervention 的新定位

**建议**：将 Intervention 从"看门狗"重新定位为 **"MCP 规则生成器"**

**新职责**：
- 接收 Watchdog 检测到的违规事件（通过 MCP）
- 生成 Aristotle 学习规则（write_rule）
- 管理 KI 文档（KI 文档是干预结果，不是检测逻辑）
- 执行 Git 回滚（作为 MCP 工具暴露）

**不再负责**：
- ❌ 违规检测（由 Watchdog 负责）
- ❌ 状态机管理（由 Watchdog 负责）
- ❌ 阶段转换验证（由 Watchdog 负责）

### 4.3 整合方案

```
Watchdog (TypeScript)                Intervention (Python via MCP)
    │                                          │
    │  检测到违规                              │
    ▼                                          ▼
┌──────────────┐                      ┌──────────────────┐
│ Interceptor  │ ──MCP report_feedback()│ Rule Generator   │
│ 阻止操作      │                      │ 生成学习规则      │
└──────────────┘                      └──────────────────┘
                                              │
                                              ▼
                                       ┌──────────────────┐
                                       │ write_rule        │
                                       │ 写入 Aristotle    │
                                       └──────────────────┘
```

---

## 5. 实施建议

### 5.1 短期（立即）

1. **重命名 intervention/src/watchdog.py** → `violation_handler.py` 或删除
   - 避免与 Watchdog 混淆
   - ViolationFilter 的功能已被 Watchdog 覆盖

2. **删除干预协调器中的状态机逻辑**
   - Watchdog 已经管理状态机
   - Intervention 只处理"生成规则"和"执行回滚"

### 5.2 中期

1. **实现 MCP 集成**
   - `reflector.py` 实现真正的 MCP 调用
   - 暴露工具：rollback, commit_guard, generate_rule

2. **统一事件协议**
   - Watchdog 检测到违规时，通过 MCP 发送事件给 Intervention
   - Intervention 生成规则并写入 Aristotle

### 5.3 长期

1. **评估 Intervention 的必要性**
   - 如果所有功能都能在 TypeScript Watchdog 中实现，考虑合并
   - Git 操作、规则生成在 Node.js 中同样可行

---

## 6. 结论

**TypeScript Watchdog 是唯一的运行时看门狗**，负责检测和阻止 TDD 违规。

**Python Intervention 应该转型为 MCP 规则生成服务**，不再自称"看门狗"：
- 接收 Watchdog 的违规事件
- 生成学习规则
- 执行 Git 回滚

当前 intervention/ 的 ViolationFilter（19 行）与 Watchdog 的完整拦截框架（~1500+ 行）**严重不对等**，不应并存。

---

## 附录：文件清单

| 文件 | 角色 | 建议 |
|------|------|------|
| `packages/watchdog/src/interceptor.ts` | 运行时拦截 | ✅ 保留 |
| `packages/watchdog/src/observer.ts` | 运行时观察 | ✅ 保留 |
| `packages/watchdog/src/checkpoint.ts` | 检查点处理 | ✅ 保留 |
| `packages/watchdog/src/transitions.ts` | 状态机 | ✅ 保留 |
| `intervention/src/watchdog.py` | 简化过滤器 | ❌ 删除或重命名 |
| `intervention/src/intervention_coordinator.py` | 协调器 | 🔄 重构 |
| `intervention/src/rollback_engine.py` | 回滚引擎 | ✅ 保留（MCP 暴露） |
| `intervention/src/commit_guard.py` | 提交守卫 | ✅ 保留（MCP 暴露） |
| `intervention/src/ki_doc_manager.py` | KI 文档 | ✅ 保留（MCP 暴露） |
| `intervention/src/rule_generator.py` | 规则生成 | ✅ 保留（核心功能） |
| `intervention/src/reflector.py` | MCP 集成 | 🔄 实现 |
