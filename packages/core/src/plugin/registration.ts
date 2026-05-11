export interface ToolDefinition {
  description: string
  args: Record<string, any>
  execute: (args: any, context: any) => Promise<string>
}

export interface RoleRegistration {
  onToolBefore?: (tool: string, args: unknown, sessionId: string) => Promise<string | null>
  onToolAfter?: (tool: string, args: unknown, output: unknown, sessionId: string) => Promise<void>
  onIdle?: (sessionId: string, client: any) => Promise<void>
  tools?: Record<string, ToolDefinition>
}

export interface PluginOutput {
  tool?: Record<string, ToolDefinition>
  event?: (event: any) => Promise<void>
}

function getSessionId(context: any): string {
  return context?.session?.id ?? context?.sessionId ?? ''
}

export function assemblePlugin(ctx: any, roles: Array<RoleRegistration | null>): PluginOutput {
  const activeRoles = roles.filter((r): r is RoleRegistration => r != null)

  if (activeRoles.length === 0) {
    return {}
  }

  // Merge tools from all roles
  const mergedTools: Record<string, ToolDefinition> = {}
  for (const role of activeRoles) {
    if (role.tools) {
      for (const [name, def] of Object.entries(role.tools)) {
        if (name in mergedTools) {
          throw new Error(`Tool name conflict: ${name}`)
        }
        mergedTools[name] = def
      }
    }
  }

  const hasToolHooks = activeRoles.some(r => r.onToolBefore || r.onToolAfter)

  // Wrap tool.execute with onToolBefore/onToolAfter hooks
  if (hasToolHooks) {
    for (const [name, def] of Object.entries(mergedTools)) {
      const originalExecute = def.execute
      mergedTools[name] = {
        ...def,
        execute: async (args: any, context: any) => {
          const sessionId = getSessionId(context)

          // Call onToolBefore for all active roles
          let interceptedResult: string | null = null
          for (const role of activeRoles) {
            if (role.onToolBefore) {
              try {
                const result = await role.onToolBefore(name, args, sessionId)
                if (result !== null) {
                  interceptedResult = result
                  break
                }
              } catch {
                // PR-10: catch error and treat as PASS (continue to next role or execute)
              }
            }
          }

          if (interceptedResult !== null) {
            // Call onToolAfter with intercepted result
            for (const role of activeRoles) {
              if (role.onToolAfter) {
                try {
                  await role.onToolAfter(name, args, interceptedResult, sessionId)
                } catch {
                  // Don't block on onToolAfter errors
                }
              }
            }
            return interceptedResult
          }

          // Execute original tool
          const output = await originalExecute(args, context)

          // Call onToolAfter for all active roles
          for (const role of activeRoles) {
            if (role.onToolAfter) {
              try {
                await role.onToolAfter(name, args, output, sessionId)
              } catch {
                // Don't block on onToolAfter errors
              }
            }
          }

          return output
        },
      }
    }
  }

  const output: PluginOutput = {}

  if (Object.keys(mergedTools).length > 0) {
    output.tool = mergedTools
  }

  const hasIdleHandlers = activeRoles.some(r => r.onIdle)
  if (hasIdleHandlers) {
    output.event = async (event: any) => {
      const actualEvent = event?.event ?? event
      const sessionId = actualEvent?.sessionId ?? ''

      for (const role of activeRoles) {
        if (role.onIdle) {
          try {
            await role.onIdle(sessionId, ctx.client)
          } catch {
            // PR-12: don't block subsequent roles on idle error
          }
        }
      }
    }
  }

  return output
}
