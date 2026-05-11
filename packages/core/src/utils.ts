const DEFAULT_SENTINEL = '[ARISTOTLE_BRIDGE:no_text_output]';

export function extractLastAssistantText(
  messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> | null | undefined }> | null | undefined,
  sentinel?: string,
): string {
  const fallback = sentinel !== undefined ? sentinel : DEFAULT_SENTINEL;

  if (!messages || messages.length === 0) {
    return fallback;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === 'assistant') {
      const parts = msg.parts;
      if (!parts || parts.length === 0) {
        continue;
      }
      const text = parts
        .filter((p): p is { type: 'text'; text: string } =>
          p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return fallback;
}
