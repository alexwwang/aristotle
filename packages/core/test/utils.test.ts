import { describe, it, expect } from 'vitest';
import { extractLastAssistantText } from '../src/utils.js';

type Message = {
  info: { role: string };
  parts: Array<{ type: string; text?: string }> | null | undefined;
};

describe('extractLastAssistantText', () => {
  it('should_extract_text_from_info_parts_format', () => {
    const messages: Message[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hello' }] },
    ];
    expect(extractLastAssistantText(messages)).toBe('hello');
  });

  it('should_skip_pure_tool_call_messages', () => {
    const messages: Message[] = [
      {
        info: { role: 'assistant' },
        parts: [{ type: 'tool_use', name: 'foo', input: {} } as any],
      },
    ];
    expect(extractLastAssistantText(messages)).toBe(
      '[ARISTOTLE_BRIDGE:no_text_output]',
    );
  });

  it('should_return_sentinel_when_no_assistant_text', () => {
    const messages: Message[] = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] },
    ];
    expect(extractLastAssistantText(messages)).toBe(
      '[ARISTOTLE_BRIDGE:no_text_output]',
    );
  });

  it('should_find_last_assistant_with_text', () => {
    const messages: Message[] = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'q1' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'first' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'q2' }] },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'second' }],
      },
    ];
    expect(extractLastAssistantText(messages)).toBe('second');
  });

  it('should_skip_assistant_message_with_empty_parts', () => {
    const messages: Message[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'earlier' }] },
      { info: { role: 'assistant' }, parts: [] },
    ];
    expect(extractLastAssistantText(messages)).toBe('earlier');
  });

  it('should_join_multiple_text_parts_with_newline', () => {
    const messages: Message[] = [
      {
        info: { role: 'assistant' },
        parts: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    ];
    expect(extractLastAssistantText(messages)).toBe('a\nb');
  });

  it('should_skip_assistant_message_with_whitespace_only_text', () => {
    const messages: Message[] = [
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: '   ' }],
      },
    ];
    expect(extractLastAssistantText(messages)).toBe(
      '[ARISTOTLE_BRIDGE:no_text_output]',
    );
  });

  it('should_use_custom_sentinel_when_provided', () => {
    const messages: Message[] = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] },
    ];
    expect(extractLastAssistantText(messages, 'CUSTOM')).toBe('CUSTOM');
  });

  it('should_use_default_sentinel_when_not_provided', () => {
    const messages: Message[] = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] },
    ];
    expect(extractLastAssistantText(messages)).toBe(
      '[ARISTOTLE_BRIDGE:no_text_output]',
    );
  });

  it('should_allow_empty_string_sentinel', () => {
    const messages: Message[] = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] },
    ];
    expect(extractLastAssistantText(messages, '')).toBe('');
  });

  it('should_handle_message_with_null_parts', () => {
    const messages: Message[] = [
      { info: { role: 'assistant' }, parts: null as any },
      { info: { role: 'assistant' }, parts: undefined },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'found' }] },
    ];
    expect(extractLastAssistantText(messages)).toBe('found');
  });

  it('should_handle_null_or_undefined_messages_array', () => {
    expect(extractLastAssistantText(null)).toBe(
      '[ARISTOTLE_BRIDGE:no_text_output]',
    );
    expect(extractLastAssistantText(undefined)).toBe(
      '[ARISTOTLE_BRIDGE:no_text_output]',
    );
  });
});
