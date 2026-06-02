# Technical Specification
# OpenCode Agent Platform: Shared Core + Aristotle + TDD Watchdog

**Version**: 0.1.0-draft  
**Status**: Draft  
**Last Updated**: 2026-05-03  
**Companion Document**: PRD-opencode-agent-platform.md

---

## 1. Architecture Overview

### 1.1 Repository Structure

The platform is a monorepo. The existing `aristotle` repository is restructured as follows:

```
aristotle/                              ← repo root (renamed conceptually to "agent-platform")
├── packages/
│   ├── core/                           ← Shared Core Library (new)
│   │   ├── src/
│   │   │   ├── plugin/                 ← Plugin registration scaffolding
│   │   │   ├── store/                  ← Session & workflow state persistence
│   │   │   ├── executor/               ← Async task executor
│   │   │   ├── idle/                   ← session.idle event dispatcher
│   │   │   └── logger/                 ← Structured logger
│   │   └── package.json
│   │
│   ├── aristotle/                      ← Aristotle agent role (refactored from current root)
│   │   ├── src/
│   │   │   ├── reflection/             ← Error reflection workflow
│   │   │   ├── review/                 ← DRAFT review workflow
│   │   │   ├── learn/                  ← Learning rule retrieval
│   │   │   └── index.ts                ← Role entry point, registers with core
│   │   ├── mcp/                        ← Aristotle MCP server (Python, unchanged)
│   │   └── skills/                     ← SKILL.md, REFLECT.md, etc. (unchanged)
│   │
│   └── watchdog/                       ← TDD Watchdog agent role (new)
│       ├── src/
│       │   ├── state-machine/          ← tdd-pipeline state machine logic
│       │   ├── interceptor/            ← tool.execute.before rule engine
│       │   ├── checkpoint/             ← MCP checkpoint tool handlers
│       │   ├── escalation/             ← Escalation detection and formatting
│       │   └── index.ts                ← Role entry point, registers with core
│       └── skills/                     ← Watchdog skill files (new)
│
├── plugin/                             ← OpenCode plugin entry point (new top-level)
│   └── index.ts                        ← Composes core + all registered roles → single plugin
│
├── aristotle_mcp/                      ← Python MCP server (unchanged)
├── SKILL.md                            ← Aristotle skill entry (unchanged path for compatibility)
└── ...
```

### 1.2 Dependency Graph

```
plugin/index.ts
    ├── packages/core          (infrastructure)
    ├── packages/aristotle     (depends on core)
    └── packages/watchdog      (depends on core)

packages/aristotle
    └── packages/core

packages/watchdog
    └── packages/core

packages/aristotle  ←──(reads audit log)──  packages/watchdog
                   (no direct code dependency — data coupling only)
```

**Key constraint**: `aristotle` and `watchdog` must not import from each other. Cross-role communication happens only through shared data files on disk.

---

## 2. Shared Core Library (`packages/core`)

### 2.1 Plugin Registration (`core/plugin/`)

Provides a registration API so each role can declare its hooks without knowing about other roles. The top-level `plugin/index.ts` collects all role registrations and assembles the final plugin object that OpenCode loads.

**Interface**:

```typescript
// Each role calls this during initialization
interface RoleRegistration {
  // Called before any tool executes — return a violation string to block, null to allow
  onToolBefore?: (tool: string, args: unknown, sessionId: string) => Promise<string | null>

  // Called after any tool executes — for audit logging
  onToolAfter?: (tool: string, args: unknown, output: unknown, sessionId: string) => Promise<void>

  // Called on session.idle — for escalation checks and background work
  onIdle?: (sessionId: string, client: OpenCodeClient) => Promise<void>

  // Custom MCP tools this role exposes to the LLM
  tools?: Record<string, ToolDefinition>
}

// Registration function called by each role
function registerRole(name: string, registration: RoleRegistration): void
```

**Plugin assembly** (`plugin/index.ts`):

```typescript
// Collects all registered roles and builds the OpenCode plugin object
const plugin = async (ctx) => {
  await aristotleRole.initialize(ctx)
  await watchdogRole.initialize(ctx)   // only if installed

  return {
    "tool.execute.before": async (input, output) => {
      for (const role of registeredRoles) {
        const violation = await role.onToolBefore?.(input.tool, input.args, input.sessionID)
        if (violation) {
          output.abort = violation
          return   // first violation wins; abort immediately
        }
      }
    },

    "tool.execute.after": async (input) => {
      for (const role of registeredRoles) {
        await role.onToolAfter?.(input.tool, input.args, input.output, input.sessionID)
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionId = event.properties?.sessionID
        for (const role of registeredRoles) {
          await role.onIdle?.(sessionId, ctx.client)
        }
      }
    },

    tool: mergeTools(registeredRoles),
  }
}
```

### 2.2 State Store (`core/store/`)

Provides atomic read/write for persistent state files. All state is stored under a configurable base directory. The base directory is resolved by each role's entry point from its config. For the Aristotle role, this maps to the existing data root (e.g., `~/.config/opencode/`), so that key `aristotle/watchdog/...` resolves to `{baseDir}/aristotle/watchdog/...` matching the directory layout in §5.1. Watchdog data nests under the business application's subdirectory, not at a separate top-level path.

**Interface**:

```typescript
interface StateStore {
  // Read a JSON state file; returns null if not found (synchronous)
  read<T>(key: string): T | null

  // Atomically write a JSON state file (mkdir + write-to-temp + rename, synchronous)
  write<T>(key: string, value: T): void

  // Append a line to a JSONL log file (mkdir + appendFileSync, synchronous)
  appendLog(key: string, entry: unknown): void

  // List all keys matching a prefix (directory scan, synchronous)
  list(prefix: string): string[]
}
```

**Key naming convention**: `{role}/{scope}/{identifier}` — e.g., `aristotle/watchdog/project/abc123/state`, `aristotle/reflection/ses_xyz/draft`

**Atomic write implementation**: Write to `{path}.tmp`, then `fs.renameSync` to final path. Rename is atomic on POSIX systems.

### 2.3 Workflow Store (`core/store/workflow-store.ts`)

Extracted from current `aristotle-bridge/src/workflow-store.ts` with no behavioral changes. Tracks active background sessions (subagent workflows) across OpenCode restarts.

**Phase 0 设计决策**：WorkflowStore 归属 core。虽然它起源于 Aristotle 的 R→C 链管理，但其本质是"异步子任务生命周期管理"——Watchdog 的 pipeline runs 也需要同样能力。归属 core 确保两个角色共享一套 crash recovery 和 reconciliation 逻辑。Aristotle 专属的 R→C 编排（trigger 文件处理、MCP 子进程调用）留在 `packages/reflection/src/idle-handler.ts`。

### 2.4 Async Task Executor (`core/executor/`)

Extracted from current `aristotle-bridge/src/executor.ts`, decoupled into a pure sub-session creation + `promptAsync` mechanism. Aristotle-specific concerns (WorkflowStore registration, snapshot injection, `SESSION_FILE` substitution) remain in `packages/reflection/src/executor.ts` as a wrapper. Core executor receives only `client` via constructor — no config import.

### 2.5 Plugin Registration (`core/plugin/registration.ts`)

Role registration interface + `assemblePlugin` combinator. Core provides the mechanism (role discovery, tool merging, `onToolBefore`/`onToolAfter` dispatch, `onIdle` chaining with error isolation). Each role provides its own `onIdle` handler.

**Phase 0 设计决策**：Idle dispatcher 的 *分发机制* 在 core（assemblePlugin），但 idle-handler 的 *业务逻辑*（R→C 链、MCP 子进程、trigger 文件处理）留在 `packages/reflection/src/idle-handler.ts`。Phase 2 Watchdog 注册自己的 idle handler 时自然接入分发。

### 2.6 Logger (`core/logger/`)

Extracted from current `aristotle-bridge/src/logger.ts`, refactored to `createLogger` factory pattern. Each module creates its own logger instance with role-specific prefix and env var (e.g., `createLogger('workflow', 'AGENT_PLATFORM_LOG')`), with `AGENT_PLATFORM_LOG` as shared fallback. Backward compatible with existing `ARISTOTLE_LOG` env var.

---

## 3. TDD Watchdog (`packages/watchdog`)

### 3.1 Pipeline State Machine (`watchdog/state-machine/`)

#### 3.1.1 State Schema

```typescript
interface PipelineState {
  version: 1
  projectId: string          // SHA256(git worktree root)[:8]
  runId: string              // UUID, created when pipeline starts
  startedAt: string          // ISO 8601

  currentPhase: 1 | 2 | 3 | 4 | 5
  phaseStatus: "active" | "ralph_loop" | "awaiting_approval" | "complete"

  phases: Record<number, PhaseRecord>

  ralph: RalphLoopState
}

interface PhaseRecord {
  phase: number
  enteredAt: string
  ralphCompleted: boolean
  ralphTermination: "early_stop" | "gate_pass" | "escalated" | null
  userApproved: boolean
  approvedAt: string | null
}

interface RalphLoopState {
  phase: number              // which phase this ralph loop belongs to
  round: number              // current round (1-based)
  consecutiveZero: number    // consecutive rounds with zero C/H/M (P/L excluded)
  tallyHistory: RoundTally[]
  openContested: ContestedIssue[]
  escalated: boolean
  escalatedAt: string | null
  termination: "early_stop" | "gate_pass" | "max_rounds" | null
}

interface RoundTally {
  round: number
  C: number
  H: number
  M: number
  L: number
  I: number
  timestamp: string
}

interface ContestedIssue {
  id: string                 // e.g. "M-2"
  firstContestedRound: number
  disputeRounds: number      // increments each round reviewer re-assesses
  description: string
}
```

#### 3.1.2 State Transitions

Valid state transitions enforced by the state machine:

```
IDLE
  → phase_enter(1)                    → Phase 1 active

Phase N active
  → ralph_start(N)                    → Phase N ralph_loop

Phase N ralph_loop
  → ralph_round_complete(N, round, tally)   → validates round sequence
  → ralph_escalate(N)                 → Phase N escalated (terminal for this phase)
  → ralph_terminate(N, "gate_pass")   → Phase N awaiting_approval
  → ralph_terminate(N, "early_stop")  → Phase N awaiting_approval

Phase N awaiting_approval
  → user_approve(N)                   → Phase N complete

Phase N complete
  → phase_enter(N+1)                  → Phase N+1 active

Phase 5 complete
  → pipeline_complete                 → terminal state
```

Any transition not in this list is a violation.

#### 3.1.3 Transition Validation Rules

For each transition, the validator checks:

**`ralph_round_complete(phase, round, tally)`**:
- `round` must equal `state.ralph.round + 1` (no round skipping)
- `phase` must match `state.currentPhase`
- `tally` fields (C, H, M, L, I) must all be non-negative integers
- If `openContested` is non-empty, the submitted tally must include a `contested_resolutions` field

**`ralph_terminate(phase, termination)`**:
- If `termination == "gate_pass"`: `state.ralph.round >= 5` AND last round tally has `C + H + M == 0`
- If `termination == "early_stop"`: `state.ralph.consecutiveZero >= 2`
- If `termination == "max_rounds"`: `state.ralph.round >= 10` AND C/H/M > 0

**`user_approve(phase)`**:
- `state.phases[phase].ralphCompleted == true`
- `state.phases[phase].ralphTermination != "escalated"`

**`phase_enter(N+1)`**:
- `state.phases[N].userApproved == true`
- If `N == 4` (entering Phase 5): `testEvidenceConfirmed == true`

### 3.2 Interceptor (`watchdog/interceptor/`)

The `onToolBefore` handler registered with the core plugin system.

#### 3.2.1 Intercept Rules

```typescript
interface InterceptRule {
  name: string
  // Returns violation message if rule is violated, null if clean
  check(tool: string, args: unknown, state: PipelineState): string | null
}
```

**Rule: NO_BUSINESS_CODE_BEFORE_FAILING_TESTS**
```
Applies when: state.currentPhase == 4 OR state.currentPhase == 5
              AND tool is a file-write tool (write, edit, patch)
              AND target file matches business code pattern (not test file)
Condition: state.testEvidenceConfirmed == false
Violation: "⛔ [TDD Watchdog] Phase {phase} violation: business code write blocked.
            Failing tests must be confirmed before writing implementation.
            Run your test suite and call tdd_checkpoint('test_evidence', ...) with the output."
```

**Rule: NO_PHASE_ADVANCE_WITHOUT_GATE**
```
Applies when: tool is a file-write tool
              AND target file matches a Phase N+1 deliverable pattern
              AND state.currentPhase == N
Condition: state.phases[N].ralphCompleted == false
           OR state.phases[N].userApproved == false
Violation: "⛔ [TDD Watchdog] Phase transition blocked: Phase {N} Ralph loop gate
            has not been passed (current status: {state.phaseStatus}).
            Complete the Ralph loop and obtain user approval before starting Phase {N+1}."
```

#### 3.2.2 File Pattern Classification

Business code vs. test file classification uses a priority-ordered rule list:

1. Path contains `/test/`, `/tests/`, `/__tests__/`, `/spec/` → test file
2. Filename matches `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py` → test file
3. Path contains `/src/`, `/lib/`, `/app/` → business code
4. Default: unknown (do not block)

Phase deliverable classification (for phase-advance rule):
- Phase 1: files matching `requirements*.md`, `product-design*.md`
- Phase 2: files matching `technical*.md`, `architecture*.md`
- Phase 3: files matching `test-plan*.md`, `test-strategy*.md`
- Phase 4: test files (see above)
- Phase 5: business code files (see above)

This classification is configurable via `.opencode/watchdog-config.json` to allow project-specific overrides.

### 3.3 Checkpoint MCP Tool (`watchdog/checkpoint/`)

The Watchdog exposes one primary MCP tool to the LLM:

```typescript
tdd_checkpoint: tool({
  description: `Report a tdd-pipeline state event to the TDD Watchdog for validation.
    Call this at every phase entry, after every Ralph loop round, before phase transitions,
    and when test evidence is available. The Watchdog will validate your state and return
    either a confirmation or a violation that must be resolved before proceeding.`,

  args: {
    event: z.enum([
      "phase_enter",
      "ralph_loop_start",
      "ralph_round_complete",
      "ralph_terminate",
      "test_evidence",
      "user_approval",
      "phase_transition",
    ]),
    payload: z.string().describe("JSON string with event-specific fields (see documentation)"),
  },

  execute: async (args, context) => {
    // OTQ-03 resolution: state key is (projectId, runId), not sessionID.
    // A pipeline run spans sessions. Lookup: find active run by projectId.
    const projectId = computeProjectId(context.worktree)
    const stateKey = resolveActiveStateKey(projectId)  // → runId-based key
    const state = store.read<PipelineState>(stateKey)
    const payload = JSON.parse(args.payload)
    const result = validateTransition(args.event, payload, state)

    if (!result.valid) {
      appendAuditLog({ event: args.event, decision: "BLOCK", ...result })
      return JSON.stringify({ ok: false, violation: result.violation, guidance: result.guidance })
    }

    const newState = applyTransition(args.event, payload, state)
    store.write(stateKey, newState)
    appendAuditLog({ event: args.event, decision: "PASS", round: newState.ralph?.round })

    return JSON.stringify({ ok: true, state: summarizeState(newState) })
  }
})
```

**Payload schemas per event**:

```typescript
// phase_enter
{ phase: number }

// ralph_round_complete
{
  phase: number
  round: number
  tally: { C: number, H: number, M: number, L: number, I: number }
  contested_resolutions?: Array<{ id: string, action: "accepted" | "re_raised" | "escalated" }>
}

// ralph_terminate
{ phase: number, termination: "early_stop" | "gate_pass" | "max_rounds" }

// test_evidence
{ phase: 4, evidence_file: string }   // path to captured test output file

// user_approval
{ phase: number }

// phase_transition
{ from_phase: number, to_phase: number }
```

### 3.4 Escalation (`watchdog/escalation/`)

The `onIdle` handler checks for escalation conditions on every `session.idle` event.

**Escalation conditions checked**:

1. **Ralph loop stall**: `state.ralph.round >= 10` AND `state.ralph.escalated == false` AND last tally has C/H/M > 0
2. **Contested issue limit**: Any `openContested` issue with `disputeRounds >= 2`
3. **Phase timeout**: Phase active for > 4 hours with no checkpoint (configurable)
4. **Missing checkpoint**: `session.idle` fired and `state.phaseStatus == "ralph_loop"` but no ralph checkpoint in last N minutes

**Escalation output** (injected via `client.session.prompt()`):

```
🚨 [TDD Watchdog] Escalation Required

{escalation_type}: {human_readable_description}

Current state:
- Phase: {N}
- Ralph loop: round {R} of 10
- Open issues: {C} Critical, {H} High, {M} Major
- Contested: {list of contested issue IDs with dispute round counts}

Recommended action: {specific guidance}

To resolve: {what the user or LLM should do next}
```

Escalation is marked in state to prevent repeated injection on subsequent idle events.

### 3.5 Audit Log Format

Each entry in `ralph-log.jsonl`:

```typescript
interface AuditLogEntry {
  timestamp: string          // ISO 8601
  sessionId: string
  projectId: string
  runId: string
  event: string              // checkpoint event type or "INTERCEPT" or "ESCALATE"
  phase: number
  round?: number             // for ralph loop events
  decision: "PASS" | "BLOCK" | "ESCALATE"
  tally?: RoundTally
  violation?: string         // populated on BLOCK
  escalationType?: string    // populated on ESCALATE
}
```

### 3.6 Watchdog Skill Files

**`watchdog/skills/SKILL.md`** — entry point, loaded when user invokes `/watchdog`

Commands:
- `/watchdog status` → reads current `PipelineState`, formats human-readable summary
- `/watchdog log [--last N]` → reads last N entries from `ralph-log.jsonl`
- `/watchdog reset` → prompts for confirmation, then clears state for current project run

**`watchdog/skills/SETUP.md`** — loaded when tdd-pipeline is first activated with Watchdog present. Instructs the LLM on checkpoint protocol: when to call `tdd_checkpoint`, what payload to include, and what to do when a violation is returned.

---

## 4. Aristotle Refactoring (`packages/aristotle`)

### 4.1 Module Migration

Current `plugins/aristotle-bridge/src/` modules migrate to:

| Current location | New location |
|-----------------|--------------|
| `index.ts` | `packages/reflection/src/index.ts` (role entry point) |
| `workflow-store.ts` | `packages/core/src/store/workflow-store.ts` |
| `executor.ts` | Core: `packages/core/src/executor/index.ts` (pure mechanism) + Aristotle: `packages/reflection/src/executor.ts` (wrapper with snapshot injection) |
| `idle-handler.ts` | `packages/reflection/src/idle-handler.ts` (role-specific R→C logic, config injected via constructor) |
| `config.ts` | Core: `packages/core/src/config.ts` (generic `createConfigResolver<T>`) + Aristotle: `packages/reflection/src/config.ts` (wrapper with `detectMcpDir`) |
| `logger.ts` | `packages/core/src/logger.ts` (`createLogger` factory) |
| `utils.ts` | `packages/core/src/utils.ts` (sentinel configurable) |
| `api-probe.ts` | `packages/core/src/plugin/api-probe.ts` |
| `snapshot-extractor.ts` | Core: `packages/core/src/session/extractor.ts` (generic) + Aristotle: `packages/reflection/src/reflection/snapshot-extractor.ts` (wrapper with Aristotle file naming) |
| `types.ts` | `packages/core/src/types.ts` (all 4 types — `WorkflowState`, `ApiMode`, `LaunchArgs`, `LaunchResult` — are generic. No Aristotle-specific types exist, so no split is needed.) |

### 4.2 New: Process Violation Error Category

Aristotle's REFLECTOR gains a new error category:

```
PROCESS_VIOLATION — The LLM deviated from a defined workflow protocol

Detection signal: Watchdog audit log entries with decision == "BLOCK" or "ESCALATE"
Root-cause dimensions:
  - What step was skipped or bypassed
  - What the LLM was trying to accomplish (inferred from surrounding context)
  - Why the shortcut was attempted (context pressure, unclear protocol, ambiguous state)
  - What the correct behavior should have been
```

**Reflection trigger**: When Aristotle runs reflection and finds Watchdog audit log entries from the same session with `BLOCK` or `ESCALATE` decisions, it includes those entries as additional input to the REFLECTOR subagent alongside the conversation transcript.

### 4.3 Shared Data Access

Aristotle reads Watchdog data via the shared `StateStore`:
- `aristotle/watchdog/{projectId}/{runId}/state.json` — current pipeline state
- `aristotle/watchdog/{projectId}/{runId}/ralph-log.jsonl` — audit log

Aristotle never writes to these paths. Read access is sufficient for reflection context.

---

## 5. Data Layout

### 5.1 Directory Structure

Watchdog 是 monorepo 中的独立 agent role，与 Aristotle 平级（参见 §1.2 依赖图）。两者的运行数据共享同一个平台数据目录，但各自拥有独立的子目录。`aristotle-repo/` 是独立的 Git 仓库，保持不变。

```
~/.config/opencode/
├── aristotle/                       ← Aristotle platform data
│   ├── state.json                   ← reflection records
│   ├── aristotle-learnings.md       ← flat learning file
│   ├── drafts/
│   │   └── {ses_id}_draft.json
│   └── watchdog/                    ← Watchdog operational data (independent role)
│       └── {projectId}/
│           └── {runId}/
│               ├── state.json       ← current PipelineState
│               └── ralph-log.jsonl  ← append-only audit log
│
└── aristotle-repo/                  ← Git-backed rule store (separate repo, unchanged)
    ├── .git/
    ├── user/
    └── projects/
```

### 5.2 Cross-Role Data Access

Aristotle reads Watchdog data for reflection context:
- `aristotle/watchdog/{projectId}/{runId}/state.json` — current pipeline state
- `aristotle/watchdog/{projectId}/{runId}/ralph-log.jsonl` — audit log

Aristotle never writes to Watchdog's data paths. Read access only.

---

## 6. Configuration

### 6.1 `opencode.json` (user's OpenCode config)

```json
{
  "plugin": [
    "file://$HOME/.config/opencode/agent-platform/plugin/index.js"
  ],
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "$HOME/.config/opencode", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

### 6.2 `.opencode/watchdog-config.json` (per-project)

```json
{
  "enabled": true,
  "file_patterns": {
    "business_code": ["src/**", "lib/**", "app/**"],
    "test_files": ["tests/**", "**/*.test.*", "**/*.spec.*"],
    "phase_deliverables": {
      "1": ["docs/requirements*.md"],
      "2": ["docs/technical*.md"],
      "3": ["docs/test-plan*.md"]
    }
  },
  "thresholds": {
    "phase_timeout_minutes": 240,
    "idle_checkpoint_timeout_minutes": 30
  }
}
```

---

## 7. Implementation Plan

### Phase 0 — Core extraction (prerequisite for everything)

Extract shared core modules from `aristotle-bridge` into `packages/core`. No behavioral changes. Aristotle continues to work identically. Tests must pass before proceeding.

Deliverables:
- `packages/core` with all extracted modules
- `packages/aristotle` wrapping existing aristotle-bridge behavior
- Top-level `plugin/index.ts` composing core + aristotle
- All existing aristotle tests passing

Estimated scope: refactor only, no new features.

**Gate: Technical spike (after Phase 0, before Phase 1) — ✅ PASSED (2026-05-12)**

Phase 0 完成后、Phase 1 开始前的技术验证已全部完成。三项结论：

1. **OTQ-01 ✅**: `tool.execute.before` 没有 `abort` output 字段。阻止工具执行的唯一方式是 `throw`。Phase 2 需要将拦截机制从"返回 violation string"改为"throw error"。
2. **OTQ-02 ✅**: Event handler 是 fire-and-forget（`void` 丢弃 Promise）。`prompt()` 注入存在竞态。Phase 3 使用 MCP tool inline 返回 escalation 作为主要机制，`prompt()` 作为补充。
3. **OTQ-03 ✅**: Session 是 SQLite 持久化的，跨重启存活。Pipeline run 跨 session，state key 必须用 `(projectId, runId)` 而非 `sessionID`。

详细结论见 §9 OTQ 条目。三项结论已反映到对应 Phase 的设计中。

### Phase 1 — Watchdog state machine + checkpoint tool

Build the Watchdog's state machine and checkpoint tool. No interception yet. The LLM can call `tdd_checkpoint` and get validation responses. State is persisted. Audit log is written.

#### Phase 1 设计决策

**D1: Pipeline 启动机制**。用户触发 tdd-pipeline skill 后，SKILL.md Phase 1 开头强制指令 LLM 调用 `tdd_checkpoint('pipeline_start', { description: '...' })`。Watchdog 收到 `pipeline_start` 时：(1) 检查 `active.json`，如果已有活跃 run 则归档旧 run（PRD OQ-01，每项目最多一个活跃 run）；(2) 生成 `runId`；(3) 创建 `active.json` + 初始 `state.json`。LLM 不需要知道 runId——Watchdog 通过 `projectId` 自动解析。

**D2: Tool 注册路径**。`tdd_checkpoint` 走 plugin `tool` hook（和 Aristotle 的 `aristotle_fire_o` 一样通过 `assemblePlugin` 合并），不走 MCP server。理由：checkpoint 验证是纯 TypeScript 逻辑（读文件、校验规则、写文件），不需要 Python 进程。plugin 进程内执行延迟 < 50ms（PRD 5.2 要求）。

**D3: Crash recovery**。Watchdog 启动时（plugin 初始化）读 `active.json` → `runId` → state。如果存在活跃 run 且最后 checkpoint 超过 4 小时，标记为 `stale`。LLM 首次调用 `tdd_checkpoint` 时，如果检测到 stale run，返回恢复提示而非错误（"上次停在 Phase 3 Round 4，是否继续？"），由 LLM 转达用户决定。不自动恢复、不自动重置。

**D4: Pipeline 完成清理**。Phase 5 complete 时：(1) 清除 `active.json`；(2) state.json 和 ralph-log.jsonl 移动到 `watchdog/{projectId}/archive/{runId}/`。Aristotle 反思时可读归档数据。不删除任何数据。

**D5: Fail-open 行为**（PRD OQ-02）。tdd-pipeline SKILL.md 加容错指令："如果 `tdd_checkpoint` 调用失败（tool not found），继续正常执行。Watchdog 未安装时不影响流程。" Watchdog 侧不做特殊处理——tool 不存在时 OpenCode 自然返回错误，LLM 按 SKILL.md 指令忽略即可。

#### Phase 1 目录结构

```
packages/watchdog/
├── src/
│   ├── state-machine/
│   │   ├── schema.ts          ← PipelineState, PhaseRecord, RalphLoopState types
│   │   ├── transitions.ts     ← validateTransition + applyTransition
│   │   └── constants.ts       ← MAX_ROUNDS, MIN_GATE_ROUNDS, etc.
│   ├── checkpoint/
│   │   └── handler.ts         ← tdd_checkpoint tool logic
│   ├── store/
│   │   └── pipeline-store.ts  ← state read/write, active.json, archive
│   ├── escalation/
│   │   └── detector.ts        ← stale run detection (Phase 1: stub for Phase 3)
│   └── index.ts               ← Role entry, createWatchdogRole
├── skills/
│   └── SKILL.md               ← (lives in external tdd-pipeline repo, updated separately)
└── package.json
```

#### Phase 1 Deliverables

- `packages/watchdog/src/state-machine/` — state schema + transition validation + apply
- `packages/watchdog/src/checkpoint/` — `tdd_checkpoint` tool handler
- `packages/watchdog/src/store/pipeline-store.ts` — state persistence + active.json + archive
- `packages/watchdog/src/index.ts` — `createWatchdogRole()` returning `RoleRegistration`
- `plugin/index.ts` updated — `assemblePlugin(ctx, [aristotleRole, watchdogRole])`
- Unit tests for all state machine transition rules (valid + invalid transitions)
- Integration test: simulated pipeline run through Phase 1→5 with checkpoints

#### Phase 1 Acceptance Criteria

1. Run a simulated tdd-pipeline session, call `tdd_checkpoint` at each mandatory point (pipeline_start, phase_enter×5, ralph_round_complete×N, ralph_terminate, user_approval×5), verify state.json reflects correct state and audit log is accurate
2. `pipeline_start` with existing active run correctly archives old run
3. Crash recovery: simulate stale run, verify `tdd_checkpoint` returns recovery prompt
4. Fail-open: calling `tdd_checkpoint` when Watchdog is not installed returns tool-not-found, SKILL.md instructs LLM to continue

### Phase 2 — Interception

Add `tool.execute.before` intercept rules. Build file pattern classifier. Wire into core plugin registration.

**OTQ-01 影响设计决策**：拦截必须通过 `throw` 实现，不能通过修改 output。`onToolBefore` 在检测到违规时 throw error（message 为违规描述），OpenCode 的 Effect 框架会短路工具执行。throw 的 error message 会显示在 LLM 的工具调用结果中。

Deliverables:
- `packages/watchdog/src/interceptor/` — intercept rules + file pattern classifier
- `onToolBefore` registered via `RoleRegistration.onToolBefore`, throws on violation
- Unit tests: each intercept rule with valid/invalid tool calls

Acceptance criteria: Attempting to write a business code file in Phase 4 without `testEvidenceConfirmed == true` results in the tool call being blocked with the correct violation message. The violation is visible to the LLM as the tool call result.

### Phase 3 — Escalation + idle monitoring

Add escalation detection. Build escalation formatter. Wire into Watchdog's checkpoint handler and idle handler.

**OTQ-02 影响设计决策**：Event handler 是 fire-and-forget，`prompt()` 有竞态。Escalation 采用双通道机制：
- **主通道（同步，可靠）**：LLM 调 `tdd_checkpoint` 时，如果 Watchdog 检测到 escalation 条件，在 tool 返回值中直接带上 escalation 信息。无竞态。
- **副通道（异步，best-effort）**：`onIdle` handler 通过 `client.session.prompt({ noReply: true })` 注入 escalation 通知。用于 LLM 主动调用 checkpoint 之前的场景（比如 Ralph loop stall 后 LLM 没有再调 checkpoint）。竞态可接受——通知迟到了不会丢数据，state.json 里已标记。

Deliverables:
- `packages/watchdog/src/escalation/` — escalation condition detection + formatting
- `tdd_checkpoint` tool 更新：返回值包含 escalation 字段（当检测到时）
- `onIdle` handler：fire-and-forget notification 作为补充
- Escalation state tracking（state 中 `escalated` 标记防止重复注入）

Acceptance criteria: Simulate a Ralph loop that hits 10 rounds with persistent issues; verify (1) next `tdd_checkpoint` call returns escalation in response, (2) `session.idle` fires a best-effort notification exactly once.

### Phase 4 — Aristotle integration

Add `PROCESS_VIOLATION` error category to Aristotle's REFLECTOR. Connect Aristotle's reflection trigger to Watchdog audit log.

Deliverables:
- Updated `REFLECTOR.md` with PROCESS_VIOLATION category
- Audit log reader in `packages/reflection/src/reflection/`
- Updated reflection prompt to include Watchdog context when available

Acceptance criteria: Run a session where the Watchdog blocks a violation; trigger `/aristotle`; verify the REFLECTOR's analysis includes the blocked violation as an error to reflect on.

### Phase 5 — Install experience

Updated installer and documentation.

Deliverables:
- Updated `install.sh` / `install.ps1`
- Updated README covering both roles

---

## 8. Testing Strategy

### 8.1 Unit Tests (per package)

- `packages/core`: StateStore atomic write/crash recovery, WorkflowStore reconciliation
- `packages/watchdog`: All state machine transition rules (valid + invalid), file pattern classifier edge cases, escalation condition detection
- `packages/aristotle`: Unchanged from current test suite

### 8.2 Integration Tests

- Checkpoint tool: valid sequence of events produces correct final state
- Checkpoint tool: invalid sequences (round skipping, premature gate pass) produce correct violation messages
- Interception: tool.execute.before correctly blocks/allows writes based on state
- Idle escalation: stalled Ralph loop triggers escalation injection exactly once

### 8.3 End-to-End Tests

Simulate a complete tdd-pipeline run (Phases 1–5) with a mock LLM that:
1. Follows the happy path correctly → verify no violations, correct final state
2. Attempts to skip Ralph loop → verify interception and state machine rejection
3. Attempts to write business code before test evidence → verify block
4. Ralph loop hits 10 rounds → verify escalation fires

---

## 9. Open Technical Questions

**OTQ-01**: `tool.execute.before` abort mechanism

> **Resolved (2026-05-12)**: Abort via `throw`, NOT via output mutation.

The output type is `{ args: any }` — there is NO `abort` field. The OpenCode plugin system runs hooks inside `Effect.promise(async () => fn(input, output))`. A thrown error rejects the Effect, short-circuiting the chain before the tool's `execute()` is invoked. The official docs example confirms: `throw new Error("Do not read .env files")`.

**Impact on Phase 2**: Watchdog's `onToolBefore` must `throw` to block a tool call. Our current `registration.ts` wraps tools and returns the interception result as a string — this does NOT block execution. Phase 2 needs to change the interception mechanism from "return violation string" to "throw error with violation message".

Source: `packages/opencode/src/plugin/index.ts` `trigger()`, `packages/opencode/src/session/prompt.ts` tool execution paths.

---

**OTQ-02**: `session.idle` event handler behavior

> **Resolved (2026-05-12)**: Fire-and-forget. Promise explicitly discarded.

OpenCode dispatches events with `void hook["event"]?.({ event: input })`. The `void` operator discards the returned Promise. Event handlers are NOT awaited. This means:
1. `client.session.prompt()` calls from idle handlers race with LLM responses
2. Errors in event handlers are silently swallowed
3. GitHub issues #16879 and #23380 track this gap

**Impact on Phase 3**: Escalation injection via `prompt()` in `onIdle` is unreliable — the message may arrive after the LLM has already started its next response. Two mitigation options:
- **Option A**: Accept the race condition. The escalation message will appear as a user message, and the LLM will see it on its next turn. This is the current Aristotle approach (notifyParent is also fire-and-forget).
- **Option B**: Use a dedicated MCP tool for escalation. The LLM calls `tdd_checkpoint` which returns the escalation inline — no race condition because it's synchronous in the tool call.

Recommendation: Option B for critical escalations (Ralph loop stall), Option A for informational notifications.

Source: `packages/opencode/src/plugin/index.ts` `bus.subscribeAll()` handler.

---

**OTQ-03**: Session lifecycle and state key strategy

> **Resolved (2026-05-12)**: Sessions are DB-persisted (SQLite), span restarts, and support forking.

OpenCode sessions are persistent conversation entities stored in `SessionTable` (SQLite via Drizzle ORM). They survive restarts. Messages are queryable via `Session.messages({ sessionID })`. Sessions have a `parentID` field for forking.

**Impact on Phase 1**: A tdd-pipeline run may span multiple sessions (user starts a pipeline, closes laptop, resumes tomorrow). Using `sessionID` as the state key would lose state across sessions. The correct state key is `runId` (generated when the pipeline starts, persisted independently). State lookup should be: find active run by `projectId` → return `runId`'s state.

Source: `packages/opencode/src/session/session.ts` `Info` schema, `get()`, `messages()`, `fork()`.

---

**OTQ-04**: Monorepo build tooling

> **Resolved (2026-05-12)**: Bun workspaces working. Phase 0 completed.

Bun workspace setup was completed during Phase 0. Three packages (`core`, `aristotle`, `plugin`) build successfully. No further action needed.
