import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, logger } from '../src/logger.js'

describe('createLogger', () => {
  let envBackup: NodeJS.ProcessEnv
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    envBackup = { ...process.env }
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = envBackup
    stderrSpy.mockRestore()
  })

  // LG-01
  it('should_output_all_levels_when_env_set_to_debug', () => {
    process.env.AGENT_PLATFORM_LOG = 'debug'
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(4)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[test:debug] d')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[test:info] i')
    expect(stderrSpy).toHaveBeenNthCalledWith(3, '[test:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(4, '[test:error] e')
  })

  // LG-02
  it('should_output_debug_when_level_is_debug', () => {
    process.env.AGENT_PLATFORM_LOG = 'debug'
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')

    log.debug('d')

    expect(stderrSpy).toHaveBeenCalledTimes(1)
    expect(stderrSpy).toHaveBeenCalledWith('[test:debug] d')
  })

  // LG-03
  it('should_output_all_when_level_is_info', () => {
    process.env.AGENT_PLATFORM_LOG = 'info'
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(3)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[test:info] i')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[test:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(3, '[test:error] e')
  })

  // LG-04
  it('should_fallback_to_global_env_when_module_env_unset', () => {
    delete process.env.WORKFLOW_LOG
    process.env.AGENT_PLATFORM_LOG = 'info'
    const log = createLogger('wf', 'WORKFLOW_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(3)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[wf:info] i')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[wf:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(3, '[wf:error] e')
  })

  // LG-05
  it('should_use_module_env_var_over_platform_env', () => {
    process.env.AGENT_PLATFORM_LOG = 'error'
    process.env.WORKFLOW_LOG = 'debug'
    const log = createLogger('wf', 'WORKFLOW_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(4)
  })

  // LG-06
  it('should_only_log_at_or_above_configured_level', () => {
    process.env.AGENT_PLATFORM_LOG = 'warn'
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(2)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[test:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[test:error] e')
  })

  // LG-07
  it('should_fallback_to_warn_when_no_env_set', () => {
    delete process.env.AGENT_PLATFORM_LOG
    delete process.env.ARISTOTLE_LOG
    const log = createLogger('test', 'ARISTOTLE_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(2)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[test:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[test:error] e')
  })

  // LG-08
  it('should_prefix_with_module_name', () => {
    process.env.AGENT_PLATFORM_LOG = 'debug'
    const log = createLogger('workflow', 'AGENT_PLATFORM_LOG')

    log.debug('hello')

    expect(stderrSpy).toHaveBeenCalledWith('[workflow:debug] hello')
  })

  // LG-09
  it('should_output_to_stderr_not_stdout', () => {
    process.env.AGENT_PLATFORM_LOG = 'debug'
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(stderrSpy).toHaveBeenCalledTimes(4)
    expect(stdoutSpy).not.toHaveBeenCalled()

    stdoutSpy.mockRestore()
  })

  // LG-10
  it('should_handle_unknown_level_gracefully', () => {
    process.env.AGENT_PLATFORM_LOG = 'foo'
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    // 'foo' → LEVELS['foo'] ?? 1 → 1 (info). So info/warn/error pass.
    expect(stderrSpy).toHaveBeenCalledTimes(3)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[test:info] i')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[test:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(3, '[test:error] e')
  })

  // LG-11
  it('should_not_interfere_between_independent_loggers', () => {
    process.env.AGENT_PLATFORM_LOG = 'warn'
    process.env.ARISTOTLE_LOG = 'debug'

    const platformLog = createLogger('platform', 'AGENT_PLATFORM_LOG')
    const aristotleLog = createLogger('aristotle', 'ARISTOTLE_LOG')

    platformLog.debug('pd')
    platformLog.error('pe')
    aristotleLog.debug('ad')
    aristotleLog.error('ae')

    expect(stderrSpy).toHaveBeenCalledTimes(3)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[platform:error] pe')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[aristotle:debug] ad')
    expect(stderrSpy).toHaveBeenNthCalledWith(3, '[aristotle:error] ae')
  })

  // LG-12
  it('should_preserve_backward_compat_with_ARISTOTLE_LOG', () => {
    delete process.env.AGENT_PLATFORM_LOG
    process.env.ARISTOTLE_LOG = 'debug'
    const log = createLogger('aristotle', 'ARISTOTLE_LOG')

    log.debug('d')

    expect(stderrSpy).toHaveBeenCalledTimes(1)
    expect(stderrSpy).toHaveBeenCalledWith('[aristotle:debug] d')
  })

  // LG-13
  it('should_treat_empty_string_env_as_unsets', () => {
    process.env.AGENT_PLATFORM_LOG = ''
    const log = createLogger('test', 'AGENT_PLATFORM_LOG')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    // Empty string should be treated as unset → fallback to 'warn'
    expect(stderrSpy).toHaveBeenCalledTimes(2)
    expect(stderrSpy).toHaveBeenNthCalledWith(1, '[test:warn] w')
    expect(stderrSpy).toHaveBeenNthCalledWith(2, '[test:error] e')
  })
})

describe('logger (default export)', () => {
  it('is exported', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })
})
