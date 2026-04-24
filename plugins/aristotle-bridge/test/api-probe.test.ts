import { describe, it, expect, vi } from 'vitest';
import { detectApiMode } from '../src/api-probe.js';

describe('detectApiMode', () => {
  it('should_return_promptAsync_when_api_available', async () => {
    const client = {
      session: {
        promptAsync: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await detectApiMode(client as any);

    expect(result).toBe('promptAsync');
  });

  it('should_return_null_when_promptAsync_missing', async () => {
    const client = { session: {} };

    const result = await detectApiMode(client as any);

    expect(result).toBeNull();
  });

  it('should_return_null_when_session_missing', async () => {
    const client = {};

    const result = await detectApiMode(client as any);

    expect(result).toBeNull();
  });

  it('should_return_null_when_client_null', async () => {
    const result = await detectApiMode(null as any);

    expect(result).toBeNull();
  });

  it('should_not_call_promptAsync_only_check_existence', async () => {
    const mockPromptAsync = vi.fn().mockResolvedValue(undefined);
    const client = {
      session: {
        promptAsync: mockPromptAsync,
      },
    };

    await detectApiMode(client as any);

    // Should NOT actually call promptAsync — only check typeof
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });
});
