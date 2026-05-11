import fs from 'node:fs'

export interface ConfigResolverOptions<T> {
  /** 配置文件路径（可返回 null 表示跳过文件） */
  configPath: string | (() => string | null)
  /** env var 映射：config 字段名 → env var 名 */
  envMappings: Partial<Record<keyof T, string>>
  /** 字段级 resolver：fileValue + envValue → 最终值 */
  resolvers: { [K in keyof T]: (fileValue: any, envValue: string | undefined) => T[K] }
  /** 自定义文件读取函数（用于测试注入） */
  readFile?: (path: string, encoding: string) => string
}

export interface ConfigResolver<T> {
  /** 解析并返回配置（带缓存） */
  resolve(): T
  /** 清除缓存 */
  clearCache(): void
}

/**
 * 创建配置解析器。返回对象包含 resolve() 和 clearCache() 方法。
 *
 * 解析优先级（由每个 resolver 自行决定，通常）：
 *   config file value > env var value > default
 *
 * DC-04: eager cache allocation 保证递归安全。当某个 resolver 调用
 * resolver.resolve() 读取其他字段时，缓存已存在（truthy），不会重新
 * 进入文件读取循环。
 *
 * 异常安全：任一 resolver 抛异常时，缓存被重置为 null，避免返回
 * 不完整的结果。
 */
export function createConfigResolver<T>(options: ConfigResolverOptions<T>): ConfigResolver<T> {
  let cache: T | null = null

  return {
    resolve(): T {
      if (cache) return cache

      // 读取配置文件
      let fileConfig: Record<string, any> = {}
      const configPath = typeof options.configPath === 'function' ? options.configPath() : options.configPath
      if (configPath) {
        try {
          const content = options.readFile
            ? options.readFile(configPath, 'utf-8')
            : fs.readFileSync(configPath, 'utf-8')
          fileConfig = JSON.parse(content)
        } catch {
          // file not found or corrupted — fallback
        }
      }

      // DC-04: eager cache allocation — 递归安全
      cache = {} as T
      try {
        for (const key of Object.keys(options.resolvers) as (keyof T)[]) {
          const envVarName = options.envMappings[key]
          const envValue = envVarName ? process.env[envVarName] : undefined
          // DC-14: 注意 resolver 自己处理 || fallback 链，env 值原样传递
          ;(cache as any)[key] = options.resolvers[key](fileConfig[key as string], envValue)
        }
        return cache as T
      } catch (e) {
        cache = null // 异常安全：清空缓存
        throw e
      }
    },

    clearCache(): void {
      cache = null
    },
  }
}
