import type { CoreLaunchArgs, CoreLaunchResult } from '../types.js'

export class AsyncTaskExecutor {
  constructor(private client: any) {}

  async launch(args: CoreLaunchArgs): Promise<CoreLaunchResult> {
    // DC-01: try/catch error handling, return { status: 'error' } instead of throw
    try {
      // 1. Create sub-session
      const session = await this.client.session.create({
        body: { title: args.title, parentID: args.parentSessionId },
      })
      // DC-02: onSessionCreated callback invoked before promptAsync
      args.onSessionCreated?.(session.data.id)
      // 2. promptAsync
      await this.client.session.promptAsync({
        path: { id: session.data.id },
        body: { parts: [{ type: 'text', text: args.oPrompt }] },
      })
      return { sessionId: session.data.id, status: 'running', message: 'Sub-session launched successfully' }
    } catch (err) {
      return { sessionId: '', status: 'error', message: String(err) }
    }
  }
}
