import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import { createConfigResolver } from '../src/config.js'

describe('createConfigResolver', () => {
  let envBackup: NodeJS.ProcessEnv

  beforeEach(() => {
    envBackup = { ...process.env }
  })

  afterEach(() => {
    process.env = envBackup
    vi.restoreAllMocks()
  })

  // CR-01
  it('should_resolve_from_file_first', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ port: 8080 }))
    process.env.APP_PORT = '9090'

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    expect(resolver.resolve()).toEqual({ port: 8080 })
  })

  // CR-02
  it('should_resolve_from_env_when_no_file', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('file not found')
    })
    process.env.APP_PORT = '9090'

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    expect(resolver.resolve()).toEqual({ port: 9090 })
  })

  // CR-03
  it('should_resolve_from_default_when_nothing_set', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('file not found')
    })

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    expect(resolver.resolve()).toEqual({ port: 3000 })
  })

  // CR-04
  it('should_cache_result_after_first_resolve', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ port: 8080 }))

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    const first = resolver.resolve()
    const second = resolver.resolve()

    expect(first).toBe(second) // 同一对象引用
    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  // CR-05
  it('should_clear_cache_and_re_resolve', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ port: 8080 }))

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    resolver.resolve()
    resolver.clearCache()
    resolver.resolve()

    expect(readSpy).toHaveBeenCalledTimes(2)
  })

  // CR-06
  it('should_handle_null_config_path', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync')

    const resolver = createConfigResolver<{ port: number }>({
      configPath: () => null,
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    expect(resolver.resolve()).toEqual({ port: 3000 })
    expect(readSpy).not.toHaveBeenCalled()
  })

  // CR-07
  it('should_handle_corrupted_config_file', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('not valid json {{{')
    process.env.APP_PORT = '9090'

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    expect(resolver.resolve()).toEqual({ port: 9090 })
  })

  // CR-08
  it('should_support_generic_type', () => {
    interface AppConfig {
      enabled: boolean
      name: string
      count: number
    }

    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('file not found')
    })

    const resolver = createConfigResolver<AppConfig>({
      configPath: '/fake/config.json',
      envMappings: {
        enabled: 'APP_ENABLED',
        name: 'APP_NAME',
        count: 'APP_COUNT',
      },
      resolvers: {
        enabled: (fileVal, envVal) => fileVal || envVal === 'true' || false,
        name: (fileVal, envVal) => fileVal || envVal || 'default',
        count: (fileVal, envVal) => fileVal || Number(envVal) || 0,
      },
    })

    expect(resolver.resolve()).toEqual({ enabled: false, name: 'default', count: 0 })
  })

  // CR-09
  it('should_invalidate_cache_on_resolver_error', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ a: 1 }))

    const resolver = createConfigResolver<{ a: number; b: number }>({
      configPath: '/fake/config.json',
      envMappings: {},
      resolvers: {
        a: (fileVal) => fileVal || 0,
        b: () => {
          throw new Error('resolver error')
        },
      },
    })

    expect(() => resolver.resolve()).toThrow('resolver error')

    readSpy.mockRestore()

    // cache 已被置 null，第二次 resolve 会重新读取文件
    const readSpy2 = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ a: 1 }))
    expect(() => resolver.resolve()).toThrow('resolver error')
    expect(readSpy2).toHaveBeenCalledTimes(1)
  })

  // CR-10
  it('should_handle_missing_env_var_gracefully', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('file not found')
    })

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'NON_EXISTENT_VAR_XYZ' },
      resolvers: {
        port: (fileVal, envVal) => {
          // envVal 应为 undefined
          return fileVal || Number(envVal) || 3000
        },
      },
    })

    expect(resolver.resolve()).toEqual({ port: 3000 })
  })

  // CR-11
  it('should_respect_field_order_with_cross_field_dep', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ sessionsDir: '/data' }))

    const resolver: import('../src/config.js').ConfigResolver<{ sessionsDir: string; mcpDir: string }> = createConfigResolver<{ sessionsDir: string; mcpDir: string }>({
      configPath: '/fake/config.json',
      envMappings: {},
      resolvers: {
        sessionsDir: (fileVal, envVal) => fileVal || '/default',
        mcpDir: (fileVal, envVal) => fileVal || resolver.resolve().sessionsDir + '/mcp',
      },
    })

    expect(resolver.resolve()).toEqual({ sessionsDir: '/data', mcpDir: '/data/mcp' })
  })

  // CR-12
  it('should_not_recurse_infinitely_on_cross_field', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('file not found')
    })

    const resolver: import('../src/config.js').ConfigResolver<{ sessionsDir: string; mcpDir: string }> = createConfigResolver<{ sessionsDir: string; mcpDir: string }>({
      configPath: '/fake/config.json',
      envMappings: {},
      resolvers: {
        sessionsDir: () => '/default',
        mcpDir: (fileVal, envVal) => fileVal || resolver.resolve().sessionsDir + '/mcp',
      },
    })

    // eager cache allocation 保证不会无限递归
    expect(resolver.resolve()).toEqual({ sessionsDir: '/default', mcpDir: '/default/mcp' })
  })

  // CR-13
  it('should_resolve_successfully_after_error_recovery', () => {
    let shouldThrow = true
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ port: 8080 }))

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: {},
      resolvers: {
        port: (fileVal, envVal) => {
          if (shouldThrow) throw new Error('temporary error')
          return fileVal || Number(envVal) || 3000
        },
      },
    })

    expect(() => resolver.resolve()).toThrow('temporary error')

    shouldThrow = false
    expect(resolver.resolve()).toEqual({ port: 8080 })
  })

  // CR-14
  it('should_treat_empty_string_env_as_falsy', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('file not found')
    })
    process.env.APP_PORT = ''

    const resolver = createConfigResolver<{ port: number }>({
      configPath: '/fake/config.json',
      envMappings: { port: 'APP_PORT' },
      resolvers: {
        // resolver 使用 || 处理 falsy 值（包括空字符串）
        port: (fileVal, envVal) => fileVal || Number(envVal) || 3000,
      },
    })

    // 空字符串被 Number('') → 0，0 是 falsy，走 || fallback 链到 3000
    expect(resolver.resolve()).toEqual({ port: 3000 })
  })
})
