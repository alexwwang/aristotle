# Technical Design: TDD Pipeline Checkpoint Integration

**Version**: 1.6
**Status**: GATE PASSED (R5+R6+R7 consecutive 0C/0H/0M)
**Last Updated**: 2026-05-20
**Source**: Phase2.1-CheckpointIntegration-Requirements.md (R9, GATE PASSED)
**TDD Pipeline Phase**: Phase 2 (Technical Solution) — **GATE PASSED**

---

## Why Articulation

Phase 2 protects the traceability of architectural decisions for Checkpoint Integration. The 13 ACs introduce a cross-cutting concern — **loopType awareness** — that flows through 7+ source files. The central design risk is the **config injection path**: `validateTransition` is a pure function with no config access, yet AC-3/AC-7/AC-12 all require loopType lookup during validation. Storing `loopPhaseMap` in `PipelineState` at `pipeline_start` time preserves the pure function signature while giving every consumer (state machine, intercept rules, checkpoint handler) config access through the state they already receive. This is the keystone decision — all other module designs flow from it.

---

## Split Decision

**SPLIT = true** (5 modules, 9 components, ≥3 threshold met).

| Module | Components | ACs Served | Dependencies |
|--------|-----------|------------|--------------|
| A: Loop Config & Schema | loop-config.ts (new), schema.ts, watchdog-config.ts | AC-1, AC-2 | None (foundation) |
| B: State Machine | transitions.ts | AC-1, AC-3, AC-7, AC-8, AC-13 | Module A (LoopType, PhaseLoopMap) |
| C: Intercept Rules | intercept-rules.ts | AC-12 | Module A (LoopType via state.loopPhaseMap) |
| D: Tools & Wiring | tools.ts, checkpoint.ts, index.ts | AC-1, AC-4 | Module A (LoopConfigResult) |
| E: Skill Integration | SKILL.md, ralph-gpav.md | AC-5~AC-11 | Module A (LoopType semantics) |

**Execution order**: A → B, C, D, E (parallel after A's contracts are defined)

**Dependency rule**: Modules depend on each other ONLY through shared contracts (LoopType, PhaseLoopMap, LoopConfigResult). No module reads another module's internal design.

---

## Architecture Overview

```
watchdog.jsonc
  └─ "loopPhases": { "ralph": [1,2,3,4,5], "followup": [6,7] }
       │
       ▼
  ┌──────────────┐    plugin init (once)
  │ loop-config.ts│─── parse + validate → LoopConfigResult
  └──────┬───────┘    (loopPhaseMap + maxPhase)
         │
         ▼ stored in state at pipeline_start
  ┌──────────────────────────────────────────┐
  │           PipelineState                   │
  │  + loopPhaseMap?: PhaseLoopMap (optional) │
  │  + maxPhase?: number (optional)           │
  │  + totalPhases: number (deprecated)       │
  └──────┬───────────┬───────────┬───────────┘
         │           │           │
    ┌────▼────┐ ┌────▼────┐ ┌───▼──────┐
    │transit- │ │intercept│ │checkpoint│
    │ions.ts  │ │-rules.ts│ │  .ts     │
    │(B)      │ │(C)      │ │(D)       │
    └─────────┘ └─────────┘ └──────────┘
```

**Data flow**: Config parsed at init → embedded in state at pipeline_start → consumed by state machine + intercept rules via `state.loopPhaseMap` → no runtime config lookups.

---

## Shared Contracts

### Types (Module A exports, consumed by all)

```typescript
// loop-config.ts

/** Loop type for a pipeline phase. Determines validation + apply behavior. */
export type LoopType = 'ralph' | 'followup'

/** Phase → LoopType mapping. Immutable per pipeline run. */
export type PhaseLoopMap = Record<number, LoopType>

/** Result of parsing loopPhases config. */
export interface LoopConfigResult {
  loopPhaseMap: PhaseLoopMap
  /** undefined in LoopConfigResult when loopPhases config is missing.
   *  PipelineState writes totalPhases as fallback (see B.3). */
  maxPhase: number | undefined
}

/** Error from invalid loopPhases config. */
export interface LoopConfigError {
  error: true
  message: string  // Human-readable, reported to user at plugin init
}

/** Type guard: distinguish LoopConfigError from LoopConfigResult. */
export function isLoopConfigError(result: LoopConfigResult | LoopConfigError): result is LoopConfigError {
  return 'error' in result && result.error === true
}

/** Config validation error — thrown when loopPhases is present but invalid.
 *  Causes plugin init failure (hard fail per AC-2). */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}
```

### Schema Changes (schema.ts)

```typescript
// Additions to PipelineState:
export interface PipelineState {
  // ... existing fields ...
  totalPhases: number              // @deprecated (v2.1) kept for backward compat
  maxPhase?: number                // derived from loopPhaseMap at pipeline_start; undefined for legacy
  loopPhaseMap?: PhaseLoopMap      // phase → loop type, immutable per run; undefined for legacy
}
```

**Note**: Both new fields are **optional** (`?`). This avoids a SCHEMA_VERSION bump — legacy v3 states simply lack these fields, and runtime code uses fallback logic (`?? state.totalPhases`, `?? 'ralph'`). No migration needed. `PhaseLoopMap` type alias is defined in `loop-config.ts` (Shared Contracts).

### State Access Pattern

All consumers access loopType via: `state.loopPhaseMap?.[phase] ?? 'ralph'`

- If `loopPhaseMap` is `undefined` (legacy state or missing config fallback) → treat as all-ralph
- `getLoopType(state, phase): LoopType` helper handles the fallback
- **Design decision on AC-3 "Phase not in map → reject"**: `getLoopType` returns 'ralph' fallback instead of rejecting. This is safe because AC-2 step 3 (completeness validation) guarantees all phases 1..maxPhase are in the map for valid configs. The fallback only activates for (a) legacy states with no loopPhaseMap, or (b) empty map from missing config. In both cases, all-ralph behavior is correct and consistent with AC-2's soft-fail fallback. Runtime rejection for "phase not in map" would be dead code given AC-2's guarantees. (D-7)

---

## Component Breakdown

| Component | Priority | Responsibilities | Serves ACs | Interface | Dependencies |
|-----------|----------|-----------------|------------|-----------|-------------|
| loop-config.ts | Key | Parse/validate loopPhases, produce PhaseLoopMap + maxPhase | AC-2 | `parseLoopPhases, getLoopType, isLoopConfigError, ConfigValidationError` | None (foundation) |
| schema.ts | Key | Add maxPhase + loopPhaseMap to PipelineState | AC-1 | PipelineState type | LoopType |
| watchdog-config.ts | Peripheral | Extend WatchdogConfig with loopPhases field | AC-2 | WatchdogConfig interface | loop-config.ts |
| transitions.ts (validate) | Key | loopType-aware validation for ralph_loop_start, user_approval, phase_enter | AC-1, AC-3, AC-7, AC-8 | `validateTransition(event, payload, state)` | state.loopPhaseMap |
| transitions.ts (apply) | Key | loopType-aware apply for user_approval (followup phaseStatus), pipeline_start (embed config) | AC-1, AC-13 | `applyTransition(event, payload, state)` | state.loopPhaseMap |
| intercept-rules.ts | Key | Rule 2 loopType-aware (skip ralphCompleted for followup) | AC-12 | `evaluate(tool, path, cls, state)` | state.loopPhaseMap |
| tools.ts | Peripheral | Add ralph_round_finding to z.enum + description | AC-4 | z.enum array | None |
| checkpoint.ts | Key | Pipeline completion use maxPhase, inject loopPhaseMap at pipeline_start | AC-1 | CheckpointHandler | LoopConfigResult |
| index.ts | Peripheral | Wire loop-config into plugin init | cross-cutting | createWatchdogRole | loop-config.ts |
| SKILL.md | Key | Checkpoint call integration at every phase boundary | AC-5~AC-11 | Text documentation | None |
| ralph-gpav.md | Peripheral | GPAV tool format documentation | AC-11 | Text documentation | None |

---

## Module A: Loop Config & Schema

### A.1: loop-config.ts (new file)

**Responsibility**: Parse `loopPhases` from `watchdog.jsonc`, validate all constraints, produce immutable `LoopConfigResult`.

**Algorithm**:
```
parseLoopPhases(loopPhases: unknown):
  1. If loopPhases is undefined → return { loopPhaseMap: {}, maxPhase: undefined } (fallback marker)
  2. If loopPhases is not object or is null → return LoopConfigError
  3. If loopPhases is empty {} → return LoopConfigError ("loopPhases is empty")
  4. For each key-value pair:
     a. key must be 'ralph' or 'followup' → else LoopConfigError
     b. value must be Array → else LoopConfigError
     c. value must not be empty array → else LoopConfigError (empty loopType declaration is meaningless)
     d. for each element in value: typeof === 'number' && Number.isInteger(v) && v >= 1 → else LoopConfigError
     e. array must have no duplicate values (use Set to check) → else LoopConfigError
  5. Build phaseSet from all values (deduplicated)
  6. Check cross-group overlap: sum all group array lengths, compare with phaseSet.size. If unequal → LoopConfigError (some phase appears in multiple groups)
  7. minPhase must be 1 → else LoopConfigError
  8. maxPhase = max(all phases)
  9. Check gap: phases 1..maxPhase must all be present → else LoopConfigError
  10. Check Phase 4: loopPhaseMap[4] must be 'ralph' → else LoopConfigError
  11. Build loopPhaseMap: { phase: loopType } for each phase
  12. Return { loopPhaseMap, maxPhase }
```

**Edge cases**:
- `loopPhases: { "ralph": [], "followup": [6,7] }` → ralph has no phases, maxPhase=7, phases 1-5 missing → gap error
- `loopPhases: { "ralph": [1,2,3,5], "followup": [4,6,7] }` → Phase 4 = followup → config error
- Missing `loopPhases` → fallback: empty map (consumers treat as all-ralph)

### A.2: schema.ts changes

**Changes**:
1. Add import: `import type { PhaseLoopMap } from './loop-config.js'`
2. Add to `PipelineState` (optional fields for backward compat with v3 states):
   ```typescript
   maxPhase?: number                // derived from loopPhaseMap at pipeline_start; undefined for legacy
   loopPhaseMap?: PhaseLoopMap      // phase → loop type, immutable per run; undefined for legacy
   ```
3. `totalPhases` marked `@deprecated (v2.1)` in JSDoc (field retained for backward compat)
4. No SCHEMA_VERSION bump needed — optional fields, runtime fallback via `??`

### A.3: watchdog-config.ts changes

**Changes**: Restructure `loadWatchdogConfig` to parse `loopPhases` independently of `phaseDeliverables`.

**Imports to add** (watchdog-config.ts):
```typescript
import { parseLoopPhases, isLoopConfigError, ConfigValidationError, type LoopConfigResult } from './loop-config.js'
```

**Updated WatchdogConfig interface**:
```typescript
export interface WatchdogConfig {
  phaseDeliverables: Record<number, string[]>
  ignorePatterns: string[]
  monitoredTools: string[]
  loopPhasesResult: LoopConfigResult  // NEW: parsed loopPhases config
}
```

```typescript
export function loadWatchdogConfig(worktreeRoot, logger): WatchdogConfig {
  const configPath = join(worktreeRoot, '.opencode', 'watchdog.jsonc')

  // Default loopPhasesResult for all fallback paths
  const defaultLoopResult: LoopConfigResult = { loopPhaseMap: {}, maxPhase: undefined }

  if (!existsSync(configPath)) {
    logger.info('No watchdog.jsonc found — using built-in defaults')
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS], loopPhasesResult: defaultLoopResult }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(stripJsonComments(raw)) as any

    // --- Parse loopPhases INDEPENDENTLY (must run regardless of phaseDeliverables) ---
    const loopPhasesResult = parseLoopPhases(parsed?.loopPhases)
    if (isLoopConfigError(loopPhasesResult)) {
      throw new ConfigValidationError(loopPhasesResult.message)  // Hard fail per AC-2
    }

    // --- Parse remaining config (existing logic) ---
    if (parsed?.phaseDeliverables && typeof parsed.phaseDeliverables === 'object') {
      // ... existing phaseDeliverables parsing ...
      return { phaseDeliverables, ignorePatterns, monitoredTools, loopPhasesResult }
    }

    logger.warn('watchdog.jsonc missing phaseDeliverables — using built-in defaults')
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS], loopPhasesResult }
  } catch (err) {
    if (err instanceof ConfigValidationError) throw err  // Propagate hard fail
    logger.warn('Failed to load watchdog.jsonc: %s — using built-in defaults', String(err))
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS], loopPhasesResult: defaultLoopResult }
  }
}
```

**Key restructuring points**:
1. `defaultLoopResult` defined once at top — used by all fallback return paths
2. `parseLoopPhases(parsed?.loopPhases)` runs BEFORE `phaseDeliverables` check — not nested inside the if/else
3. `ConfigValidationError` caught and re-thrown — all other errors fall through to soft fail
4. All 3 fallback return paths include `loopPhasesResult` — no undefined path

**Hard-fail rationale** (D-7): AC-2/Constraints explicitly state "无效 loopPhases 配置 → plugin 初始化失败". Invalid → hard fail (plugin won't start).

**Note**: "Missing loopPhases" (config field absent) is distinct from "invalid loopPhases" (config field present but broken). Missing → soft fail (all-ralph fallback, `maxPhase: undefined`). Invalid → hard fail (plugin won't start). This distinction is critical per AC-2.

### A.4: Phase 3 Test Strategy for Module A

| Test Scenario | Expected Result |
|---|---|
| Missing loopPhases → parseLoopPhases(undefined) | `{ loopPhaseMap: {}, maxPhase: undefined }` |
| Empty loopPhases `{}` → parseLoopPhases({}) | LoopConfigError |
| Unknown loopType `{ "custom": [1,2] }` | LoopConfigError |
| Overlapping phases `{ "ralph": [1,2,3], "followup": [3,4] }` | LoopConfigError |
| Gap `{ "ralph": [1,3,4,5], "followup": [6,7] }` (missing phase 2) | LoopConfigError — incomplete coverage |
| Phase 4 = followup | LoopConfigError — structural constraint |
| Valid config `{ "ralph": [1,2,3,4,5], "followup": [6,7] }` | `{ loopPhaseMap: {1:'ralph',...,7:'followup'}, maxPhase: 7 }` |
| Duplicate within group `{ "ralph": [1,2,2,3] }` | LoopConfigError |
| ConfigValidationError thrown in loadWatchdogConfig | Plugin init fails (index.ts returns null) |

### A.5: Integration Test Strategy (Cross-Module)

| Scenario | Modules Covered | Expected Result |
|---|---|---|
| Valid config → full chain | A→B→D | loadWatchdogConfig returns loopPhasesResult → pipeline_start → state has correct loopPhaseMap + maxPhase |
| Missing config → full chain | A→B→D | loopPhasesResult = { {}, undefined } → pipeline_start → maxPhase = totalPhases, loopPhaseMap = {}, all phases treated as ralph |
| Invalid config → hard fail | A→D | parseLoopPhases returns LoopConfigError → loadWatchdogConfig throws ConfigValidationError → index.ts returns null |
| Followup phase full flow | B→C→D | phase_enter(6) → user_approval(6) (phaseStatus active→awaiting_approval) → phase_complete(6) (awaiting_approval→complete). Rule 2 allows Phase 7 deliverable with ralphCompleted=false |
| **Note on JS runtime behavior** | A | PhaseLoopMap keys are `number`-typed in TypeScript but runtime string keys per JS object semantics. Access via `loopPhaseMap[phase]` works correctly due to JS implicit number→string coercion. `Object.keys()` returns strings — use `Object.entries()` or explicit conversion when iterating. |

---

## Module B: State Machine (transitions.ts)

### B.1: Helper — getLoopType

```typescript
/** Get loop type for a phase. Returns 'ralph' as fallback for legacy states
 *  (no loopPhaseMap) or missing config. Safe because AC-2 completeness validation
 *  guarantees all phases are in the map for valid configs. (D-7)
 *  Defined in loop-config.ts as shared utility for all modules.
 *  Uses structural type parameter to avoid circular dependency with schema.ts. */
export function getLoopType(state: { loopPhaseMap?: PhaseLoopMap }, phase: number): LoopType {
  return state.loopPhaseMap?.[phase] ?? 'ralph'
}
```

**Note**: `getLoopType` lives in `loop-config.ts` (Module A) as a shared contract, making it available to both Module B (transitions.ts) and Module C (intercept-rules.ts) without creating circular dependencies. Uses structural typing (`{ loopPhaseMap?: PhaseLoopMap }`) instead of importing `PipelineState` from schema.ts, preserving loop-config.ts as a true foundation module with no upstream dependencies.

**Import requirement**: Both `transitions.ts` (Module B) and `intercept-rules.ts` (Module C) need `import { getLoopType, type LoopType } from './loop-config.js'`. Module B additionally uses `LoopType` for type assertions in B.3.

### B.2: pipeline_start — validate (AC-1)

**No changes to validate**. `pipeline_start` always succeeds (current behavior). `totalPhases` in payload still accepted for backward compat.

### B.3: pipeline_start — apply (AC-1)

**Changes**: Add `maxPhase` and `loopPhaseMap` to the new state object. Note: `pipeline_start` creates a **brand new** state object (no spread from previous state).

```typescript
case 'pipeline_start': {
  const totalPhases = ... // existing logic (backward compat, written to state)
  const loopPhaseMap = (payload._loopPhaseMap as Record<number, LoopType>) ?? {}
  const maxPhase = (payload._maxPhase as number | undefined) ?? totalPhases
  return {
    version: SCHEMA_VERSION,
    projectId: payload._projectId as string,
    runId: payload._runId as string,
    startedAt: now,
    description: payload.description as string,
    currentPhase: 0,
    phaseStatus: 'idle',
    totalPhases,                    // deprecated, kept for backward compat
    maxPhase,                       // NEW: from loopPhases config or totalPhases fallback
    loopPhaseMap,                   // NEW: phase → loop type mapping
    phases: {},
    ralph: null,
    testEvidenceConfirmed: false,
    lastCheckpointAt: now,
    ownerSessionId: payload._ownerSessionId as string | undefined,
  }
}
```

**Injection path**: `checkpoint.ts` injects `_loopPhaseMap` and `_maxPhase` into payload (like `_runId`, `_projectId`). Source: `LoopConfigResult` from watchdog config.

**Fallback behavior**: When `loopPhases` config is missing → `_loopPhaseMap = {}`, `_maxPhase = undefined` → `maxPhase ?? totalPhases` uses totalPhases (from payload or default 5). AC-2's "默认值 7" is the **tdd-pipeline convention** (7 phases), while the watchdog's backward-compat default is 5. When `loopPhases` IS configured, maxPhase comes from config and overrides totalPhases.

### B.4: phase_enter — validate (AC-1)

**Change**: Replace `state.totalPhases` with effective max for boundary check.

```typescript
// Before:
if (phase > state.totalPhases) { ... }
// After:
const effectiveMax = state.maxPhase ?? state.totalPhases
if (phase > effectiveMax) {
  return fail('Phase exceeds pipeline total', `Phase ${phase} exceeds pipeline total of ${effectiveMax} phases.`)
}
```

### B.5: ralph_loop_start — validate (AC-7, KI-59)

**Add loopType guard** after existing checks:
```typescript
case 'ralph_loop_start': {
  // ... existing checks (state not null, phase match, phaseStatus='active') ...
  
  // NEW: loopType guard
  const loopType = getLoopType(state, state.currentPhase)
  if (loopType !== 'ralph') {
    return fail(
      'ralph_loop_start not allowed for followup phase',
      `Phase ${state.currentPhase} is a followup phase (${loopType}), does not use Ralph loop. Followup phases proceed: phase_enter → user_approval → phase_complete.`
    )
  }
  return ok()
}
```

### B.6: user_approval — validate (AC-3)

**Replace unconditional ralphCompleted check with loopType-aware logic**:

```typescript
case 'user_approval': {
  // ... existing checks (state not null, phase match, rec exists) ...
  
  const loopType = getLoopType(state, phase)
  
  if (loopType === 'ralph') {
    // Ralph phase: require ralphCompleted + no escalation
    if (!rec.ralphCompleted) {
      return fail('Ralph loop not completed', ...)
    }
    if (state.ralph?.escalated || rec.ralphTermination === 'escalated') {
      return fail('Ralph loop escalated', ...)
    }
  } else if (loopType === 'followup') {
    // Followup phase: skip ralphCompleted + escalated, require phaseStatus='active'
    if (state.phaseStatus !== 'active') {
      return fail(
        'Phase not active',
        `user_approval for followup phase requires phaseStatus='active' (current: '${state.phaseStatus}'). Followup phases do not use Ralph loop.`
      )
    }
  } else {
    // Defensive: unknown loopType — should never happen given getLoopType's
    // fallback, but fail-safe for future LoopType extensions.
    return fail('Unknown loop type', `Phase ${phase} has unrecognized loop type '${loopType}'.`)
  }
}
```

### B.7: user_approval — apply (AC-13)

**Add loopType-aware phaseStatus transition**:

```typescript
case 'user_approval': {
  const phase = payload.phase as number
  const loopType = getLoopType(state, phase)
  
  // Common: set userApproved + approvedAt
  const base = {
    ...state,
    phases: {
      ...state.phases,
      [phase]: {
        ...state.phases[phase],
        userApproved: true,
        approvedAt: now,
      },
    },
    lastCheckpointAt: now,
  }
  
  // Followup-specific: transition phaseStatus active → awaiting_approval
  if (loopType === 'followup') {
    return { ...base, phaseStatus: 'awaiting_approval' }
  }
  // Ralph: phaseStatus already 'awaiting_approval' (set by ralph_terminate).
  // Invariant: validate ensures ralphCompleted=true, which implies ralph_terminate
  // was called, which set phaseStatus='awaiting_approval'. Apply is safe to no-op.
  return base
}
```

### B.8: phase_complete — validate (AC-8)

**No changes**. AC-8 explicitly states `phase_complete` does not directly check `ralphCompleted` — the invariant is guaranteed by the ordered call sequence (user_approval must precede phase_complete).

### B.9: phase_complete — apply

**No changes**. Sets `phaseStatus: 'complete'`, clears `ralph: null` — same for both loopTypes.

### B.9a: Implicit Protection for Followup Phases

For followup phases, `ralph_loop_start` is explicitly rejected (B.5). This means `phaseStatus` never transitions from `'active'` to `'ralph_loop'`. Consequently, `ralph_round_complete`, `ralph_round_finding`, and `ralph_terminate` are **implicitly rejected** by their existing `phaseStatus !== 'ralph_loop'` checks in `validateTransition` — no new code needed. This invariant should be documented but does not require implementation changes.

### B.10: Phase 3 Test Strategy for Module B

| Test Scenario | Event | LoopType | Expected Result |
|---|---|---|---|
| Followup phase calls ralph_loop_start | ralph_loop_start | followup | Rejected: "followup phase, does not use Ralph loop" |
| Ralph phase user_approval before ralphCompleted | user_approval | ralph | Rejected: "Ralph loop not completed" |
| Followup phase user_approval with phaseStatus=active | user_approval | followup | Accepted, phaseStatus → awaiting_approval |
| Followup phase user_approval with phaseStatus=complete | user_approval | followup | Rejected: "Phase not active" |
| Followup phase user_approval apply sets phaseStatus | user_approval apply | followup | newState.phaseStatus === 'awaiting_approval' |
| Legacy state (no loopPhaseMap) user_approval | user_approval | (fallback ralph) | Uses ralph rules (requires ralphCompleted) |
| phase_enter with maxPhase=7, phase=8 | phase_enter | any | Rejected: "Phase exceeds pipeline total" |
| phase_enter with maxPhase undefined, totalPhases=5, phase=6 | phase_enter | any | Rejected (effectiveMax = 5) |
| Pipeline_start creates state with loopPhaseMap | pipeline_start apply | — | newState.loopPhaseMap === injected map |
| Unknown loopType in user_approval | user_approval | 'custom' | Rejected: "Unknown loop type" (defensive else) |
| Ralph phase user_approval apply phaseStatus no-op | user_approval apply | ralph | newState.phaseStatus unchanged (already awaiting_approval from ralph_terminate) |
| Missing config pipeline_start apply | pipeline_start apply | — | newState.maxPhase === totalPhases (from payload or default 5), newState.loopPhaseMap === {} |

---

## Module C: Intercept Rules (intercept-rules.ts)

### C.1: Rule 2 — NO_PHASE_ADVANCE_WITHOUT_GATE (AC-12)

**Change**: Make `ralphCompleted` check conditional on loopType.

```typescript
// Rule 2: Phase Gate (loopType-aware)
{
  id: 'NO_PHASE_ADVANCE_WITHOUT_GATE',
  evaluate(tool, path, classification, state) {
    const currentPhase = state.currentPhase
    const rec = state.phases?.[currentPhase]
    
    if (
      classification.category === 'phase_deliverable' &&
      classification.phase === currentPhase + 1
    ) {
      const loopType = getLoopType(state, currentPhase)
      
      // Common: userApproved is always required
      if (!rec || !rec.userApproved) {
        const status = !rec ? 'phase not entered' : 'awaiting user approval'
        return { blocked: true, reason: `...Phase ${currentPhase} not yet user-approved...` }
      }
      
      // Ralph-specific: ralphCompleted is required
      if (loopType === 'ralph' && !rec.ralphCompleted) {
        return { blocked: true, reason: `...Phase ${currentPhase} Ralph loop incomplete...` }
      }
      // Followup: skip ralphCompleted (it's always false, correctly)
    }
    return { blocked: false }
  },
}
```

### C.2: Rule 1 — NO_BUSINESS_CODE_BEFORE_PHASE5

**No changes**. AC-12 says "Rule 1 checks Phase 4 which is always ralph — no loopType change needed." The structural constraint (AC-2 step 4) guarantees Phase 4 = ralph.

### C.3: createRules factory (wiring consideration)

**No signature change needed**. Rules read `loopPhaseMap` from `state` parameter which is already available. The `state.loopPhaseMap` field added by Module A is accessible without any wiring changes.

**Note**: `getLoopType` from `loop-config.ts` (see B.1) is used instead of inline access, maintaining consistency with State Access Pattern. This requires adding `import { getLoopType } from './loop-config.js'` to intercept-rules.ts — the only file-level change needed for Module C.

### C.4: Phase 3 Test Strategy for Module C

| Test Scenario | Rule | LoopType | Expected Result |
|---|---|---|---|
| Ralph phase deliverable without ralphCompleted | Rule 2 | ralph | Blocked: "Ralph loop incomplete" |
| Ralph phase deliverable with ralphCompleted + userApproved | Rule 2 | ralph | Not blocked |
| Followup phase deliverable with userApproved (ralphCompleted=false) | Rule 2 | followup | Not blocked (ralphCompleted skipped) |
| Followup phase deliverable without userApproved | Rule 2 | followup | Blocked: "not yet user-approved" |
| Legacy state (no loopPhaseMap) deliverable | Rule 2 | (fallback ralph) | Uses ralph rules (requires ralphCompleted) |

---

## Module D: Tools & Wiring

### D.1: tools.ts fix (AC-4)

**Change**: Add `ralph_round_finding` to z.enum array AND description string.

```typescript
// z.enum array (line 24-28):
event: z.enum([
  'pipeline_start', 'phase_enter', 'ralph_loop_start',
  'ralph_round_complete', 'ralph_round_finding', 'ralph_terminate',
  'test_evidence', 'user_approval', 'why_articulation', 'phase_complete',
])
```

**Note**: `ralph_round_finding` is **already fully implemented** in schema.ts (CheckpointEvent type, line 7) and transitions.ts (validate line 317-358, apply line 993-1048). The only gap is the tools.ts z.enum registration — this fix is a one-line enum addition + description string update. Phase 3 should focus tests on tools.ts registration only, not the existing transitions.ts logic.

**Complete updated description string**:
```
'Report a checkpoint event to the TDD pipeline watchdog. Call this at mandatory points during tdd-pipeline execution: pipeline_start, phase_enter, ralph_loop_start, ralph_round_complete, ralph_round_finding, ralph_terminate, user_approval, phase_complete. NOTE: test_evidence and why_articulation are also accepted but test_evidence is DEPRECATED (no longer gates behavior).'
```

**Impact**: Fixes runtime Zod rejection when LLM calls `tdd_checkpoint({ event: "ralph_round_finding", ... })`.

### D.2: checkpoint.ts changes (AC-1)

**Change 1**: Inject `_loopPhaseMap` and `_maxPhase` at pipeline_start.

```typescript
// In handle(), pipeline_start section (after existing _runId/_projectId injection):
if (event === 'pipeline_start') {
  // ... existing injection ...
  payload._loopPhaseMap = this.loopConfig.loopPhaseMap
  payload._maxPhase = this.loopConfig.maxPhase
}
```

**New dependency**: `CheckpointHandler` constructor receives `LoopConfigResult`:
```typescript
import type { LoopConfigResult } from './loop-config.js'

constructor(
  private store: PipelineStore,
  private staleThresholdMs: number,
  private loopConfig: LoopConfigResult,  // NEW
  private cache?: PipelineStateCache,
  private observer?: Observer,
  private logger?: Logger,
)
```

**Change 2**: Pipeline completion uses effectiveMax (maxPhase with fallback).

```typescript
// Line 365 (current):
if (event === 'phase_complete' && payload.phase === newState.totalPhases) {
// Changed to:
const effectiveMax = newState.maxPhase ?? newState.totalPhases
if (event === 'phase_complete' && payload.phase === effectiveMax) {
```

### D.3: index.ts wiring

**Changes**:
1. Import `isLoopConfigError`, `ConfigValidationError` from `loop-config.js`
2. Wrap `loadWatchdogConfig` in try/catch for `ConfigValidationError`
3. Extract `loopPhasesResult` from config
4. Pass to `CheckpointHandler` constructor:
   ```typescript
   try {
     watchdogConfig = loadWatchdogConfig(worktreeRoot, logger)
   } catch (err) {
     if (err instanceof ConfigValidationError) {
       logger.error('Watchdog config validation failed: %s', err.message)
       logger.error('Fix .opencode/watchdog.jsonc and restart the plugin.')
       return null  // Plugin fails to register
     }
     throw err
   }
   const loopConfig = watchdogConfig.loopPhasesResult
   const checkpointHandler = new CheckpointHandler(
     store, STALE_THRESHOLD_MS, loopConfig, cache, observer, logger
   )
   ```

### D.4: Phase 3 Test Strategy for Module D

| Test Scenario | Component | Expected Result |
|---|---|---|
| tools.ts z.enum contains ralph_round_finding | tools.ts | Enum accepts 'ralph_round_finding' |
| tools.ts description lists ralph_round_finding | tools.ts | String contains 'ralph_round_finding' |
| CheckpointHandler constructor accepts LoopConfigResult | checkpoint.ts | Compiles with new parameter |
| pipeline_start injects _loopPhaseMap + _maxPhase | checkpoint.ts | Payload receives injected values |
| Pipeline completion uses effectiveMax | checkpoint.ts | `maxPhase ?? totalPhases` used for archive trigger |
| ConfigValidationError in loadWatchdogConfig | index.ts | Plugin returns null (fails to register) |
| Legacy state (maxPhase undefined) pipeline completion | checkpoint.ts | Uses totalPhases as effectiveMax |

---

## Module E: Skill File Integration

### E.1: SKILL.md checkpoint call points (AC-5~AC-11)

**No code changes** — skill files are Markdown documents consumed by the LLM. Changes are editorial:

| Phase Boundary | Checkpoint Call | AC |
|---|---|---|
| Pipeline start | `tdd_checkpoint({ event: "pipeline_start", payload: JSON.stringify({ description: "<feature>" }) })` | AC-5 |
| Every phase start | `tdd_checkpoint({ event: "phase_enter", payload: JSON.stringify({ phase: N }) })` | AC-6 |
| Ralph phases (1-5) | `ralph_loop_start` → rounds → `ralph_terminate` | AC-7 |
| Followup phases (6-7) | `phase_enter(N)` → work → `user_approval(N)` → `phase_complete(N)` | AC-7, AC-13 |
| Phase approval | `tdd_checkpoint({ event: "user_approval", payload: JSON.stringify({ phase: N }) })` | AC-8 |
| Phase completion | `tdd_checkpoint({ event: "phase_complete", payload: JSON.stringify({ phase: N }) })` | AC-8 |
| Fail-open | "If `tdd_checkpoint` is not available, continue normal execution" | AC-9 |
| Ralph phases only | `why_articulation` called after articulation | AC-10 |
| GPAV format | `tdd_checkpoint({ event: "ralph_round_finding", payload: JSON.stringify({...}) })` | AC-11 |

### E.2: Key editorial changes to SKILL.md

1. Add loopType-aware phase flow table showing ralph vs followup checkpoint sequences
2. Update "Phase 6/7" sections to use followup flow (no ralph_loop_start/ralph_terminate)
3. Add fail-open section verbatim (AC-9)
4. Update `ralph-gpav.md` pseudo-code to use actual `tdd_checkpoint` format (AC-11)

### E.3: SKILL.md path

**Target**: `/Users/alex/tdd-pipeline/SKILL.md` (authoritative source, v0.10.0)
**Installed copy**: `~/.claude/skills/tdd-pipeline/SKILL.md` (follows authoritative)

### E.4: Phase 3 Test Strategy for Module E

| AC | Verification Method | Binary Pass/Fail |
|----|---------------------|-------------------|
| AC-5 | `grep SKILL.md for "pipeline_start" + "description"` — exactly one call point at pipeline beginning | ✅/❌ |
| AC-6 | `grep SKILL.md for "phase_enter" + "phase: N"` — call at every phase boundary | ✅/❌ |
| AC-7 | `grep SKILL.md for "ralph_loop_start"` — only appears in ralph-phase sections (not Phase 6/7) | ✅/❌ |
| AC-8 | `grep SKILL.md for "user_approval" then "phase_complete"` — ordered call sequence documented | ✅/❌ |
| AC-9 | `grep SKILL.md for "not available" OR "fail-open"` — canonical fail-open section present | ✅/❌ |
| AC-10 | `grep SKILL.md for "why_articulation"` — only appears in ralph-phase sections | ✅/❌ |
| AC-11 | `grep ralph-gpav.md for "tdd_checkpoint" + "ralph_round_finding"` — actual tool format (not pseudo-code) | ✅/❌ |

---

## Key Decisions

| # | Decision | Rationale | Alternatives Rejected |
|---|----------|-----------|----------------------|
| D-1 | Store `loopPhaseMap` in `PipelineState` | Preserves pure function signature for `validateTransition`; no caller changes; config immutable per run; naturally testable | (a) Add config parameter — breaks all callers, leaks config concern. (b) Factory closure — complex, overkill for static config. (c) Global/singleton — testability nightmare |
| D-2 | Keep `totalPhases` as deprecated field | Backward compat (AC-1); existing persisted states have it; no migration needed | Remove entirely — would require data migration for existing states |
| D-3 | Inject config at pipeline_start via payload `_loopPhaseMap`/`_maxPhase` | Consistent with existing pattern (`_runId`, `_projectId`, `_now`); keeps `applyTransition` pure | Read config from closure — would break `applyTransition` purity |
| D-4 | `getLoopType(state, phase)` helper with 'ralph' fallback | Legacy states (no `loopPhaseMap`) and missing config both produce empty map → all-ralph behavior preserved | Throw on missing map — would break existing pipelines |
| D-5 | Hard-fail on invalid `loopPhases` at plugin init | AC-2/Constraints explicit: "plugin 初始化失败". Catches config errors early | Soft-fail with fallback — hides misconfiguration, violates AC-2 intent |
| D-6 | `user_approval` apply sets `phaseStatus='awaiting_approval'` for followup | AC-13 requires this transition; `phase_complete` validates `phaseStatus === 'awaiting_approval'` | Separate `followup_approval` event — violates System Boundaries (no new event types) |
| D-7 | `getLoopType` returns 'ralph' fallback, doesn't reject on missing phase (**deviation from AC-3** "Phase not in map → reject") | AC-2 completeness validation guarantees all phases in map; fallback only for legacy states (no map) or missing config (empty map). Rejection would be dead code and would break legacy state backward compat. | Reject on missing phase — adds complexity with no safety benefit; contradicts backward compat goal |
| D-8 | Watchdog default totalPhases=5 preserved (not changed to 7) | AC-2's "默认值 7" is the tdd-pipeline SKILL.md convention (always passes totalPhases=7). Watchdog's default 5 is pre-loopPhases backward compat. In practice, SKILL.md always provides totalPhases, so default never triggers. Changing default would break non-tdd-pipeline users. | Change default to 7 — breaks backward compat for non-tdd-pipeline users of watchdog |

---

## Failure Mode Handling

| Failure Scenario | Priority | Design Response |
|---|---|---|
| Invalid loopPhases config (unknown type, overlap, gap, Phase 4=non-ralph) | Key | `parseLoopPhases` returns `LoopConfigError` → `loadWatchdogConfig` throws `ConfigValidationError` → plugin init fails with clear error message |
| Missing loopPhases config | Key | `parseLoopPhases` returns empty map → `getLoopType` returns 'ralph' for all phases → maxPhase from payload.totalPhases or default 5 (watchdog backward-compat; tdd-pipeline SKILL.md passes totalPhases=7) (AC-2 fallback, D-8) |
| Legacy state (no loopPhaseMap/maxPhase fields) | Key | `getLoopType` returns 'ralph' fallback; effectiveMax uses `totalPhases` fallback — full backward compat |
| LLM calls ralph_loop_start on followup phase | Key | `validateTransition` rejects with guidance explaining followup flow (AC-7) |
| LLM calls user_approval on followup phase with wrong phaseStatus | Key | Validate requires `phaseStatus='active'` (AC-3/F-48); if phase already complete, rejected |
| Followup user_approval called after phase_complete (regression) | Key | phaseStatus='complete' ≠ 'active' → rejected. Prevents regression (AC-3 F-48) |
| Config changed mid-run | Peripheral | loopPhaseMap embedded in state at pipeline_start → immutable per run. New config takes effect on next run only (AC-2) |
| tools.ts enum still missing ralph_round_finding (existing bug) | Key | AC-4 fix: add to z.enum + description string. Immediate runtime fix |
| Rule 2 blocks followup phase deliverables (KI-58) | Key | loopType-aware check: skip ralphCompleted for followup phases (AC-12) |

---

## Non-functional Constraints

| Dimension | Requirement | Design Response |
|---|---|---|
| **Concurrency/blocking** | Watchdog is sync; no async in state machine | No change. `parseLoopPhases` is sync. All transitions remain sync. |
| **Operation reversibility** | pipeline_start archives old run | No change. Existing archive mechanism works with new schema. |
| **Data isolation** | Pipeline state is per-project | No change. loopPhaseMap is per-run state. |
| **Resource boundaries** | loopPhaseMap is O(phases) ≈ O(7) | Trivial memory. No concern. |
| **Extension vectors** | New loop types in future | `LoopType` is a union type. Adding a new type requires: (1) extend parseLoopPhases validation, (2) add validation/apply logic in transitions.ts. Impact: 3 files. |
| **Cost constraints** | N/A (no external services) | — |
| **Compliance** | Trust-based security model | No change. loopType config is local, no network. |
| **Performance** | No measurable impact | Config parsed once at init, stored in state. No per-call overhead. |
| **Maintainability** | Requirement change affects ≤2 modules | Verified: loopType behavior change → transitions.ts + intercept-rules.ts. Config format change → loop-config.ts only. New event type → out of scope. |

---

## KI Resolution Status

| KI | Severity | Phase 2 Resolution | Module |
|---|---|---|---|
| KI-55 | L | **Resolved**: loopPhaseMap stored in state → `validateTransition` reads from state, no parameter needed | B |
| KI-56 | L | **Resolved**: maxPhase added to schema, totalPhases deprecated but retained. Migration via effectiveMax fallback. | A, B, D |
| KI-57 | L | **Closed**: Requirement corrected (rollback from Phase 1 only). No code change needed. | — |
| KI-58 | M | **Resolved**: Rule 2 loopType-aware, reads state.loopPhaseMap | C |
| KI-59 | M | **Resolved**: ralph_loop_start validate checks loopType, rejects followup | B |
| KI-60 | L | **Deferred**: Trust-based model limitation. Not addressable by this design. | — |

---

## Priority Classification & Phase 1 Traceability

### Forward Check: Every Phase 1 core AC → ≥1 Phase 2 key component

| Phase 1 Core AC | Phase 2 Key Components | Status |
|---|---|---|
| AC-1 (pipeline_start simplify + maxPhase) | loop-config.ts, schema.ts, transitions.ts (validate+apply), checkpoint.ts | ✅ |
| AC-2 (loopPhases config) | loop-config.ts, watchdog-config.ts | ✅ |
| AC-3 (user_approval loopType-aware) | transitions.ts (validate+apply) | ✅ (deviation D-7: getLoopType fallback 替代 AC-3 'reject on missing phase') |
| AC-4 (tools.ts enum fix) | tools.ts | ✅ |
| AC-5 (pipeline_start once) | SKILL.md (E.1) | ✅ |
| AC-6 (phase_enter every phase) | SKILL.md (E.1) | ✅ |
| AC-7 (ralph/followup checkpoint sequences) | transitions.ts (ralph_loop_start guard), SKILL.md (E.1) | ✅ |
| AC-8 (approval then complete order) | transitions.ts (no change needed), SKILL.md (E.1) | ✅ |
| AC-9 (fail-open section) | SKILL.md (E.2) | ✅ |
| AC-10 (why_articulation ralph only) | SKILL.md (E.2) | ✅ |
| AC-11 (GPAV actual format) | ralph-gpav.md (E.2) | ✅ |
| AC-12 (intercept-rules loopType-aware) | intercept-rules.ts | ✅ |
| AC-13 (followup phaseStatus lifecycle) | transitions.ts (user_approval apply) | ✅ |

### Reverse Check: Key components without core AC trace

| Key Component | Core AC Trace | Intentional? |
|---|---|---|
| loop-config.ts | AC-2 | ✅ Direct |
| transitions.ts | AC-1, AC-3, AC-7, AC-13 | ✅ Direct |
| intercept-rules.ts | AC-12 | ✅ Direct |
| checkpoint.ts | AC-1 | ✅ Direct |
| SKILL.md / ralph-gpav.md | AC-5~AC-11 | ✅ Direct (editorial, verified via E.4 test strategy) |

**No priority downgrades** from Phase 1.

---

## Open Technical Questions

| # | Question | Resolution |
|---|---|---|
| OTQ-1 | Should `parseLoopPhases` be a separate module or part of `watchdog-config.ts`? | **Resolved**: Separate `loop-config.ts` — single responsibility, testable in isolation, no circular deps with config loader |
| OTQ-2 | Schema version bump needed? PipelineState gains 2 fields. | **Resolved**: No bump. New fields (`maxPhase?`, `loopPhaseMap?`) are optional. Legacy v3 states simply lack them; runtime uses `??` fallback. This avoids migration entirely. |
| OTQ-3 | Should `phase_enter` validate that the phase exists in `loopPhaseMap`? | **No**: AC-2 validates completeness (1..maxPhase all covered) at init time. If we reach phase_enter, the map is valid. Defensive check would be redundant. |

---

## Gate: Reviewer Checklist

```
gate_pass = ALL:
  coverage:     all Phase1.AC covered by design ✅
  classification: all components/interfaces/failure_modes ∈ {key, peripheral} ✅
  consistency:  Phase1.core → maps_to ≥ 1 Phase2.key ✅
  testability:  interfaces concrete enough for test authoring ✅
  failure:      error paths designed (not just happy path) ✅
  lean:         every abstraction justified (no over-engineering) ✅
  boundary:     single_responsibility + blast_radius + min_api_surface ✅
  decisions:    alternatives + trade-offs recorded ✅
  nfr:          non-functional constraints documented ✅
  ralph:        zero C/H/M issues (pending review)
```

---

## Ralph Loop Review Log

### Round 1 (R1 — dual-pass Recall only)
- **Recall**: 16 findings (1C, 4H, 7M, 4L, 3I)
- **Precision**: skipped — all C/H/M high confidence (≥0.85)
- **Confirmed findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-01 | **C** | maxPhase=0 sentinel breaks AC-2 fallback (0 ?? totalPhases = 0) | maxPhase 改为 `number \| undefined`，missing config 时返回 undefined |
| F-02 | **H** | PipelineState 新字段声明为 required 但消费端用 optional chaining | 改为 `maxPhase?: number` 和 `loopPhaseMap?: Record<number, LoopType>` |
| F-03 | **H** | getLoopType fallback 与 AC-3 "Phase not in map → reject" 矛盾 | 文档化设计决策 D-7：AC-2 completeness 保证 runtime 检查冗余 |
| F-04 | **H** | ConfigValidationError class 和 isLoopConfigError type guard 未定义 | 添加到 Shared Contracts |
| F-05 | **H** | WatchdogConfig 字段名不一致（loopPhases vs loopPhasesResult） | 统一为 loopPhasesResult |
| F-06 | M | parseAndValidateLoopPhases 与 parseLoopPhases 名称混用 | 删除 parseAndValidateLoopPhases 引用 |
| F-07 | M | B.3 使用 ...existing 但 pipeline_start 创建全新对象 | 改为完整对象字面量 |
| F-08 | M | AC-2 说默认值 7 但代码默认值 5 不一致 | 文档化：7 是 tdd-pipeline 约定，5 是 watchdog backward-compat 默认值 |
| F-09 | M | A.3 包含决策思考过程而非最终设计 | 简化为最终设计 + Key Decisions 表格 |
| F-10 | M | Schema version bump 需要决定 | 决定：不 bump，新字段 optional |
| F-11 | M | 未说明 transitions.ts 已完整实现 ralph_round_finding | D.1 添加说明 |
| F-12 | M | user_approval validate 无 else 兜底 | 添加防御性 else 分支 |
| F-13 | M | pipeline completion effectiveMax 同 F-01 问题 | 由 F-01 修复覆盖 |

### R1 Fixes Applied

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| F-01 (C) | maxPhase: number → number \| undefined; parseLoopPhases 返回 undefined 而非 0 | Shared Contracts, A.1, B.3 |
| F-02 (H) | PipelineState 新字段改为 optional (?) | A.2 |
| F-03 (H) | 添加设计决策 D-7 解释 getLoopType fallback 合理性 | State Access Pattern, B.1 |
| F-04 (H) | 添加 ConfigValidationError class 和 isLoopConfigError type guard | Shared Contracts |
| F-05 (H) | WatchdogConfig 统一使用 loopPhasesResult | A.3, D.3 |
| F-06 (M) | 删除 parseAndValidateLoopPhases 引用 | A.3 |
| F-07 (M) | B.3 改为完整对象字面量 | B.3 |
| F-08 (M) | 文档化 5 vs 7 差异 | B.3 |
| F-09 (M) | A.3 简化为最终设计 | A.3 |
| F-10 (M) | 决定不 bump schema version，optional 字段 | A.2, OTQ-2 |
| F-11 (M) | D.1 添加说明 | D.1 |
| F-12 (M) | B.6 添加 else 分支 | B.6 |
| F-13 (M) | 由 F-01 修复覆盖 | D.2 |

### Round 2 (R2 — Recall only)
- **Recall**: 13 findings (0C, 1H, 5M, 4L, 3I)
- **All R1 fixes verified**: F-01(C) ✅ resolved, F-02~F-05(H) ✅ resolved, F-06~F-13(M) ✅ resolved
- **New findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-01 | **H** | A.2 字段声明仍为 required（R1 F-02 修复未落地） | 再次修复 A.2 为 optional |
| F-02 | M | 默认 5 vs 7 差异未作为正式 Design Decision 记录 | 添加 D-8 |
| F-03 | M | Component Breakdown 中 loop-config.ts 依赖方向错误 | 改为 None (foundation) |
| F-04 | M | parseLoopPhases 算法 4b 验证细节不足 | 展开为子步骤 |
| F-05 | M | Module E 缺乏 Phase 3 测试策略 | 添加 E.4 test strategy 表 |
| F-06 | M | R1 fix F-02 未实际落地（同 F-01） | 由 F-01 修复覆盖 |
| F-07 | M | Priority Classification 表遗漏 AC-5~AC-11 | 补充完整 trace |

### R2 Fixes Applied

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| F-01 (H) | A.2 字段声明改为 optional (maxPhase?, loopPhaseMap?)，添加 SCHEMA_VERSION 说明 | A.2 |
| F-02 (M) | 添加 Key Decision D-8 记录 5 vs 7 差异 | Key Decisions |
| F-03 (M) | loop-config.ts Dependencies 改为 None (foundation) | Component Breakdown |
| F-04 (M) | parseLoopPhases step 4b 展开为 4b/4c/4d 子步骤 | A.1 |
| F-05 (M) | 添加 E.4 Phase 3 Test Strategy 表 | Module E |
| F-06 (M) | 由 F-01 修复覆盖 | A.2 |
| F-07 (M) | Forward Check 表补充 AC-5~AC-11，Reverse Check 补充 SKILL.md | Priority Classification |

### Round 3 (R3 — Recall only)
- **Recall**: 15 findings (0C, 1H, 6M, 5L, 3I)
- **All R2 fixes verified**: ✅ F-01(H) A.2 now optional, F-02~F-07(M) all resolved
- **New findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| H-01 | **H** | Failure Mode 表写 "default 7" 与 D-8 (default 5) 矛盾 | 修正为 "default 5" |
| M-01 | M | ralph-gpav.md 缺失于 Component Breakdown | 添加组件行 |
| M-02 | M | C.1 用 inline 访问而非 getLoopType helper | getLoopType 移至 loop-config.ts (shared)，C.1 改用 helper |
| M-03 | M | Shared Contracts maxPhase 注释上下文歧义 | 区分 LoopConfigResult vs PipelineState 语义 |
| M-04 | M | D-7 deviation from AC-3 未显式标记 | 添加 deviation 标记 |
| M-05 | M | parseLoopPhases 步骤 6 overlap 检测算法未具体说明 | 改为 sum-vs-size 方法 |
| M-06 | M | Module A-D 缺少 Phase 3 测试策略 | 添加 A.4/B.10/C.4/D.4 测试策略表 |

### R3 Fixes Applied

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| H-01 (H) | Failure Mode 表 "default 7" → "default 5" + SKILL.md 说明 | Failure Modes |
| M-01 (M) | 添加 ralph-gpav.md 到 Component Breakdown | Component Breakdown |
| M-02 (M) | getLoopType 移至 loop-config.ts (shared)，C.1 改用 helper | B.1, C.1 |
| M-03 (M) | Shared Contracts maxPhase 注释区分上下文 | Shared Contracts |
| M-04 (M) | D-7 添加 deviation from AC-3 标记 | Key Decisions |
| M-05 (M) | parseLoopPhases step 6 改为 sum-vs-size 方法 | A.1 |
| M-06 (M) | 添加 A.4/B.10/C.4/D.4 Phase 3 Test Strategy 表 | Modules A-D |
| L-01 (L) | 架构图标注 optional (?) | Architecture Overview |
| L-02 (L) | A.2 schema 用 PhaseLoopMap 别名 | A.2 |

### Round 4 (R4 — Recall only)
- **Recall**: 22 findings (0C, 3H, 13M, 5L, 1I)
- **All R3 fixes verified**: ✅ H-01/M-01~M-06 resolved
- **New findings (key)**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| F-01 | **H** | loadWatchdogConfig 3 个 fallback return path 缺 loopPhasesResult | 重写 A.3 为完整代码，所有路径含 loopPhasesResult |
| F-02 | **H** | loopPhases 解析位置在 phaseDeliverables if/else 内，独立 config 会被忽略 | loopPhases 解析移至 phaseDeliverables 检查之前 |
| F-03 | **H** | 缺少跨模块集成测试策略 | 添加 A.5 Integration Test Strategy |
| F-05 | M | A.2 仍用 Record<number, LoopType> 而非 PhaseLoopMap 别名 | 改为 PhaseLoopMap |
| F-06 | M | C.3 未提及 getLoopType import | 添加 import 说明 |
| F-09 | M | B.10 缺 ralph no-op 测试 | 添加 ralph phaseStatus 不变测试 |
| F-10 | M | followup 下 ralph 系列事件隐式保护未文档化 | 添加 B.9a |
| F-11 | M | tools.ts description string 未展示完整文本 | 添加完整 description |
| F-12 | M | Forward Check AC-3 缺 deviation 注释 | 添加 D-7 deviation 标注 |
| F-13 | M | 空数组 loopType value 语义模糊 | 算法添加 step 4c: 空数组 → LoopConfigError |
| F-16 | M | pipeline_start apply fallback 测试缺失 | B.10 添加 missing config 场景 |

### R4 Fixes Applied

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| F-01+F-02 (H) | A.3 重写为完整代码：所有 return path 含 loopPhasesResult，loopPhases 解析独立于 phaseDeliverables | A.3 |
| F-03 (H) | 添加 A.5 Integration Test Strategy + JS key coercion note | A.5 |
| F-05 (M) | A.2 改用 PhaseLoopMap 别名 | A.2 |
| F-06 (M) | C.3 添加 getLoopType import 说明 | C.3 |
| F-09 (M) | B.10 添加 ralph no-op 测试 | B.10 |
| F-10 (M) | 添加 B.9a Implicit Protection 说明 | B.9a |
| F-11 (M) | D.1 添加完整 description string | D.1 |
| F-12 (M) | Forward Check AC-3 添加 deviation 注释 | Priority Classification |
| F-13 (M) | A.1 添加 step 4c 空数组拒绝 | A.1 |
| F-16 (M) | B.10 添加 missing config pipeline_start apply 测试 | B.10 |

### Round 5 (R5 — Recall only)
- **Recall**: 8 findings (0C, 0H, 3M, 4L, 1I)
- **All R4 fixes verified**: ✅ F-01/F-02/F-03(H) all landed, F-05~F-16(M) all resolved
- **Consecutive-zero C/H count**: 1 (R5 = 0C/0H)
- **New findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| M-1 | M | A.2 import LoopType 但字段用 PhaseLoopMap — import 错配 | 改为 import PhaseLoopMap |
| M-2 | M | getLoopType(state: PipelineState) 造成 loop-config ↔ schema 循环依赖 | 改为结构类型参数 `{ loopPhaseMap?: PhaseLoopMap }` |
| M-3 | M | Module B 未提及 getLoopType import | B.1 添加 import 说明 |

### R5 Fixes Applied

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| M-1 (M) | A.2 import 改为 PhaseLoopMap | A.2 |
| M-2 (M) | getLoopType 改为结构类型参数，消除循环依赖 | B.1 |
| M-3 (M) | B.1 添加 import 说明（B 和 C 模块都需要） | B.1 |

### Round 6 (R6 — Recall only)
- **Recall**: 10 findings (0C, 0H, 4M, 5L, 1I)
- **All R5 fixes verified**: ✅ M-1/M-2/M-3 all resolved
- **Consecutive 0C/0H count**: 2 (R5 + R6)
- **New findings**:

| ID | Severity | Problem | Action |
|---|---|---|---|
| M-4 | M | B.1 import 缺 LoopType 类型 | 补充 type LoopType import |
| M-5 | M | A.3 缺 watchdog-config.ts import 语句 | 添加 import 说明 |
| M-6 | M | WatchdogConfig 接口缺 loopPhasesResult 字段定义 | 添加完整 interface |
| M-7 | M | A.4 gap 测试用例实际为有效配置 | 修正为有 gap 的配置 |

### R6 Fixes Applied

| Finding | Fix | Section Changed |
|---------|-----|-----------------|
| M-4 (M) | B.1 import 补充 type LoopType | B.1 |
| M-5 (M) | A.3 添加 watchdog-config.ts import 说明 | A.3 |
| M-6 (M) | A.3 添加完整 WatchdogConfig interface | A.3 |
| M-7 (M) | A.4 gap 测试用例修正 | A.4 |
| L-1 (L) | D.2 添加 checkpoint.ts import 说明 | D.2 |
| L-4 (L) | Component Breakdown loop-config.ts Interface 列完整化 | Component Breakdown |
| L-5 (L) | A.1 step 7 格式统一 | A.1 |
