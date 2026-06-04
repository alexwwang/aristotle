# Pseudocode Reference — §3.1 Phase 1 Observer

**Source**: quality-assurance-implementation-plan.md v1.46
**Purpose**: Implementation reference — not part of the technical plan spec.

## Code Block 1: L462-465
**Context**: **Interceptor 规则**（保持 2 个，不新增）：

```typescript
// AC-3: 业务代码写入门控（原有）
// AC-12: 阶段门控（原有）
```

## Code Block 2: L470-770
**Context**: > ⚠️ 以下为 Phase 1 **拟实现代码**，非当前 observer.ts 实现。当前 handle() 仅处理 Task 工具的 ralph_loop 观察（见实际代码 observer.ts:141-193）。

```typescript
  // ⚠️ Phase 1 目标接口说明：
  // - 所有 appendAudit 调用使用 Phase 1 扩展后的 AuditLogEntry
  // - 扩展策略：保留 decision 字段 + 新增 severity 字段（Observer 条目专用）
  // - event 联合类型扩展为：Phase 1/2/3 审计事件完整清单见 §3.0.1 AuditLogEntry.event Phase 分期。
  // - Observer 条目同时携带 decision（必填，兼容现有代码）和 severity（Observer 专用）
  // - timestamp 由调用方手动提供（new Date().toISOString()），与当前 observer.ts:111 模式一致。appendAudit 不自动填充。
  // - sessionId 从 OpenCode 上下文获取，由 handle() 参数 sessionID 传入
  // - phase/runId/projectId 从 this.cache.get() 返回的 PipelineState 获取（非 this.cache.getActiveRun()——getActiveRun() 是 PipelineStore 的方法）
  //   示例：`const state = this.cache.get(); if (!state) return; const { projectId, runId, currentPhase: phase } = state;`
  // - runId/projectId 同时也由 appendAudit 三参数签名前两个参数传递（存在冗余，与当前 schema.ts:185-186 一致）
  // - ⚠️ appendAudit 当前为同步方法（pipeline-store.ts:201 返回 void）。代码示例中不带 await，与现有 checkpoint.ts 代码风格一致（V4）。若 Phase 2 改为 async，需重新评估 Observer 20ms 超时保护。

// observer.ts handle() 方法扩展（Phase 1 拟实现）
async handle(tool, args, output, sessionID, callID) {
  this._timedOut = false;  // 重置超时标志。平台契约：OpenCode 按序调用 onToolAfter（每 tool-event 串行），实例级 _timedOut 标志在此契约下安全。若需异步并发支持，改用 AbortController 或 per-call { cancelled } 对象。
  // Auto-resolve: 检查当前 tool/文件 的前次 block 级违规，本次成功则标记 resolved
  // ⚠️ projectId 和 runId 从 this.cache.get() 获取的 PipelineState 中解构（同上方 OBSERVER_TIMEOUT handler）。
  // 完整实现需先获取 state：`const state = this.cache.get(); if (!state) return; const { projectId, runId } = state;`
  // 注意：若 recordTaskAndScan 已获取 state，可复用而非重复调用。
  // ⚠️ 以下 auto-resolve 伪代码的执行位置在 recordTaskAndScan 之后、Promise.race 之前。
  // 为保持代码线性阅读流，此处分开展示。实际代码位置见下方 `/* === AUTO-RESOLVE (runs here) === */` 标记。
  // Auto-resolve 实现——三个独立调用，按事件类型区分过滤维度：
  // ⚠️ scope: `a` 在 _handleObservations 内定义（L186），auto-resolve 在 handle() 顶层执行。
  // auto-resolve 获取参数方式：`const arArgs = args as Record<string, unknown>;`
  // 使用 `arArgs.command`（非 `a.command`）以避免 scope 错误。
  // 调用 1：COMMAND_FAILED — 按 tool + commandPattern 过滤（精确匹配 normalizeCommand 后的命令字符串）— 仅 tool==='Bash' 时执行
  // if (tool === 'Bash') {
   //   const cmdViolations = this.store.getUnresolvedViolations(state.projectId, state.runId, 'block', { tool: 'Bash', commandPattern: normalizeCommand(arArgs.command as string) });
  //   if (cmdViolations.length > 100) {
  //     // ⚠️ 安全守卫：超过 100 条目跳过 resolveViolations（性能保护）
  //     this.store.appendAudit(projectId, runId, { event: 'RESOLVE_SKIPPED_TOO_MANY', tool: 'Bash', ... });
  //     // ⚠️ 不 return——继续执行后续 _handleObservations 逻辑（仅跳过 resolveViolations）
  //   }
  //   else if (cmdViolations.length > 0) {
  //     this.store.resolveViolations(projectId, runId, cmdViolations.map(v => v.timestamp)); // resolveViolations(projectId: string, runId: string, timestamps: string[]): void — 完整签名见 §3.0.2
  //   }
  // }
  // 调用 2：SYNTAX_ERROR_POST_WRITE — 按 tool + filePath 过滤（无 commandPattern）— 仅 tool==='Write' 时执行
  // if (tool === 'Write') {
   //   const syntaxViolations = this.store.getUnresolvedViolations(state.projectId, state.runId, 'block', { tool: 'Write', filePath: arArgs.filePath as string });
  //   if (syntaxViolations.length > 100) {
  //     // ⚠️ 安全守卫：超过 100 条目跳过 resolveViolations（性能保护）
  //     this.store.appendAudit(projectId, runId, { event: 'RESOLVE_SKIPPED_TOO_MANY', tool: 'Write', ... });
  //     // ⚠️ 不 return——继续执行后续 _handleObservations 逻辑（仅跳过 resolveViolations）
  //   }
  //   else if (syntaxViolations.length > 0) {
  //     this.store.resolveViolations(projectId, runId, syntaxViolations.map(v => v.timestamp));
  //   }
  // }
  // 调用 3：OBSERVER_TIMEOUT — 按 event 过滤（无 tool/filePath）— 任何工具成功时均执行
  // const timeoutViolations = this.store.getUnresolvedViolations(state.projectId, state.runId, 'block', { event: 'OBSERVER_TIMEOUT' });
  // if (timeoutViolations.length > 100) {
  //   // ⚠️ 安全守卫：超过 100 条目跳过 resolveViolations（性能保护）
  //   this.store.appendAudit(projectId, runId, { event: 'RESOLVE_SKIPPED_TOO_MANY', event_filter: 'OBSERVER_TIMEOUT', ... });
  //   // ⚠️ 不 return——继续执行后续 _handleObservations 逻辑（仅跳过 resolveViolations）
  // }
  // else if (timeoutViolations.length > 0) {
  //   this.store.resolveViolations(projectId, runId, timeoutViolations.map(v => v.timestamp));
  //   // ⚠️ 成功 auto-resolve OBSERVER_TIMEOUT 后重置降级计数器
  //   // 原因：后续 Observer 成功执行说明超时是暂时的，计数器应归零避免误触发降级
  //   state.observerTimeoutCount = 0;
  //   // ⚠️ 计数器重置基于 recordTaskAndScan 成功而非 _handleObservations 成功。若当前观察后续超时，计数器将从 0 重新开始（保守行为）。
  // }
  // ⚠️ 设计决策：auto-resolve 仅处理 block 级 OBSERVER_TIMEOUT 事件（第 1-2 次超时）。降级后的 warn 级事件（第 3 次起）保留为历史审计记录，不自动 resolve。observerTimeoutCount 重置为 0 后，下次超时序列重新计数。
  // ⚠️ 多维过滤：COMMAND_FAILED/SYNTAX_ERROR_POST_WRITE 按 tool+filePath 匹配，
  // OBSERVER_TIMEOUT 按 event='OBSERVER_TIMEOUT' 匹配（无 tool/filePath）。
  // getUnresolvedViolations 的 filter 参数支持 { tool?, filePath?, event? } 组合。
  // auto-resolve 性能预算：典型 <1ms（日志 <100 行时），硬性上限 ≤5ms
  // 安全机制：超过 100 条目跳过 resolveViolations（性能保护）
  // resolveViolations 涉及 JSONL 文件读写（readLogSafe → modify → write），I/O 开销与日志行数相关
  // ⚠️ 执行位置：auto-resolve 在 recordTaskAndScan 之后、_handleObservations 之前执行。
  // 即 Path 1 (ralph_loop Task 观察) 和 Path 2 (session buffer) 的 early return 不影响 auto-resolve——
  // auto-resolve 在 Path 3 替换位置执行（state 存在且不在 ralph_loop Task 场景）。
  // 但若 recordTaskAndScan 内部 early return（如 tool 不是 Task），auto-resolve 仍会执行，
  // 因为它不依赖 recordTaskAndScan 的结果。
  // ⚠️ 执行位置与超时保护的关系：
  // auto-resolve 在 Promise.race 超时保护**之外**执行（在 recordTaskAndScan 之后、Promise.race 之前）。
  // 原因：auto-resolve 调用 getUnresolvedViolations（内存索引 O(1)）+ resolveViolations（同步方法），不消耗 20ms 超时预算。若放在 Promise.race 内，auto-resolve 会占用 _handleObservations 的时间预算。
  // 现有逻辑：记录 Task 调用、扫描注入
  // `recordTaskAndScan` 为拟提取的私有方法，封装现有 `this.cache.get()` + `this.store.appendObservation()` + `this.scanTaskPrompt()` 调用序列。
  await this.recordTaskAndScan(tool, args, output, sessionID, callID);
  /* === AUTO-RESOLVE (runs here) === */
  // ⚠️ auto-resolve 运行在 Promise.race 超时保护之外，需独立 try/catch
  try {
  // [auto-resolve 伪代码见上方注释块——实现时展开为实际代码]
  } catch (e) {
    console.error('[Observer] auto-resolve failed:', e);
    // auto-resolve 失败不应阻断 Observer 主路径
  }
  // ⚠️ auto-resolve 在 Path branching之前无条件执行；Bash/Write 过滤器自然排除非匹配工具（如 Task）
  // ⚠️ Phase 1 集成说明：以上 recordTaskAndScan 封装现有 observer.ts L141-183 的 Path 1（ralph_loop Task 观察）
  // 和 Path 2（session buffer）逻辑，含 early return。以下 _handleObservations 为 Phase 1 新增代码，
  // 在 Path 1/Path 2 的 early return 之后执行（即仅在'有活跃 pipeline 且需观察 Bash/Write 结果'时触发）。
  // 实际插入位置：替代 observer.ts Path 3 (L185-186 `return`——"Active pipeline but not ralph_loop → no-op")。
  // 仅在 state 存在且不在 ralph_loop 时执行观察逻辑。Path 1 (L169 return) 和 Path 2 (L182 return) 保持不变。
  // ⚠️ 注意：Path 3 的实际条件是 state 存在 AND NOT (ralph_loop + Task tool)。
  // Phase 1 观察逻辑会在 ralph_loop 期间的非 Task 工具调用（如 Bash、Write）时也触发。
  // 这是设计意图：在 ralph_loop 中执行的 Bash/Write 也需要观察（命令失败、语法错误）。
  
  // 超时保护（§4.2 防御闭环）
  const TIMEOUT_MS = 20;
  // setTimeout 在 JS 事件循环中非精确计时。Observer 超时为 best-effort 保护，实际超时可能略超 20ms。AC-5 P99 基准测量实际执行时间而非依赖 setTimeout 精度。
  // ⚠️ Promise.race 仅能中断 async 操作中的 yield 点（如 await），不能中断同步 CPU 密集操作。js-yaml/json.parse 等同步库执行时超时保护不生效。
  // ⚠️ clearTimeout 必须在 finally 中调用——即使 _handleObservations 在 20ms 内完成，未清理的 setTimeout 会保持 event loop 引用并浪费 macrotask 资源（setTimeout 为宏任务/定时器资源，非 microtask）。
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ObserverTimeoutError()), TIMEOUT_MS);
  });
  try {
    await Promise.race([
      this._handleObservations(tool, args, output, sessionID, callID),
      timeoutPromise
    ]);
  } catch (e) {
    if (e instanceof ObserverTimeoutError) {
      const state = this.cache.get();
      if (!state) return; // 无活跃 pipeline，忽略超时
      const { projectId, runId, currentPhase: phase } = state;
      // ⚠️ 降级计数器递增 + 检查
      state.observerTimeoutCount = (state.observerTimeoutCount || 0) + 1;
      const isDegraded = state.observerTimeoutCount >= 3;
      this._timedOut = true;
      this.store.appendAudit(projectId, runId, {
        event: 'OBSERVER_TIMEOUT',
        decision: isDegraded ? 'WARN' : 'BLOCK',
        severity: isDegraded ? 'warn' : 'block',
        violation: `Observer handle() 超时（>20ms），检查已跳过${isDegraded ? '（已降级，不再阻止阶段推进）' : ''}`,
        sessionId: sessionID,
        phase,
        timestamp: new Date().toISOString(),
      });
      // 降级时额外写入 OBSERVER_TIMEOUT_DEGRADED 审计事件
      if (isDegraded) {
        this.store.appendAudit(projectId, runId, {
          event: 'OBSERVER_TIMEOUT_DEGRADED',
          decision: 'WARN',
          severity: 'warn',
          violation: `Observer 连续 ${state.observerTimeoutCount} 次超时，降级为 warn`,
          sessionId: sessionID,
          phase,
          timestamp: new Date().toISOString(),
        });
        // ⚠️ DEGRADED 事件为 information-only，severity='warn'，不参与 getUnresolvedViolations('block') 查询。这些事件不会被 auto-resolve 或 phase_complete 清理。唯一清理路径是 archiveRun → 见 §3.0.2 PipelineStore.archiveRun()（删除整个审计日志）。
      }
      return; // fail-open for current call, fail-closed at gate（§4.2 防御闭环——超时不阻塞当前操作，但 block 级违规会阻止阶段推进）
    }
    throw e;
  } finally {
    clearTimeout(timeoutId!);
  }
  // 超时错误处理：ObserverTimeoutError 定义在模块顶层（与 Observer 类同级），支持跨方法 instanceof 检查。
  // ⚠️ 超时后防写入机制：Observer 设置 this._timedOut = true 标志（在 catch 块中）。_handleObservations 内部在每个 appendAudit 调用前检查 if (this._timedOut) return;。handle() 方法在每次调用开始时重置 this._timedOut = false。
  // 以下代码已包含 _timedOut 完整逻辑（设置 (Phase 1 target observer.ts:L547 / 本文档:L143)、检查 (Phase 1 target observer.ts:L606/L650/L680/L708)、重置 (Phase 1 target observer.ts:L459 / 本文档:L136)）。
}
// --- 以下为 Observer 类外部定义（模块级）---
// ObserverTimeoutError 定义见 §3.0.4（模块级定义，与 Observer 类同级）
// class ObserverTimeoutError extends Error {}  // stub; full definition in §3.0.4

// --- Observer 私有方法 ---
  // 私有方法：实际观察逻辑（提取自 handle()）
  private async _handleObservations(tool: string, args: unknown, output: unknown, sessionID: string, callID: string) {
    // ⚠️ 类型守卫：args 类型为 unknown，需先检查类型再访问属性
    if (!args || typeof args !== 'object') return;
    const a = args as Record<string, unknown>;
    // 获取 pipeline state（使用 this.cache.get() 返回 PipelineState，非 getActiveRun()）
    const state = this.cache.get();
    if (!state) return; // 无活跃 pipeline，跳过观察
    const { projectId, runId, currentPhase: phase } = state;
    // 新增：Bash 命令结果检查
    if (tool === 'Bash') {
      if (typeof a.command !== 'string') return;
      const normalizedCmd = normalizeCommand(a.command);  // 计算一次，复用
      // ⚠️ 类型守卫：output 类型为 unknown（observer.ts:143），需先检查类型
      if (typeof output !== 'string') return;
      const exitCode = extractExitCode(output);
      if (exitCode !== 0) {
        // 检查配置：是否忽略此退出码
        const config = RuleConfigLoader.load('COMMAND_RESULT_CHECK');
        if (config.enabled && !config.ignoreExitCodes?.includes(exitCode)
            && !config.ignoreCommands?.some(pat => matchPattern(normalizedCmd  // ⚠️ 使用上方缓存的 normalizedCmd（原 a.command as string）
            , pat))) {
          if (this._timedOut) return;  // 超时后阻止追加审计条目
          this.store.appendAudit(projectId, runId, {
            event: 'COMMAND_FAILED',
            decision: config.severity === 'block' ? 'BLOCK' : 'WARN',
            severity: config.severity,  // 'warn' 或 'block'
            violation: `命令退出码 ${exitCode}: ${normalizedCmd}`,
            // ⚠️ F-07: 存储 normalizeCommand 后的命令（非原始值），确保 auto-resolve 精确匹配。
            command: normalizedCmd,  // auto-resolve commandPattern 匹配此字段
            tool: 'Bash',  // auto-resolve filter.tool 匹配此字段
            // ⚠️ F-17: 命令可能含敏感参数（API key、password、token）。Phase 1 存储完整命令供调试；
            // Phase 2 应实现参数脱敏（识别 -H "Authorization: ..."、--token ...、password=... 并替换为 [REDACTED]）。
            // ⚠️ Watchdog StateStore 目录（.watchdog/）必须在 Phase 1 初始化时添加到 .gitignore，防止含原始命令的审计日志泄露到版本控制。
            sessionId: sessionID,
            phase,
            timestamp: new Date().toISOString(),
          });
          // Observer handle() 返回 Promise<void>（被动监视器，无返回值）
          // 警告通过审计日志传递，Checkpoint 阶段推进时检查 block 级违规
          // ⚠️ Auto-resolve 死锁缓解：auto-resolve 标记 resolved 不触发新命令执行，
          // 仅更新审计日志条目（resolved: true），因此不会递归触发 COMMAND_FAILED。
        }
      }
      // ⚠️ Bash 分支到此结束，下方 else if (Write) 与 Bash 互斥
    // 新增：文件写入后语法验证（Observer 可读取 args.content）
    // 注意：空文件（content === ''）和空白文件（content.trim() === ''）均视为合法（无内容 = 无语法错误）。falsy 跳过覆盖空字符串，trim 检查覆盖空白文件。
    //   因此只对 Write 工具做完整语法验证，Edit 工具跳过。⚠️ Edit 工具跳过语法验证的已知限制：Edit 可能引入语法错误（如删除闭合括号），但因 Edit 的 args 仅含 oldString/newString 而非完整文件内容，无法做全文件语法检查。缓解：(1) 同一文件的后续完整 Write 操作会触发语法验证；(2) 测试执行（Phase 2）可间接检测语法错误。Phase 1 无直接机制检测 Edit 引入的语法错误。
    // Bash 和 Write 是互斥分支（tool 值唯一）。Bash 分支执行完毕后自然跳过 Write 分支。
    } else if (tool === 'Write') {
      if (typeof a.filePath !== 'string') return;
      const filePath = a.filePath as string;
      const content = a.content as string;
      // ⚠️ F-10: content null safety guard — Write 工具始终提供 content（即使为空字符串 ''），
      // 但 `as string` 类型断言不提供运行时保护。若 content 实际为 null/undefined（非预期行为），
      // 后续 content.length 和 content?.trim() 会抛 TypeError。添加 early-return guard：
      if (typeof content !== 'string') return;  // 防御性检查：Write 工具不应产生 null content，但需类型安全
      const config = RuleConfigLoader.load('SYNTAX_CHECK_POST_WRITE');
      if (!config.enabled) return;
      
      // 文件大小检查（AC-5: ≤100KB）。⚠️ content.length 是 JS 字符数（UTF-16 code units），非字节数。
      // 对含多字节字符（中文/emoji）的文件，字符数 < 实际 UTF-8 字节数。Phase 1 使用字符数近似（偏宽松）。
      // 若需精确字节限制，改用 `Buffer.byteLength(content, 'utf8')`。
      if (content.length > 100 * 1024) {
        if (this._timedOut) return;  // 超时后阻止追加审计条目
        // ⚠️ 此事件仅在 config.enabled=true 时写入。config.enabled=false 时整个 Write 观察被跳过（L267 return），不会产生此事件。
        this.store.appendAudit(projectId, runId, {
          event: 'FILE_TOO_LARGE_FOR_CHECK',
          decision: 'WARN',
          severity: 'warn',
          violation: `文件 ${filePath} 超过 100KB 限制，跳过语法检查`,
          tool: 'Write',  // auto-resolve filter.tool 匹配此字段
          filePath,  // auto-resolve filter.filePath 匹配此字段
          sessionId: sessionID,
          phase,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      
      // 快速短路：空内容先于扩展名匹配（避免无用 I/O）
      if (!content.trim()) return; // content is string (type-narrowed by L238 typeof guard)
      
      // 根据配置的 extensions 过滤（而非硬编码）
      // ⚠️ config.extensions 缺失或为空数组时，fallback 到默认扩展名列表 ['.json', '.yaml', '.yml']（Phase 1 默认值）
      const extensions = config.extensions?.length ? config.extensions : ['.json', '.yaml', '.yml'];
      const extMatch = extensions.some(ext => filePath?.endsWith(ext));
      if (!extMatch) return;
      // ⚠️ 未知扩展名通过 extensions 过滤后到达此点，若无对应验证分支（如 .toml、.ini）则静默跳过。
      // 若需支持新扩展名，需在 extensions 配置 AND 添加对应验证分支（如 L312 .json、L334 .yaml/.yml）。
      // Phase 1 仅验证 .json/.yaml/.yml，其他扩展名即使配置也不执行验证（无分支可匹配）。
      
      if (filePath?.endsWith('.json')) {
        try { JSON.parse(content); }
        catch (e: unknown) {
          if (!(e instanceof Error)) return;
          if (this._timedOut) return;  // 超时后阻止追加审计条目
          this.store.appendAudit(projectId, runId, {
            event: 'SYNTAX_ERROR_POST_WRITE',
            decision: 'BLOCK',
            severity: 'block',
            violation: `JSON 语法错误: ${e.message}`,
            tool: 'Write',  // auto-resolve filter.tool 匹配此字段
            filePath,  // auto-resolve filter.filePath 匹配此字段
            sessionId: sessionID,
            phase,
            timestamp: new Date().toISOString(),
          });
        }
      }
      
      // [Phase 2] TypeScript/TSX 语法验证（Phase 1 不实现此分支——仅保留注释占位，无执行代码）
      // if (filePath?.endsWith('.ts') || filePath?.endsWith('.tsx')) {
      //   const result = quickSyntaxCheck(content);
      //   if (!result.ok) { /* appendAudit SYNTAX_ERROR_POST_WRITE */ }
      // }
      // Phase 1 仅实现上方 .json 和 .yaml/.yml 分支
      
      if (filePath?.endsWith('.yaml') || filePath?.endsWith('.yml')) {
        const result = yamlSyntaxCheck(content);
        if (!result.ok) {
          // ⚠️ result.error 类型为 `string | undefined`（yamlSyntaxCheck 返回类型定义）。
          // ok=false 时 error 应存在，但 TypeScript 不做 discriminated union narrowing。
          // 实现时建议使用 `result.error ?? '未知 YAML 语法错误'` 作为 fallback。
          if (this._timedOut) return;  // 超时后阻止追加审计条目
          this.store.appendAudit(projectId, runId, {
            event: 'SYNTAX_ERROR_POST_WRITE',
            decision: 'BLOCK',
            severity: 'block',
            violation: `YAML 语法错误: ${result.error ?? '未知 YAML 语法错误'}`,
            tool: 'Write',  // auto-resolve filter.tool 匹配此字段
            filePath,  // auto-resolve filter.filePath 匹配此字段
            sessionId: sessionID,
            phase,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }
```

## Code Block 3: L775-798
**Context**: **Checkpoint 门控增强**（Phase 1 拟实现，当前 checkpoint.ts:397-405 仅做 archiveRun + clearActiveRun）：

```typescript
// checkpoint.ts — 阶段推进时检查审计日志（Phase 1 拟实现）
// ⚠️ 插入位置：在 CheckpointHandler.handle() 中 validateTransition() 之后、applyTransition() 之前。
// 执行顺序：validate → **violation gate check** → apply → writeState → audit → archive
// 若 violation gate check 返回 blocked，不执行 applyTransition，直接返回 CheckpointGateResult。
// 这确保磁盘状态与门控决策一致——blocked 时不写入 phaseStatus='complete'。
case 'phase_complete':
  // 检查审计日志中是否有未修复的 block 级违规
  // `getUnresolvedViolations` 为 Phase 1 需新增到 PipelineStore 的方法。实现：读取当前 run 审计日志 → 过滤 severity 匹配条目 → 排除 resolved:true 条目。
  // ⚠️ 性能：50000 条线性扫描可能超 50ms 预算。Phase 1 实现方案：(1) 维护内存中的 unresolved 索引（Map<severity, AuditLogEntry[]>），appendAudit 时更新索引，getUnresolvedViolations 直接读索引（O(1)）；(2) 索引随 pipeline state 序列化持久化。
  // 返回类型：`Array<AuditLogEntry & { _sourceKey: string }>` — _sourceKey 标识条目所在 audit key，resolveViolations 需据此定位条目。
  // ⚠️ 审计日志轮转（audit → audit-2 → ...）：unresolved 索引必须覆盖所有 audit* key 前缀。
  // 索引在 appendAudit 时更新（含轮转 key 的条目），getUnresolvedViolations 查询全量索引。
  const unresolved = this.store.getUnresolvedViolations(state.projectId, state.runId, 'block'); // ⚠️ getUnresolvedViolations 需要 projectId 和 runId 参数（3-param 签名），使用内存索引（O(1)），同步调用，无需 await
  if (unresolved.length > 0) {
    return {
      blocked: true,
      reason: `存在 ${unresolved.length} 个未修复的 block 级违规，无法推进阶段`,
      violations: unresolved.map(v => v.violation).filter((v): v is string => v !== undefined),
      // ⚠️ violation 为 optional 字段，需 filter 排除 undefined（block-level 条目可能缺失 violation 字段）
    };
  }
  break;
```
