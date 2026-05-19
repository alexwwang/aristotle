# Aristotle: Product Positioning

**Last Updated**: 2026-05-19
**Status**: Active

---

## One-Liner

**Aristotle** — 让 AI agent 学会不犯错的约束平台。

## Architecture

Aristotle is an umbrella project containing two independently installable products that combine into a closed loop:

```
┌─────────────────────────────────────────────────────────────┐
│                        Aristotle (伞品牌)                     │
│                                                             │
│  ┌─────────────────────┐     ┌─────────────────────────┐   │
│  │  Aristotle 反思引擎   │     │    TDD Watchdog          │   │
│  │  (packages/reflection)│     │  (packages/watchdog)     │   │
│  │                     │     │                         │   │
│  │  会后错误反思          │     │  实时流程监控             │   │
│  │  5-Why 根因分析       │     │  文件写入拦截             │   │
│  │  规则沉淀             │     │  Phase Gate 强制执行      │   │
│  │  Git-backed 规则管理   │     │  多 Agent 环境防护        │   │
│  │  Δ 审计决策           │     │  理解验证 (Why Artic.)    │   │
│  │                     │     │                         │   │
│  └──────────┬──────────┘     └────────────┬────────────┘   │
│             │                              │                │
│             │       审计日志 (自动)          │                │
│             │◄─────────────────────────────┤                │
│             │                              │                │
│             │      学习规则 (自动)           │                │
│             ├─────────────────────────────►│                │
│             │                              │                │
│  └──────────┴──────────────────────────────┴────────────┘   │
│                          ▲                                   │
│                     packages/core                            │
│              (共享基础设施: Logger, StateStore,                │
│               Plugin Registration, Config)                   │
└─────────────────────────────────────────────────────────────┘
```

## The Two Products

### Aristotle 反思引擎

| 维度 | 内容 |
|------|------|
| **定位** | 会后学习系统 |
| **核心能力** | 错误检测 → 5-Why 根因分析 → 结构化规则生成 → 审核确认 → Git 持久化 |
| **独立价值** | 不需要 Watchdog 也能独立使用——任何 AI session 都可以触发反思 |
| **包** | `packages/reflection`（TypeScript）, `aristotle_mcp/`（Python MCP Server） |
| **安装** | `opencode.json` 注册 reflection plugin + MCP server |
| **当前版本** | v1.2.0 |

### TDD Watchdog

| 维度 | 内容 |
|------|------|
| **定位** | 实时流程监控 |
| **核心能力** | Observer（Task 调用记录）+ Interceptor（文件写入拦截）+ CheckpointHandler（状态机 + 理解验证） |
| **独立价值** | 不需要 Aristotle 也能独立使用——纯流程约束，不学习 |
| **包** | `packages/watchdog`（TypeScript） |
| **配置** | `.opencode/watchdog.jsonc`（monitoredTools, phaseDeliverables, ignorePatterns） |
| **当前版本** | v0.2.0 |

### 组合使用（推荐）

Watchdog 检测到流程违规 → 审计日志写入 `ralph-log.jsonl` → Aristotle 反思引擎读取违规记录 → 生成 PROCESS_VIOLATION 类型的规则 → 规则被后续 session 加载 → 同类违规被预防。

这是"**检测 → 学习 → 预防**"闭环——也是 PRD §1.3 中描述的核心价值。

## Independence Principle

两个产品的设计原则是**可独立安装、可独立运行**：

1. 只想要错误学习的用户 → 只装 Aristotle 反思引擎
2. 只想要流程约束的用户 → 只装 TDD Watchdog
3. 想要完整闭环的用户 → 两个都装

`packages/core` 是共享基础设施，两者都依赖它，但彼此之间零直接依赖。Phase 4（Aristotle 集成）只是让反思引擎能**读取** Watchdog 的审计日志，不改变任何接口。

## TDD Pipeline Skill（协议定义）

Watchdog 是**协议执行层**，tdd-pipeline skill 是**协议定义层**。两者必须版本对齐。

```
tdd-pipeline skill          TDD Watchdog
(告诉 LLM 怎么做)            (机械性强制执行)
─────────────────          ─────────────────
Phase 1-7 定义         →    状态机 transitions
Phase deliverable 文件名  →   FALLBACK_PATTERNS
Gate pass / Early stop  →    GPAV (Phase 2.1)
Ralph Loop 严重度体系    →    severity 校验
Monitored tools         →    watchdog.jsonc
```

### Phase 数量

tdd-pipeline 当前为 **7 phase**：

| Phase | 名称 | Deliverable | Ralph Review |
|-------|------|-------------|-------------|
| 1 | Product Design | Requirements Document | ✅ |
| 2 | Technical Solution | Technical Design Document | ✅ |
| 3 | Test Plan | Test Plan Document | ✅ |
| 4 | Test Code | Test Files (all failing) | ✅ |
| 5 | Business Code | Working Business Code | ✅ |
| 6 | Pre-Release Testing | Bug root cause analysis, regression | ✅ |
| 7 | System Quality Audit | Architecture/quality review | ✅ |

Watchdog 当前硬编码 5 phase，需扩展到 7 phase（前置任务，应在 Phase 2.1 之前完成）。

### 引入方案

**安装脚本拉取**（单一真相源）：tdd-pipeline skill 在独立仓库（`github.com/alexwwang/tdd-pipeline`）维护，`install.sh` 拉取与 Watchdog 版本对齐的 tag。用户不装 tdd-pipeline skill 也能用 Watchdog（降级为无 skill 指导的纯拦截模式）。

### 双向闭环（待设计）

当前闭环是单向的：Watchdog 违规 → Aristotle 反思 → 规则持久化。缺失反向：Aristotle 规则 → Watchdog 行为调整。例如规则"agent tends to skip Phase 3"应触发 Watchdog 在 Phase 2→3 转换时加强监控。这是 Phase 4 的延伸。

## Versioning

| 包 | 版本线 | 说明 |
|---|--------|------|
| `aristotle`（pyproject.toml） | 1.x | 主包，跟随反思引擎迭代 |
| `@opencode-ai/reflection` | 1.x | 反思引擎 TypeScript 包 |
| `@opencode-ai/watchdog` | 0.x | 流程监控（API 未稳定，minor version 迭代） |
| `@opencode-ai/core` | 0.x | 共享基础设施（跟随 watchdog 版本） |

## Phased Delivery

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 0 | Core 提取（包拆分、build 系统） | ✅ v1.2.0 |
| Phase 1 | Watchdog 状态机 + Checkpoint Tool（5 phase） | ✅ v0.1.0 |
| Phase 2 | Active Monitoring（Observer + Interceptor + Articulation） | ✅ v0.2.0 |
| **前置** | **扩展到 7 phase（对齐 tdd-pipeline）** | 📋 **待实现** |
| Phase 2.1 | Ralph Loop 完整性（GPAV + RPS） | 📋 设计完成 |
| Phase 3 | Escalation + Idle Monitoring | ⏳ 未开始 |
| Phase 4 | Aristotle 集成（PROCESS_VIOLATION + 双向规则闭环） | ⏳ 未开始 |
| Phase 5 | 安装体验 + tdd-pipeline skill 拉取 + 文档 | ⏳ 未开始 |
