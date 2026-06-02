# Phase 3 补充：Schema 契约测试 + 设计语义断言测试

> 本文档补充 Phase3-ModuleA/B/C.md 中遗漏的测试维度。
> **教训来源**：重建后代码通过 352 个行为测试，但 Oracle 审查发现 4H+2M 偏差。
> **根因**：测试方案只覆盖行为正确性，未覆盖契约一致性和设计语义。

---

## 1. Schema 契约测试（SC 系列）

### SC-1: CheckpointEvent 类型联合完整性
**验证**: `why_articulation` 存在于 `CheckpointEvent` 联合类型中。
**设计依据**: §4.1 line 436 — `| 'why_articulation' // ← NEW: Module C event`
**方法**: 编译时检查 + 运行时值覆盖检查。

```typescript
it('SC-1: CheckpointEvent includes why_articulation', () => {
  const events: CheckpointEvent[] = [
    'pipeline_start', 'phase_enter', 'ralph_loop_start',
    'ralph_round_complete', 'ralph_terminate', 'test_evidence',
    'user_approval', 'phase_complete', 'why_articulation',
  ]
  // 编译时：如果 why_articulation 不在联合中，TypeScript 报错
  // 运行时：确保所有事件值都能赋给 CheckpointEvent
  expect(events).toContain('why_articulation')
})
```

### SC-2: articulationDimensions 类型结构匹配
**验证**: `PhaseRecord.articulationDimensions` 是 boolean map，不是 string 数组。
**设计依据**: §4.1 lines 484-488:
```typescript
articulationDimensions?: {
  what_it_protects: boolean
  key_risks: boolean
  why_approach_works: boolean
}
```
**方法**: 验证 schema 类型的键与 `validateArticulation` 返回的键一致。

```typescript
it('SC-2: articulationDimensions matches validateArticulation output shape', () => {
  const result = validateArticulation('test protects X. key risk is Y. approach works because Z.')
  // result.dimensions 应该是 { what_it_protects: boolean, key_risks: boolean, why_approach_works: boolean }
  expect(result.dimensions).toHaveProperty('what_it_protects')
  expect(result.dimensions).toHaveProperty('key_risks')
  expect(result.dimensions).toHaveProperty('why_approach_works')
  expect(typeof result.dimensions.what_it_protects).toBe('boolean')
  expect(typeof result.dimensions.key_risks).toBe('boolean')
  expect(typeof result.dimensions.why_approach_works).toBe('boolean')
})
```

### SC-3: ObservationEntry.tool 字段命名一致性
**验证**: Observer 写入的字段名与 ObservationEntry schema 定义一致。
**设计依据**: §6.2 — observer writes `tool`, schema must define `tool`.
**方法**: 验证 mock 调用的 entry 对象包含 `tool` 字段（非 `toolName`）。

```typescript
it('SC-3: observation entry uses "tool" field matching schema', () => {
  // 通过 observer.test.ts 已有的 mock 断言间接验证
  // 此处显式验证 schema 定义和 observer 输出使用相同字段名
  const entry: ObservationEntry = {
    timestamp: '2026-01-01', runId: 'r', projectId: 'p',
    sessionId: 's', type: '_reviewer_spawned',
    tool: 'Task', callID: 'c1', round: 1,
  }
  expect(entry).toHaveProperty('tool')
  expect(entry).not.toHaveProperty('toolName')
})
```

---

## 2. 设计语义断言测试（SA 系列）

### SA-1: phase_complete(5) 调用 observer.clearDegradation
**验证**: pipeline 完成时清理内存中的降级状态。
**设计依据**: §5.4 line 975 — "It also calls `observer.clearDegradation(projectId, runId)` on `phase_complete(5)`"
**前置**: Pipeline 需要经历完整流程到 phase 5。

```typescript
it('SA-1: phase_complete(5) calls observer.clearDegradation', async () => {
  const mockObserver = createMockObserver()
  // ... 通过 checkpoint handler 推进 pipeline 到 phase_complete(5)
  handler = new CheckpointHandler(store, STALE_THRESHOLD_MS, cache, mockObserver)
  // pipeline_start → phase_enter(1) → ... → phase_complete(5)
  // 验证: mockObserver.clearDegradation 被调用
  expect(mockObserver.clearDegradation).toHaveBeenCalledWith(projectId, runId)
})
```

### SA-2: why_articulation 失败时审计 decision 为 PASS
**验证**: articulation 内容验证失败时，审计仍记 PASS（状态已写入）。
**设计依据**: §8.5 line 2640 — "The audit entry is `decision: 'PASS'` because state preconditions passed and `PhaseRecord` was mutated. This preserves Phase 1's invariant: `PASS` = state was written (AC-5)."

```typescript
it('SA-2: why_articulation failure records audit PASS (state WAS written)', async () => {
  // ... 推进到 phase 1 active
  const result = await handler.handle('why_articulation', { phase: 1, articulation: 'bad' }, 'proj', 'sess')
  // ok: false (articulation failed)
  expect(JSON.parse(result).ok).toBe(false)
  // 但 audit decision 是 PASS（状态已写入）
  expect(mockStore.appendAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ decision: 'PASS' }),
  )
})
```

### SA-3: SESSION_BUFFER_MAX_SIZE 常量存在且值为 1000
**验证**: 默认值常量已导出。
**设计依据**: §4.2 — `SESSION_BUFFER_MAX_SIZE = 1000`.

```typescript
it('SA-3: SESSION_BUFFER_MAX_SIZE is exported as 1000', () => {
  expect(SESSION_BUFFER_MAX_SIZE).toBe(1000)
})
```

---

## 3. 测试文件归属

| 测试 ID | 归属文件 | 原因 |
|---------|----------|------|
| SC-1 | `schema-contract.test.ts`（新建） | 纯类型/schema 测试，不属于任何模块 |
| SC-2 | `articulation.test.ts` | 涉及 validateArticulation 返回值 |
| SC-3 | `observer.test.ts` | 涉及 Observer 输出格式 |
| SA-1 | `checkpoint-phase2.test.ts` | 涉及 CheckpointHandler 行为 |
| SA-2 | `checkpoint-phase2.test.ts` | 涉及 CheckpointHandler 审计语义 |
| SA-3 | `session-buffer.test.ts` | 涉及 SessionBuffer 默认配置 |

---

## 4. 设计文档显式约束索引

以下是从设计文档中提取的、必须有对应断言的"必须"类约束：

| # | 设计文档约束 | 位置 | 对应测试 |
|---|-------------|------|---------|
| 1 | CheckpointEvent 包含 why_articulation | §4.1 L436 | SC-1 |
| 2 | articulationDimensions 是 boolean map | §4.1 L484-488 | SC-2 |
| 3 | ObservationEntry 字段名与 observer 输出一致 | §6.2 | SC-3 |
| 4 | phase_complete(5) 调用 observer.clearDegradation | §5.4 L975 | SA-1 |
| 5 | 审计 decision 为 PASS（articulation 失败时） | §8.5 L2640 | SA-2 |
| 6 | SESSION_BUFFER_MAX_SIZE = 1000 | §4.2 | SA-3 |
| 7 | phase_enter PhaseRecord 包含 articulation 字段默认值 | §8.4 L2567 | SC-4 |
| 8 | articulationDimensions schema 类型定义与运行时一致 | §4.1 L484-488 | SC-2 补充 |

---

## 5. Oracle Review 发现的额外约束（v1.1 补充）

Oracle 审查 (0C/0H/2M/3L) 发现 2 个额外的设计约束未被覆盖：

### SC-4: phase_enter PhaseRecord 包含 articulation 字段默认值
**验证**: `phase_enter(N)` 创建的 PhaseRecord 包含 `articulationAttempted: false` 等默认值。
**设计依据**: §8.4 L2567 — "Phase 1's `phase_enter` applyTransition must be updated to initialize the 3 new articulation fields with false defaults"
**注意**: 当前实现中字段为 optional（undefined ≡ false），运行时等价。但严格相等检查 `=== false` 会区分"未初始化"和"未尝试"。

```typescript
it('SC-4: phase_enter initializes articulation fields with defaults', () => {
  const state = applyTransition('phase_enter', { phase: 1, _now: NOW }, baseState)
  const rec = state.phases[1]
  // Design requires explicit defaults, not optional undefined
  expect(rec).toHaveProperty('articulationAttempted')
  expect(rec).toHaveProperty('articulationVerified')
  expect(rec).toHaveProperty('articulationDegraded')
})
```

**归属文件**: `transitions.test.ts`

### SC-2 补充: schema 类型编译时覆盖
**说明**: SC-2 的运行时测试正确，但设计文档的 M-1 发现指出，如果 `schema.ts` 中的类型定义从 boolean map 回退到 `ArticulationDimension[]`，SC-2 运行时测试仍会通过（因为只检查运行时数据）。需要在 CI 中加入 `tsc --noEmit` 编译检查，或添加显式类型断言测试。
