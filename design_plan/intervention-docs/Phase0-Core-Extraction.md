# Phase 0 Technical Plan: Core Library Extraction

**Version**: 3.6
**Status**: Implemented
**Companion Documents**: TechSpec-opencode-agent-platform.md (Section 2, 4, 7)  
**Goal**: Extract shared infrastructure from aristotle-bridge into `packages/core`, driven by what both Aristotle and TDD Watchdog need. Aristotle works identically after refactor. All existing tests pass.

---

## 1. Abstraction Design: From Two Roles' Needs

Phase 0 的抽象不是"从现有代码搬家"，而是从 Aristotle 和 TDD Watchdog 各自的需求出发，提取交集作为 core 的能力。

### 1.1 双角色需求矩阵

| 能力 | Aristotle 用途 | Watchdog 用途 | 归属 |
|------|---------------|---------------|------|
| 结构化日志（分层） | 所有模块，`ARISTOTLE_LOG` 独立控制 | 所有模块，`WATCHDOG_LOG` 独立控制 | **core**（`createLogger` 工厂） |
| 通用类型定义 | WorkflowState, LaunchArgs 等 | PipelineState, AuditLogEntry 等 | **core**（通用部分） |
| 消息文本提取（可配置 sentinel） | reconciliation + idle handler | escalation 上下文提取、验证 agent 输出 | **core** |
| 配置文件解析 | aristotle-config.json（路径） | watchdog-config.json（patterns/thresholds） | **core**（`createConfigResolver` 机制）+ 各角色（具体 schema） |
| 原子化持久化 | snapshot 文件、draft 文件 | pipeline state.json、ralph-log.jsonl | **core**（StateStore 原语） |
| Session 数据提取（文件名自定义） | 反思用会话快照 | checkpoint 验证、状态判断 | **core**（命名由上层决定） |
| 异步任务执行 | R→C 链的 sub-session 创建 | 潜在的验证型 sub-agent、诊断 agent | **core**（不含业务注册） |
| 工作流生命周期管理 | R→C 链状态追踪、reconciliation | 潜在的 sub-agent 生命周期管理 | **core**（通用机制） |
| Plugin 注册 + 组装 | 注册 Aristotle 角色 | 注册 Watchdog 角色 | **core** |
| API 能力探测 | promptAsync 检测 | 同 | **core** |
| Idle 事件分发 | 注册 R→C 链处理 | 注册 escalation 检测 | **core**（分发机制） |
| R→C 链业务逻辑 | R→C 转换决策、MCP 子进程调用 | — | **aristotle** |
| Trigger 文件处理 | 外部测试 harness | — | **aristotle** |
| Pipeline 状态机 | — | tdd-pipeline 状态验证 | **watchdog**（Phase 1） |
| 文件模式分类 | — | business code vs test file | **watchdog**（Phase 2） |
| 拦截规则引擎 | — | tool.execute.before 规则 | **watchdog**（Phase 2） |

**关键设计决策说明**：

**WorkflowStore 归属 core**：WorkflowStore 管理的是异步子任务的生命周期（注册、状态追踪、startup reconciliation）。Aristotle 的 R→C 链是当前唯一的消费者，但 Watchdog 的潜在场景（验证型 sub-agent、诊断 agent）也需要同样的生命周期管理能力。核心机制（状态持久化、crash recovery、超时检测）是通用的。Aristotle 专属的 R→C 转换决策逻辑（`driveChainTransition`、`driveChainCompletion`、MCP 子进程调用）留在 `idle-handler.ts`，不进 core。

### 1.2 抽象原则

- **core 提供机制，不提供策略**：StateStore 提供原子读写，不决定存什么结构；ConfigResolver 提供文件→env→default 的解析链，不决定配置 schema
- **角色通过组合使用 core，不继承**：Aristotle 的 WorkflowStore 用 core 的通用生命周期管理能力，但 R→C 转换决策和 MCP 调用是 Aristlete 专属策略
- **core 不引入新行为**：Phase 0 中 core 的所有能力都来源于现有代码的提取和泛化，不创造 Aristotle 当前没有的新功能

---

## 2. Current State Analysis

### 2.1 Source Inventory

`plugins/aristotle-bridge/src/` 下 10 个文件，~1255 行：

| File | Lines | 内部依赖 |
|------|-------|----------|
| `logger.ts` | 18 | — |
| `utils.ts` | 19 | — |
| `types.ts` | 33 | — |
| `api-probe.ts` | 11 | types |
| `config.ts` | 110 | logger |
| `workflow-store.ts` | 290 | types, utils, logger |
| `snapshot-extractor.ts` | 71 | config |
| `executor.ts` | 107 | types, snapshot-extractor, workflow-store(type) |
| `idle-handler.ts` | 461 | types, utils, logger, config, workflow-store(type), executor(type) |
| `index.ts` | 135 | all of the above |

### 2.2 依赖图

```
index.ts
├── api-probe.ts ──► types.ts
├── config.ts ──► logger.ts
├── workflow-store.ts ──► types.ts, utils.ts, logger.ts
├── snapshot-extractor.ts ──► config.ts ──► logger.ts
├── executor.ts ──► types.ts, snapshot-extractor.ts, workflow-store.ts(type)
├── idle-handler.ts ──► types.ts, utils.ts, logger.ts, config.ts,
│                       workflow-store.ts(type), executor.ts(type)
└── logger.ts, utils.ts, types.ts (leaves)
```

---

## 3. Core Module Design

### 3.1 Target Directory Structure

```
packages/core/
├── src/
│   ├── plugin/
│   │   ├── registration.ts       ← NEW: RoleRegistration + assemblePlugin
│   │   └── api-probe.ts          ← FROM: api-probe.ts（零改动）
│   ├── store/
│   │   ├── state-store.ts        ← NEW: 原子化 JSON 读写 + JSONL 追加原语
│   │   └── workflow-store.ts     ← FROM: workflow-store.ts（Phase 0 内部实现不变）
│   ├── session/
│   │   └── extractor.ts          ← FROM: snapshot-extractor.ts（泛化，文件名由上层决定）
│   ├── executor/
│   │   └── index.ts              ← FROM: executor.ts（拆出快照+注册逻辑）
│   ├── config.ts                 ← FROM: config.ts（泛化为 createConfigResolver）
│   ├── logger.ts                 ← FROM: logger.ts（改为 createLogger 工厂，分层日志）
│   ├── utils.ts                  ← FROM: utils.ts（sentinel 改为可配置）
│   ├── types.ts                  ← FROM: types.ts（通用部分保留）
│   └── index.ts                  ← barrel export
├── test/
│   ├── state-store.test.ts       ← NEW: StateStore 全部用例（对应 TestPlan P0-2）
│   ├── registration.test.ts      ← NEW: Plugin 组装用例（对应 TestPlan P0-3）
│   ├── workflow-store.test.ts    ← FROM（Phase 0 测试逻辑不变）
│   ├── extractor.test.ts         ← FROM + adapted: session extractor 测试
│   ├── executor.test.ts          ← FROM + adapted: 纯执行逻辑测试
│   ├── config.test.ts            ← FROM + adapted: 通用配置解析测试
│   ├── logger.test.ts            ← NEW: createLogger 工厂 + 分层日志测试
│   ├── utils.test.ts             ← FROM（sentinel 可配置后的适配）
│   └── api-probe.test.ts         ← FROM（零改动）
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 3.2 各 Core 模块详细设计

#### 3.2.1 `logger.ts` — 改为分层工厂模式

**现状**：单一 logger，`ARISTOTLE_LOG` env var 控制，stderr 输出。

**问题**：core/Aristotle/Watchdog 各层的日志应该可以独立控制。用户调试 Watchdog 问题时不需要看 Aristotle R→C 链的日志。

**改造**：提供 `createLogger` 工厂函数，每层独立 env var，fallback 到平台级：

```typescript
// packages/core/src/logger.ts

export interface Logger {
  debug(fmt: string, ...args: unknown[]): void
  info(fmt: string, ...args: unknown[]): void
  warn(fmt: string, ...args: unknown[]): void
  error(fmt: string, ...args: unknown[]): void
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

function shouldLog(level: string, configured: string): boolean {
  return (LEVELS[level] ?? 99) >= (LEVELS[configured] ?? 1)
}

/**
 * 创建分层 logger。
 * @param prefix - 日志前缀，如 'aristotle', 'watchdog', 'platform'
 * @param envVar - 该层的控制环境变量，如 'ARISTOTLE_LOG'
 *                 fallback 到 AGENT_PLATFORM_LOG，再 fallback 到 'warn'
 */
export function createLogger(prefix: string, envVar: string): Logger {
  const configured = (process.env[envVar] || process.env.AGENT_PLATFORM_LOG || 'warn').toLowerCase()
  // DC-03: 使用 || 而非 ??。?? 不跳过空字符串，空字符串 env var 会导致 toLowerCase() 返回 ''，
  // 最终 shouldLog 对所有级别返回 true（意外 debug-all）。|| 正确跳过空字符串回退到 warn。
  return {
    debug: (fmt, ...args) => shouldLog('debug', configured) && console.error(`[${prefix}:debug] ${fmt}`, ...args),
    info:  (fmt, ...args) => shouldLog('info', configured)  && console.error(`[${prefix}:info] ${fmt}`, ...args),
    warn:  (fmt, ...args) => shouldLog('warn', configured)  && console.error(`[${prefix}:warn] ${fmt}`, ...args),
    error: (fmt, ...args) => shouldLog('error', configured) && console.error(`[${prefix}:error] ${fmt}`, ...args),
  }
}

// core 自身使用的 logger
export const logger = createLogger('platform', 'AGENT_PLATFORM_LOG')
```

**各角色使用**：
- Aristotle: `const logger = createLogger('aristotle', 'ARISTOTLE_LOG')` — 后向兼容，现有 `ARISTOTLE_LOG=debug` 继续工作
- Watchdog（Phase 1）: `const logger = createLogger('watchdog', 'WATCHDOG_LOG')`
- 全局调试: `AGENT_PLATFORM_LOG=debug` 开启所有层

**后向兼容**：`ARISTOTLE_LOG` env var 继续有效，行为与当前完全一致（prefix 从 `aristotle:debug` 变为 `aristotle:debug`，日志格式不变）。3 个 e2e 测试脚本使用 `ARISTOTLE_LOG=debug` 不需要改动。

#### 3.2.2 `utils.ts` — sentinel 改为可配置

**现状**：`extractLastAssistantText()` 返回硬编码的 `[ARISTOTLE_BRIDGE:no_text_output]` sentinel。

**分析**：sentinel 是 bridge 与 LLM 交互的技术手段——当 sub-agent 无文本输出时，用明确的占位值替代空值，让下游逻辑可以区分"没有输出"和"出错"。Python MCP 侧不使用此 sentinel（grep 确认零匹配），消费者全部在 TS 插件内部。

**Watchdog 场景评估**：如果 Watchdog 拉起验证型 sub-agent，同样需要处理空输出情况。但 Watchdog 可能需要不同的 sentinel 或不同的空输出策略（比如返回 structured error 而非 sentinel string）。Phase 0 不定论，改为可配置。

**改造**：

```typescript
// packages/core/src/utils.ts

// 保持与当前源码一致的默认值——re-export 桥接期间所有消费者行为不变
const DEFAULT_NO_TEXT_SENTINEL = '[ARISTOTLE_BRIDGE:no_text_output]'

export function extractLastAssistantText(
  messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>,
  noTextSentinel: string = DEFAULT_NO_TEXT_SENTINEL,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role === 'assistant') {
      const text = msg.parts
        .filter((p): p is { type: 'text'; text: string } =>
          p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return noTextSentinel
}
```

**Aristotle 侧**：传入 `[ARISTOTLE_BRIDGE:no_text_output]` 保持原有行为。
**Watchdog 侧（Phase 1+）**：根据实际需求传入自己的 sentinel 或处理逻辑。

**后向兼容**：Aristotle 调用 `extractLastAssistantText(messages, '[ARISTOTLE_BRIDGE:no_text_output]')`，行为与原代码完全一致。WorkflowStore 和 idle-handler 中现有 sentinel 比较逻辑不受影响。

`extractLastAssistantText()` 是 OpenCode message 格式的通用工具。Watchdog escalation 提取上下文也需要它。

#### 3.2.3 `types.ts` — 保留在 core

保留所有类型（`WorkflowState`, `ApiMode`, `LaunchArgs`, `LaunchResult`）。`WorkflowState` 虽然当前只被 Aristotle R→C 使用，但它是异步子任务生命周期的通用模型——Watchdog 如果拉起 sub-agent，也需要类似的状态机（running → completed/error）。类型本身不包含业务策略，保留在 core。

#### 3.2.4 `api-probe.ts` — 零改动

直接移动到 `plugin/api-probe.ts`，更新 import 路径。

#### 3.2.5 `store/state-store.ts` — **新建，核心抽象**

这是 Phase 0 最重要的新模块。从 WorkflowStore 的持久化逻辑中提取通用原语。

**设计依据**：

| Watchdog 需求（TechSpec 3.5, 5.1） | StateStore 能力 |
|-------------------------------------|----------------|
| 写 `state.json`（PipelineState） | `write<T>(key, value)` — 原子写 JSON |
| 读 `state.json` | `read<T>(key)` — 读 JSON |
| 追加 `ralph-log.jsonl`（AuditLogEntry） | `appendLog(key, entry)` — 追加 JSONL |
| 按 project 列出 runs | `list(prefix)` — 列出 key 前缀匹配 |
| crash 后恢复 | atomic write (tmp + rename) |

**接口**：

```typescript
export interface StateStore {
  /** 读 JSON 文件；文件不存在返回 null */
  read<T>(key: string): T | null

  /** 原子写 JSON 文件（write-to-tmp + rename，同步） */
  write<T>(key: string, value: T): void

  /** 追加一行 JSONL（使用 appendFileSync，自带 O_APPEND flag 保证原子追加） */
  appendLog(key: string, entry: unknown): void

  /** 列出所有匹配前缀的 key */
  list(prefix: string): string[]
}

/**
 * 创建基于文件系统的 StateStore。
 * key 格式: "role/scope/identifier" → 映射为 {baseDir}/role/scope/identifier.json
 * log key 格式: 同上但扩展名为 .jsonl
 *
 * 所有方法同步：避免在 crash recovery 场景引入 async 竞态。
 * appendLog 使用 fs.appendFileSync（Node 默认带 O_APPEND flag，POSIX 保证 ≤PIPE_BUF 写入原子）。
 */
export function createStateStore(baseDir: string): StateStore
```

**baseDir 来源**：由角色入口函数从 config 解析后传入，core 不决定默认值。Aristotle 角色传入 `config.sessions_dir`（当前为 `~/.config/opencode/`），使得 key `aristotle/...` 映射到 `{sessions_dir}/aristotle/...`，与 TechSpec §5.1 目录树一致。Watchdog 数据作为底层模块嵌套在业务应用的子目录下（`aristotle/watchdog/...`）。

**key → 路径映射**：
- `aristotle/watchdog/{projectId}/{runId}/state` → `{baseDir}/aristotle/watchdog/{projectId}/{runId}/state.json`
- `aristotle/watchdog/{projectId}/{runId}/ralph-log` → `{baseDir}/aristotle/watchdog/{projectId}/{runId}/ralph-log.jsonl`
- `aristotle/drafts/{sessionId}` → `{baseDir}/aristotle/drafts/{sessionId}.json`

**原子写实现**（从 WorkflowStore.saveToDiskRaw 提取）：
```
mkdirSync(path.dirname(finalPath), { recursive: true })  // 自动创建中间目录
write to {path}.tmp → fs.renameSync({path}.tmp, {path})
```

**JSONL 追加实现**：
```
mkdirSync(path.dirname(logPath), { recursive: true })  // 自动创建中间目录
fs.appendFileSync(logPath, JSON.stringify(entry) + '\n')
```

**DC-05 错误吞没**：`write()` 和 `appendLog()` 必须用 try/catch 包裹文件操作。失败时调用 `logger.error()` 记录错误，但不 throw。这确保单次持久化失败不会中断上层业务流程。实现：
```typescript
write<T>(key: string, value: T): void {
  try {
    // mkdir + tmp + rename
  } catch (err) {
    logger.error(`StateStore write failed for key ${key}: ${err}`)
    // 不 throw
  }
}

appendLog(key: string, entry: unknown): void {
  try {
    // mkdir + appendFileSync
  } catch (err) {
    logger.error(`StateStore appendLog failed for key ${key}: ${err}`)
    // 不 throw
  }
}
```

**注意**：`mkdirSync` 在每次 write/appendLog 时调用（而非依赖外部保证）。这确保 StateStore 对深层 key（如 `watchdog/project-abc/run-xyz/state`）首次使用时不会因目录不存在而失败。

**list(prefix) 实现规格**：
```
prefix → 目录路径映射：
  prefix "aristotle/watchdog/proj1" → 目录 {baseDir}/aristotle/watchdog/proj1/
  列出目录下所有文件，按扩展名过滤：
    .json 文件 → 去掉扩展名即为 key 的最后一段
    .jsonl 文件 → 去掉扩展名即为 key 的最后一段
  返回完整 key 列表：["aristotle/watchdog/proj1/run1/state", "aristotle/watchdog/proj1/run1/ralph-log"]
  忽略子目录（不递归）、.tmp 文件（in-progress writes）、其他扩展名文件
  trailing slash 不影响结果：list("foo/") 等同于 list("foo")
  目录不存在时返回空数组 []
```
POSIX rename 是原子的。这是 WorkflowStore 已经验证过的模式。

**与 WorkflowStore 的关系**：

WorkflowStore 在 `packages/core/src/store/` 中，提供异步子任务的生命周期管理。Phase 0 中内部实现不变（单文件格式、in-memory Map、LRU eviction、multi-instance merge、startup reconciliation）。后续可考虑让 WorkflowStore 基于 StateStore 原语重建，但 Phase 0 不做这个迁移——保持行为不变。

**迁移注意事项**：

- **Sentinel**：core `extractLastAssistantText` 的默认 sentinel 保持 `[ARISTOTLE_BRIDGE:no_text_output]`（与当前源码一致）。参数可配置但默认值不变，确保所有消费者通过 re-export 桥接时行为完全一致。未来 Watchdog 可传入自定义 sentinel。
- **Idle-handler sentinel**：idle-handler:53 调用 `extractLastAssistantText(messages.data)` 无 sentinel，通过默认值获得正确行为。Step 12 idle-handler 移到 aristotle 包时，可选择显式传入 sentinel 增加可读性，但不是必须的。

WorkflowStore 保留在 core 的理由：
- 异步子任务的生命周期管理（注册、状态追踪、crash recovery）是通用能力
- Watchdog 如果拉起 sub-agent（验证、诊断），需要同样的注册 + 状态追踪 + reconciliation 模式
- 具体的"什么时候拉起 sub-agent"、"拉起后怎么处理结果"是各角色的业务策略，通过 idle-handler 等上层模块实现

#### 3.2.6 `config.ts` — 泛化为通用配置解析机制

**现状**：`resolveConfig()` 硬编码了 Aristotle 路径逻辑（读 `aristotle-config.json`、ARISTOTLE_ env 前缀、MCP dir 向上查找）。

**泛化**：提取"配置文件 → env var → default → 缓存"的通用解析链：

```typescript
// packages/core/src/config.ts

export interface ConfigResolverOptions<T> {
  /** 配置文件路径（可返回 null 表示跳过文件） */
  configPath: string | (() => string | null)
  /** env var 映射：config 字段名 → env var 名 */
  envMappings: Partial<Record<keyof T, string>>
  /** 字段级 fallback：env var 没有时的默认值或自动检测函数 */
  resolvers: { [K in keyof T]: (fileValue: any, envValue: string | undefined) => T[K] }
}

export interface ConfigResolver<T> {
  /** 解析并返回配置（带缓存） */
  resolve(): T
  /** 清除缓存（测试用） */
  clearCache(): void
}

/**
 * 创建配置解析器。返回对象包含 resolve() 和 clearCache() 方法。
 * clearCache() 是实例方法，无需传参——解决泛化后签名变更导致的测试兼容问题。
 */
export function createConfigResolver<T>(options: ConfigResolverOptions<T>): ConfigResolver<T>
```

**Aristotle 侧包装**（`packages/reflection/src/config.ts`）：

**字段间依赖处理**：`detectMcpDir` 需要 `sessions_dir`。处理方式：单次 `createConfigResolver`，`mcp_dir` 的 resolver 内部调用辅助函数从同一 resolver 的其他字段值获取 `sessions_dir`（通过闭包延迟求值）。与旧代码 `resolveConfig()` 的单次解析行为一致。

```typescript
import { createConfigResolver } from '@opencode-ai/core/config'

export interface AristotleConfig {
  mcp_dir: string
  sessions_dir: string
}

export const configResolver = createConfigResolver<AristotleConfig>({
  configPath: () => findAristotleConfigFile(),
  envMappings: { mcp_dir: 'ARISTOTLE_MCP_DIR', sessions_dir: 'ARISTOTLE_SESSIONS_DIR' },
  resolvers: {
    // 优先级：config file > env var > default（与旧代码 resolveConfig() 一致）
    sessions_dir: (fileVal, envVal) => fileVal || envVal || defaultSessionsDir,
    // mcp_dir resolver 通过闭包延迟引用 configResolver.resolve().sessions_dir
    mcp_dir: (fileVal, envVal) =>
      fileVal || envVal || detectMcpDir(configResolver.resolve().sessions_dir),
  },
})

// 后向兼容（箭头函数包装避免 this 绑定丢失）
export const resolveConfig = () => configResolver.resolve()
export const clearConfigCache = () => configResolver.clearCache()
```

**递归安全性**：`mcp_dir` resolver 调用 `configResolver.resolve()` 时，`resolve()` 正在执行中。实现时 `resolve()` 必须在调用任何 resolver 之前将缓存设为空对象（eager cache allocation）。这样递归调用时缓存已 truthy，返回部分结果（`sessions_dir` 已填充），`mcp_dir` resolver 安全读取 `.sessions_dir`。

**异常安全性**：如果某个 resolver 抛异常，`resolve()` 必须 catch 并清除缓存（置回 null），避免后续调用返回不完整的部分结果。实现伪代码：

**DC-04 字段排序约束**：`resolvers` 对象中跨字段依赖的字段必须列在被依赖字段之后。例如 `mcp_dir` 依赖 `sessions_dir`，因此 `sessions_dir` 必须排在 `mcp_dir` 之前。这是因为 eager cache allocation 按顺序填充，只有已填充的字段才能被后续 resolver 安全读取。违反排序会导致递归调用返回 undefined。
```
resolve() {
  if (this._cache) return this._cache
  this._cache = {} as Partial<T>  // eager allocation
  try {
    for (const key of Object.keys(this.options.resolvers)) {
      this._cache[key] = this.options.resolvers[key](fileConfig[key], envValues[key])
    }
    return this._cache as T
  } catch (e) {
    this._cache = null  // invalidate on error
    throw e
  }
}
```

**测试兼容**：现有测试调用 `clearConfigCache()` 无参数，re-export 保留兼容。

**Watchdog 侧使用**（Phase 1）：

```typescript
const resolveWatchdogConfig = createConfigResolver<WatchdogConfig>({
  configPath: () => path.join(projectRoot, '.opencode/watchdog-config.json'),
  envMappings: { enabled: 'WATCHDOG_ENABLED' },
  resolvers: { ... },
})
```

#### 3.2.7 `session/extractor.ts` — 从 SnapshotExtractor 泛化

**现状**：`SnapshotExtractor` 只服务于 Aristotle 反思——提取 user/assistant 消息，截断到 4KB，写成 reflection 专用的 JSON 结构。

**Watchdog 需求**：checkpoint 验证需要提取 session 中的工具调用结果、LLM 声称的状态。例如 `test_evidence` checkpoint 需要验证测试确实运行过。

**泛化**：提取"从 session 中读取消息 + 过滤 + 转换"的通用能力：

```typescript
// packages/core/src/session/extractor.ts

export interface ExtractOptions {
  /** 消息过滤条件 */
  roles?: ('user' | 'assistant' | 'tool')[]
  /** 最大消息数 */
  limit?: number
  /** 单条内容截断长度 */
  maxContentLength?: number
  /** 自定义转换函数 */
  transform?: (msg: any, index: number) => any
}

export class SessionExtractor {
  constructor(private baseDir?: string) {}

  /**
   * 从 session 中提取消息。
   * 返回原始数据，不做业务格式化。
   */
  async extract(
    client: any,
    sessionId: string,
    options?: ExtractOptions,
  ): Promise<{ messages: any[]; sessionId: string; extractedAt: string }>

  /** 提取结果是否已缓存（基于 key） */
  isCached(sessionId: string, key?: string): boolean

  /** 缓存文件路径 */
  cachePath(sessionId: string, key?: string): string | null
}
```

**DC-06 损坏缓存处理**：`extract()` 检测到缓存文件存在但 JSON 解析失败时，必须跳过缓存、重新调用 API 获取数据。不得因缓存损坏而 throw 或返回空结果。实现：`readFileSync` + `JSON.parse` 在 try/catch 中，catch 分支视为缓存未命中。

**`key` 参数语义**：`key` 是区分同一 session 不同提取结果的文件名后缀。Aristotle 用 `workflowId` 作为 key（对应当前 `snapshotExists(sessionId, workflowId)`），产生 `{baseDir}/{sessionId}_{workflowId}.json`。Watchdog 可用 `runId` 或 checkpoint 名作为 key。省略 `key` 时使用默认文件名（无后缀），适用于单次全量提取场景。

**与旧 SnapshotExtractor 的差异**：旧 `SnapshotExtractor.extract()` 返回 `string`（文件路径），且内部负责文件写入（atomic write）。新的 core `SessionExtractor.extract()` 返回 `{ messages, sessionId, extractedAt }`（原始数据），不负责文件写入。Aristotle 包装层 (`SnapshotExtractor`) 负责调用 core `extract()` 获取数据后自行写入文件。这一差异是有意的——core 提供数据提取机制，持久化策略由角色决定。

**Aristotle 侧包装**（`packages/reflection/src/reflection/snapshot-extractor.ts`）：

```typescript
import { SessionExtractor } from '@opencode-ai/core/session/extractor'

export class SnapshotExtractor {
  private extractor = new SessionExtractor(sessionsDir)

  async extract(client, sessionId, focusHint, limit, workflowId) {
    const raw = await this.extractor.extract(client, sessionId, {
      roles: ['user', 'assistant'],
      limit: Math.min(limit, 200),
      maxContentLength: 4000,
    })
    // 包装为 reflection 专用格式
    const snapshot = {
      version: 1,
      session_id: sessionId,
      focus: focusHint,
      source: 'bridge-plugin-sdk',
      messages: raw.messages,
    }
    // 用 StateStore atomic write 写文件
    // ...
  }
}
```

#### 3.2.8 `executor/index.ts` — 拆出快照和注册逻辑

**现状**：executor.launch() 内嵌了快照提取（21-37 行）和 SESSION_FILE 注入（40-42 行），并依赖 WorkflowStore 做注册。

**拆分**：core executor 只做 sub-session 创建 + promptAsync：

```typescript
// packages/core/src/executor/index.ts

export interface CoreLaunchArgs {
  oPrompt: string
  parentSessionId: string
  title: string
  /** DC-02: crash-safety 回调。在 promptAsync 之前调用，允许调用方做 pre-promptAsync 注册 */
  onSessionCreated?: (sessionId: string) => void
}

export interface CoreLaunchResult {
  sessionId: string
  status: 'running' | 'error'
  message: string
}

export class AsyncTaskExecutor {
  constructor(private client: any) {}

  async launch(args: CoreLaunchArgs): Promise<CoreLaunchResult> {
    // DC-01: try/catch 错误处理，返回 { status: 'error' } 而非 throw
    try {
      // 1. Create sub-session
      const session = await this.client.session.create({
        body: { title: args.title, parentID: args.parentSessionId },
      })
      // DC-02: onSessionCreated 回调在 promptAsync 之前调用
      args.onSessionCreated?.(session.data.id)
      // 2. promptAsync
      await this.client.session.promptAsync({
        path: { id: session.data.id },
        body: { parts: [{ type: 'text', text: args.oPrompt }] },
      })
      return { sessionId: session.data.id, status: 'running', message: '...' }
    } catch (err) {
      return { sessionId: '', status: 'error', message: String(err) }
    }
  }
}
```

**Aristotle 侧包装**（`packages/reflection/src/` 中）：

```typescript
// packages/reflection/src/executor.ts (Aristotle 专属)

export class AristotleExecutor {
  constructor(
    private client: any,
    private store: WorkflowStore,
    private snapshotExtractor: SnapshotExtractor,
  ) {}

  async launch(args: LaunchArgs): Promise<LaunchResult> {
    // 1. 快照提取（Aristotle 业务逻辑）
    let oPrompt = await this.preparePrompt(args)
    // 2. 调用 core executor 创建 sub-session
    //    DC-02: 使用 onSessionCreated 回调在 promptAsync 之前注册到 store（crash-safety）
    const result = await this.coreExecutor.launch({
      oPrompt,
      parentSessionId: args.parentSessionId,
      title: `aristotle-${args.workflowId}`,
      onSessionCreated: (sessionId) => {
        this.store.register({ ...args, sessionId })
      },
    })
    // 3. 返回格式化结果
    return { workflow_id: args.workflowId, session_id: result.sessionId, ... }
  }

  private async preparePrompt(args: LaunchArgs): Promise<string> {
    // SESSION_FILE 注入逻辑（从原 executor.ts 拆出）
  }
}
```

**注意**：`AristotleExecutor` 不是 core 的东西。它用 core 的 `AsyncTaskExecutor` 做 sub-session 创建，但自己管快照和注册。

#### 3.2.9 `plugin/registration.ts` — 新建

```typescript
export interface ToolDefinition {
  description: string
  args: Record<string, any>  // Zod schema
  execute: (args: any, context: any) => Promise<string>
}

export interface RoleRegistration {
  onToolBefore?: (tool: string, args: unknown, sessionId: string) => Promise<string | null>
  onToolAfter?: (tool: string, args: unknown, output: unknown, sessionId: string) => Promise<void>
  onIdle?: (sessionId: string, client: any) => Promise<void>
  tools?: Record<string, ToolDefinition>
}

// assemblePlugin 返回值必须与旧 plugin 导出形状完全一致
export interface PluginOutput {
  tool?: Record<string, ToolDefinition>
  event?: (event: any) => Promise<void>
}

/**
 * 组合多个角色为单一 plugin 导出。
 * 
 * - ctx.client 传入各 role 的 onIdle(sessionId, ctx.client)
 * - event handler 解包 event.event ?? event 后分发 idle
 * - null roles 被过滤；全 null 返回 {}
 */
export function assemblePlugin(ctx: any, roles: Array<RoleRegistration | null>): PluginOutput
```

`assemblePlugin` 负责 tool 合并、idle 事件分发、`tool.execute.before`/`tool.execute.after` 链式调用。Phase 0 即实现完整分发基础设施——虽然 Phase 0 只有 Aristotle 不注册 `onToolBefore`/`onToolAfter`，但 TestPlan P0-3 用 mock role 测试分发行为，要求 assemblePlugin 实际执行分发循环。

**参考实现**：TechSpec §2.1 提供了 `assemblePlugin` 的参考代码。在此基础上需要补充以下行为：
- 过滤 null 角色：`const activeRoles = roles.filter((r): r is RoleRegistration => r !== null)`
- `onToolBefore` 链式调用中，某个 role 抛异常时 catch 并当 PASS 处理（PR-10）
- `onIdle` 链式调用中，某个 role 抛异常时不阻塞后续 role 的 handler（PR-12）
- tool name 冲突在注册时即抛错（PR-03）

**`tool.execute.before` 接线**：Phase 0 即在 `assemblePlugin` 中接入 `onToolBefore`/`onToolAfter` 的分发逻辑。虽然 Phase 0 只有 Aristotle（不注册 `onToolBefore`），但 TestPlan P0-3 用 mock role 测试了这些行为，需要 `assemblePlugin` 实际执行分发。Phase 2 Watchdog 注册拦截时自然生效。

---

## 4. Aristotle Role Design

### 4.1 Aristotle 专属模块

```
packages/reflection/
├── src/
│   ├── reflection/
│   │   └── snapshot-extractor.ts  ← Aristotle 专用快照格式（包装 core SessionExtractor）
│   ├── idle-handler.ts            ← R→C 链驱动 + MCP 子进程调用（从旧代码复制 + 机械性改造）
│   ├── executor.ts                ← 包装 core AsyncTaskExecutor + 注册 + 快照
│   ├── tools.ts                   ← 三个 tool 定义（fire_o, check, abort），闭包捕获依赖
│   ├── config.ts                  ← Aristotle 路径配置（包装 core ConfigResolver）
│   └── index.ts                   ← 角色入口：createAristotleRole()
├── test/
│   ├── idle-handler.test.ts
│   ├── snapshot-extractor.test.ts
│   ├── executor.test.ts
│   ├── tools.test.ts
│   ├── config.test.ts
│   └── index.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 4.2 Aristotle 专属 vs Core 共享的边界

| 模块 | 放在 Aristotle | 理由 |
|------|---------------|------|
| `idle-handler.ts` | ✅ | R→C 转换决策（`driveChainTransition`、`driveChainCompletion`）、MCP 子进程调用、trigger 文件处理都是 Aristotle R→C 链的专属业务逻辑 |
| `snapshot-extractor.ts`（包装层） | ✅ | Aristotle 反思专用的快照格式（version、focus、source 字段）和文件命名约定 |
| `executor.ts`（包装层） | ✅ | 快照注入 SESSION_FILE、WorkflowStore 注册是 Aristotle 启动流程的专属步骤 |
| `config.ts`（包装层） | ✅ | `detectMcpDir` 向上查找、`aristotle-config.json` 的具体字段映射 |

WorkflowStore、StateStore、SessionExtractor（通用部分）、AsyncTaskExecutor（通用部分）、Logger、Utils、PluginRegistration 都在 core。

### 4.3 依赖注入原则：Core 模块不 import config

**核心原则**：`packages/core/` 中的任何模块都不 import config 模块，不调用 `resolveConfig()`。所有 core 模块需要的配置值通过构造参数注入。

这确保了：
- core 不知道 `aristotle-config.json` 或 `watchdog-config.json` 的存在
- ConfigResolver 只被各角色入口函数调用
- 配置解析结果通过参数传递给 core 模块（WorkflowStore、SessionExtractor、Executor 等）

**具体体现**：

| Core 模块 | 需要的配置 | 注入方式 |
|-----------|-----------|----------|
| `WorkflowStore` | `storePath`, `instanceId` | 构造参数（当前已经是） |
| `SessionExtractor` | `baseDir` | 构造参数（当前已经是） |
| `AsyncTaskExecutor` | `client` | 构造参数（当前已经是） |

**IdleEventHandler 的 config 解耦——机械性改造，不是重写**：

idle-handler（461 行）是 Aristotle 最复杂的模块，含 R→C 链转换、MCP 子进程管理、trigger 文件处理、abort 竞态检测等 ~15 个行为分支。改造方式：

1. **复制** `plugins/aristotle-bridge/src/idle-handler.ts` → `packages/reflection/src/idle-handler.ts`
2. **机械性改造**（不改任何业务逻辑）：
   - `import { resolveConfig } from './config.js'` → 删除
   - 构造函数：新增 `private options: { sessionsDir: string; mcpDir: string }` 参数
   - `resolveConfig().mcp_dir` → `this.options.mcpDir`
   - `import { extractLastAssistantText } from './utils.js'` → `import { extractLastAssistantText } from '@opencode-ai/core/utils'`
   - `import { WorkflowStore } from './workflow-store.js'` → `import { WorkflowStore } from '@opencode-ai/core/store/workflow-store'`
3. 全部其他代码原样保留

```typescript
// packages/reflection/src/idle-handler.ts — 构造参数注入

export class IdleEventHandler {
  constructor(
    private client: any,
    private store: WorkflowStore,
    private executor: AsyncTaskExecutor,
    private options: {
      sessionsDir: string
      mcpDir: string      // 由上层传入，不内部 resolve
    },
  ) {
    // 不再 import config，不调用 resolveConfig()
  }
}
```

Aristotle 角色入口负责解析 config 并传入：

```typescript
// packages/reflection/src/index.ts

const config = configResolver.resolve()
const idleHandler = new IdleEventHandler(ctx.client, store, executor, {
  sessionsDir,
  mcpDir: config.mcp_dir,
})
```

### 4.4 角色入口

`createAristotleRole()` 返回 `RoleRegistration`：

```typescript
export async function createAristotleRole(ctx: any): Promise<RoleRegistration | null> {
  const apiMode = await detectApiMode(ctx.client)
  if (!apiMode) return null

  // 解析 config（使用 core ConfigResolver）
  const config = configResolver.resolve()

  // OpenCode 运行时配置覆盖（保留当前 index.ts:21 的行为）
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? config.sessions_dir
  const mcpDir = config.mcp_dir

  // 初始化（marker file, instanceId, snapshot cleanup — 从原 index.ts 搬来）
  // ...

  const store = new WorkflowStore(sessionsDir, instanceId)
  await store.reconcileOnStartup(ctx.client)

  const snapshotExtractor = new SnapshotExtractor(sessionsDir)
  const executor = new AristotleExecutor(ctx.client, store, snapshotExtractor)
  const idleHandler = new IdleEventHandler(ctx.client, store, executor, {
    sessionsDir,
    mcpDir,
  })

  return {
    tools: { aristotle_fire_o, aristotle_check, aristotle_abort },
    onIdle: (sessionId) => idleHandler.handle(sessionId),
  }
}
```

---

## 5. Top-Level Plugin Assembly

```
plugin/
├── index.ts        ← 组合所有角色 → 单一 OpenCode plugin
└── package.json
```

```typescript
// plugin/index.ts
import { assemblePlugin } from '@opencode-ai/core/plugin/registration'
import { createAristotleRole } from '@opencode-ai/reflection'

export default async function(ctx: any) {
  const aristotleRole = await createAristotleRole(ctx)
  return assemblePlugin(ctx, [aristotleRole])
}
```

---

## 6. Build System

### 6.1 Root Workspace

```json
// package.json (root)
{
  "name": "opencode-agent-platform",
  "private": true,
  "workspaces": ["packages/*", "plugin"],
  "scripts": {
    "build": "bun run --filter '*' build",
    "test": "bun run --filter '*' test"
  }
}
```

### 6.2 `packages/core/package.json`

```json
{
  "name": "@opencode-ai/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "echo 'consumed as TypeScript source'",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### 6.3 `packages/reflection/package.json`

```json
{
  "name": "@opencode-ai/reflection",
  "version": "1.2.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "echo 'consumed as TypeScript source'",
    "test": "vitest run"
  },
  "dependencies": {
    "@opencode-ai/core": "workspace:*",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### 6.4 `plugin/package.json`

```json
{
  "name": "@opencode-ai/agent-platform-plugin",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "bun build index.ts --outdir dist --target node --format esm"
  },
  "dependencies": {
    "@opencode-ai/core": "workspace:*",
    "@opencode-ai/reflection": "workspace:*",
    "@opencode-ai/plugin": "^1.4.0"   // OpenCode 运行时提供的类型定义，源码不显式 import，但 plugin build 需要
  }
}
```

**构建流程**：`bun build plugin/index.ts` 自动解析 workspace 依赖，打包为单一 `dist/index.js`。行为与当前 `bun build src/index.ts` 等价。core 和 aristotle 都不预编译。

---

## 7. Execution Steps

**总体策略：新写不碰旧，最后一切换。**

```
Phase A — 新建 core        ← 全新文件，全新测试，不碰旧代码
Phase B — 新建 aristotle   ← 全新文件，消费 core，外部接口与旧 Aristotle 一致
Phase C — 接入 + 验证      ← 新 plugin 入口，跑全部 162 旧测试，smoke test
Phase D — 切换             ← 删除旧代码，合并分支
```

旧目录 `plugins/aristotle-bridge/` 全程保留。新代码全部在 `packages/` 下。不存在中间态。

---

### Step 0: 安全准备

1. Tag 当前 HEAD 为 `pre-phase0`
2. 创建分支 `phase0-core-extraction`，所有工作在此分支上进行
3. 运行完整测试套件（vitest + pytest + test.sh）确认全部通过，建立已知良好基线

---

### Phase A: 新建 core

#### Step 1: 目录结构 + workspace 配置

```
mkdir -p packages/core/src/{plugin,store,session,executor}
mkdir -p packages/core/test
mkdir -p packages/reflection/src/reflection
mkdir -p packages/reflection/test
mkdir -p plugin
```

创建 root `package.json`（workspaces）+ 各子包 `package.json` + `tsconfig.json` + `vitest.config.ts`（Section 6）。

**验证点**：空 plugin 入口 + `bun build plugin/index.ts` → workspace 依赖解析和构建链路通畅。

#### Step 2: Logger 工厂

`packages/core/src/logger.ts` — `createLogger(prefix, envVar)` 工厂（Section 3.2.1）。

`packages/core/test/logger.test.ts` — 测试分层 env var、fallback、各 prefix 独立。

**验证点**：core logger 测试通过。

#### Step 3: Utils 可配置 sentinel

`packages/core/src/utils.ts` — `extractLastAssistantText` 改 sentinel 为可选参数（Section 3.2.2）。默认值保持 `[ARISTOTLE_BRIDGE:no_text_output]`（与当前源码一致）。

`packages/core/test/utils.test.ts` — 测试 sentinel 可配置 + 默认行为。

**验证点**：core utils 测试通过。

#### Step 4: StateStore

`packages/core/src/store/state-store.ts` — 接口 + 实现（Section 3.2.5）。原子写（mkdir + tmp + rename）、JSONL 追加、key→路径映射、list(prefix)。

`packages/core/test/state-store.test.ts` — 23 个用例（SS-01 到 SS-23：含 P0-2 的 15 个 + list() 的 4 个 + 路径安全 2 个 + 错误吞噬 2 个）。

**验证点**：core StateStore 测试通过。

#### Step 5: WorkflowStore

`packages/core/src/store/workflow-store.ts` — 从旧代码提取（Section 3.2.3），import core 内部模块。内部实现不变（单文件、in-memory Map、LRU eviction、multi-instance merge、startup reconciliation）。logger 改用 `createLogger('workflow', 'AGENT_PLATFORM_LOG')`。

`packages/core/test/workflow-store.test.ts` — 从旧测试迁移，更新日志 prefix 断言。

**验证点**：core WorkflowStore 测试通过。

#### Step 6: ConfigResolver

`packages/core/src/config.ts` — `createConfigResolver<T>()` 通用机制（Section 3.2.6），返回 `ConfigResolver<T>` 对象。

`packages/core/test/config.test.ts` — 测试通用解析链（文件→env→default→cache）+ `clearCache()`。

**验证点**：core config 测试通过。

#### Step 7: SessionExtractor

`packages/core/src/session/extractor.ts` — 通用 session 数据读取（Section 3.2.7）。构造参数接受 `baseDir`。

`packages/core/test/extractor.test.ts` — 测试通用过滤、截断、自定义文件名、key 语义。

**验证点**：core extractor 测试通过。

#### Step 8: Executor

`packages/core/src/executor/index.ts` — 纯 sub-session 创建 + promptAsync（Section 3.2.8）。构造参数只接受 `client`。

`packages/core/test/executor.test.ts` — 测试纯执行逻辑（session 创建、promptAsync、错误处理），不含快照和注册。

**验证点**：core executor 测试通过。

#### Step 9: 类型 + API Probe + Plugin Registration

1. `packages/core/src/types.ts` — 所有共享类型（WorkflowState 等）
2. `packages/core/src/plugin/api-probe.ts` — API mode detection
3. `packages/core/src/plugin/registration.ts` — RoleRegistration 接口 + assemblePlugin（含 onToolBefore/onToolAfter 分发、null 过滤、error isolation）

`packages/core/test/api-probe.test.ts` + `packages/core/test/registration.test.ts`（TestPlan P0-3 的 13 个用例）。

**验证点**：全部 core 测试通过。

#### Step 10: core barrel export + 总验证

`packages/core/src/index.ts` — 统一导出所有 core 模块。

**验证点**：`bun test` 在 `packages/core/` 下全部通过。

---

### Phase B: 新建 aristotle（消费 core，接口与旧一致）

**外部接口一致性要求**：
- Plugin 导出形状：`{ tool: { aristotle_fire_o, aristotle_check, aristotle_abort }, event: async (event) => {...} }`
- 三个 tool 的名称、args schema、返回值格式与旧代码完全一致
- event handler 对 idle 事件的处理行为与旧代码一致
- 配置路径（`aristotle-config.json`、env var `ARISTOTLE_MCP_DIR`/`ARISTOTLE_SESSIONS_DIR`）解析逻辑一致

#### Step 11: Aristotle 模块

编写以下文件（import from `@opencode-ai/core`）：

1. `packages/reflection/src/config.ts` — 包装 core ConfigResolver + Aristotle 路径逻辑 + detectMcpDir（单次解析，Section 3.2.6）+ re-export `clearConfigCache`
2. `packages/reflection/src/reflection/snapshot-extractor.ts` — 包装 core SessionExtractor，Aristotle 专属文件命名
3. `packages/reflection/src/executor.ts` — 包装 core AsyncTaskExecutor + WorkflowStore 注册 + 快照注入
4. `packages/reflection/src/idle-handler.ts` — **从旧代码复制 + 机械性改造**（详见 §4.3）：改 import 指向 core，构造函数增加 `{ sessionsDir, mcpDir }` 参数替代 `resolveConfig()` 调用。全部业务逻辑原样保留
5. `packages/reflection/src/tools.ts` — 三个 tool 定义（`aristotle_fire_o`, `aristotle_check`, `aristotle_abort`）。从旧 `index.ts:56-120` 提取，闭包捕获 `client`, `store`, `executor`。**注意**：`aristotle_abort` 有 6 个状态分支（not found / cancelled / chain_broken / chain_pending / running / other），其中 `chain_pending` 的处理逻辑与 `running` 不同（不检查非 running 状态）——必须原样保留
6. `packages/reflection/src/index.ts` — 角色入口 `createAristotleRole()`：解析 config、mkdirSync、marker file、exit handler、snapshot cleanup、创建各模块实例、组装并返回 `RoleRegistration`

**从旧 `index.ts` 迁移的启动职责**（当前 `index.ts:24-49`）：

| 职责 | 当前位置 | 目标 |
|------|---------|------|
| `mkdirSync(sessionsDir, { recursive: true })` | index.ts:25 | `createAristotleRole()` 开头 |
| `.bridge-active` marker file 创建（PID + timestamp） | index.ts:27-33 | `createAristotleRole()` 内 |
| process exit handler 注册（marker cleanup） | index.ts:35-49 | `createAristotleRole()` 内 |
| 7 天快照文件清理 | index.ts 后半部分 | `createAristotleRole()` 或独立函数 |
| API mode detection | index.ts 前半部分 | `createAristotleRole()` 开头 |

#### Step 12: Aristotle 测试

从旧测试迁移到 `packages/reflection/test/`，更新 import 路径指向新包：

1. `idle-handler.test.ts`（41 个测试）— 注意第 501-548 行有 3 个 config 路径检测测试需移到 config.test.ts；idle-handler 测试中 mcpDir 改为 mock 注入
2. `index.test.ts`（23 个测试）— 改测 `createAristotleRole()`
3. `snapshot-extractor.test.ts`（12 个测试）
4. `config.test.ts`（14 个测试：原 config.test.ts 全量迁移）— 全部是 Aristotle 特定的路径解析逻辑。注：idle-handler.test.ts 中的 3 个 detectMcpDir 测试是 config.test.ts 的重复，迁移时从 idle-handler **删除**而非新增到 config
5. `executor.test.ts` 拆分：

| 测试名 | 归属 | 原因 |
|--------|------|------|
| `should_create_session_promptAsync_and_return_running` | **core**（Step 8） | 纯 sub-session 创建 + promptAsync |
| `should_return_error_when_session_create_fails` | **core**（Step 8） | session 创建失败处理 |
| `should_abort_and_return_error_when_promptAsync_fails` | **core**（Step 8） | promptAsync 失败处理 |
| `should_invoke_onSessionCreated_callback_before_promptAsync` | **core**（Step 8） | DC-02 crash-safety 回调 |
| `should_extract_snapshot_when_targetSessionId` | **aristotle** | 快照注入逻辑 |
| `should_reuse_snapshot_when_exists_for_this_workflow` | **aristotle** | 快照复用逻辑 |
| `should_continue_launch_when_snapshot_extraction_fails` | **aristotle** | 快照提取容错 |
| `should_skip_snapshot_when_no_target_session_id` | **aristotle** | 快照条件跳过 |
| `should_reject_and_abort_session_when_store_full` | **aristotle** | WorkflowStore 容量检查 |
| `should_map_snake_case_params_to_camel_case_launch_args` | **aristotle** | Aristotle 专属参数映射 |
| `should_default_agent_to_R_when_not_provided` | **aristotle** | Aristotle R/C 链默认值 |
| `should_register_to_store_before_promptAsync` | **aristotle** | WorkflowStore 注册时序 |
| `should_overwrite_existing_workflow_on_re_register` | **aristotle** | WorkflowStore 重复注册 |
| `should_return_error_when_core_launch_fails` | **aristotle** | core launch 返回 error → 传播不 throw |
| `should_default_target_session_id_to_context_sessionID` | **aristotle** | 无 target_session_id 时使用 context sessionID |
| `should_pass_resolved_mcpDir_to_idle_handler` | **aristotle** | config.mcp_dir 注入路径 |
| `should_abort_session_when_store_register_fails` | **aristotle** | store.register 失败 rollback（SC-01） |
| `should_not_block_launch_when_snapshot_extraction_times_out` | **aristotle** | 快照提取超时不阻塞（SC-02） |

**验证点**：`packages/aristotle` 所有测试通过。

---

### Phase C: 接入 + 验证

#### Step 13: 新 plugin 入口

`plugin/index.ts` + `plugin/package.json`（Section 5 + 6.4）。

调用 `assemblePlugin(ctx, [createAristotleRole(ctx)])` 产出与旧代码相同形状的 plugin 对象。

**验证点**：
1. `tsc --noEmit` 在 `packages/core/` 和 `packages/reflection/` 通过（类型检查无误）
2. `bun build plugin/index.ts` 产出 `dist/index.js`

#### Step 14: 全量验证

- 全部 core 测试通过
- 全部 aristotle 测试通过
- `bun build` 成功产出 `dist/index.js`
- **测试完整性验证**：diff 迁移后的测试文件与原始文件，确认只改了 import 路径，断言逻辑无任何修改
- **接口一致性验证**：`assemblePlugin(ctx, [createAristotleRole(ctx)])` 返回的 `{ tool, event }` 形状与旧 plugin 导出逐字段对比
- 实际 OpenCode 加载插件，验证 Aristotle 功能（/aristotle 反思、R→C 链、rule 管理）全部正常
- pytest（~390）+ static（103）+ regression（64）+ e2e（2）通过

---

### Phase D: 切换

#### Step 15: 清理 + 合并

- 删除 `plugins/aristotle-bridge/`
- 更新 `install.sh`（repo 根目录）中的 build 路径
- 合并 `phase0-core-extraction` 到 main

---

## 8. Import Path Mapping

```
packages/core 内部（相对路径）:
  store/state-store.ts     → ../logger
  store/workflow-store.ts  → ../types, ../utils, ../logger
  session/extractor.ts     → ../logger
  executor/index.ts        → ../types
  plugin/api-probe.ts      → ../types
  plugin/registration.ts   → 无内部依赖
  config.ts                → ./logger

packages/aristotle → packages/core:
  @opencode-ai/core           → packages/core/src
  @opencode-ai/core/logger    → packages/core/src/logger
  @opencode-ai/core/config    → packages/core/src/config
  @opencode-ai/core/utils     → packages/core/src/utils
  @opencode-ai/core/types     → packages/core/src/types
  @opencode-ai/core/store/state-store → packages/core/src/store/state-store
  @opencode-ai/core/store/workflow-store → packages/core/src/store/workflow-store
  @opencode-ai/core/session/extractor → packages/core/src/session/extractor
  @opencode-ai/core/executor  → packages/core/src/executor
  @opencode-ai/core/plugin/api-probe → packages/core/src/plugin/api-probe
  @opencode-ai/core/plugin/registration → packages/core/src/plugin/registration

packages/aristotle 内部:
  idle-handler.ts   → @opencode-ai/core/*
  executor.ts       → @opencode-ai/core/store/workflow-store(type), ./reflection/snapshot-extractor, @opencode-ai/core/executor
  tools.ts          → @opencode-ai/core/types(type), @opencode-ai/core/store/workflow-store(type), ./executor(type)
  config.ts         → @opencode-ai/core/config
  index.ts          → ./idle-handler, ./executor, ./tools, ./config, @opencode-ai/core/plugin/api-probe

plugin/index.ts → @opencode-ai/core/plugin/registration, @opencode-ai/reflection
```

---

## 9. Risk Analysis

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| StateStore 与 WorkflowStore 单文件模式不兼容 | 低 | 低 | WorkflowStore Phase 0 不改持久化格式 |
| ConfigResolver 泛化引入 regression | 中 | 中 | 保留 Aristotle 现有 config 测试全量通过；`clearConfigCache` 通过 re-export 保持后向兼容 |
| SessionExtractor 泛化改变快照格式 | 中 | 高 | Aristotle SnapshotExtractor 包装层保证输出格式不变 |
| Executor 拆分后 AristotleExecutor 组合逻辑出错 | 中 | 高 | executor.test.ts 覆盖全部 launch 路径 |
| bun workspace 解析问题 | 低 | 中 | 先建空项目验证 workspace setup |
| idle-handler config 解耦遗漏 | 中 | 中 | 构造参数注入 `{ sessionsDir, mcpDir }`，不 import config 模块 |
| ctx.config 运行时覆盖丢失 | 低 | 高 | createAristotleRole 伪代码已体现 `ctx.config?.aristotleBridge?.sessionsDir` 覆盖 |
| Sentinel 默认值变更导致行为变化 | 低 | 高 | 默认 sentinel 保持 `[ARISTOTLE_BRIDGE:no_text_output]` 不变；参数可配置但默认值不改 |
| Logger prefix 变更导致测试断言失败 | 中 | 低 | WorkflowStore 用 `createLogger('workflow', ...)`，测试断言一并更新 |
| Logger env var 变更导致运行时可观测性回归 | 中 | 中 | WorkflowStore 使用 `AGENT_PLATFORM_LOG` 而非 `ARISTOTLE_LOG`。当前 `ARISTOTLE_LOG=debug` 用户将不再看到 WorkflowStore 的日志输出（reconciliation 详情、eviction、保存错误）。**缓解**：在 release notes 中显式说明此变更，用户需设置 `AGENT_PLATFORM_LOG=debug` 查看 core 模块日志。此为 Phase 0 唯一有意为之的运行时行为差异 |

---

## 10. Verification Checklist

- [ ] `packages/core/` 包含所有通用模块（StateStore, ConfigResolver, SessionExtractor, Executor, PluginRegistration, Logger, Utils, Types, API Probe, WorkflowStore）
- [ ] `packages/core/` 无任何 Aristotle 专属业务策略（无 R→C 转换逻辑、无 MCP 子进程调用、无 trigger 文件处理）。注意：WorkflowState 类型保留在 core，它是通用异步子任务状态模型；`agent` 字段类型为 `string`（非 `'R'|'C'` 联合），后续可按需扩展
- [ ] `packages/reflection/` 包含所有业务模块（IdleEventHandler, SnapshotExtractor 包装层, AristotleExecutor, Config 包装层）
- [ ] `packages/reflection/` 通过 `@opencode-ai/core` 引用基础设施
- [ ] StateStore 测试全部通过（SS-01 到 SS-23）
- [ ] Plugin Registration 测试全部通过（PR-01 到 PR-18）
- [ ] 所有 Aristotle 原有测试通过
- [ ] `bun build plugin/index.ts` 产出 `dist/index.js`
- [ ] `tsc --noEmit` 在 core 和 aristotle 零错误
- [ ] Python MCP server 不受影响
- [ ] Skill 文件路径不变
- [ ] 实际 OpenCode 加载后，Aristotle 功能（/aristotle 反思、R→C 链、rule 管理）全部正常
- [ ] `plugins/aristotle-bridge/` 已删除

---

## 11. Out of Scope (Phase 0 不做)

- 不引入 Watchdog 任何代码
- 不接入 OpenCode 的 `tool.execute.before` / `tool.execute.after` 事件源（assemblePlugin 内部分发基础设施已实现，Phase 2 接入 OpenCode 事件源后自然生效）
- 不重写 WorkflowStore 的持久化格式为 StateStore key-value 模式
- 不改变 Python MCP server
- 不改变数据目录结构
- 不改变 Skill 文件内容
- 不改变用户可见的任何行为
