import type { InterceptRule } from './intercept-rules.js'

/**
 * Thrown when the interceptor blocks a tool call due to a TDD invariant violation.
 * This is an EXPECTED throw — the tool is intentionally blocked.
 */
export class WatchdogInterceptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchdogInterceptError'
  }
}

/**
 * File write interceptor — evaluates TDD rules before tool execution.
 * Bound to RoleRegistration.onToolBefore.
 */
export class Interceptor {
  constructor(
    private _cache: any,
    private _config: any,
    private _pathExtractor: (tool: string, args: unknown) => string | null,
    private _fileClassifier: (path: string, patterns: any, ignore: any) => any,
    private _rules: InterceptRule[],
  ) {}

  async handle(tool: string, args: unknown, sessionID: string, callID: string): Promise<void> {
    try {
      // 1. Check if tool is in monitoredTools → if not, return silently
      const monitoredTools = this._config?.monitoredTools || []
      if (!monitoredTools.includes(tool)) {
        return
      }

      // 2. Get state from cache → if null, return silently
      const state = this._cache.get()
      if (!state) {
        return
      }

      // 3. Extract file path via pathExtractor
      const filePath = this._pathExtractor(tool, args)
      if (!filePath) {
        return
      }

      // 5. Classify file via fileClassifier
      const classification = this._fileClassifier(
        filePath,
        this._config?.deliverablePatterns || {},
        this._config?.ignorePatterns || [],
      )

      // 6. Run rules in order → first blocked rule wins
      for (const rule of this._rules) {
        const result = rule.evaluate(tool, filePath, classification, state)
        if (result?.blocked) {
          throw new WatchdogInterceptError(
            result.reason || 'Blocked by TDD Watchdog rule',
          )
        }
      }

      // 7. If no rule blocked → return silently
      return
    } catch (err) {
      // Re-throw known intentional errors
      if (err instanceof WatchdogInterceptError) {
        throw err
      }
      // On unexpected error → throw plain Error with TDD Watchdog prefix
      throw new Error(
        `[TDD Watchdog] Unexpected error during interception: ${(err as Error).message}. Please restart the pipeline.`,
      )
    }
  }
}
