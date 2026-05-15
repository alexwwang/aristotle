export interface ToolDefinition {
  description: string
  args: Record<string, any>
  execute: (args: any, context: any) => Promise<string>
}

export interface RoleRegistration {
  onToolBefore?: (tool: string, args: unknown, sessionId: string, callID: string) => Promise<void>
  onToolAfter?: (tool: string, args: unknown, output: unknown, sessionId: string, callID: string) => Promise<void>
  onIdle?: (sessionId: string, client: any) => Promise<void>
  tools?: Record<string, ToolDefinition>
}

export interface PluginOutput {
  tool?: Record<string, ToolDefinition>
  event?: (event: any) => Promise<void>
  "tool.execute.before"?: (params: {
    tool: string
    sessionID: string
    callID: string
    args: unknown
  }) => Promise<void>
  "tool.execute.after"?: (params: {
    tool: string
    sessionID: string
    callID: string
    args: unknown
    output: unknown
  }) => Promise<void>
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

          // Call onToolBefore for all active roles (fail-closed: errors propagate)
          for (const role of activeRoles) {
            if (role.onToolBefore) {
              await role.onToolBefore(name, args, sessionId, context.callID ?? '')
            }
          }

          // Execute original tool
          const output = await originalExecute(args, context)

          // Call onToolAfter for all active roles (fail-open with degradation flag)
          for (const role of activeRoles) {
            if (role.onToolAfter) {
              try {
                await role.onToolAfter(name, args, output, sessionId, context.callID ?? '')
              } catch {
                // Observer errors caught here; degradation flag set internally
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

  // Phase 2 NEW: Global tool.execute.before/after — fires for ALL tools
  const rolesWithBefore = activeRoles.filter(r => r.onToolBefore)
  const rolesWithAfter = activeRoles.filter(r => r.onToolAfter)

  if (rolesWithBefore.length > 0) {
    output["tool.execute.before"] = async (params) => {
      for (const role of rolesWithBefore) {
        await role.onToolBefore!(params.tool, params.args, params.sessionID, params.callID)
      }
    }
  }

  if (rolesWithAfter.length > 0) {
    output["tool.execute.after"] = async (params) => {
      for (const role of rolesWithAfter) {
        try {
          await role.onToolAfter!(params.tool, params.args, params.output, params.sessionID, params.callID)
        } catch {
          // Observer is fail-open: errors caught, degradation flag set internally
        }
      }
    }
  }

  const hasIdleHandlers = activeRoles.some(r => r.onIdle)
  if (hasIdleHandlers) {
    output.event = async (event: any) => {
      const e = event?.event ?? event
      // Only handle session.idle events — match OpenCode's event format
      if (e?.type !== 'session.idle') return

      const sessionId = e?.properties?.sessionID ?? ''
      if (typeof sessionId !== 'string' || !sessionId) return

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
