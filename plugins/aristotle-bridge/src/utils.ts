const SENTINEL = '[ARISTOTLE_BRIDGE:no_text_output]';

export function extractLastAssistantText(
  messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === 'assistant') {
      const text = msg.parts
        .filter((p): p is { type: 'text'; text: string } =>
          p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return SENTINEL;
}
