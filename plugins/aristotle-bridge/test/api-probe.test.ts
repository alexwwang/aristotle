import { describe, it, expect, vi } from 'vitest';
import { detectApiMode } from '../src/api-probe.js';

describe('detectApiMode', () => {
  const createMockClient = (sessionOverrides = {}) => ({
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: 'probe-session-1' } }),
      promptAsync: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      ...sessionOverrides,
    },
  });

  it('should_return_promptAsync_when_api_available', async () => {
    const client = createMockClient();

    const result = await detectApiMode(client as any);

    expect(result).toBe('promptAsync');
  });

  it('should_return_null_when_promptAsync_fails', async () => {
    const client = createMockClient({
      promptAsync: vi.fn().mockRejectedValue(new Error('prompt failed')),
    });

    const result = await detectApiMode(client as any);

    expect(result).toBeNull();
  });

  it('should_delete_probe_session_on_success', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const client = createMockClient({ delete: mockDelete });

    await detectApiMode(client as any);

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('should_delete_probe_session_on_failure', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const client = createMockClient({
      promptAsync: vi.fn().mockRejectedValue(new Error('prompt failed')),
      delete: mockDelete,
    });

    await detectApiMode(client as any);

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('should_propagate_error_when_probe_session_create_fails', async () => {
    const client = {
      session: {
        create: vi.fn().mockRejectedValue(new Error('create failed')),
      },
    };

    await expect(detectApiMode(client as any)).rejects.toThrow('create failed');
  });
});
