// Plugin entry point — Phase 0 Core Extraction + Phase 1 Watchdog
// Wires up the platform plugin using core + aristotle + watchdog packages
import { assemblePlugin } from '@opencode-ai/core/plugin/registration';
import { createAristotleRole } from '@opencode-ai/aristotle';
import { createWatchdogRole } from '@opencode-ai/watchdog';

export default async function (ctx: any) {
  const aristotleRole = await createAristotleRole(ctx);
  const watchdogRole = await createWatchdogRole(ctx);
  return assemblePlugin(ctx, [aristotleRole, watchdogRole]);
}
