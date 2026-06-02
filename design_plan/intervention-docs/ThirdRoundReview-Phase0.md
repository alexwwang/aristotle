# Third-Round Independent Technical Review
## Phase 0 Core Library Extraction Plan v2.2

**Reviewer**: Independent third-round review  
**Scope**: Phase 0 plan v2.2, TechSpec, TestPlan, and all 10 source files  
**Date**: 2026-05-10

> **Resolution Status (2026-05-12)**: All 3 critical blockers (C3-1, C3-2, C3-3) and 6 major issues (M3-1 through M3-6) were addressed during Phase 4+5 implementation (4-round Ralph Loop: R1 found 4C+4M, R3 independent re-review found 1C+1M, R4 confirmed zero issues). Final results: 999 tests passing (150 core + 115 aristotle + 162 bridge + 405 pytest + 103 static + 64 regression), tsc zero errors in both packages. Phase D deployment completed: 3 runtime bugs fixed (async/await, Zod v3→v4+externalize, session.idle event format).

---

## Executive Summary

The plan is **substantially improved** after two rounds of fixes, but **3 critical blockers** and **6 major issues** remain that would prevent clean execution or cause regressions. The most dangerous problems are:

1. **TestPlan still contradicts the plan on test destinations** (M-new-4 was "tracked" but never fixed).
2. **`onToolBefore` is declared "not activated" in Phase 0, yet TestPlan P0-3 tests it extensively** — a direct contradiction.
3. **`clearConfigCache` signature breaking change** would break all existing config tests.

Several Round 2 fixes are verified correct against source code. No new regressions were introduced by Round 2 fixes themselves. However, both prior rounds missed a cluster of implementation feasibility issues around config override loss, logger behavior changes, and incomplete `SessionExtractor` wrapper specification.

---

## Findings

### 🔴 Critical

#### C3-1: TestPlan P0-1 file destination mapping still wrong (M-new-4 unresolved)
**Severity**: Critical — would cause tests to be placed in wrong packages, breaking verification  
**Location**: TestPlan P0-1 vs Phase 0 plan Section 3.1 & 4.1

TestPlan P0-1 asserts these destinations:
- `idle-handler.test.ts` → `packages/core/test/idle/idle-handler.test.ts` ❌
- `snapshot-extractor.test.ts` → `packages/core/test/store/snapshot-extractor.test.ts` ❌

But per TechSpec §4.1 and Phase 0 plan §4.1, **both modules are Aristotle-specific**:
- `idle-handler.ts` stays in `packages/reflection/src/` (R→C chain logic + MCP subprocess calls)
- `snapshot-extractor.ts` stays in `packages/reflection/src/reflection/` (wrapper around core SessionExtractor)

Therefore their tests must go to `packages/reflection/test/`, not core. The Round 2 resolution "tracked for post-final alignment" was never applied. **This blocks TestPlan acceptance** because P0-1 explicitly claims these tests move to core.

**Fix**: Update TestPlan P0-1 to reflect actual destinations per TechSpec §4.1 and Phase 0 plan §4.1.

---

#### C3-2: `tool.execute.before` dispatch contradiction — declared but TestPlan tests it
**Severity**: Critical — P0-3 tests cannot pass if mechanism isn't wired  
**Location**: Phase 0 plan §3.2.9 vs TestPlan P0-3-2 (PR-05..PR-10)

Phase 0 plan §3.2.9 states:
> "Phase 0 中 `onToolBefore`/`onToolAfter` 只声明不激活——Phase 2 Watchdog 实现拦截时才接入"

But TestPlan P0-3-2 defines 6 tests (PR-05 through PR-10) for `tool.execute.before` dispatch, including:
- PR-06: Single role BLOCK → `output.abort` set
- PR-07: First role BLOCK → second role not called
- PR-10: Role `onToolBefore` throws → caught, treated as PASS

These tests **require `assemblePlugin` to wire `tool.execute.before` in Phase 0**. If it's not wired, the plugin object won't have a `"tool.execute.before"` handler, and PR-05..PR-10 have nothing to test against.

**Fix**: Either (a) wire `tool.execute.before`/`tool.execute.after` in `assemblePlugin` for Phase 0 (they simply iterate roles and call handlers, with exception isolation), or (b) move PR-05..PR-10 from P0-3 to Phase 2 in TestPlan. Option (a) is safer — the mechanism is generic and doesn't require Watchdog-specific logic.

---

#### C3-3: `clearConfigCache` breaking change not addressed
**Severity**: Critical — breaks existing config tests  
**Location**: Phase 0 plan §3.2.6 vs current `config.ts` and `config.test.ts`

Current code:
```typescript
export function clearConfigCache(): void { _cachedConfig = null; }
```

Existing tests call `clearConfigCache()` with **zero arguments** (appears 3 times in config.test.ts).

Phase 0 plan proposes:
```typescript
export function clearConfigCache<T>(resolver: () => T): void
```

This is a **breaking signature change**. Every existing test that calls `clearConfigCache()` would fail to compile. The plan does not mention updating test call sites, nor does it explain how the generic wrapper would pass a resolver reference.

**Fix**: Keep `clearConfigCache()` as a no-arg function that clears an internal cache. If core's `createConfigResolver` needs cache clearing, expose it as a method on the returned resolver or use a WeakMap. Do not change the public signature.

---

### 🟠 Major

#### M3-1: `ctx.config?.aristotleBridge?.sessionsDir` override lost in new architecture
**Severity**: Major — behavioral regression  
**Location**: Current `index.ts:21` vs Phase 0 plan §4.4

Current code supports runtime override:
```typescript
const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? SESSIONS_DIR();
```

Phase 0 plan's `createAristotleRole(ctx)` does **not** extract `ctx.config?.aristotleBridge?.sessionsDir`. It uses `SESSIONS_DIR()` unconditionally (implied by the `// ...` ellipsis). This means users who override sessionsDir via OpenCode config will lose that capability after Phase 0.

**Fix**: Add to `createAristotleRole`:
```typescript
const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? resolveAristotleConfig().sessions_dir;
```

---

#### M3-2: `idle-handler.ts` imports `resolveConfig` from wrong layer
**Severity**: Major — would create forbidden cross-package dependency  
**Location**: Phase 0 plan §4.3

Current `idle-handler.ts:35`:
```typescript
this.mcpProjectDir = resolveConfig().mcp_dir;
```

Phase 0 plan says idle-handler moves to `packages/reflection/` and its imports are updated to `@opencode-ai/core/*`. But `resolveConfig()` is **Aristotle-specific** (reads `aristotle-config.json`, `ARISTOTLE_*` env vars, `detectMcpDir`). It must come from `packages/reflection/src/config.ts` (the wrapper), not from core.

The plan says "import 路径改 core" (change imports to core) for idle-handler. This is **incorrect** for `resolveConfig` — idle-handler needs the Aristotle-specific config, not the generic `createConfigResolver`.

**Fix**: `idle-handler.ts` must import `resolveConfig` from the local Aristotle config wrapper (`./config.js` or `@opencode-ai/reflection/config`), not from core.

---

#### M3-3: `assemblePlugin` must filter `null` roles
**Severity**: Major — null-dereference crash  
**Location**: Phase 0 plan §5

The plan shows:
```typescript
const aristotleRole = await createAristotleRole(ctx)
return assemblePlugin(ctx, [aristotleRole])
```

But `createAristotleRole` returns `Promise<RoleRegistration | null>` (when API mode unavailable). If `aristotleRole` is `null`, `assemblePlugin` would iterate over `[null]` and crash on `null.tools` or `null.onIdle`.

The `RoleRegistration` interface is not nullable in the array type, but the actual call site can pass null.

**Fix**: Either (a) `assemblePlugin` filters nulls: `roles.filter(Boolean)`, or (b) `createAristotleRole` returns an empty registration object instead of null. Option (a) is safer and more explicit.

---

#### M3-4: `StateStore.appendLog` concurrency semantics unspecified
**Severity**: Major — tests may pass locally but fail in production  
**Location**: Phase 0 plan §3.2.5, TestPlan SS-13

The TestPlan SS-13 tests concurrent appends:
> "Write 10 entries in rapid succession | All 10 lines present and valid"

But the plan never specifies how `appendLog` is implemented. On POSIX, `fs.appendFileSync` without `O_APPEND` is **not atomic across processes** for writes > PIPE_BUF (512B on macOS, 4KB on Linux). JSONL audit log entries could exceed this.

If Watchdog (Phase 1+) writes audit logs concurrently from multiple sessions, entries could interleave and corrupt the JSONL. This is a latent data corruption bug.

**Fix**: Specify `appendLog` implementation using `fs.openSync(path, 'a')` + `fs.writeSync(fd, ...)` with `O_APPEND` flag, or implement file locking. At minimum, document the single-process assumption for Phase 0.

---

#### M3-5: `StateStore.write()` async/sync mismatch
**Severity**: Major — interface lies about asynchronicity  
**Location**: Phase 0 plan §3.2.5

Interface declares:
```typescript
write<T>(key: string, value: T): Promise<void>
```

But the implementation shown uses `fs.renameSync` (synchronous). The existing `WorkflowStore.saveToDiskRaw()` also uses sync FS. For Phase 0 consistency, either:
1. Make `StateStore` interface synchronous (matches implementation reality), or
2. Implement true async writes using `fs.promises`.

Option 1 is safer for Phase 0 — WorkflowStore already uses sync writes, and changing to async could introduce subtle ordering bugs in the existing reconciliation logic.

**Fix**: Change `StateStore` interface to synchronous:
```typescript
read<T>(key: string): T | null
write<T>(key: string, value: T): void
appendLog(key: string, entry: unknown): void
list(prefix: string): string[]
```

---

#### M3-6: `SnapshotExtractor` wrapper example is incomplete
**Severity**: Major — implementation gap blocks Step 12  
**Location**: Phase 0 plan §3.2.7

The Aristotle wrapper example ends with:
```typescript
// 用 StateStore atomic write 写文件
// ...
```

Current `SnapshotExtractor` has three public methods: `extract()`, `snapshotExists()`, `snapshotPath()`. The wrapper example only shows `extract()`. The wrapper must also implement:
- `snapshotExists(sessionId, workflowId?)` → delegate to `this.extractor.isCached(sessionId, workflowId)` or custom logic
- `snapshotPath(sessionId, workflowId?)` → construct path and check existence
- File naming: `${sessionId}${workflowId ? '_' + workflowId : ''}_snapshot.json`

Without this, Step 12 (build Aristotle module) cannot be executed.

**Fix**: Provide complete wrapper implementation for all three methods, showing how `StateStore` or direct FS calls are used for the atomic write.

---

### 🟡 Minor

#### m3-7: `packages/core/package.json` should not list zod
**Severity**: Minor — unnecessary dependency  
**Location**: Phase 0 plan §6.2

Core does not use zod. The `ToolDefinition.args` field is typed as `Record<string, any>`. Zod schemas are constructed in the Aristotle role layer and passed through opaquely. Core's `package.json` correctly omits zod. ✓ Verified correct (this is actually fine as-is).

Wait — re-checking: the plan's §6.2 core package.json does NOT list zod. It only lists `@types/node`, `typescript`, `vitest` as devDeps. This is correct. The Aristotle package.json (§6.3) does list zod. ✓ Round 2 fix M-new-6 is correct.

---

#### m3-8: Log prefix change claim is inaccurate
**Severity**: Minor — plan overstates test impact  
**Location**: Phase 0 plan §3.2.5, §5

The plan states:
> "测试中对日志 prefix 的硬编码断言需一并更新" (hard-coded log prefix assertions in tests need updating)

But **no existing test asserts on log prefix**. `workflow-store.test.ts`, `idle-handler.test.ts`, `executor.test.ts`, `config.test.ts`, `index.test.ts`, `snapshot-extractor.test.ts`, `utils.test.ts`, and `api-probe.test.ts` — none of them import `logger` or assert on its output. The only log assertion is in `config.test.ts` which checks `console.warn` (not the logger module).

This is a harmless overstatement, but it creates false confidence that the test migration is more complex than it actually is.

---

#### m3-9: `StateStore.list()` is declared but never tested
**Severity**: Minor — untested core API  
**Location**: TestPlan P0-2

`StateStore` interface declares `list(prefix: string): Promise<string[]>`. TestPlan SS-05 tests key isolation (writing to different prefixes), but no test directly invokes `list()` and verifies it returns matching keys. Add SS-16 to test `list`.

---

#### m3-10: `WorkflowStore` still uses Aristotle-specific filename `bridge-workflows.json`
**Severity**: Minor — architectural impurity  
**Location**: Phase 0 plan §3.2.5

The plan acknowledges this as intentional for Phase 0 ("Phase 0 中内部实现不变"). However, having a file named `bridge-workflows.json` inside `packages/core/src/store/` is architecturally impure. The plan should add a note to the Out of Scope section explicitly confirming this naming will be addressed in a later phase.

---

#### m3-11: Bun workspace build command syntax risk
**Severity**: Minor — needs verification  
**Location**: Phase 0 plan §6.1

Root package.json proposes:
```json
"build": "bun run --filter '*' build"
```

Bun's workspace filter syntax can be finicky with quoting. The Step 1 validation point ("最小化的 plugin/index.ts...确认 workspace 依赖解析和构建链路通畅") mitigates this, but the plan should explicitly verify the `--filter` syntax works for the user's Bun version.

---

#### m3-12: `createAristotleRole` doesn't show process cleanup handlers
**Severity**: Minor — lost signal handling  
**Location**: Current `index.ts:24-36` vs Phase 0 plan §4.4

Current `index.ts` registers cleanup handlers for `exit`, `SIGTERM`, `SIGINT`, `SIGHUP` to remove `.bridge-active` marker. `createAristotleRole` does not show these handlers. They should be in the role entry function or noted as intentionally moved.

---

#### m3-13: `console.error`/`console.warn` in WorkflowStore and executor not migrated to logger
**Severity**: Minor — inconsistent logging  
**Location**: `workflow-store.ts:251`, `executor.ts:35`

Current code has direct `console.error`/`console.warn` calls. After migration, these should use the injected logger. The plan doesn't mention this cleanup.

---

### 💡 Suggestions

#### S3-1: Add `WORKFLOW_LOG` env var for per-module granularity
Currently `WorkflowStore` uses `AGENT_PLATFORM_LOG`. Consider allowing `WORKFLOW_LOG` as a more specific override:
```typescript
const logger = createLogger('workflow', 'WORKFLOW_LOG')
```
With fallback to `AGENT_PLATFORM_LOG`. This gives operators fine-grained control.

#### S3-2: Document `registerRole` vs `assemblePlugin` divergence from TechSpec
TechSpec §2.1 shows `registerRole(name, registration)` but Phase 0 plan uses `assemblePlugin(ctx, roles[])`. Add a note explaining this design evolution.

#### S3-3: Verify root `package.json` doesn't conflict with `.opencode/package.json`
OpenCode may read `.opencode/package.json` for plugin dependencies. Adding a root `package.json` with workspaces could change resolution behavior. Test this in Step 1.

---

## Round 2 Fix Verification

| Fix | Status | Verification |
|-----|--------|--------------|
| C-new-1: Sentinel explicit pass in WorkflowStore | ✅ Correct | Plan §5 Step 5 correctly shows `extractLastAssistantText(msgs.data, '[ARISTOTLE_BRIDGE:no_text_output]')` |
| M-new-1: `assemblePlugin` references TechSpec | ✅ Correct | Plan §3.2.9 references TechSpec §2.1 and adds error isolation notes |
| M-new-2: Error isolation for role handlers | ✅ Correct | Plan §3.2.9 notes PR-10 (onToolBefore catch) and PR-12 (onIdle catch) |
| M-new-3: ConfigResolver inter-field dependency | ✅ Correct | Plan §3.2.6 documents `detectMcpDir` as wrapper-layer concern |
| M-new-4: TestPlan locations not updated | ❌ **NOT FIXED** | TestPlan P0-1 still has wrong destinations for idle-handler and snapshot-extractor tests |
| M-new-5: Verification checklist self-contradiction | ✅ Correct | Checklist item about WorkflowState now says `agent: string` |
| M-new-6: Missing zod in aristotle package.json | ✅ Correct | Plan §6.3 includes `"zod": "^3.0.0"` |
| M-new-7: Logger prefix change accepted | ✅ Correct | Plan §3.2.5 documents prefix change as expected migration cost |

---

## Blind Spots Both Rounds Missed

1. **`clearConfigCache` signature breaking change** (C3-3) — neither round examined the generic wrapper's impact on existing test calls.
2. **`ctx.config` override loss** (M3-1) — no one checked that `createAristotleRole` preserves the OpenCode config override path.
3. **`idle-handler.ts` importing Aristotle-specific config from core** (M3-2) — Round 2 fixed config abstraction but didn't trace the consumer imports.
4. **`assemblePlugin` null role handling** (M3-3) — obvious once you see the call site, but both rounds focused on the interface, not the usage.
5. **`appendLog` concurrency semantics** (M3-4) — TestPlan tests concurrency but implementation is unspecified; this is a latent production bug.
6. **`StateStore` async/sync mismatch** (M3-5) — interface design didn't match the extracted implementation pattern.
7. **`SnapshotExtractor` wrapper incompleteness** (M3-6) — the wrapper example is literally incomplete (`// ...`).

---

## Execution Blockers

These issues **must** be resolved before the plan can be executed:

1. **C3-1**: Fix TestPlan P0-1 test destinations (idle-handler and snapshot-extractor tests → aristotle package).
2. **C3-2**: Resolve `onToolBefore` contradiction — either wire it in `assemblePlugin` or move tests to Phase 2.
3. **C3-3**: Fix `clearConfigCache` signature to remain backward-compatible (no-arg).
4. **M3-1**: Restore `ctx.config?.aristotleBridge?.sessionsDir` override in `createAristotleRole`.
5. **M3-2**: Fix `idle-handler.ts` import path for `resolveConfig` (must come from aristotle wrapper, not core).
6. **M3-3**: Add null-filtering to `assemblePlugin`.
7. **M3-6**: Complete the `SnapshotExtractor` wrapper specification.

After these 7 fixes, the plan is executable. The remaining issues (M3-4, M3-5, m3-8..m3-13) can be addressed during implementation without blocking the start of Phase 0.
