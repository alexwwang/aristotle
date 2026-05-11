// Plugin entry point — Phase 0 Core Extraction
// Wires up the platform plugin using core + aristotle packages
import { assemblePlugin } from '@opencode-ai/core/plugin/registration';
import { createAristotleRole } from '@opencode-ai/aristotle';

export default async function (ctx: any) {
  const role = await createAristotleRole(ctx);
  return assemblePlugin(ctx, [role]);
}
