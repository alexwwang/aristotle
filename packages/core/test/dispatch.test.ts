import { describe, it, expect, vi } from 'vitest';
import { assemblePlugin, RoleRegistration } from '../src/plugin/registration.js';

const createMockRole = (overrides: Partial<RoleRegistration> = {}): RoleRegistration => ({
  onToolBefore: vi.fn().mockResolvedValue(undefined),
  onToolAfter: vi.fn().mockResolvedValue(undefined),
  onIdle: vi.fn().mockResolvedValue(undefined),
  tools: {},
  ...overrides,
});

describe('TC-I-19: assemblePlugin — tool.execute.before throw propagates', () => {
  it('should propagate error from tool.execute.before and call both roles', async () => {
    const roleA = createMockRole({
      onToolBefore: vi.fn().mockResolvedValue(undefined),
    });
    const roleB = createMockRole({
      onToolBefore: vi.fn().mockRejectedValue(new Error('RoleB before error')),
    });
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [roleA, roleB]);

    const beforeHook = plugin['tool.execute.before'];
    expect(beforeHook).toBeDefined();

    await expect(
      beforeHook!({
        tool: 'testTool',
        args: { foo: 'bar' },
        sessionID: 'sess-1',
        callID: 'call-1',
      }),
    ).rejects.toThrow('RoleB before error');

    expect(roleA.onToolBefore).toHaveBeenCalledTimes(1);
    expect(roleA.onToolBefore).toHaveBeenCalledWith('testTool', { foo: 'bar' }, 'sess-1', 'call-1');
    expect(roleB.onToolBefore).toHaveBeenCalledTimes(1);
    expect(roleB.onToolBefore).toHaveBeenCalledWith('testTool', { foo: 'bar' }, 'sess-1', 'call-1');
  });
});

describe('TC-I-20: assemblePlugin — tool.execute.after per-role error isolation', () => {
  it('should swallow error from one role and continue calling others', async () => {
    const roleA = createMockRole({
      onToolAfter: vi.fn().mockRejectedValue(new Error('RoleA after error')),
    });
    const roleB = createMockRole({
      onToolAfter: vi.fn().mockResolvedValue(undefined),
    });
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [roleA, roleB]);

    const afterHook = plugin['tool.execute.after'];
    expect(afterHook).toBeDefined();

    // Should not throw even though RoleA errors
    await expect(
      afterHook!({
        tool: 'testTool',
        args: { foo: 'bar' },
        sessionID: 'sess-1',
        callID: 'call-1',
        output: 'result',
      }),
    ).resolves.toBeUndefined();

    expect(roleA.onToolAfter).toHaveBeenCalledTimes(1);
    expect(roleA.onToolAfter).toHaveBeenCalledWith('testTool', { foo: 'bar' }, 'result', 'sess-1', 'call-1');
    expect(roleB.onToolAfter).toHaveBeenCalledTimes(1);
    expect(roleB.onToolAfter).toHaveBeenCalledWith('testTool', { foo: 'bar' }, 'result', 'sess-1', 'call-1');
  });
});

describe('TC-I-21: assemblePlugin — double-firing idempotency for plugin tools', () => {
  it('should handle duplicate (tool, callID) calls without crashing', async () => {
    const observerRole = createMockRole({
      onToolBefore: vi.fn().mockResolvedValue(undefined),
      onToolAfter: vi.fn().mockResolvedValue(undefined),
    });
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [observerRole]);

    const beforeHook = plugin['tool.execute.before'];
    const afterHook = plugin['tool.execute.after'];
    expect(beforeHook).toBeDefined();
    expect(afterHook).toBeDefined();

    const params = {
      tool: 'testTool',
      args: { foo: 'bar' },
      sessionID: 'sess-1',
      callID: 'call-1',
    };

    // First call
    await expect(beforeHook!(params)).resolves.toBeUndefined();
    await expect(afterHook!({ ...params, output: 'result-1' })).resolves.toBeUndefined();

    // Second call with same (tool, callID) — simulating double-firing
    await expect(beforeHook!(params)).resolves.toBeUndefined();
    await expect(afterHook!({ ...params, output: 'result-2' })).resolves.toBeUndefined();

    expect(observerRole.onToolBefore).toHaveBeenCalledTimes(2);
    expect(observerRole.onToolAfter).toHaveBeenCalledTimes(2);
  });
});
