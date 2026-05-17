# Changelog

## [Unreleased] — Watchdog Phase 5 Audit Review Fixes

> All changes since commit `a16ce76` (test: add TC-C-41b/45/46 per frozen design doc test plan).
> These fixes were produced through multiple independent Oracle audits (ds4f, k26, Oracle)
> and a Council review. Final state: 552 tests, 31 files, all green.

### Source Changes

#### `packages/core/src/store/state-store.ts`
- **Added `readLogSafe<T>(key)` method** — per-line tolerant JSONL parser that skips corrupt
  lines with a warning instead of discarding the entire log. Returns all successfully parsed
  entries. Prevents data loss when a single corrupted line exists in observations or audit logs.
  *(Council F1 fix)*

#### `packages/watchdog/src/interceptor.ts`
- **Replaced `any` types with precise interfaces** (`PipelineStateCache`, `PipelineStore`,
  `FileClassification`, `Logger`, `InterceptorConfig`).
- **Added `Set<string>` for `monitoredTools` lookup** — O(1) instead of `Array.includes`.
- **Injected `worktreeRoot` for absolute path resolution** — relative paths like `./src/foo.ts`
  are now resolved before classification, preventing bypass of `/src/` regex patterns.
- **Added interception audit logging** — blocked tool calls now persist an `AuditLogEntry` with
  `event: 'INTERCEPT'` to the audit log before throwing. Provides traceability for Phase 4
  Aristotle integration.
- **Added warning log for null path extraction** — when `extractFilePath` returns null, a
  `warn`-level log is emitted for observability.
- **Added error log before re-throwing unexpected errors** — structured log entry for
  interceptor infrastructure failures that were previously invisible in production.
  *(oracle-k26 R1 M-1 / oracle-ds4f R1 M-1)*
- **Added `store` and `logger` constructor parameters** — interceptor now receives the pipeline
  store and logger for audit persistence and structured logging.

#### `packages/watchdog/src/observer.ts`
- **Replaced `any` types with precise interfaces** (`PipelineStore`, `Logger`).
- **Added `handlerFailedPipelines` Set** — per-pipeline fallback when `handleDegradation` itself
  fails. Prevents unrelated pipelines from being marked as degraded.
- **Removed overly broad double-fault fallback** — the catch block in `handleDegradation` no
  longer marks ALL degraded runs as failed when no state is available. Instead, it logs and
  does nothing (safe degradation). *(Oracle-2 O2-M1 fix)*
- **Added debug/warn logging throughout** — original errors are logged before degradation
  handling, cache load failures produce warnings.
- **Removed `tool !== 'Task'` early-return** — all tool calls are now recorded to session buffer
  (Path 2), matching spec §6.3 AC-10. Only Path 1 (ralph_loop observation) is gated on Task.
- **Added `hadFailedLoad` warning** — when cache previously failed, observer logs a warning
  before recording to session buffer only.

#### `packages/watchdog/src/checkpoint.ts`
- **Swapped `archiveRun` / `clearActiveRun` order** in `phase_complete(5)` — archive is now
  written before the active pointer is cleared. If crash occurs between them, data is at least
  archived. *(Oracle-2 O2-M2 fix)*
- **Added `getFailureCount` persistence recovery** — reads `PhaseRecord.articulationFailures`
  from disk after restart, with legacy fallback to boolean flags.
- **Added `formatElapsed` defense** — sub-second durations show `<1s`, seconds are now included.
- **Added `try/catch` with `logger.error`** around `applyTransition` calls — prevents silent
  failures in the checkpoint handler.
- **Added pre-write `ownerSessionId` invariant check** — asserts owner is not lost before
  `writeState`.
- **Added `PhaseRecord` import and `articulationFailures` field** to phase record construction.

#### `packages/watchdog/src/pipeline-store.ts`
- **Swapped `addProjectToIndex` / `write(activeRun)` order** in `setActiveRun` — index is
  written before the active pointer. Crash worst-case is harmless empty pointer instead of
  dangling pointer.
- **Changed `clearActiveRun` to use `write<ActiveRun | null>(..., null)`** — replaces unsafe
  `null as unknown as ActiveRun` cast.
- **All `readLog` calls replaced with `readLogSafe`** — audit archive and observation archive
  now tolerate corrupt lines instead of losing all data.
- **Added JSDoc comments** explaining async signature rationale for observation methods.

#### `packages/watchdog/src/transitions.ts`
- **Added `default` branches** in both `validateTransition` and `applyTransition` switch
  statements — unrecognized event types are now explicitly rejected/thrown.
- **Added phase range validation** (1-5) for all event payloads — prevents invalid phase numbers.
- **Added `user_approval` escalated safety gate** — rejects approval when
  `ralph.escalated === true` OR `ralphTermination === 'escalated'`.
- **Added `new_contested` duplicate ID check** — uses `Set` comparison to reject duplicate IDs.
- **Removed `testEvidenceConfirmed` check for `phase_enter(5)`** — v1.8 spec change: phase gate
  is now solely Ralph loop completion + user approval.
- **Changed `contested_resolutions` check from `undefined` to `null`** — handles both null and
  undefined correctly.
- **Added `articulationFailures` field** to `phase_enter` state construction and
  `why_articulation` handler.
- **Added Phase 3 TODO comment** for `escalated` action handling.
- **Removed redundant `/i` flag** from test file regex pattern.

#### `packages/watchdog/src/session-buffer.ts`
- **Rewrote to per-session FIFO model** — each session has an independent buffer (was global
  FIFO). Matches spec §6.3 pseudocode exactly.
- **Added `MAX_TRACKED_SESSIONS=50` LRU eviction** — sessions are re-inserted on access to
  maintain LRU order in Map iteration. Prevents unbounded memory growth in multi-agent.
  *(oracle-k26 R1 L-2 / oracle-ds4f R1 L-2)*
- **Replaced `any` with `SessionBufferEntry` interface**.
- **Added `Logger` dependency** for eviction debug logging.

#### `packages/watchdog/src/state-cache.ts`
- **Replaced `any` types with precise interfaces** (`PipelineStore`, `Logger`).
- **Fixed constructor parameter order** to `(store, worktreeRoot, logger?, multiAgent?)` —
  `worktreeRoot` is now required (was optional).
- **Added `_failedLoad` flag and `hadFailedLoad` getter** — tracks whether disk reads failed,
  used by Observer to log degradation warnings.
- **Added single-agent lazy-load** — first `get()` reads from disk, subsequent calls use memory
  cache. Matches spec §5.1 `ensurePopulated`.
- **Added `_failedLoad = false` in `clear()`** — prevents stale failure flag from persisting
  across pipeline completions. *(oracle-k26 R1 L-3 / oracle-ds4f R1 L-3)*
- **Handles corrupted state** (activeRun exists but state is null) — sets `_failedLoad = true`
  and warns.

#### `packages/watchdog/src/file-classifier.ts`
- **Added `FileCategory` union type** (`'test_file' | 'business_code' | 'phase_deliverable' | 'unknown'`)
  — compile-time safety for category comparisons. *(Oracle M-3 fix)*
- **Added `anchored` parameter to `globToRegex`** — path-separator ignore patterns use
  unanchored matching so they correctly match absolute paths. *(oracle-ds4f R1 L-1)*
- **Fixed test file regex** — `[a-z]+$` replaced with `[^\\/]+$` to support multi-segment
  extensions (`.test.integration.ts`).
- **Updated rule comments** to reference spec §3.2.2 rule numbers.

#### `packages/watchdog/src/intercept-rules.ts`
- **Replaced `any` parameters with precise types** in `InterceptRule.evaluate()`.
- **Updated Rule 1 (AC-3) to v1.8 spec** — Phase 4 business code is unconditionally blocked;
  Phase 5 requires Phase 4 Ralph gate passed.
- **Updated Rule 2 (AC-4)** — removed redundant Phase 4 business_code branch (now handled by
  Rule 1).
- **Added deviation note** explaining single `evaluate()` vs spec's two-phase `applies()/check()`.

#### `packages/watchdog/src/schema.ts`
- **Made `PhaseRecord` articulation fields required** (were optional) — `articulationAttempted`,
  `articulationVerified`, `articulationDegraded` are now always present.
- **Added `articulationFailures: number`** to `PhaseRecord` — persisted failure count for
  restart recovery.
- **Added `'escalated'` to `RalphTermination`** — Phase 3 forward reference.
- **Added `'INTERCEPT'` to `AuditLogEntry.event`** — interceptor block events use uppercase
  to match spec §3.8. *(oracle-ds4f R1 L-2)*
- **Added `as const` to observation type constants**.
- **Marked `testEvidenceConfirmed` and `test_evidence` as `@deprecated`**.

#### `packages/watchdog/src/watchdog-config.ts`
- **Empty `monitoredTools` now falls back to defaults with `warn`** — was `info` + keep empty.
  Prevents users accidentally disabling all interception. *(Oracle M-1 fix)*
- **Removed Phase 4/5 from `FALLBACK_PATTERNS`** — these phases use hardcoded classifier rules.
- **Added phase number validation** (`phase < 1` rejected).

#### `packages/watchdog/src/index.ts`
- **Updated constructor calls** to match new parameter orders (cache, session buffer, interceptor,
  observer, checkpoint handler).
- **Added `InterceptorConfig` with `worktreeRoot`** — interceptor now receives resolved config.
- **Passed `store` and `logger` to Interceptor** — needed for audit logging.
- **Updated `onToolAfter`** — passes raw `output` (unknown) instead of stringifying.

#### `packages/watchdog/src/tools.ts`
- **Changed `event` from `z.string()` to `z.enum([...])`** — validates event types at the
  schema level.
- **Added `why_articulation` to enum**.
- **Updated description** noting `test_evidence` is deprecated.

#### `packages/watchdog/src/path-extractor.ts`
- **Added empty string checks** — `length > 0` guards prevent empty path strings from being
  treated as valid paths.

#### `packages/watchdog/src/project-id.ts`
- **Added `.toLowerCase()` for case-insensitive FS normalization** — macOS is case-insensitive
  by default; `/Users/Alex` and `/users/alex` now produce the same project ID.

#### `packages/watchdog/src/constants.ts`
- **Added `MAX_TRACKED_SESSIONS = 50`** — used by SessionBuffer for cross-session eviction.

### Test Changes

#### `packages/core/test/state-store.test.ts`
- **Added SS-27: `readLogSafe` corruption resilience test** — verifies that 3 valid entries
  survive a corrupt line, while `readLog` returns `[]` for the same file.

#### `packages/watchdog/test/interceptor.test.ts`
- **Updated all tests for v1.8 Rule 1** — Phase 4 business code unconditionally blocked,
  Phase 5 requires Phase 4 gate.
- **Added TC-B-01a** — unknown file classification passes through.
- **Added TC-B-15a** — Phase 5 business code blocked when Phase 4 gate not passed.
- **Added TC-B-45** — relative path resolution via `worktreeRoot`.
- **Added TC-B-46** — null path extraction logs warning.
- **Updated mock patterns** — sync `mockReturnValue` for sync methods, `mockImplementation`
  for error injection.

#### `packages/watchdog/test/observer.test.ts`
- **Updated all tests** from `mockResolvedValue` to `mockReturnValue` (sync `cache.get()`).
- **Updated error injection** from `mockRejectedValue` to `mockImplementation(() => throw ...)`.
- **Added TC-A-11** — `appendObservation` throw with valid cache state → degradation.
- **Added TC-A-25** — `handleDegradation` fallback with no state in recovery.
- **Added integration suite (TC-A-20 through TC-A-24)** — full pipeline flow, crash recovery,
  downstream readability, non-degraded round, degradation tracking failure.

#### `packages/watchdog/test/pipeline-store.test.ts`
- **Added `readLogSafe` to mock stores**.
- **Added observation test suite** — append/read roundtrip, multiple entries, filter by type,
  filter by round, combined filter, archive of observations.

#### `packages/watchdog/test/session-buffer.test.ts`
- **Updated for new `Logger` constructor parameter**.
- **Added per-session FIFO independence test**.
- **Added `MAX_TRACKED_SESSIONS` eviction test** — verifies LRU behavior.

#### `packages/watchdog/test/transitions.test.ts`
- **Updated all `PhaseRecord` fixtures** to include new required fields
  (`articulationAttempted`, `articulationVerified`, `articulationDegraded`, `articulationFailures`).
- **Updated `phase_enter(5)` test** — now expects `valid: true` (removed `testEvidenceConfirmed` gate).
- **Added M5 test** — `ralphTermination === 'escalated'` blocks `user_approval`.

#### `packages/watchdog/test/checkpoint-phase2.test.ts`
- **Updated all `PhaseRecord` fixtures** to include new required fields.
- **Updated mock patterns** for sync consistency.

#### `packages/watchdog/test/checkpoint.test.ts`
- **Updated `PhaseRecord` fixtures** for new required fields.

#### `packages/watchdog/test/helpers.ts`
- **Updated `makePhaseRecord`** to include articulation fields.
- **Updated `createMockStore`** — sync methods use `mockReturnValue`, async observation methods
  use `mockResolvedValue`. Added `readLogSafe` mock.
- **Updated `createMockCache`** — `get()` uses `mockReturnValue` (sync).
- **Added comments** explaining sync/async mock rationale.

#### `packages/watchdog/test/watchdog-config.test.ts`
- **Updated TC-B-41** — now asserts `warn` log + fallback to defaults (was `info` + empty).

#### `packages/core/test/dispatch.test.ts` (new)
- **New dispatch integration test file**.

#### `packages/watchdog/test/integration-phase2.test.ts` (new)
- **New Phase 2 integration test file**.

### Audit Trail

| Round | Reviewer | C | H | M | L | Key Fixes |
|-------|----------|---|---|---|---|-----------|
| Pre-Ralph | Council (doubao) | 0→0 | 1→0 | 5 | 0 | F1: readLogSafe, F5: operator precedence |
| Oracle-1/2/3 | Triple Oracle | 0 | 0 | 6 | 2 | O2-M1: observer fallback, O2-M2: archive order |
| Oracle (ora-52) | Oracle | 0 | 0 | 4 | 4 | M-1: empty monitoredTools, M-2: null path log, M-3: FileCategory union |
| R1 | oracle-k26 + oracle-ds4f | 0 | 0 | 1 | 2 | M-1: interceptor error log, L-2: LRU eviction, L-3: clear _failedLoad |
| R2 | oracle-k26 + oracle-ds4f | 0 | 0 | 0 | 0 | All fixes verified, no regression |
| R1 (ds4f) | oracle-ds4f | 0 | 0 | 0 | 2 | L-1: ignore path unanchored, L-2: INTERCEPT casing |
| R2 (ds4f) | oracle-ds4f | 0 | 0 | 0 | 0 | All fixes verified, no regression |
