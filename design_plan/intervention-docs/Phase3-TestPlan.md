# Phase 3 Test Plan: Watchdog Active Monitoring + Pre-execution Verification

**Version**: 1.0
**Status**: Draft
**Based On**: Phase2-ActiveMonitoring.md (v1.0-draft, 2026-05-13)
**Phase 1 Baseline**: 106 tests passing (checkpoint.test.ts, transitions.test.ts, pipeline-store.test.ts, project-id.test.ts)

---

## Part 1: Implementation Dependency Graph

Implementation order -- lower numbers must be complete before higher numbers can be built or tested.

### Tier 0: Core Package Changes (Foundation)

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 1 | `packages/core/src/plugin/registration.ts` | **Updated** | None (base infra) | `PluginOutput` extended with `"tool.execute.before"`/`"tool.execute.after"`; `RoleRegistration.onToolBefore` signature changed to `Promise<void>` + `callID` param; `RoleRegistration.onToolAfter` gains `callID` param; `assemblePlugin` global hook dispatch | All integration tests; Module A onToolAfter; Module B onToolBefore |

### Tier 1: Schema & Constants (Shared Types)

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 2 | `packages/watchdog/src/schema.ts` | **Updated** | None | Add `'why_articulation'` to `CheckpointEvent`; add `ownerSessionId?: string` to `PipelineState`; add `articulationVerified`, `articulationDimensions`, `articulationAttempted`, `articulationDegraded` to `PhaseRecord`; new `ObservationEntry` interface; new `OBS_TYPE_REVIEWER_SPAWNED` constant | All Phase 2 tests |
| 3 | `packages/watchdog/src/constants.ts` | **Updated** | None | Add `ARTICULATION_MAX_FAILURES = 3`; add `SESSION_BUFFER_MAX_SIZE = 1000` | Module A SessionBuffer tests; Module C degradation tests |

### Tier 2: Shared Infrastructure (No External Dependencies)

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 4 | `packages/watchdog/src/state-cache.ts` | **NEW** | schema.ts (#2) | `PipelineStateCache` class: `get()`, `update()`, `clear()` | Module A observer tests; Module B interceptor tests; Module C checkpoint tests; integration tests |
| 5 | `packages/watchdog/src/session-buffer.ts` | **NEW** | constants.ts (#3) | `SessionBuffer` class: `record()`, `getSession()`, `clearSession()`, `sessionCount()` | Module A SessionBuffer tests |
| 6 | `packages/watchdog/src/watchdog-config.ts` | **NEW** | None (pure functions) | `loadWatchdogConfig()`, `stripJsonComments()`, `FALLBACK_PATTERNS`, `DEFAULT_MONITORED_TOOLS` | Module B config tests |
| 7 | `packages/watchdog/src/articulation.ts` | **NEW** | None (pure function) | `validateArticulation(text): ArticulationResult` | Module C articulation tests |
| 8 | `packages/watchdog/src/path-extractor.ts` | **NEW** | None (pure function) | `extractFilePath(tool, args): string \| null` | Module B PathExtractor tests |
| 9 | `packages/watchdog/src/file-classifier.ts` | **NEW** | None (pure function) | `classifyFile(absolutePath, deliverablePatterns, ignorePatterns): FileClassification` | Module B FileClassifier tests |
| 10 | `packages/watchdog/src/intercept-rules.ts` | **NEW** | file-classifier.ts (#9), schema.ts (#2) | `InterceptRule` interface; Rule 1; Rule 2 | Module B Rule tests |

### Tier 3: Module Components

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 11 | `packages/watchdog/src/interceptor.ts` | **NEW** | state-cache.ts (#4), path-extractor.ts (#8), file-classifier.ts (#9), intercept-rules.ts (#10) | `Interceptor.handle()`; `WatchdogInterceptError` | Module B interceptor tests |
| 12 | `packages/watchdog/src/observer.ts` | **NEW** | state-cache.ts (#4), session-buffer.ts (#5), schema.ts (#2) | `Observer.handle()`, `isDegraded()`, `clearDegradation()` | Module A observer tests; AC-2 tests |
| 13 | `packages/watchdog/src/transitions.ts` | **Updated** | schema.ts (#2) | Add `why_articulation` validation/apply cases; update `phase_enter` init; update `pipeline_start` owner | Module C transitions tests |
| 14 | `packages/watchdog/src/pipeline-store.ts` | **Updated** | schema.ts (#2) | Add `appendObservation()`, `readObservations()`, `findObservations()` | Module A observer tests; AC-2 tests |

### Tier 4: Orchestrator

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 15 | `packages/watchdog/src/checkpoint.ts` | **Updated** | pipeline-store.ts (#14), transitions.ts (#13), observer.ts (#12), state-cache.ts (#4), articulation.ts (#7) | Constructor gains `cache` and `observer`; ownership check; AC-2; why_articulation; degradation | Module C checkpoint tests; AC-2; ownership |
| 16 | `packages/watchdog/src/index.ts` | **Updated** | All above | `createWatchdogRole()`: wire all new components | Integration tests |

---

## Part 2: Phase 1 Migration Verification

### 2.1 Core `registration.ts` Changes

#### Change 1: `RoleRegistration.onToolBefore` Return Type

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| Return type | `Promise<string \| null>` | `Promise<void>` |
| `callID` param | absent | present (4th param) |
| Blocking | Return non-null = intercept | Throw = block |

**Affected Phase 1 tests**: None -- no tests exercise `onToolBefore`.

#### Change 2: `RoleRegistration.onToolAfter` Signature

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| Params | 4 | 5 (+callID) |

**Affected Phase 1 tests**: None.

#### Change 3: `PluginOutput` Type Extension

Adds `"tool.execute.before"` and `"tool.execute.after"` keys.

**Affected Phase 1 tests**: None.

### 2.2 `schema.ts` Changes

#### Change 4: `CheckpointEvent` -- add `'why_articulation'`

**Affected**: `transitions.test.ts` -- no hardcoded count. **No update needed**.

#### Change 5: `PipelineState` -- add `ownerSessionId?: string`

**Affected**: None -- field is optional, existing `makeState()` helpers don't need it.

#### Change 6: `PhaseRecord` -- add 3 articulation fields

**Affected**:
- `transitions.test.ts` line 676-683: **MUST UPDATE** -- `phase_enter` test expects exact `PhaseRecord` shape. Add `articulationVerified: false`, `articulationAttempted: false`, `articulationDegraded: false`.
- `checkpoint.test.ts` -- TypeScript allows extra props. **No update needed**.
- `pipeline-store.test.ts` -- same. **No update needed**.

#### Change 7: `ObservationEntry` -- NEW interface

**Affected**: None (new type).

### 2.3 `transitions.ts` Changes

#### Change 8: `validateTransition` -- new `why_articulation` case

**Affected**: None -- no existing tests call this event.

#### Change 9: `applyTransition` -- `pipeline_start` sets `ownerSessionId`

**Affected**: `transitions.test.ts` line 653-669 -- test checks `newState` properties but doesn't assert absence of `ownerSessionId`. If `payload._ownerSessionId` missing, value is `undefined` which is valid (backward compat). **No update needed**.

#### Change 10: `applyTransition` -- `phase_enter` initializes articulation fields

**Affected**: `transitions.test.ts` line 676-683:
```typescript
expect(newState.phases[1]).toEqual({
  phase: 1,
  enteredAt: NOW,
  ralphCompleted: false,
  ralphTermination: null,
  userApproved: false,
  approvedAt: null,
  // MUST ADD:
  articulationVerified: false,
  articulationAttempted: false,
  articulationDegraded: false,
})
```

### 2.4 `checkpoint.ts` Changes

#### Change 11: Constructor signature

| Phase 1 | Phase 2 |
|---------|---------|
| `new CheckpointHandler(store, staleThresholdMs)` | `new CheckpointHandler(store, staleThresholdMs, cache, observer)` |

**Affected**: `checkpoint.test.ts` line 97 -- **MUST UPDATE** if params required.

**Recommendation**: Make `cache` and `observer` optional:
```typescript
constructor(store, staleThresholdMs, cache?, observer?)
```
This preserves Phase 1 compatibility.

#### Change 12-15: New branches in `handle()`

- `why_articulation` handling -- no existing tests
- AC-2 enforcement -- guard with `if (this.observer)` to skip when absent
- Ownership check -- skipped when `ownerSessionId` undefined
- Cache update -- skipped when `cache` absent

**Affected**: None if params optional.

### 2.5 `pipeline-store.ts` Changes

New observation methods -- **No affected tests**.

### 2.6 `index.ts` Changes

Returns `{ tools, onToolBefore, onToolAfter }` -- no test coverage in Phase 1.

### 2.7 `constants.ts` Changes

New constants -- **No affected tests**.

### 2.8 Summary: Phase 1 Test Impact

| Test File | Tests | Affected? | Updates Needed |
|-----------|-------|-----------|----------------|
| `test/checkpoint.test.ts` | ~25 | Maybe | Constructor if params required |
| `test/transitions.test.ts` | ~45 | Yes | `phase_enter` test: add 3 articulation fields |
| `test/pipeline-store.test.ts` | ~25 | No | None |
| `test/project-id.test.ts` | ~5 | No | None |
| **Total** | **~100** | **1 file** | **~1 assertion** |

---

## Part 3: Test Cases

### Module A: Event Observation

#### TC-A-01: Task call with active pipeline in ralph_loop

**Source**: §6.7
**Priority**: Key
**Preconditions**: Mock cache returns ralph_loop state with round=2
**Input**: `observer.handle('Task', {prompt:'review'}, 'out', 'sess-001', 'call-123')`
**Expected**: `store.appendObservation` called with `type='_reviewer_spawned'`, `round=3`, `callID='call-123'`
**Covers**: AC-1, §6.2

#### TC-A-02: Task call without active pipeline

**Source**: §6.7
**Priority**: Key
**Preconditions**: Mock cache returns null
**Input**: `observer.handle('Task', {prompt:'review'}, 'out', 'sess-001', 'call-124')`
**Expected**: `sessionBuffer.record` called with tool='Task', callID='call-124'
**Covers**: AC-10, §6.2

#### TC-A-03: Non-Task call (edit)

**Source**: §6.7
**Priority**: Key
**Input**: `observer.handle('edit', {filePath:'foo.ts'}, 'ok', 'sess-001', 'call-125')`
**Expected**: No observation recorded
**Covers**: §6.2

#### TC-A-04: Multiple Task calls in same round

**Source**: §6.7
**Priority**: Key
**Input**: Three `observer.handle('Task', ...)` calls with same state
**Expected**: Three appendObservation calls, all with same round
**Covers**: AC-1

#### TC-A-05: Task call with active pipeline NOT in ralph_loop

**Source**: §6.7
**Priority**: Key
**Preconditions**: cache returns state with phaseStatus='active'
**Input**: `observer.handle('Task', {}, 'out', 'sess-001', 'call-126')`
**Expected**: No observation recorded
**Covers**: §6.2

#### TC-A-06: handle() throws during ralph_loop -- dual-channel degradation

**Source**: §6.7
**Priority**: Key
**Preconditions**: cache.get() throws Error('disk read failed')
**Input**: `observer.handle('Task', {}, 'out', 'sess-001', 'call-127')`
**Expected**: No throw from handle(); isDegraded() returns true; store has `_observer_degraded` entry
**Covers**: AC-2 degradation, §6.2

#### TC-A-07: AC-2 -- round complete with matching observation

**Source**: §6.7
**Priority**: Key
**Preconditions**: findObservations returns 1 entry for round 2; isDegraded returns false
**Input**: `handler.handle('ralph_round_complete', '{phase:1,round:2,tally:{C:0,H:0,M:0,L:0,I:0}}', CONTEXT)`
**Expected**: Returns ok=true
**Covers**: AC-2, §6.4

#### TC-A-08: AC-2 -- round complete without observation

**Source**: §6.7
**Priority**: Key
**Preconditions**: findObservations returns []; isDegraded returns false
**Input**: Same as TC-A-07
**Expected**: Returns ok=false, violation='Round 2 completed without a reviewer subagent'
**Covers**: AC-2, §6.4

#### TC-A-09: AC-2 -- observer degraded, skip check

**Source**: §6.7
**Priority**: Key
**Preconditions**: isDegraded returns true
**Input**: Same as TC-A-07
**Expected**: Returns ok=true, warning logged about AC-2 skip
**Covers**: AC-2 degradation, §6.4

#### TC-A-10: AC-2 -- observation for wrong round

**Source**: §6.7
**Priority**: Key
**Preconditions**: findObservations for round 2 returns []; round 3 has observation
**Input**: `handler.handle('ralph_round_complete', '{phase:1,round:2,...}', CONTEXT)`
**Expected**: Returns ok=false (round mismatch)
**Covers**: AC-2, §6.4

#### TC-A-11: Dual-channel degradation -- crash sets flag + persists entry

**Source**: §6.7
**Priority**: Key
**Input**: Force cache.get() to throw in observer.handle()
**Expected**: isDegraded returns true; store has `_observer_degraded` entry with metadata.error
**Covers**: §6.2

#### TC-A-12: isDegraded -- true for degraded round, false otherwise

**Source**: §6.7
**Priority**: Key
**Expected**: After degradation for round 2: isDegraded(proj,run,2)=true, isDegraded(proj,run,3)=false
**Covers**: §6.2

#### TC-A-13: clearDegradation removes both channels

**Source**: §6.7
**Priority**: Key
**Input**: `observer.clearDegradation('proj-1','run-1')`
**Expected**: isDegraded returns false for previously degraded round
**Covers**: §6.2

#### TC-A-14: Persisted entry readable by downstream

**Source**: §6.7
**Priority**: Key
**Input**: `store.readObservations('proj-1','run-1')`
**Expected**: Contains entry with `type='_observer_degraded'`
**Covers**: §6.2

#### TC-A-15: SessionBuffer -- record within bounds

**Source**: §6.7
**Priority**: Peripheral
**Input**: Record 2 entries for same session
**Expected**: getSession returns array of length 2
**Covers**: AC-10, §6.3

#### TC-A-16: SessionBuffer -- overflow FIFO eviction

**Source**: §6.7
**Priority**: Peripheral
**Input**: Record 1001 entries (SESSION_BUFFER_MAX_SIZE=1000)
**Expected**: getSession returns 1000 entries; oldest evicted
**Covers**: §6.3

#### TC-A-17: SessionBuffer -- clearSession

**Source**: §6.7
**Priority**: Peripheral
**Input**: `sessionBuffer.clearSession('sess-001')`
**Expected**: getSession returns []
**Covers**: §6.3

#### TC-A-18: SessionBuffer -- multiple sessions isolated

**Source**: §6.7
**Priority**: Peripheral
**Input**: Record entries for sess-A and sess-B
**Expected**: Each session has its own buffer; sessionCount=2
**Covers**: §6.3

#### TC-A-19: Integration -- full pipeline flow with observations

**Source**: §6.7
**Priority**: Key
**Input**: pipeline_start -> phase_enter(1) -> ralph_loop_start(1) -> Task call -> ralph_round_complete(1)
**Expected**: Observation recorded; round completes with ok=true
**Covers**: AC-1, AC-2, §6.4

#### TC-A-20: Integration -- crash recovery observation loss

**Source**: §6.7
**Priority**: Peripheral
**Input**: Observer crashes, then round complete
**Expected**: ok=true (AC-2 skipped); degradation persisted
**Covers**: AC-2 degradation

#### TC-A-21: Integration -- downstream reads persisted entry

**Source**: §6.7
**Priority**: Key
**Input**: `store.findObservations(..., {type:'_observer_degraded'})`
**Expected**: Returns degraded entries
**Covers**: §6.2

#### TC-A-22: isDegraded returns false for non-degraded round

**Source**: §6.7
**Priority**: Key
**Expected**: Fresh observer: isDegraded(any) returns false
**Covers**: §6.2

#### TC-A-23: Degradation tracking itself fails -- no unhandled exception

**Source**: §6.7
**Priority**: Key
**Preconditions**: cache.get() throws in both outer and inner try
**Input**: `observer.handle('Task',{},'out','sess-001','call-202')`
**Expected**: No throw; original error logged
**Covers**: §6.2

---

### Module B: File Interception

#### TC-B-01 (#1): Non-monitored tool returns without reading cache

**Source**: §7.8 #1
**Priority**: Key
**Preconditions**: monitoredTools=['edit','write']
**Input**: `interceptor.handle('read', {filePath:'foo.ts'}, 'sess-001', 'call-300')`
**Expected**: Returns normally; cache.get NOT called
**Covers**: C-3, §7.2

#### TC-B-02 (#2): Monitored tool with null cache returns silently

**Source**: §7.8 #2
**Priority**: Key
**Preconditions**: cache returns null
**Input**: `interceptor.handle('edit', {filePath:'foo.ts'}, 'sess-001', 'call-301')`
**Expected**: Returns normally
**Covers**: AC-8, §7.2

#### TC-B-03 (#3): PathExtractor -- edit with filePath

**Source**: §7.8 #3
**Priority**: Peripheral
**Input**: `extractFilePath('edit', {filePath: 'src/foo.ts'})`
**Expected**: Returns 'src/foo.ts'
**Covers**: OQ-3, §7.3

#### TC-B-04 (#4): PathExtractor -- write with file

**Source**: §7.8 #4
**Priority**: Peripheral
**Input**: `extractFilePath('write', {file: 'src/bar.ts'})`
**Expected**: Returns 'src/bar.ts'
**Covers**: OQ-3, §7.3

#### TC-B-05 (#5): PathExtractor -- edit with empty args returns null

**Source**: §7.8 #5
**Priority**: Peripheral
**Input**: `extractFilePath('edit', {})`
**Expected**: Returns null
**Covers**: §7.3

#### TC-B-06 (#6): FileClassifier -- src directory -> business_code

**Source**: §7.8 #6
**Priority**: Key
**Input**: `classifyFile('/project/src/utils/helper.ts', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'business_code'}
**Covers**: Rule 3, C-4, §7.4

#### TC-B-07 (#7): FileClassifier -- tests directory -> test_file

**Source**: §7.8 #7
**Priority**: Key
**Input**: `classifyFile('/project/tests/auth.test.ts', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'test_file'}
**Covers**: Rule 1, C-4, §7.4

#### TC-B-08 (#8): FileClassifier -- technical-spec.md -> phase_deliverable(2)

**Source**: §7.8 #8
**Priority**: Key
**Input**: `classifyFile('/project/docs/technical-spec.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'phase_deliverable', phase: 2}
**Covers**: Rule 4, C-4, §7.4

#### TC-B-09 (#9): FileClassifier -- random.md -> unknown

**Source**: §7.8 #9
**Priority**: Key
**Input**: `classifyFile('/project/random.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'unknown'}
**Covers**: Rule 5, §7.4

#### TC-B-10 (#9a): FileClassifier -- prd-v2.md -> phase_deliverable(1)

**Source**: §7.8 #9a
**Priority**: Key
**Input**: `classifyFile('/project/docs/prd-v2.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'phase_deliverable', phase: 1}
**Covers**: Rule 4, §7.4

#### TC-B-11 (#9b): FileClassifier -- user-stories.md -> phase_deliverable(1)

**Source**: §7.8 #9b
**Priority**: Key
**Input**: `classifyFile('/project/docs/user-stories.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'phase_deliverable', phase: 1}
**Covers**: Rule 4, §7.4

#### TC-B-12 (#9c): FileClassifier -- ignorePatterns override

**Source**: §7.8 #9c
**Priority**: Key
**Preconditions**: ignorePatterns=['technical-notes.md']
**Input**: `classifyFile('/project/docs/technical-notes.md', FALLBACK_PATTERNS, ['technical-notes.md'])`
**Expected**: {category: 'unknown'}
**Covers**: Rule 0, §7.4

#### TC-B-13 (#9d): FileClassifier -- custom config override

**Source**: §7.8 #9d
**Priority**: Key
**Input**: `classifyFile('/project/api-design.md', {2: ['api-design*.md']}, [])`
**Expected**: {category: 'phase_deliverable', phase: 2}
**Covers**: Config override, §7.4

#### TC-B-14 (#10): Rule 1 -- Phase 4, no evidence, business code -> throws

**Source**: §7.8 #10
**Priority**: Key
**Preconditions**: currentPhase=4, testEvidenceConfirmed=false
**Input**: `interceptor.handle('edit', {filePath: '/project/src/foo.ts'}, 'sess-001', 'call-302')`
**Expected**: Throws WatchdogInterceptError with "business code write blocked"
**Covers**: AC-3, Rule 1, §7.5

#### TC-B-15 (#11): Rule 1 -- Phase 4, evidence confirmed, business code -> allows

**Source**: §7.8 #11
**Priority**: Key
**Preconditions**: testEvidenceConfirmed=true
**Input**: Same file path as TC-B-14
**Expected**: Returns normally
**Covers**: AC-3 edge, §7.5

#### TC-B-16 (#12): Rule 1 -- Phase 4, no evidence, test file -> allows

**Source**: §7.8 #12
**Priority**: Key
**Preconditions**: testEvidenceConfirmed=false, file is test_file
**Input**: `interceptor.handle('edit', {filePath: '/project/tests/foo.test.ts'}, 'sess-001', 'call-304')`
**Expected**: Returns normally
**Covers**: AC-3 edge, §7.5

#### TC-B-17 (#13): Rule 2 -- Phase 2 incomplete, Phase 3 deliverable -> throws

**Source**: §7.8 #13
**Priority**: Key
**Preconditions**: currentPhase=2, phase 2 not ralphCompleted
**Input**: `interceptor.handle('write', {file: 'test-plan.md'}, 'sess-001', 'call-305')`
**Expected**: Throws WatchdogInterceptError with "Phase transition blocked"
**Covers**: AC-4, Rule 2, §7.5

#### TC-B-18 (#14): Rule 2 -- Phase 2 complete+approved, Phase 3 deliverable -> allows

**Source**: §7.8 #14
**Priority**: Key
**Preconditions**: currentPhase=2, phase 2 ralphCompleted=true, userApproved=true
**Input**: Same as TC-B-17
**Expected**: Returns normally
**Covers**: AC-4 edge, §7.5

#### TC-B-19 (#15): Rule order -- AC-3 fires before AC-4

**Source**: §7.8 #15
**Priority**: Key
**Preconditions**: Both rules would apply (Phase 4, no evidence, business_code)
**Input**: `interceptor.handle('edit', {filePath: '/project/src/foo.ts'}, 'sess-001', 'call-307')`
**Expected**: Throws with AC-3 message ("business code write blocked"), not AC-4 message
**Covers**: C-7, §7.5

#### TC-B-20 (#16): Disk read -- active run on disk returns state

**Source**: §7.8 #16
**Priority**: Key
**Preconditions**: multiAgent=true, store has state
**Input**: `cache.get()`
**Expected**: Returns PipelineState (not null)
**Covers**: C-8, §5.1

#### TC-B-21 (#17): Disk read failure -- corrupt state returns null

**Source**: §7.8 #17
**Priority**: Key
**Preconditions**: multiAgent=true, store.readState throws
**Input**: `cache.get()`
**Expected**: Returns null; warning logged
**Covers**: C-8, §5.1

#### TC-B-22 (#18): Unexpected error -> infrastructure failure

**Source**: §7.8 #18
**Priority**: Key
**Preconditions**: Internal error in classification
**Input**: Force extractFilePath to throw
**Expected**: Throws plain Error (not WatchdogInterceptError) with "[TDD Watchdog]" prefix
**Covers**: Fail-closed, §7.2

#### TC-B-23 (#19): Error message includes restart guidance

**Source**: §7.8 #19
**Priority**: Key
**Expected**: Thrown error contains "restart the pipeline" guidance
**Covers**: Fail-closed, §7.2

#### TC-B-24 (#20): WatchdogInterceptError instance check

**Source**: §7.8 #20
**Priority**: Key
**Expected**: Thrown violation instanceof WatchdogInterceptError === true
**Covers**: Error class, §7.2

#### TC-B-25 (#21): Unexpected error NOT instanceof WatchdogInterceptError

**Source**: §7.8 #21
**Priority**: Key
**Preconditions**: cache.get() throws
**Expected**: thrown instanceof WatchdogInterceptError === false
**Covers**: Error class, §7.2

#### TC-B-26 (#22): loadWatchdogConfig -- missing file -> defaults

**Source**: §7.8 #22
**Priority**: Peripheral
**Preconditions**: No watchdog.jsonc
**Expected**: Returns FALLBACK_PATTERNS, empty ignorePatterns, DEFAULT_MONITORED_TOOLS
**Covers**: Config fallback, §7.4.1

#### TC-B-27 (#23): loadWatchdogConfig -- valid file -> parsed

**Source**: §7.8 #23
**Priority**: Peripheral
**Expected**: Returns parsed config; info logged
**Covers**: Config loading, §7.4.1

#### TC-B-28 (#24): loadWatchdogConfig -- malformed JSONC -> defaults + warn

**Source**: §7.8 #24
**Priority**: Peripheral
**Expected**: Returns defaults; warn logged
**Covers**: Config error, §7.4.1

#### TC-B-29 (#25): loadWatchdogConfig -- missing phaseDeliverables -> defaults

**Source**: §7.8 #25
**Priority**: Peripheral
**Expected**: Returns FALLBACK_PATTERNS; warn logged
**Covers**: Config validation, §7.4.1

#### TC-B-30 (#26): Extra phases preserved, never matched

**Source**: §7.8 #26
**Priority**: Peripheral
**Expected**: phaseDeliverables[6] exists; rules never match it
**Covers**: Config extensibility

#### TC-B-31 (#27): globToRegex -- *.md matches .md only

**Source**: §7.8 #27
**Priority**: Peripheral
**Input**: classifyFile with *.md pattern
**Expected**: .md matches; .txt does not
**Covers**: Glob->regex, §7.4

#### TC-B-32 (#28): Custom monitoredTools -- hashline_edit intercepted

**Source**: §7.8 #28
**Priority**: Key
**Preconditions**: monitoredTools includes 'hashline_edit'
**Expected**: Evaluates rules for hashline_edit
**Covers**: Section 15a L3, §7.2

#### TC-B-33 (#29): Default monitoredTools -- hashline_edit NOT intercepted

**Source**: §7.8 #29
**Priority**: Key
**Preconditions**: default monitoredTools (no hashline_edit)
**Expected**: Returns normally; cache.get NOT called
**Covers**: C-3 default, §7.2

#### TC-B-34 (#30): PathExtractor -- hashline_edit generic fallback

**Source**: §7.8 #30
**Input**: `extractFilePath('hashline_edit', {filePath: 'x.ts'})`
**Expected**: Returns 'x.ts'
**Covers**: PathExtractor fallback, §7.3

#### TC-B-35 (#31): PathExtractor -- custom_tool path field

**Source**: §7.8 #31
**Input**: `extractFilePath('custom_tool', {path: 'y.ts'})`
**Expected**: Returns 'y.ts'
**Covers**: PathExtractor fallback, §7.3

#### TC-B-36 (#32): Ownership -- orchestrator allowed

**Source**: §7.8 #32
**Priority**: Key
**Preconditions**: ownerSessionId='sess-orchestrator', caller='sess-orchestrator'
**Expected**: Returns ok=true
**Covers**: Section 5.5a, §15a L2

#### TC-B-37 (#33): Ownership -- sub-agent rejected

**Source**: §7.8 #33
**Priority**: Key
**Preconditions**: ownerSessionId='sess-orchestrator', caller='sess-sub-agent'
**Expected**: ok=false, violation contains "belongs to another session"
**Covers**: Section 5.5a, §15a L2

#### TC-B-38 (#34): Ownership -- sub-agent pipeline_start rejected (active exists)

**Source**: §7.8 #34
**Priority**: Key
**Preconditions**: Active pipeline exists
**Expected**: ok=false, violation contains "already active"
**Covers**: Single-pipeline constraint

#### TC-B-39 (#35): Ownership rejection logged as audit BLOCK

**Source**: §7.8 #35
**Priority**: Key
**Expected**: appendAudit called with decision='BLOCK', violation contains 'owner_mismatch'
**Covers**: Section 5.5a

#### TC-B-40 (#36): Disk read consistency -- orchestrator writes, sub-agent sees

**Source**: §7.8 #36
**Priority**: Key
**Preconditions**: multiAgent=true
**Expected**: After orchestrator writes, sub-agent cache.get() returns new state
**Covers**: Multi-agent consistency, §5.1

#### TC-B-41 (#37): Empty monitoredTools -> warning + fallback

**Source**: §7.8 #37
**Priority**: Peripheral
**Preconditions**: Config has monitoredTools: []
**Expected**: Returns defaults; warn logged
**Covers**: Config footgun guard, §7.4.1

#### TC-B-42 (#38): Phase 1 state (no ownerSessionId) -> check skipped

**Source**: §7.8 #38
**Priority**: Key
**Preconditions**: State without ownerSessionId
**Expected**: Returns ok=true
**Covers**: Migration safety, §5.5a

#### TC-B-43 (#39): pipeline_start with empty sessionID -> rejected

**Source**: §7.8 #39
**Priority**: Key
**Input**: sessionID=''
**Expected**: ok=false, violation contains "session ID is empty"
**Covers**: Edge case guard, §5.5a

#### TC-B-44 (#40): PathExtractor -- first field wins

**Source**: §7.8 #40
**Input**: `extractFilePath('custom', {filePath: 'a', path: 'b'})`
**Expected**: Returns 'a' (filePath priority)
**Covers**: PathExtractor priority, §7.3

---

### Module C: Articulation Validation

#### TC-C-01: All 3 dimensions pass

**Source**: §8.8
**Priority**: Key
**Input**: Text with protect/guard/prevent + risk/edge case + because/effective
**Expected**: {verified: true, dimensions: {all true}}
**Covers**: AC-5, §8.2

#### TC-C-02: Missing what_it_protects

**Source**: §8.8
**Input**: Text with risks and approach but no protection keywords
**Expected**: {verified: false, missingDimension: 'what_it_protects', dimensions: {false,true,true}}
**Covers**: AC-5, §8.2

#### TC-C-03: Missing key_risks

**Source**: §8.8
**Input**: Text with protection and approach but no risk keywords
**Expected**: {verified: false, missingDimension: 'key_risks', dimensions: {true,false,true}}
**Covers**: AC-5, §8.2

#### TC-C-04: Missing why_approach_works

**Source**: §8.8
**Input**: Text with protection and risks but no approach keywords
**Expected**: {verified: false, missingDimension: 'why_approach_works', dimensions: {true,true,false}}
**Covers**: AC-5, §8.2

#### TC-C-05: Text too short (< 50 chars)

**Source**: §8.8
**Input**: "I will write tests for this."
**Expected**: {verified: false, all dimensions false, missingDimension: 'what_it_protects'}
**Covers**: §8.2

#### TC-C-06: Empty string

**Source**: §8.8
**Input**: ""
**Expected**: Same as TC-C-05
**Covers**: §8.2

#### TC-C-07: All dimensions missing

**Source**: §8.8
**Input**: Long text about weather/gardening (no matching keywords)
**Expected**: {verified: false, all dimensions false, missingDimension: 'what_it_protects'}
**Covers**: §8.2

#### TC-C-08: Minimum length boundary (exactly 50 chars)

**Source**: §8.8
**Input**: "a".repeat(50)
**Expected**: Length check passes (50 < 50 is false), proceeds to keywords
**Covers**: §8.2

#### TC-C-09: Degradation -- 3 consecutive failures -> degraded

**Source**: §8.8
**Priority**: Key
**Input**: Three why_articulation calls, all failing
**Expected**: Third: ok=false, violation contains "escalated to Ralph review", articulationDegraded=true
**Covers**: AC-7, §8.3

#### TC-C-10: Degradation -- success resets counter

**Source**: §8.8
**Priority**: Key
**Input**: 2 failures, then success
**Expected**: Third call: ok=true, articulationVerified=true
**Covers**: AC-5, §8.3

#### TC-C-11: Degradation -- persists as historical marker

**Source**: §8.8
**Priority**: Key
**Preconditions**: articulationDegraded already true
**Input**: New successful articulation
**Expected**: ok=true, articulationVerified=true, articulationDegraded stays true
**Covers**: AC-7, §8.4

#### TC-C-12: Degradation -- restart loses counter

**Source**: §8.8
**Priority**: Peripheral
**Input**: Fresh CheckpointHandler after 2 prior failures
**Expected**: First failure on new handler: NOT degraded (counter=1)
**Covers**: AC-5, §8.3

#### TC-C-13: transitions -- why_articulation valid preconditions

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition('why_articulation', {phase:1, articulation:'text'}, state)
**Expected**: {valid: true}
**Covers**: §8.4

#### TC-C-14: transitions -- why_articulation wrong phase

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition with phase != currentPhase
**Expected**: {valid: false, violation: 'Phase mismatch'}
**Covers**: §8.4

#### TC-C-15: transitions -- phaseStatus not active

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition with phaseStatus='idle'
**Expected**: {valid: false, violation: 'Phase not active'}
**Covers**: §8.4

#### TC-C-16: transitions -- phase not entered

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition with phases[phase] missing
**Expected**: {valid: false, violation: 'Phase X not found'}
**Covers**: §8.4

#### TC-C-17: checkpoint -- why_articulation ok=true

**Source**: §8.8
**Priority**: Key
**Input**: Good articulation text
**Expected**: ok=true, state has articulationVerified=true, audit PASS
**Covers**: AC-5, §8.5

#### TC-C-18: checkpoint -- why_articulation ok=false with guidance

**Source**: §8.8
**Priority**: Key
**Input**: Poor articulation text
**Expected**: ok=false, guidance present, violation contains "incomplete", audit PASS
**Covers**: AC-5, §8.5

#### TC-C-19: checkpoint -- degraded note after 3 failures

**Source**: §8.8
**Priority**: Key
**Preconditions**: 2 prior failures
**Expected**: ok=false, violation contains "escalated to Ralph review", articulationDegraded=true
**Covers**: AC-7, §8.5

#### TC-C-20: checkpoint -- re-validation after failure

**Source**: §8.8
**Priority**: Key
**Preconditions**: Previous failure (articulationAttempted=true, articulationVerified=false)
**Input**: Good text
**Expected**: ok=true, articulationVerified=true
**Covers**: AC-5, §8.5

#### TC-C-21: checkpoint -- phase_enter resets failure counter

**Source**: §8.5 (M-5 fix)
**Priority**: Key
**Input**: phase_enter(2) after 2 failures in phase 1
**Expected**: First articulation for phase 2: NOT degraded
**Covers**: M-5, §8.5

---

### Integration Tests

#### TC-I-01: Full pipeline with observations

**Source**: §21.4
**Priority**: Key
**Expected**: All 5 phases complete; all AC-2 checks pass; observations present
**Covers**: Full flow

#### TC-I-02: Articulation full cycle

**Source**: §21.4
**Priority**: Key
**Expected**: Bad -> ok=false with guidance; good -> ok=true; state mutations correct
**Covers**: AC-5, AC-6

#### TC-I-03: Interceptor block -> address -> retry

**Source**: §21.4
**Priority**: Key
**Expected**: Blocked by AC-3; submit evidence; retry succeeds
**Covers**: AC-3, reversibility

#### TC-I-04: Multi-agent ownership

**Source**: §21.4
**Priority**: Key
**Expected**: Orchestrator allowed; sub-agent rejected; audit trail
**Covers**: Section 15a L2

#### TC-I-05: Adaptive cache single-agent

**Source**: §21.4
**Priority**: Key
**Expected**: First get() reads disk; subsequent returns memory
**Covers**: C-8, §5.1

#### TC-I-06: Adaptive cache multi-agent

**Source**: §21.4
**Priority**: Key
**Expected**: Every get() reads disk
**Covers**: C-8, §5.1

#### TC-I-07: Cache update on checkpoint

**Source**: §21.4
**Priority**: Key
**Expected**: cache.update() called after writeState
**Covers**: §5.1

#### TC-I-08: Cache clear on completion

**Source**: §21.4
**Priority**: Key
**Expected**: cache.clear() called on phase_complete(5)
**Covers**: §5.1

#### TC-I-09: Observer + AC-2 cycle

**Source**: §21.4
**Priority**: Key
**Expected**: Observation -> findObservations -> AC-2 pass
**Covers**: AC-1, AC-2

#### TC-I-10: Custom monitoredTools

**Source**: §21.4
**Priority**: Key
**Expected**: Custom tool evaluated with generic path extraction
**Covers**: Section 15a L3

---

## Part 4: Test File Organization

```
packages/watchdog/test/
├── helpers.ts                      <- Existing shared utilities
├── observer.test.ts                <- Module A (~22 tests)
├── session-buffer.test.ts          <- Module A SessionBuffer (5 tests)
├── path-extractor.test.ts          <- Module B PathExtractor (6 tests)
├── file-classifier.test.ts         <- Module B FileClassifier (8 tests)
├── interceptor.test.ts             <- Module B Interceptor (~15 tests)
├── watchdog-config.test.ts         <- Module B Config (5 tests)
├── articulation.test.ts            <- Module C Articulation (8 tests)
├── checkpoint-phase2.test.ts       <- Module C + ownership (~12 tests)
└── integration-phase2.test.ts      <- Integration (~10 tests)
```

---

## Part 5: Summary Statistics

### 5.1 Test Count by Module

| Module | Tests | Key | Peripheral |
|--------|-------|-----|-----------|
| Module A - Observation | ~22 | 14 | 8 |
| Module B - Interception | ~33 | 22 | 11 |
| Module C - Articulation | ~20 | 16 | 4 |
| Integration | ~10 | 10 | 0 |
| **Phase 2 Total** | **~85** | **~62** | **~23** |
| Phase 1 Baseline | 106 | - | - |
| **Combined Total** | **~191** | | |

### 5.2 Estimated Implementation Effort

| Activity | Hours |
|----------|-------|
| Schema & constants updates | 0.5 |
| Core registration update | 1.0 |
| Shared infrastructure | 1.5 |
| Module A tests | 3.0 |
| Module B tests | 4.0 |
| Module C tests | 2.5 |
| Integration tests | 2.5 |
| Phase 1 migration fixes | 0.5 |
| Debug & stabilize | 2.0 |
| **Total** | **~17.5** |

### 5.3 Implementation Order

1. Tier 0+1+2: Core, schema, constants, state-cache, session-buffer, config, articulation, path-extractor, file-classifier
2. Tier 3: intercept-rules, interceptor, observer, transitions, pipeline-store
3. Tier 4: checkpoint, index
4. Integration tests and stabilization

---

## Appendix A: Migration Checklist

- [ ] `registration.ts`: onToolBefore returns Promise<void>, accepts callID
- [ ] `registration.ts`: onToolAfter accepts callID
- [ ] `registration.ts`: PluginOutput has tool.execute.before/after
- [ ] `schema.ts`: CheckpointEvent includes 'why_articulation'
- [ ] `schema.ts`: PipelineState has ownerSessionId?
- [ ] `schema.ts`: PhaseRecord has 3 articulation fields
- [ ] `schema.ts`: ObservationEntry interface
- [ ] `constants.ts`: ARTICULATION_MAX_FAILURES, SESSION_BUFFER_MAX_SIZE
- [ ] `transitions.ts`: why_articulation validation + apply cases
- [ ] `transitions.ts`: phase_enter init articulation fields
- [ ] `transitions.ts`: pipeline_start sets ownerSessionId
- [ ] `pipeline-store.ts`: append/read/find Observations
- [ ] `checkpoint.ts`: Constructor cache/observer params
- [ ] `checkpoint.ts`: AC-2 enforcement
- [ ] `checkpoint.ts`: why_articulation handling
- [ ] `checkpoint.ts`: Articulation degradation counter
- [ ] `checkpoint.ts`: Ownership check
- [ ] `checkpoint.ts`: cache.update/clear calls
- [ ] `index.ts`: Returns onToolBefore/onToolAfter
- [ ] `index.ts`: Wires all components
