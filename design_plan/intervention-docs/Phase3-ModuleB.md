# Phase 3 — Module B: File Interception

**Version**: 1.0
**Split From**: Phase3-TestPlan.md
**Source Design**: Phase2-ActiveMonitoring.md §7, §15a
**Dependencies**: Phase3-Shared.md (mock conventions, dependency graph)

---

## Components Under Test

| File | Tier | Status |
|------|------|--------|
| `packages/watchdog/src/interceptor.ts` | 3 | **NEW** |
| `packages/watchdog/src/path-extractor.ts` | 2 | **NEW** |
| `packages/watchdog/src/file-classifier.ts` | 2 | **NEW** |
| `packages/watchdog/src/intercept-rules.ts` | 2 | **NEW** |
| `packages/watchdog/src/watchdog-config.ts` | 2 | **NEW** |
| `packages/watchdog/src/state-cache.ts` | 2 | **NEW** (shared) |

## Test Files

| File | Tests |
|------|-------|
| `test/path-extractor.test.ts` | 8 tests |
| `test/file-classifier.test.ts` | 8 tests |
| `test/interceptor.test.ts` | 21 tests |
| `test/watchdog-config.test.ts` | 7 tests |

---

## Interceptor Tests (interceptor.test.ts)

### TC-B-01 (#1): Non-monitored tool returns without reading cache

**Source**: §7.8 #1
**Priority**: Key
**Preconditions**: monitoredTools=['edit','write']
**Input**: `interceptor.handle('read', {filePath:'foo.ts'}, 'sess-001', 'call-300')`
**Expected**: Returns normally; cache.get NOT called
**Covers**: C-3, §7.2

### TC-B-02 (#2): Monitored tool with null cache returns silently

**Source**: §7.8 #2
**Priority**: Key
**Preconditions**: cache returns null
**Input**: `interceptor.handle('edit', {filePath:'foo.ts'}, 'sess-001', 'call-301')`
**Expected**: Returns normally
**Covers**: AC-8, §7.2

### TC-B-14 (#10): Rule 1 -- Phase 4, no evidence, business code -> throws

**Source**: §7.8 #10
**Priority**: Key
**Preconditions**: currentPhase=4, testEvidenceConfirmed=false
**Input**: `interceptor.handle('edit', {filePath: '/project/src/foo.ts'}, 'sess-001', 'call-302')`
**Expected**: Throws WatchdogInterceptError with "business code write blocked"
**Covers**: AC-3, Rule 1, §7.5

### TC-B-15 (#11): Rule 1 -- Phase 4, evidence confirmed, business code -> allows

**Source**: §7.8 #11
**Priority**: Key
**Preconditions**: testEvidenceConfirmed=true
**Input**: Same file path as TC-B-14
**Expected**: Returns normally
**Covers**: AC-3 edge, §7.5

### TC-B-16 (#12): Rule 1 -- Phase 4, no evidence, test file -> allows

**Source**: §7.8 #12
**Priority**: Key
**Preconditions**: testEvidenceConfirmed=false, file is test_file
**Input**: `interceptor.handle('edit', {filePath: '/project/tests/foo.test.ts'}, 'sess-001', 'call-304')`
**Expected**: Returns normally
**Covers**: AC-3 edge, §7.5

### TC-B-17 (#13): Rule 2 -- Phase 2 incomplete, Phase 3 deliverable -> throws

**Source**: §7.8 #13
**Priority**: Key
**Preconditions**: currentPhase=2, phase 2 not ralphCompleted
**Input**: `interceptor.handle('write', {file: 'test-plan.md'}, 'sess-001', 'call-305')`
**Expected**: Throws WatchdogInterceptError with "Phase transition blocked"
**Covers**: AC-4, Rule 2, §7.5

### TC-B-18 (#14): Rule 2 -- Phase 2 complete+approved, Phase 3 deliverable -> allows

**Source**: §7.8 #14
**Priority**: Key
**Preconditions**: currentPhase=2, phase 2 ralphCompleted=true, userApproved=true
**Input**: Same as TC-B-17
**Expected**: Returns normally
**Covers**: AC-4 edge, §7.5

### TC-B-19 (#15): Rule order -- AC-3 fires before AC-4

**Source**: §7.8 #15
**Priority**: Key
**Preconditions**: Both rules would apply (Phase 4, no evidence, business_code)
**Input**: `interceptor.handle('edit', {filePath: '/project/src/foo.ts'}, 'sess-001', 'call-307')`
**Expected**: Throws with AC-3 message ("business code write blocked"), not AC-4 message
**Covers**: C-7, §7.5

### TC-B-20 (#16): Disk read -- active run on disk returns state

**Source**: §7.8 #16
**Priority**: Key
**Preconditions**: multiAgent=true, store has state
**Input**: `cache.get()`
**Expected**: Returns PipelineState (not null)
**Covers**: C-8, §5.1

### TC-B-21 (#17): Disk read failure -- corrupt state returns null

**Source**: §7.8 #17
**Priority**: Key
**Preconditions**: multiAgent=true, store.readState throws
**Input**: `cache.get()`
**Expected**: Returns null; warning logged
**Covers**: C-8, §5.1

### TC-B-22 (#18): Unexpected error -> infrastructure failure

**Source**: §7.8 #18
**Priority**: Key
**Preconditions**: Internal error in classification
**Input**: Force extractFilePath to throw
**Expected**: Throws plain Error (not WatchdogInterceptError) with "[TDD Watchdog]" prefix
**Covers**: Fail-closed, §7.2

### TC-B-23 (#19): Error message includes restart guidance

**Source**: §7.8 #19
**Priority**: Key
**Expected**: Thrown error contains "restart the pipeline" guidance
**Covers**: Fail-closed, §7.2

### TC-B-24 (#20): WatchdogInterceptError instance check

**Source**: §7.8 #20
**Priority**: Key
**Expected**: Thrown violation instanceof WatchdogInterceptError === true
**Covers**: Error class, §7.2

### TC-B-25 (#21): Unexpected error NOT instanceof WatchdogInterceptError

**Source**: §7.8 #21
**Priority**: Key
**Preconditions**: cache.get() throws
**Expected**: thrown instanceof WatchdogInterceptError === false
**Covers**: Error class, §7.2

### TC-B-32 (#28): Custom monitoredTools -- hashline_edit intercepted

**Source**: §7.8 #28
**Priority**: Key
**Preconditions**: monitoredTools includes 'hashline_edit'
**Expected**: Evaluates rules for hashline_edit
**Covers**: Section 15a L3, §7.2

### TC-B-33 (#29): Default monitoredTools -- hashline_edit NOT intercepted

**Source**: §7.8 #29
**Priority**: Key
**Preconditions**: default monitoredTools (no hashline_edit)
**Expected**: Returns normally; cache.get NOT called
**Covers**: C-3 default, §7.2

### TC-B-36 (#32): Ownership -- orchestrator allowed

**Source**: §7.8 #32
**Priority**: Key
**Preconditions**: ownerSessionId='sess-orchestrator', caller='sess-orchestrator'
**Expected**: Returns ok=true
**Covers**: Section 5.5a, §15a L2

### TC-B-37 (#33): Ownership -- sub-agent rejected

**Source**: §7.8 #33
**Priority**: Key
**Preconditions**: ownerSessionId='sess-orchestrator', caller='sess-sub-agent'
**Expected**: ok=false, violation contains "belongs to another session"
**Covers**: Section 5.5a, §15a L2

### TC-B-38 (#34): Ownership -- sub-agent pipeline_start rejected (active exists)

**Source**: §7.8 #34
**Priority**: Key
**Preconditions**: Active pipeline exists
**Expected**: ok=false, violation contains "already active"
**Covers**: Single-pipeline constraint

### TC-B-39 (#35): Ownership rejection logged as audit BLOCK

**Source**: §7.8 #35
**Priority**: Key
**Expected**: appendAudit called with decision='BLOCK', violation contains 'owner_mismatch'
**Covers**: Section 5.5a

### TC-B-40 (#36): Disk read consistency -- orchestrator writes, sub-agent sees

**Source**: §7.8 #36
**Priority**: Key
**Preconditions**: multiAgent=true
**Expected**: After orchestrator writes, sub-agent cache.get() returns new state
**Covers**: Multi-agent consistency, §5.1

> **Note (M-3 fix)**: TC-B-42 (#38, Phase 1 state migration safety) and TC-B-43 (#39, empty sessionID rejection) are CheckpointHandler ownership tests, not Interceptor tests. They have been moved to `checkpoint-phase2.test.ts` in Module C. TC-B-43 (#39) has been **removed** (M-5: design doc §5.5a has no empty-sessionID validation; this should be added to design first before testing).

---

## PathExtractor Tests (path-extractor.test.ts)

### TC-B-03 (#3): edit with filePath

**Source**: §7.8 #3
**Priority**: Peripheral
**Input**: `extractFilePath('edit', {filePath: 'src/foo.ts'})`
**Expected**: Returns 'src/foo.ts'
**Covers**: OQ-3, §7.3

### TC-B-04 (#4): write with file

**Source**: §7.8 #4
**Priority**: Peripheral
**Input**: `extractFilePath('write', {file: 'src/bar.ts'})`
**Expected**: Returns 'src/bar.ts'
**Covers**: OQ-3, §7.3

### TC-B-05 (#5): edit with empty args returns null

**Source**: §7.8 #5
**Priority**: Peripheral
**Input**: `extractFilePath('edit', {})`
**Expected**: Returns null
**Covers**: §7.3

### TC-B-34 (#30): hashline_edit generic fallback

**Source**: §7.8 #30
**Input**: `extractFilePath('hashline_edit', {filePath: 'x.ts'})`
**Expected**: Returns 'x.ts'
**Covers**: PathExtractor fallback, §7.3

### TC-B-35 (#31): custom_tool path field

**Source**: §7.8 #31
**Input**: `extractFilePath('custom_tool', {path: 'y.ts'})`
**Expected**: Returns 'y.ts'
**Covers**: PathExtractor fallback, §7.3

### TC-B-44 (#40): first field wins

**Source**: §7.8 #40
**Input**: `extractFilePath('custom', {filePath: 'a', path: 'b'})`
**Expected**: Returns 'a' (filePath priority)
**Covers**: PathExtractor priority, §7.3

### TC-B-45: null args returns null

**Source**: §7.3 guard clause
**Priority**: Peripheral
**Input**: `extractFilePath('edit', null)`
**Expected**: Returns null
**Covers**: §7.3 type guard

### TC-B-46: string args returns null

**Source**: §7.3 guard clause
**Priority**: Peripheral
**Input**: `extractFilePath('edit', 'not-an-object')`
**Expected**: Returns null
**Covers**: §7.3 type guard

---

## FileClassifier Tests (file-classifier.test.ts)

### TC-B-06 (#6): src directory -> business_code

**Source**: §7.8 #6
**Priority**: Key
**Input**: `classifyFile('/project/src/utils/helper.ts', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'business_code'}
**Covers**: Rule 3, C-4, §7.4

### TC-B-07 (#7): tests directory -> test_file

**Source**: §7.8 #7
**Priority**: Key
**Input**: `classifyFile('/project/tests/auth.test.ts', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'test_file'}
**Covers**: Rule 1, C-4, §7.4

### TC-B-08 (#8): technical-spec.md -> phase_deliverable(2)

**Source**: §7.8 #8
**Priority**: Key
**Input**: `classifyFile('/project/docs/technical-spec.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'phase_deliverable', phase: 2}
**Covers**: Rule 4, C-4, §7.4

### TC-B-09 (#9): random.md -> unknown

**Source**: §7.8 #9
**Priority**: Key
**Input**: `classifyFile('/project/random.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'unknown'}
**Covers**: Rule 5, §7.4

### TC-B-10 (#9a): prd-v2.md -> phase_deliverable(1)

**Source**: §7.8 #9a
**Priority**: Key
**Input**: `classifyFile('/project/docs/prd-v2.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'phase_deliverable', phase: 1}
**Covers**: Rule 4, §7.4

### TC-B-11 (#9b): user-stories.md -> phase_deliverable(1)

**Source**: §7.8 #9b
**Priority**: Key
**Input**: `classifyFile('/project/docs/user-stories.md', FALLBACK_PATTERNS, [])`
**Expected**: {category: 'phase_deliverable', phase: 1}
**Covers**: Rule 4, §7.4

### TC-B-12 (#9c): ignorePatterns override

**Source**: §7.8 #9c
**Priority**: Key
**Preconditions**: ignorePatterns=['technical-notes.md']
**Input**: `classifyFile('/project/docs/technical-notes.md', FALLBACK_PATTERNS, ['technical-notes.md'])`
**Expected**: {category: 'unknown'}
**Covers**: Rule 0, §7.4

### TC-B-13 (#9d): custom config override

**Source**: §7.8 #9d
**Priority**: Key
**Input**: `classifyFile('/project/api-design.md', {2: ['api-design*.md']}, [])`
**Expected**: {category: 'phase_deliverable', phase: 2}
**Covers**: Config override, §7.4

---

## Config Tests (watchdog-config.test.ts)

### TC-B-26 (#22): missing file -> defaults

**Source**: §7.8 #22
**Priority**: Peripheral
**Preconditions**: No watchdog.jsonc
**Expected**: Returns FALLBACK_PATTERNS, empty ignorePatterns, DEFAULT_MONITORED_TOOLS
**Covers**: Config fallback, §7.4.1

### TC-B-27 (#23): valid file -> parsed

**Source**: §7.8 #23
**Priority**: Peripheral
**Expected**: Returns parsed config; info logged
**Covers**: Config loading, §7.4.1

### TC-B-28 (#24): malformed JSONC -> defaults + warn

**Source**: §7.8 #24
**Priority**: Peripheral
**Expected**: Returns defaults; warn logged
**Covers**: Config error, §7.4.1

### TC-B-29 (#25): missing phaseDeliverables -> defaults

**Source**: §7.8 #25
**Priority**: Peripheral
**Expected**: Returns FALLBACK_PATTERNS; warn logged
**Covers**: Config validation, §7.4.1

### TC-B-30 (#26): Extra phases preserved, never matched

**Source**: §7.8 #26
**Priority**: Peripheral
**Expected**: phaseDeliverables[6] exists; rules never match it
**Covers**: Config extensibility

### TC-B-31 (#27): globToRegex -- *.md matches .md only

**Source**: §7.8 #27
**Priority**: Peripheral
**Input**: classifyFile with *.md pattern
**Expected**: .md matches; .txt does not
**Covers**: Glob->regex, §7.4

### TC-B-41 (#37): Empty monitoredTools -> warning + fallback

**Source**: §7.8 #37
**Priority**: Peripheral
**Preconditions**: Config has monitoredTools: []
**Expected**: Returns defaults; warn logged
**Covers**: Config footgun guard, §7.4.1

---

## Cross-Module Integration Tests (in integration-phase2.test.ts)

### TC-I-03: Interceptor block -> address -> retry

**Source**: §21.4
**Priority**: Key
**Expected**: Blocked by AC-3; submit evidence; retry succeeds
**Covers**: AC-3, reversibility

### TC-I-04: Multi-agent ownership

**Source**: §21.4
**Priority**: Key
**Expected**: Orchestrator allowed; sub-agent rejected; audit trail
**Covers**: Section 15a L2

### TC-I-10: Custom monitoredTools

**Source**: §21.4
**Priority**: Key
**Expected**: Custom tool evaluated with generic path extraction
**Covers**: Section 15a L3
