# Pseudocode Reference — §4-7 Principles & Summary

**Source**: quality-assurance-implementation-plan.md v1.46
**Purpose**: Implementation reference — not part of the technical plan spec.

## Code Block 1: L1549-1560
**Context**: ### 4.2 同步 vs 异步分层

```
同步（<5ms）         同步（Observer <20ms）    异步（Reviewer 60s）
    │                    │                         │
    ▼                    ▼                         ▼
┌──────────┐       ┌──────────┐            ┌──────────┐
│Interceptor│       │ Observer  │            │ Reviewer │
│path/state│       │语法验证   │            │ 语义审查 │
│门控判断   │       │Bash 结果  │            │ S/B/A    │
└──────────┘       │审计日志   │            │测试证据  │
   Watchdog        └──────────┘            └──────────┘
                       Watchdog              Ralph Loop
```

## Code Block 2: L1580-1599
**Context**: **OBSERVER_TIMEOUT 解决路径**：(1) 后续 Observer 成功执行时自动 resolve 前次 OBSERVER_TIMEOUT（在 handle() 开头检查是否存在未恢复的 OBSERVER_TIMEOUT 并标记 resolved）；(2) 若整个阶段无后续调用，OBSERVER_TIMEOUT 保持 block 状态并阻止阶段推进。开发者需：(1) 重新执行工具调用以触发 Observer 成功执行（自动 resolve），或 (2) 标记阶段为 failed（记录未解决违规原因）。OBSERVER_TIMEOUT 不提供"推进即恢复"路径——fail-closed at gate 原则要求显式恢复。(3) **低成本恢复路径（Phase 1 新增）**：`tdd_checkpoint(event='resolve_timeout', reason='GC pause 或瞬时负载')` — 显式恢复 OBSERVER_TIMEOUT，附带原因说明（写入审计日志），比标记 failed 轻量，比无意义操作更可审计。**(4) 连续超时自动降级（非解决路径，仅降低严重性，Phase 1 新增）**：若同一 pipeline run 中 OBSERVER_TIMEOUT 连续出现 ≥3 次，Observer 自身在写入第 3 次 OBSERVER_TIMEOUT 时递增计数器 `observerTimeoutCount` 至 3，发现 ≥3 后自动将本次 severity 降级为 `'warn'`（不再阻止阶段推进），同时额外写入 `OBSERVER_TIMEOUT_DEGRADED` 审计事件。⚠️ 降级时机与代码一致：计数器在 ≥3 检查前递增（1st→count=1→block，2nd→count=2→block，3rd→count=3→warn+degraded）。Checkpoint phase_complete 不参与降级判断——仅负责在阶段推进成功时重置 observerTimeoutCount = 0。

```typescript
// OBSERVER_TIMEOUT_DEGRADED 降级计数器方案
// 计数器存储在 PipelineState 新增字段 `observerTimeoutCount: number`
// 每次写入 OBSERVER_TIMEOUT 审计事件时递增
// ⚠️ 降级检查时机：Observer handle() 写入 OBSERVER_TIMEOUT 时检查 observerTimeoutCount。
// 若 observerTimeoutCount ≥ 3，本次 OBSERVER_TIMEOUT severity 改为 'warn'，同时额外写入 OBSERVER_TIMEOUT_DEGRADED。
// Checkpoint phase_complete 不参与降级判断——仅负责在阶段推进成功时重置 observerTimeoutCount = 0。
// 降级时同时写入 OBSERVER_TIMEOUT_DEGRADED 审计事件：
//   this.store.appendAudit(projectId, runId, {
//     event: 'OBSERVER_TIMEOUT_DEGRADED',
//     decision: 'WARN',
//     severity: 'warn',
//     violation: `Observer 连续 ${state.observerTimeoutCount} 次超时，降级为 warn（不再阻止阶段推进）`,
//     sessionId: sessionID,
//     phase,
//     timestamp: new Date().toISOString(),
//   });
// PipelineState 扩展字段：observerTimeoutCount: number（初始 0）
// transitions.ts applyTransition('resolve_timeout') 重置 observerTimeoutCount = 0
```

## Code Block 3: L1612-1617
**Context**: ### 4.3 错误处理策略

```
机械错误（语法、命令失败）    → Observer 记录审计日志 → Checkpoint 阻止阶段推进
流程错误（阶段提前推进）      → Interceptor 同步阻止，返回指导信息
测试失败（无测试证据）        → Reviewer 报告 H 级 finding → 阻止通过
语义问题（S/B/A）             → Reviewer 异步审查，返回 findings
```

## Code Block 4: L1656-1688
**Context**: 默认值策略：文件不存在 → 使用内置默认值（不打印警告）；文件格式错误 → 使用默认值 + 打印警告。

```json
{
  "version": 1,
  "rules": {
    "SYNTAX_CHECK_POST_WRITE": {
      "enabled": true,
      "severity": "block",
      "extensions": [".json", ".yaml", ".yml"]  // Phase 1 仅支持 JSON/YAML 验证。Phase 2 实现 TypeScript 验证时添加 ".ts", ".tsx"
    },
    "COMMAND_RESULT_CHECK": {
      "enabled": true,
      "severity": "warn",
      "ignoreExitCodes": [130],  // 130=SIGINT。注：exit code 1 不在默认忽略列表——它是命令失败的最常见错误码（构建失败、运行时错误等），不应默认忽略。仅对 grep/diff/test 等预期非零退出的命令，通过 ignoreCommands 模式排除或用户手动配置 ignoreExitCodes。
      "ignoreCommands": ["git log *", "man *"]  // ⚠️ 默认值使用 "git log *"（含空格）替代 "git log*"，避免匹配 "git logout" 等不相关命令。matchPattern 匹配完整命令字符串。若 glob 匹配粒度不足，建议实现命令名提取（split on first space）后再匹配。
    },
    "TEST_EVIDENCE_CHECK": {
      "enabled": true,
      "severity": "block"
      // Phase 2: Checkpoint 在 phase_complete 时检查此规则配置决定测试证据缺失时的严重性
    },
    // Interceptor 规则也通过 RuleConfig 配置 enabled/severity，但 Interceptor 不读取文件内容，配置仅控制规则启用/禁用
    "AC-3_BUSINESS_CODE_GATE": {
      "enabled": true,
      "severity": "block"
    },
    "AC-12_PHASE_GATE": {
      "enabled": true,
      "severity": "block"
    }
  }
  // observer 行为由各规则的 enabled 字段控制，无需顶层开关
}
```

## Code Block 5: L1765-1771
**Context**: **当期主线（Phase 1→2→4→5，预期 7 周）**：

```
当前:                               当期目标:
├─ Watchdog (2 Interceptor 规则)    ├─ Watchdog (2 Interceptor + 2 Observer 检查 + 审计日志门控)
├─ Ralph Loop (C/H/M/P/L/I)        ├─ Ralph Loop (+ 测试证据检查，severity 不变)
├─ Aristotle MCP (20 工具)         ├─ Aristotle MCP (25 工具，含 KI 文档 + Git 回滚 + stash 清理，全部无状态)
└─ intervention/ (孤立，有状态)     └─ intervention/ (删除，有状态模块不合并)
```

## Code Block 6: L1775-1779
**Context**: **延后（Phase 3，待独立需求文档）**：

```
未来目标（需论证）:
└─ Ralph Loop (+ S/B/A 语义审查维度，用现有 severity 标注)
   └─ Schema 迁移（25+ 处改动）需独立 Phase 需求文档
```
