import type { ApiMode } from './types.js';

export async function detectApiMode(client: any): Promise<ApiMode | null> {
  // Check if promptAsync method exists on the client — do NOT actually call it.
  // Calling it during plugin init sends a real LLM request which can block
  // or crash startup if the model provider isn't ready yet.
  if (typeof client?.session?.promptAsync === 'function') {
    return 'promptAsync';
  }
  return null;
}
