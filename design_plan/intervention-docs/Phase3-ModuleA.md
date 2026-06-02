# Phase 3 — Module A: Event Observation

**Version**: 1.0
**Split From**: Phase3-TestPlan.md
**Source Design**: Phase2-ActiveMonitoring.md §6
**Dependencies**: Phase3-Shared.md (mock conventions, dependency graph)

---

## Components Under Test

| File | Tier | Status |
|------|------|--------|
| `packages/watchdog/src/observer.ts` | 3 | **NEW** |
| `packages/watchdog/src/session-buffer.ts` | 2 | **NEW** |
| `packages/watchdog/src/state-cache.ts` | 2 | **NEW** (shared) |
| `packages/watchdog/src/pipeline-store.ts` | 3 | **Updated** (observation methods) |

## Test Files

| File | Tests |
|------|-------|
| `test/observer.test.ts` | 15 tests |
| `test/session-buffer.test.ts` | 4 tests |

---

## Observer Tests (observer.test.ts)

### TC-A-01: Task call with active pipeline in ralph_loop

**Source**: §6.7
**Priority**: Key
**Preconditions**: Mock cache returns ralph_loop state with round=2
**Input**: `observer.handle('Task', {prompt:'review'}, 'out', 'sess-001', 'call-123')`
**Expected**: `store.appendObservation` called with `type='_reviewer_spawned'`, `round=3`, `callID='call-123'`
**Covers**: AC-1, §6.2

### TC-A-02: Task call without active pipeline

**Source**: §6.7
**Priority**: Key
**Preconditions**: Mock cache returns null
**Input**: `observer.handle('Task', {prompt:'review'}, 'out', 'sess-001', 'call-124')`
**Expected**: `sessionBuffer.record` called with tool='Task', callID='call-124'
**Covers**: AC-10, §6.2

### TC-A-03: Non-Task call (edit)

**Source**: §6.7
**Priority**: Key
**Input**: `observer.handle('edit', {filePath:'foo.ts'}, 'ok', 'sess-001', 'call-125')`
**Expected**: No observation recorded
**Covers**: §6.2

### TC-A-04: Multiple Task calls in same round

**Source**: §6.7
**Priority**: Key
**Input**: Three `observer.handle('Task', ...)` calls with same state
**Expected**: Three appendObservation calls, all with same round
**Covers**: AC-1

### TC-A-05: Task call with active pipeline NOT in ralph_loop

**Source**: §6.7
**Priority**: Key
**Preconditions**: cache returns state with phaseStatus='active'
**Input**: `observer.handle('Task', {}, 'out', 'sess-001', 'call-126')`
**Expected**: No observation recorded
**Covers**: §6.2

### TC-A-06: handle() throws during ralph_loop -- dual-channel degradation

**Source**: §6.7
**Priority**: Key
**Preconditions**: cache.get() throws Error('disk read failed')
**Input**: `observer.handle('Task', {}, 'out', 'sess-001', 'call-127')`
**Expected**: No throw from handle(); isDegraded() returns true; store has `_observer_degraded` entry
**Covers**: AC-2 degradation, §6.2

> **Note (H-3 fix)**: TC-A-07 through TC-A-10 (AC-2 round-complete checks) are CheckpointHandler tests, not Observer tests. They have been moved to `checkpoint-phase2.test.ts` in Module C where they belong.

### TC-A-07: Dual-channel degradation -- crash sets flag + persists entry

**Source**: §6.7
**Priority**: Key
**Input**: Force cache.get() to throw in observer.handle()
**Expected**: isDegraded returns true; store has `_observer_degraded` entry with metadata.error
**Covers**: §6.2

### TC-A-08: isDegraded -- true for degraded round, false otherwise

**Source**: §6.7
**Priority**: Key
**Expected**: After degradation for round 2: isDegraded(proj,run,2)=true, isDegraded(proj,run,3)=false
**Covers**: §6.2

### TC-A-09: clearDegradation removes both channels

**Source**: §6.7
**Priority**: Key
**Input**: `observer.clearDegradation('proj-1','run-1')`
**Expected**: isDegraded returns false for previously degraded round
**Covers**: §6.2

### TC-A-10: Persisted entry readable by downstream

**Source**: §6.7
**Priority**: Key
**Input**: `store.readObservations('proj-1','run-1')`
**Expected**: Contains entry with `type='_observer_degraded'`
**Covers**: §6.2

### TC-A-11: SessionBuffer -- record within bounds

**Source**: §6.7
**Priority**: Peripheral
**Input**: Record 2 entries for same session
**Expected**: getSession returns array of length 2
**Covers**: AC-10, §6.3

### TC-A-12: SessionBuffer -- overflow FIFO eviction

**Source**: §6.7
**Priority**: Peripheral
**Input**: Record 1001 entries (SESSION_BUFFER_MAX_SIZE=1000)
**Expected**: getSession returns 1000 entries; oldest evicted
**Covers**: §6.3

### TC-A-13: SessionBuffer -- clearSession

**Source**: §6.7
**Priority**: Peripheral
**Input**: `sessionBuffer.clearSession('sess-001')`
**Expected**: getSession returns []
**Covers**: §6.3

### TC-A-14: SessionBuffer -- multiple sessions isolated

**Source**: §6.7
**Priority**: Peripheral
**Input**: Record entries for sess-A and sess-B
**Expected**: Each session has its own buffer; sessionCount=2
**Covers**: §6.3

### TC-A-15: Integration -- full pipeline flow with observations

**Source**: §6.7
**Priority**: Key
**Input**: pipeline_start -> phase_enter(1) -> ralph_loop_start(1) -> Task call -> ralph_round_complete(1)
**Expected**: Observation recorded; round completes with ok=true
**Covers**: AC-1, AC-2, §6.4

### TC-A-16: Integration -- crash recovery observation loss (promoted to integration TC-I-11)

**Source**: §6.7
**Priority**: Peripheral
**Input**: Observer crashes, then round complete
**Expected**: ok=true (AC-2 skipped); degradation persisted
**Covers**: AC-2 degradation

> **Note (L-3)**: This test is cross-module (Observer + CheckpointHandler). It runs in Module A's observer.test.ts for locality but should be mirrored in integration-phase2.test.ts as TC-I-11.

### TC-A-17: Integration -- downstream reads persisted entry

**Source**: §6.7
**Priority**: Key
**Input**: `store.findObservations(..., {type:'_observer_degraded'})`
**Expected**: Returns degraded entries
**Covers**: §6.2

### TC-A-18: isDegraded returns false for non-degraded round

**Source**: §6.7
**Priority**: Key
**Expected**: Fresh observer: isDegraded(any) returns false
**Covers**: §6.2

### TC-A-19: Degradation tracking itself fails -- no unhandled exception

**Source**: §6.7
**Priority**: Key
**Preconditions**: cache.get() throws in both outer and inner try
**Input**: `observer.handle('Task',{},'out','sess-001','call-202')`
**Expected**: No throw; original error logged
**Covers**: §6.2

---

## Cross-Module Integration Tests (in integration-phase2.test.ts)

These tests are authored during Module A phase but live in the shared integration file:

### TC-I-05: Adaptive cache single-agent

**Source**: §21.4
**Priority**: Key
**Expected**: First get() reads disk; subsequent returns memory
**Covers**: C-8, §5.1

### TC-I-06: Adaptive cache multi-agent

**Source**: §21.4
**Priority**: Key
**Expected**: Every get() reads disk
**Covers**: C-8, §5.1

### TC-I-07: Cache update on checkpoint

**Source**: §21.4
**Priority**: Key
**Expected**: cache.update() called after writeState
**Covers**: §5.1

### TC-I-08: Cache clear on completion

**Source**: §21.4
**Priority**: Key
**Expected**: cache.clear() called on phase_complete(5)
**Covers**: §5.1

### TC-I-09: Observer + AC-2 cycle

**Source**: §21.4
**Priority**: Key
**Expected**: Observation -> findObservations -> AC-2 pass
**Covers**: AC-1, AC-2
