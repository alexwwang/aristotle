# Requirements Document: TDD Pipeline Checkpoint Integration (R9)

**Version**: 0.9
**Status**: GATE PASSED (R5+R6 consecutive 0C/0H/0M)
**Last Updated**: 2026-05-20
**Source**: tdd-pipeline v0.10.0 skill files + watchdog Phase 2.1 gap analysis
**Dependencies**: Watchdog Phase 1 (State Machine) + Phase 2 (Active Monitoring)
**TDD Pipeline Phase**: Phase 1 (Product Design) — **GATE PASSED**

---

## System Boundaries
- **In scope**:
  1. Watchdog API 修复：`loopPhases` 配置 + `user_approval` 按 loop 类型验证 + `intercept-rules` loopType-aware + `ralph_loop_start` loopType 检查 + `tools.ts` z.enum 补 `ralph_round_finding` + `pipeline_start` 简化
  2. TDD-pipeline skill 文件接线：在正确的时机调用 `tdd_checkpoint`
- **Out of scope**: escalation 功能、新增 checkpoint event 类型
- **External dependencies**: OpenCode plugin 系统

## Core Principles

### Principle 1: Phase Transition Rules
- **单调递增**：`phase_enter(N)` 要求 `N > state.currentPhase`（正常推进）
- **合法回退**：通过 `pipeline_start` 归档旧 run、创建新 run。新 run 从 Phase 1 开始，所有 phase 重新执行
- **链式验证**：`phase_enter(N)` 的前置条件是 `user_approval(N-1)` + `phase_complete(N-1)`（或新 run 的第一个 phase），不可跳步

### Principle 2: Configuration-Driven Loop Types
- 每个phase的循环类型由 `watchdog.jsonc` 的 `loopPhases` 配置声明，不硬编码
- 合法 LoopType 枚举：`'ralph' | 'followup'`。未知值 → config error（F-15）
- watchdog 初始化时读入、校验互斥、翻转内部 map，整个生命周期不可变
- watchdog 通过自身状态机知道当前 phase，不依赖 LLM 自报
- **LoopType 来源时序**：`loopPhases` 在 watchdog plugin 初始化时从 `watchdog.jsonc` 一次性加载。`pipeline_start` 不传入 loopPhases——它从 watchdog 内部已加载的 config 获取。修改 loopPhases 需要 restart plugin（F-35）

## User Stories
| # | Priority | User Story |
|---|----------|-----------|
| US-1 | Core | As a developer running tdd-pipeline, I want the watchdog to enforce phase gates so that I cannot accidentally skip phases |
| US-2 | Core | As a developer, I want the pipeline to work normally when watchdog is not installed so that the skill remains portable |
| US-3 | Core | As a developer, I want checkpoint calls at every phase boundary so that the watchdog state machine tracks full pipeline progress |
| US-4 | Core | As a developer, I want each phase's loop type to be configurable so that watchdog enforces the correct behavior per phase (ralph, followup, etc.) |
| US-5 | Core | As a developer, I want rollback to work correctly — after rollback via `pipeline_start`, watchdog creates a clean new run that accepts execution from Phase 1 onward |
| US-6 | Secondary | As a developer, I want GPAV submissions to use the correct tool format so that review findings are tracked by the watchdog |

## Acceptance Criteria

### Watchdog API Changes

| # | User Story | Priority | Acceptance Criterion | Edge Cases |
|---|-----------|----------|---------------------|------------|
| AC-1 | US-5 | Core | `pipeline_start` payload 简化为 `{ description }`。不再需要 `totalPhases`。Phase 范围从 watchdog 初始化时已加载的 `loopPhases` 配置推导（不是从 payload）：`maxPhase = max(all configured phases)`。**所有使用 phase 范围的场景均改用 maxPhase**：`phase_enter` 越界检查、`phase_complete` 的 pipeline completion 归档触发（`phase_complete(maxPhase)` 时触发 pipeline 结束归档 + clearActiveRun）。Backward compatible：如果 payload 仍含 `totalPhases` 且为有效正整数，仍被接受但不影响 maxPhase（maxPhase 以 loopPhases 推导值为准） | Legacy payload `{ description, totalPhases: 7 }` 被接受，totalPhases 写入 state 但 maxPhase 由 loopPhases 决定。loopPhases 缺失时 maxPhase fallback 见 AC-2 |
| AC-2 | US-4 | Core | **[F-08/F-09/F-15/F-16 fix]** `watchdog.jsonc` 新增 `loopPhases` 字段：LoopType（合法值：`'ralph' \| 'followup'`）做 key，phase 编号数组做 value。例：`{ "ralph": [1,2,3,4,5], "followup": [6,7] }`。初始化时：(1) 校验互斥（同一 phase 不能出现在多个类型中，违反则 config error）(2) 翻转为内部 `{ phase: loopType }` map (3) 校验完整性：所有 phase 1..maxPhase 必须被覆盖，有 gap → config error (4) 校验结构性约束：Phase 4（test code phase）必须为 ralph type（Rule 1 TDD 约束依赖此 phase 有 ralphCompleted），违反 → config error (5) 丢弃原始结构。**Fallback**：缺失 `loopPhases` → 所有 phase 默认 ralph type，maxPhase 从 payload.totalPhases（如有）或默认值 7 推导。**Invalid config**：loopPhases 存在但为空对象 `{}` → config error（hard fail，见 Constraints） | Overlapping phases → config error。Unknown loop type → config error。Phase gap → config error。Phase 4 = followup → config error。Empty loopPhases `{}` → config error。Missing config → fallback: all ralph, maxPhase from totalPhases or default 7 |
| AC-3 | US-4 | Core | **[F-05 fix, F-13 fix, F-48 fix]** `user_approval` 验证使用翻转后的 config map 查当前 phase 的 loop 类型。`ralph` → require `ralphCompleted` + `!ralph.escalated`（ralphCompleted 隐式保证 phaseStatus 已经过 ralph_terminate 到达 `awaiting_approval`）。`followup` → skip `ralphCompleted` AND skip `ralph escalated`（因为没有 ralph loop），**但 require `phaseStatus='active'`**（防御性检查：防止 phase_complete 后重复调用 user_approval 导致 phaseStatus 回归）。Phase 不在 map 中 → reject（configuration error）。LoopType 配置在 watchdog 初始化时一次性加载，整个生命周期内不可变。**Cross-ref**: AC-7 defines which phases use which loop type; AC-13 defines followup phaseStatus lifecycle | LLM 跳过 Phase 3 Ralph loop → `user_approval` 查 loopType="ralph" → rejected。followup phase (e.g., Phase 6) → `user_approval` 不查 `ralphCompleted` 但查 phaseStatus='active' → 不死锁且防回归 |
| AC-4 | US-6 | Core | **[F-19 fix]** `tools.ts` z.enum includes `ralph_round_finding`。`tools.ts` tool description string also lists `ralph_round_finding` in the available event types（LLM 通过 description 发现可用 event） | Currently both enum and description missing `ralph_round_finding`, causing runtime Zod rejection and LLM unawareness |
| AC-12 | US-4 | Core | **[F-14 fix, F-11 fix]** Intercept rule `NO_PHASE_ADVANCE_WITHOUT_GATE` (Rule 2) must be loopType-aware: for `followup` phases, skip `ralphCompleted` check (consistent with AC-3 `user_approval` behavior). Rule 1 (`NO_BUSINESS_CODE_BEFORE_FAILING_TESTS`) checks Phase 4 (test code phase) which is always ralph — no loopType change needed. **Cross-ref**: AC-3 (user_approval), AC-7 (loop type definition) | Phase 6 (followup) 内，写 Phase 7 deliverable 时 Rule 2 检查 phases[6].ralphCompleted=false → currently blocked, should be allowed |
| AC-13 | US-4 | Core | **[F-13/F-14/F-32 fix]** Followup phase 的完整状态转换生命周期。Ralph phase 的 phaseStatus 流程：`active` → (ralph_loop_start) → `ralph_loop` → (ralph_terminate) → `awaiting_approval` → (user_approval) → (phase_complete) → `complete`。**Followup phase 的 phaseStatus 流程**：`active` → (user_approval) → `awaiting_approval` → (phase_complete) → `complete`。关键差异：`user_approval` 对 followup phase 的 apply 行为：(1) 设置 `userApproved=true`（与 ralph phase 相同）(2) 设置 `phaseStatus='awaiting_approval'`（ralph phase 此步是 no-op 因为已经是 `awaiting_approval`，followup phase 从 `active` 直接变为 `awaiting_approval`）。这确保后续的 `phase_complete` 能通过 `phaseStatus === 'awaiting_approval'` 前置条件检查。**Constraint**: 此行为变更不新增 checkpoint event 类型（符合 System Boundaries），仅修改 `user_approval` 的 apply 逻辑使其 loopType-aware | Followup phase user_approval 在 phaseStatus='active' 时被接受（而非仅 awaiting_approval）。Ralph phase 行为不变 |

### Skill File Integration

| # | User Story | Priority | Acceptance Criterion | Edge Cases |
|---|-----------|----------|---------------------|------------|
| AC-5 | US-1 | Core | `pipeline_start` is called once at the beginning with `JSON.stringify({ description: "<feature>" })` | Stale run recovery → present options to user |
| AC-6 | US-1 | Core | `phase_enter` is called at the start of every phase with `JSON.stringify({ phase: N })` | Phase regression rejected by watchdog |
| AC-7 | US-3 | Core | **[F-05 fix]** For `ralph` phases：`ralph_loop_start` → rounds (via `ralph_round_finding` GPAV or `ralph_round_complete` legacy) → `ralph_terminate`。For `followup` phases：no `ralph_loop_start`, no `ralph_terminate`。Followup phase 的完整 checkpoint 序列：`phase_enter(N)` → `[执行工作]` → `user_approval(N)` → `phase_complete(N)`（见 AC-13 phaseStatus 转换）。**Guard**: `ralph_loop_start` 必须检查 loopType — followup phase 调用 `ralph_loop_start` → reject with guidance "Phase N is a followup phase, does not use Ralph loop"。**Cross-ref**: AC-3 uses the same loopType to determine `user_approval` gate; AC-12 extends loopType to intercept-rules; AC-13 defines followup phaseStatus lifecycle | Loop type from config, not hardcoded。LLM 误在 followup phase 调 `ralph_loop_start` → rejected |
| AC-8 | US-3 | Core | `user_approval(N)` then `phase_complete(N)` called **in order** when user approves. Both use `JSON.stringify({ phase: N })`。**[F-40 fix]** `phase_complete` does not directly check `ralphCompleted` — this invariant is guaranteed by the ordered call sequence: `user_approval` (which checks `ralphCompleted` per AC-3's loopType logic) must precede `phase_complete`. For followup phases, `user_approval` skips `ralphCompleted` (per AC-3) and `user_approval` apply sets `phaseStatus='awaiting_approval'` (per AC-13), so `phase_complete` proceeds correctly. **Cross-ref**: AC-13 defines followup phaseStatus transition | User rejection — no checkpoint call。User rejection 后 pipeline 停在 awaiting_approval（或 followup 的 active），直到 stale 或 pipeline_start 重置 |
| AC-9 | US-2 | Core | SKILL.md contains canonical fail-open section："If `tdd_checkpoint` is not available, continue normal execution" | Single source of truth in SKILL.md |
| AC-10 | US-3 | Core | `why_articulation` called after articulation **only for phases configured as ralph type**（具体范围由 AC-2 `loopPhases` 配置决定）with `JSON.stringify({ phase, articulation })`。Followup phases 不调用 `why_articulation`（其工作流程无 articulation 步骤） | Watchdog validates 3 dimensions；consecutive failures trigger degradation。Followup phase 调 why_articulation → accepted（phaseStatus='active' 允许）但不应出现在正常流程中 |
| AC-11 | US-6 | Secondary | `ralph-gpav.md` uses actual tool format：`tdd_checkpoint({ event: "ralph_round_finding", payload: JSON.stringify({...}) })` | Payload must be JSON string, not raw object |

## Constraints & Assumptions
- **源仓库是唯一修改目标**：watchdog 在 `/Users/alex/aristotle/packages/watchdog/`，skill 在 `/Users/alex/tdd-pipeline/`
- **payload 始终是 JSON 字符串**：所有 AC 的 payload 格式为 `JSON.stringify({...})`
- **skill 文件是 LLM 的"业务代码"**：两部分改动都走 TDD pipeline
- **ralph-gpav.md 的 `watchdog.observe(...)` 是伪代码**：需改为实际 `tdd_checkpoint` 格式
- **watchdog 响应类型**：`{ ok: true, state }` → 继续；`{ ok: false, violation, guidance }` → 报告用户并停止；`{ ok: false, recovery: true, staleState, message }` → 呈现恢复选项给用户
- **test_evidence 兼容**：此 event 仍被接受但不 gating（保留是为了 backward compat）。新 pipeline 不应使用此 event
- **trust-based 安全模型**：watchdog 通过链式验证防止跳步，不防止恶意欺骗
- **配置驱动**：loop 类型由 `watchdog.jsonc` 声明，初始化时加载，运行时不可变。修改 loopPhases 需 restart plugin
- **`totalPhases` 废弃**：phase 范围从 `loopPhases` 配置推导，`pipeline_start` 不再需要 `totalPhases`（backward compat 见 AC-1）。所有使用 phase 范围的场景（phase_enter 边界、pipeline completion 归档）均改用从 loopPhases 推导的 maxPhase
- **LoopType 合法值**：`'ralph' | 'followup'`。其他值 → config error
- **Phase 质量机制参考**：ralph phases 使用 Ralph Loop（迭代审查）；followup phases 使用非迭代机制 — Phase 6 使用追问 (followup questions) + user go/no-go，Phase 7 使用 Verification Audit（单次验证，独立 subagent，CONFIRM/DOWNGRADE/REJECT 判定）。两者均非 Ralph loop，正确归入 followup type
- **Config error 行为**：无效 `loopPhases` 配置（overlapping phases、unknown loop type、phase gap、Phase 4 为非-ralph、空对象）→ plugin 初始化失败并报告配置错误（hard fail）。用户必须修正 `watchdog.jsonc` 后 restart plugin。这与 `loopPhases 缺失`（soft fail → fallback all ralph）明确区分

## Open Questions
- Rollback 时之前 phase 的 `phaseRecords` 是否保留？→ 建议：archive 时保留

## Gate: Reviewer Checklist
```
gate_pass = ALL:
  boundaries:     system scope, exclusions, and external deps explicitly defined
  traceability:   all user_stories → traceable to original request
  testability:    every AC testable (binary pass/fail, no subjective language)
  classification: every US + AC ∈ {core, secondary}
  ambiguity:      zero unresolved ambiguities
  edge_cases:     error scenarios + boundary conditions identified
  constraints:    assumptions + limitations explicit
  ralph:          zero C/H/M issues
```

## Ralph Loop Review Log

### Round 1 (R4 — dual-pass Recall + Precision)
- **Recall**: 31 findings (5C, 9H, 10M, 7L)
- **Precision**: 4 confirmed, 27 rejected/downgraded
- **Confirmed findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-05 | **C** | AC-3 和 AC-7 矛盾 → followup phase 死锁 | AC-3 已声明 loopType 分支，但需与 AC-7 显式交叉引用；`ralph_loop_start` 需 loopType 检查拒绝 followup phase |
| F-14 | **H** | intercept-rules 无条件要求 ralphCompleted | 需新增 AC 声明 intercept-rules Rule 1/2 需 loopType-aware |
| F-39 | **M** | AC-3/AC-7 交叉依赖未声明 | 需求文档中显式声明依赖关系 |
| F-40 | **M** | phase_complete 不检查 ralphCompleted 依赖关系不明 | 需明确 phase_complete 对 ralphCompleted 的依赖是通过 user_approval 间接保证 |

- **Contested issues forwarded to R5**: F-05, F-14, F-39, F-40

### R5 Fixes Applied

| Finding | Fix | AC Changed |
|---------|-----|------------|
| F-05 (C) | AC-3 added explicit cross-ref to AC-7; AC-7 added `ralph_loop_start` guard for followup phases | AC-3, AC-7 |
| F-14 (H) | New AC-12: intercept-rules loopType-aware requirement | AC-12 (new) |
| F-39 (M) | AC-3 and AC-7 now have explicit cross-reference declarations; AC-12 cross-refs AC-3/AC-7 | AC-3, AC-7, AC-12 |
| F-40 (M) | AC-8 now explicitly states `phase_complete` ralphCompleted dependency chain through `user_approval` | AC-8 |

### Round 2 (R5 — dual-pass Recall + Precision)
- **Recall**: 35 findings (4C, 10H, 12M, 5L)
- **Precision**: 10 confirmed, 25 rejected/downgraded (误报率 71%)
- **Confirmed findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-13 | **H** | followup phase 的 user_approval 前置条件未定义 — 需跳过 ralphCompleted + escalated | AC-3 扩展：followup skip ralphCompleted AND escalated |
| F-14 | **H** | followup phase 无法从 active → awaiting_approval（状态机死胡同） | 新增 AC-13：定义 followup phaseStatus 生命周期 |
| F-08 | M | loopPhases 配置不完整时行为未定义 | AC-2 增加完整性校验：所有 1..maxPhase 必须被覆盖 |
| F-09 | M | loopPhases 缺失时 fallback 语义矛盾 | AC-2 明确 fallback：all ralph + maxPhase from totalPhases or default 7 |
| F-15 | M | 合法 loop type 值未枚举 | Principle 2 + Constraints 明确 LoopType = 'ralph' \| 'followup' |
| F-16 | M | 示例中 Phase 7=ralph 但 Phase 7 无 Ralph loop | AC-2 示例改为 `{ "ralph": [1,2,3,4,5], "followup": [6,7] }` |
| F-19 | M | tools.ts description 也缺 ralph_round_finding | AC-4 扩展：enum + description |
| F-24 | M | followup 是否需要 articulation 未声明 | AC-10 明确：only for ralph phases |
| F-32 | M | followup phaseStatus 生命周期未定义 | 被 AC-13 覆盖 |
| F-35 | M | loopPhases 与 pipeline_start 时序 | Principle 2 + Constraints 明确：init 时加载，不可变 |

### R6 Fixes Applied

| Finding | Fix | AC Changed |
|---------|-----|------------|
| F-13 (H) | AC-3 扩展：followup skip ralphCompleted AND escalated | AC-3 |
| F-14 (H) | New AC-13：定义 followup phaseStatus 生命周期（active → user_approval → awaiting_approval → phase_complete） | AC-13 (new) |
| F-08 (M) | AC-2 增加完整性校验 | AC-2 |
| F-09 (M) | AC-2 明确 fallback 语义 | AC-2 |
| F-15 (M) | Principle 2 + Constraints 列出合法 LoopType 枚举 | Principle 2, Constraints |
| F-16 (M) | AC-2 示例修正 | AC-2 |
| F-19 (M) | AC-4 扩展含 description | AC-4 |
| F-24 (M) | AC-10 明确仅 ralph phases 调 articulation | AC-10 |
| F-32 (M) | 被 AC-13 完全覆盖 | AC-13 |
| F-35 (M) | Principle 2 + Constraints 明确时序 | Principle 2, Constraints |

### Round 3 (R6 — Recall only, no Precision needed)
- **Recall**: 6 findings (0C, 0H, 3M, 2L, 1I)
- **All R2 fixes verified**: ✅ 10/10 resolved, no new contradictions
- **Confirmed findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-41 | M | maxPhase 替换 totalPhases 时遗漏 pipeline completion 归档触发点 | AC-1 明确所有 phase 范围场景均用 maxPhase |
| F-43 | M | Principle 1 声称 rollback 可从任意 phase 开始，但 AC 只支持从 Phase 1 | Principle 1 + US-5 修正为实际行为 |
| F-44 | M | config error 行为后果未定义（hard fail vs soft fail） | Constraints 明确：invalid → hard fail，missing → soft fail |
| F-42 | L | AC-10 "by default config" 含义歧义 | 改为 "configured as ralph type per AC-2" |
| F-46 | L | loopPhases 存在但为空对象 `{}` 时行为未定义 | AC-2 补充：empty → config error |
| F-45 | I | AC-3 包含实现细节 "注入 validate 函数" | 改为纯行为描述 |

- **Consecutive-zero C/H count**: 1 (R3 = 0C/0H)

### R7 Fixes Applied

| Finding | Fix | AC/Section Changed |
|---------|-----|--------------------|
| F-41 (M) | AC-1 明确所有 phase 范围场景（含 pipeline completion 归档）均用 maxPhase | AC-1, Constraints |
| F-43 (M) | Principle 1 + US-5 修正为 "rollback 从 Phase 1 重新开始" | Principle 1, US-5 |
| F-44 (M) | Constraints 新增 config error 行为：invalid → hard fail，missing → soft fail | Constraints |
| F-42 (L) | AC-10 改为 "phases configured as ralph type per AC-2" | AC-10 |
| F-46 (L) | AC-2 补充 empty loopPhases → config error | AC-2 |
| F-45 (I) | AC-3 "注入 validate 函数" 改为纯行为描述 | AC-3 |

### Round 4 (R7 — Recall only)
- **Recall**: 2 findings (0C, 0H, 2M, 0L, 0I)
- **All R3 fixes verified**: ✅ 6/6 resolved, no regressions
- **Consecutive-zero C/H count**: 2 (R3 + R4) → **EARLY STOP, GATE PASSED**
- **Confirmed findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-47 | M | Rule 1 假设 Phase 4 始终 ralph，但 AC-2 允许任意配置 | AC-2 增加结构性约束：Phase 4 必须 ralph |
| F-48 | M | followup phase user_approval 无 phaseStatus 前置条件，可导致回归 | AC-3 增加 followup require phaseStatus='active' |

### R8 Fixes Applied (post-gate)

| Finding | Fix | AC Changed |
|---------|-----|------------|
| F-47 (M) | AC-2 增加校验步骤 (4)：Phase 4 必须 ralph，否则 config error | AC-2 |
| F-48 (M) | AC-3 增加 followup phase require phaseStatus='active' | AC-3 |

### Round 5 (R8 — Recall only)
- **Recall**: 1 finding (0C, 0H, 0M, 1L, 0I)
- **All R4 fixes verified**: ✅ F-47/F-48 resolved, no regressions, all cross-refs consistent
- **Consecutive-zero C/H/M count**: 1 (R5 = 0C/0H/0M)
- **F-49 (L)**: Constraints config error 列表遗漏 Phase 4 非-ralph 条件 → fixed

### R9 Fixes Applied (post-R5)

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| F-49 (L) | Constraints config error 列表增加 "Phase 4 为非-ralph" | Constraints |

### Round 6 (R9 — Recall only, verification round)
- **Recall**: 1 finding (0C, 0H, 0M, 0L, 1I)
- **All R5 fixes verified**: ✅ F-49 resolved
- **Full scan**: all 13 AC cross-refs consistent, Principles/Constraints/US aligned
- **Consecutive-zero C/H/M count**: 2 (R5 + R6) → **EARLY STOP, GATE PASSED**
- **F-50 (I)**: 文档 header 元数据未同步（已修复）

---

## Gate Decision

**PASSED** at Round 6 (R9).

- Total review rounds: 6
- Cumulative findings: R1=4 (1C/1H/2M) → R2=10 (2H/8M) → R3=6 (3M/2L/1I) → R4=2 (2M) → R5=1 (1L) → R6=1 (1I)
- Consecutive 0C/0H/0M: R5 + R6 = 2 rounds → early stop threshold met
- Final AC count: 13 (AC-1 through AC-13)
- Zero unresolved C/H/M/L issues
