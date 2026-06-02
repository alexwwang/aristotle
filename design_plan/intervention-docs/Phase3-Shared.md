# Phase 3 — Shared: Dependency Graph, Migration & Conventions

**Version**: 1.0
**Split From**: Phase3-TestPlan.md
**Purpose**: Implementation dependency graph, Phase 1 migration verification, shared mock conventions, statistics

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
| 2 | `packages/watchdog/src/schema.ts` | **Updated** | None | Add `'why_articulation'` to `CheckpointEvent`; add `ownerSessionId?: string` to `PipelineState`; add `articulationVerified?: boolean`, `articulationDimensions?: ...`, `articulationAttempted?: boolean`, `articulationDegraded?: boolean` to `PhaseRecord` (**all optional** — C-1 fix); new `ObservationEntry` interface; new `OBS_TYPE_REVIEWER_SPAWNED` constant | All Phase 2 tests |
| 3 | `packages/watchdog/src/constants.ts` | **Updated** | None | Add `ARTICULATION_MAX_FAILURES = 3`; add `SESSION_BUFFER_MAX_SIZE = 1000` | Module A SessionBuffer tests; Module C degradation tests |

### Tier 2: Shared Infrastructure (No External Dependencies)

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 4 | `packages/watchdog/src/state-cache.ts` | **NEW** | schema.ts (#2) | `PipelineStateCache(multiAgent: boolean)` class: `get()`, `update()`, `clear()`; adaptive strategy driven by `multiAgent` param | Module A observer tests; Module B interceptor tests; Module C checkpoint tests; integration tests |
| 5 | `packages/watchdog/src/session-buffer.ts` | **NEW** | constants.ts (#3) | `SessionBuffer` class: `record()`, `getSession()`, `clearSession()`, `sessionCount()` | Module A SessionBuffer tests |
| 6 | `packages/watchdog/src/watchdog-config.ts` | **NEW** | None (pure functions) | `loadWatchdogConfig()`, `stripJsonComments()`, `FALLBACK_PATTERNS`, `DEFAULT_MONITORED_TOOLS` | Module B config tests |
| 7 | `packages/watchdog/src/articulation.ts` | **NEW** | None (pure function) | `validateArticulation(text): ArticulationResult` | Module C articulation tests |
| 8 | `packages/watchdog/src/path-extractor.ts` | **NEW** | None (pure function) | `extractFilePath(tool, args): string \| null` | Module B PathExtractor tests |
| 9 | `packages/watchdog/src/file-classifier.ts` | **NEW** | None (pure function) | `classifyFile(absolutePath, deliverablePatterns, ignorePatterns): FileClassification` | Module B FileClassifier tests |
| 10 | `packages/watchdog/src/intercept-rules.ts` | **NEW** | file-classifier.ts (#9), schema.ts (#2) | `InterceptRule` interface; Rule 1; Rule 2 | Module B Rule tests |

### Tier 3: Module Components

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 11 | `packages/watchdog/src/interceptor.ts` | **NEW** | state-cache.ts (#4), path-extractor.ts (#8), file-classifier.ts (#9), intercept-rules.ts (#10), watchdog-config.ts (#6) | `Interceptor.handle()`; `WatchdogInterceptError`; receives `monitoredTools` from config | Module B interceptor tests |
| 12 | `packages/watchdog/src/observer.ts` | **NEW** | state-cache.ts (#4), session-buffer.ts (#5), schema.ts (#2) | `Observer.handle()`, `isDegraded()`, `clearDegradation()` | Module A observer tests; AC-2 tests |
| 13 | `packages/watchdog/src/transitions.ts` | **Updated** | schema.ts (#2) | Add `why_articulation` validation/apply cases; update `phase_enter` init; update `pipeline_start` owner | Module C transitions tests |
| 14 | `packages/watchdog/src/pipeline-store.ts` | **Updated** | schema.ts (#2) | Add `appendObservation()`, `readObservations()`, `findObservations()` | Module A observer tests; AC-2 tests |

### Tier 4: Orchestrator

| # | File | Status | Dependencies | Key Interfaces/Functions | Tests Depending On |
|---|------|--------|-------------|------------------------|-------------------|
| 15 | `packages/watchdog/src/checkpoint.ts` | **Updated** | pipeline-store.ts (#14), transitions.ts (#13), observer.ts (#12), state-cache.ts (#4), articulation.ts (#7) | Constructor gains `cache` and `observer`; ownership check; AC-2; why_articulation; degradation | Module C checkpoint tests; AC-2; ownership |
| 16 | `packages/watchdog/src/index.ts` | **Updated** | All above | `createWatchdogRole()`: calls `detectMultiAgent()` to determine mode, passes `multiAgent` to cache and `monitoredTools` to interceptor, wires all new components | Integration tests |

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

#### Change 6: `PhaseRecord` -- add 4 articulation fields (ALL OPTIONAL)

**Design decision (C-1 fix)**: All 4 fields are **optional** (`?: boolean` / `?: ...`). Rationale:
- Phase 1 code has ~25 PhaseRecord object literal sites. Optional fields = zero Phase 1 breakage.
- Semantic correctness: undefined ≡ false for all 4 fields. No behavioral difference.
- Future code doesn't need 4 boilerplate `false` values per PhaseRecord construction.

**Affected Phase 1 tests**: **NONE** — optional fields are backward-compatible.

#### Change 7: `ObservationEntry` -- NEW interface

**Affected**: None (new type).

### 2.3 `transitions.ts` Changes

#### Change 8: `validateTransition` -- new `why_articulation` case

**Affected**: None -- no existing tests call this event.

#### Change 9: `applyTransition` -- `pipeline_start` sets `ownerSessionId`

**Affected**: `transitions.test.ts` line 653-669 -- test checks `newState` properties but doesn't assert absence of `ownerSessionId`. If `payload._ownerSessionId` missing, value is `undefined` which is valid (backward compat). **No update needed**.

#### Change 10: `applyTransition` -- `phase_enter` initializes articulation fields

Fields are optional in schema. `phase_enter` sets them to `false`/`{}` defaults for Phase 2 states. Phase 1 states remain unaffected.

**Affected Phase 1 tests**: **NONE** — existing `phase_enter` tests compare against Phase 1 states where fields are absent (undefined), which is valid for optional fields.

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
| `test/checkpoint.test.ts` | ~25 | No | None — constructor params optional; articulation fields optional |
| `test/transitions.test.ts` | ~45 | No | None — articulation fields optional in schema; absent = valid |
| `test/pipeline-store.test.ts` | ~25 | No | None |
| `test/project-id.test.ts` | ~5 | No | None |
| **Total** | **~100** | **0 files** | **0 assertions** |

**Key**: C-1 fix makes all new PhaseRecord fields optional. Phase 1 test suite compiles and passes unchanged.

---

## Part 3: Shared Mock Conventions

All three modules share the same mock setup patterns. Each @coder instance MUST follow these conventions to ensure test compatibility.

### 3.1 Common Mock Factory (`test/helpers.ts`)

The existing `helpers.ts` will be extended with the following shared factories. Each module's test file imports from this single source.

```typescript
// === Schema helpers ===
// makeState default includes ownerSessionId for Phase 2 tests.
// Phase 1 code that calls makeState without overrides still works
// because ownerSessionId is optional in schema.
export function makeState(overrides?: Partial<PipelineState>): PipelineState
// Default: { ..., ownerSessionId: 'sess-test', ... }

export function makePhaseRecord(phase: number, overrides?: Partial<PhaseRecord>): PhaseRecord
// Phase 2 callers pass articulation fields; Phase 1 callers omit them (optional).

// === Mock stores (H-2 fix: includes ALL methods used by CheckpointHandler) ===
export function createMockStore(): {
  // Phase 1 methods
  readState: Mock;
  writeState: Mock;
  appendAudit: Mock;
  getActiveRun: Mock;
  setActiveRun: Mock;
  clearActiveRun: Mock;
  archiveRun: Mock;
  getProjectIds: Mock;
  // Phase 2 observation methods
  appendObservation: Mock;
  readObservations: Mock;
  findObservations: Mock;
}
// Usage: const store = createMockStore();

// === Mock caches ===
export function createMockCache(overrides?: { getReturn?: PipelineState | null }): {
  get: Mock;
  update: Mock;
  clear: Mock;
}

// === Mock observers ===
export function createMockObserver(overrides?: { isDegradedReturn?: boolean }): {
  handle: Mock;
  isDegraded: Mock;
  clearDegradation: Mock;
}

// === Mock session buffers ===
export function createMockSessionBuffer(): {
  record: Mock;
  getSession: Mock;
  clearSession: Mock;
  sessionCount: Mock;
}

// === Mock config loader ===
export function createMockConfigLoader(config?: Partial<WatchdogConfig>): () => WatchdogConfig
```

### 3.2 Mock Naming Convention

- `createMock*` factory functions return object with jest `fn()` mocks
- Test-local overrides via `mockReturnValue` / `mockImplementation`
- No `jest.mock()` for internal modules -- use constructor injection

### 3.3 Phase 1 Compatibility

Module C tests updating `checkpoint.test.ts` or `transitions.test.ts` MUST:
1. Only ADD new test blocks (describe/it), never modify existing ones
2. `makeState()` default includes `ownerSessionId: 'sess-test'` — Phase 1 helpers remain unchanged because field is optional
3. New `CheckpointHandler` tests use the 5-param constructor; existing tests keep 2-param (cache/observer are optional params)

---

## Part 4: Test File Organization

```
packages/watchdog/test/
├── helpers.ts                      <- Existing shared utilities + new mock factories
├── observer.test.ts                <- Module A (15 tests)
├── session-buffer.test.ts          <- Module A SessionBuffer (4 tests)
├── path-extractor.test.ts          <- Module B PathExtractor (8 tests)
├── file-classifier.test.ts         <- Module B FileClassifier (8 tests)
├── interceptor.test.ts             <- Module B Interceptor (21 tests)
├── watchdog-config.test.ts         <- Module B Config (7 tests)
├── articulation.test.ts            <- Module C Articulation (8 tests)
├── checkpoint-phase2.test.ts       <- Module C + ownership + AC-2 (22 tests)
├── detect-multi-agent.test.ts      <- Shared detectMultiAgent (4 tests)
└── integration-phase2.test.ts      <- Integration (~11 tests)
```

---

## Part 5: Summary Statistics

### 5.1 Test Count by Module

| Module | Tests | Key | Peripheral |
|--------|-------|-----|-----------|
| Module A - Observation | 19 | 12 | 7 |
| Module B - Interception | 44 | 28 | 16 |
| Module C - Articulation | 30 | 25 | 5 |
| Shared - detectMultiAgent | 4 | 4 | 0 |
| Integration | 11 | 11 | 0 |
| **Phase 2 Total** | **~108** | **~80** | **~28** |
| Phase 1 Baseline | 106 | - | - |
| **Combined Total** | **~214** | | |

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

1. Tier 0+1+2: Core, schema, constants, state-cache, session-buffer, config, articulation, path-extractor, file-classifier, detectMultiAgent
2. Tier 3: intercept-rules, interceptor, observer, transitions, pipeline-store
3. Tier 4: checkpoint, index
4. Integration tests and stabilization

---

## Part 6: detectMultiAgent Tests (detect-multi-agent.test.ts)

### TC-S-01: No opencode.json file -> returns false

**Source**: §5.1
**Priority**: Key
**Preconditions**: opencode.json does not exist
**Expected**: `detectMultiAgent()` returns false
**Covers**: Adaptive cache mode detection, §5.1

### TC-S-02: opencode.json without OMO plugins -> returns false

**Source**: §5.1
**Priority**: Key
**Preconditions**: opencode.json exists but has no OMO-related plugins
**Expected**: `detectMultiAgent()` returns false
**Covers**: §5.1

### TC-S-03: opencode.json with OMO plugins -> returns true

**Source**: §5.1
**Priority**: Key
**Preconditions**: opencode.json contains OMO plugin registration
**Expected**: `detectMultiAgent()` returns true
**Covers**: §5.1

### TC-S-04: Malformed opencode.json -> returns false

**Source**: §5.1
**Priority**: Key
**Preconditions**: opencode.json contains invalid JSON
**Expected**: `detectMultiAgent()` returns false; warning logged
**Covers**: §5.1 error handling

---

## Appendix A: Migration Checklist

- [ ] `registration.ts`: onToolBefore returns Promise<void>, accepts callID
- [ ] `registration.ts`: onToolAfter accepts callID
- [ ] `registration.ts`: PluginOutput has tool.execute.before/after
- [ ] `schema.ts`: CheckpointEvent includes 'why_articulation'
- [ ] `schema.ts`: PipelineState has ownerSessionId?
- [ ] `schema.ts`: PhaseRecord has 4 optional articulation fields (C-1: all optional for Phase 1 compat)
- [ ] `schema.ts`: ObservationEntry interface
- [ ] `constants.ts`: ARTICULATION_MAX_FAILURES, SESSION_BUFFER_MAX_SIZE
- [ ] `state-cache.ts`: PipelineStateCache(multiAgent) with adaptive strategy
- [ ] `index.ts`: detectMultiAgent() call, pass multiAgent to cache, monitoredTools to interceptor
- [ ] `index.ts`: Returns onToolBefore/onToolAfter
- [ ] `index.ts`: Wires all components
