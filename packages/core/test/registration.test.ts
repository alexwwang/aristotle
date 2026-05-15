import { describe, it, expect, vi } from 'vitest';
import { assemblePlugin, ToolDefinition, RoleRegistration } from '../src/plugin/registration.js';

describe('assemblePlugin', () => {
  // PR-01: should_merge_tools_from_multiple_roles
  it('should_merge_tools_from_multiple_roles', () => {
    const toolA: ToolDefinition = {
      description: 'Tool A',
      args: {},
      execute: vi.fn().mockResolvedValue('result-a'),
    };
    const toolB: ToolDefinition = {
      description: 'Tool B',
      args: {},
      execute: vi.fn().mockResolvedValue('result-b'),
    };

    const role1: RoleRegistration = { tools: { toolA } };
    const role2: RoleRegistration = { tools: { toolB } };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role1, role2]);

    expect(plugin.tool).toBeDefined();
    expect(plugin.tool).toHaveProperty('toolA');
    expect(plugin.tool).toHaveProperty('toolB');
    expect(plugin.tool!.toolA.description).toBe('Tool A');
    expect(plugin.tool!.toolB.description).toBe('Tool B');
  });

  // PR-02: should_return_empty_object_when_no_roles_provide_tools
  it('should_return_empty_object_when_no_roles_provide_tools', () => {
    const role1: RoleRegistration = { onIdle: vi.fn() };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role1]);

    expect(plugin.tool).toBeUndefined();
  });

  // PR-03: should_throw_on_tool_name_conflict
  it('should_throw_on_tool_name_conflict', () => {
    const toolA: ToolDefinition = {
      description: 'Tool A from role1',
      args: {},
      execute: vi.fn().mockResolvedValue('result'),
    };

    const role1: RoleRegistration = { tools: { toolA } };
    const role2: RoleRegistration = { tools: { toolA } };
    const ctx = { client: {} };

    expect(() => assemblePlugin(ctx, [role1, role2])).toThrow('Tool name conflict: toolA');
  });

  // PR-04: should_dispatch_idle_event_to_all_roles
  it('should_dispatch_idle_event_to_all_roles', async () => {
    const onIdle1 = vi.fn().mockResolvedValue(undefined);
    const onIdle2 = vi.fn().mockResolvedValue(undefined);
    const role1: RoleRegistration = { onIdle: onIdle1 };
    const role2: RoleRegistration = { onIdle: onIdle2 };
    const client = { id: 'client-1' };
    const ctx = { client };

    const plugin = assemblePlugin(ctx, [role1, role2]);

    expect(plugin.event).toBeDefined();
    await plugin.event!({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    expect(onIdle1).toHaveBeenCalledWith('sess-1', client);
    expect(onIdle2).toHaveBeenCalledWith('sess-1', client);
  });

  // PR-05: should_extract_sessionId_from_event
  it('should_extract_sessionId_from_event', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const role: RoleRegistration = { onIdle };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.event!({ type: 'session.idle', properties: { sessionID: 'sess-abc' } });

    expect(onIdle).toHaveBeenCalledWith('sess-abc', ctx.client);
  });

  // PR-06: should_pass_ctx_client_to_onIdle
  it('should_pass_ctx_client_to_onIdle', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const role: RoleRegistration = { onIdle };
    const client = { name: 'mock-client' };
    const ctx = { client };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.event!({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    expect(onIdle).toHaveBeenCalledWith('sess-1', client);
  });

  // PR-07: should_invoke_onToolBefore_before_tool_execution
  it('should_invoke_onToolBefore_before_tool_execution', async () => {
    const onToolBefore = vi.fn().mockResolvedValue(null);
    const execute = vi.fn().mockResolvedValue('result');
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute,
    };
    const role: RoleRegistration = { tools: { testTool: toolDef }, onToolBefore };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.tool!.testTool.execute({ foo: 'bar' }, { session: { id: 'sess-1' } });

    const beforeOrder = onToolBefore.mock.invocationCallOrder![0];
    const executeOrder = execute.mock.invocationCallOrder![0];
    expect(beforeOrder).toBeLessThan(executeOrder);
    expect(onToolBefore).toHaveBeenCalledWith('testTool', { foo: 'bar' }, 'sess-1', '');
  });

  // PR-08: should_invoke_onToolAfter_after_tool_execution
  it('should_invoke_onToolAfter_after_tool_execution', async () => {
    const onToolAfter = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue('result');
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute,
    };
    const role: RoleRegistration = { tools: { testTool: toolDef }, onToolAfter };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.tool!.testTool.execute({ foo: 'bar' }, { session: { id: 'sess-1' } });

    const executeOrder = execute.mock.invocationCallOrder![0];
    const afterOrder = onToolAfter.mock.invocationCallOrder![0];
    expect(executeOrder).toBeLessThan(afterOrder);
    expect(onToolAfter).toHaveBeenCalledWith('testTool', { foo: 'bar' }, 'result', 'sess-1', '');
  });

  // PR-09: should_allow_onToolBefore_to_modify_args
  it('should_allow_onToolBefore_to_modify_args', async () => {
    const onToolBefore = vi.fn().mockImplementation(async (_tool, args) => {
      (args as any).foo = 'modified';
      return null;
    });
    const execute = vi.fn().mockResolvedValue('result');
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute,
    };
    const role: RoleRegistration = { tools: { testTool: toolDef }, onToolBefore };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);
    const args = { foo: 'original' };

    await plugin.tool!.testTool.execute(args, { session: { id: 'sess-1' } });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ foo: 'modified' }),
      expect.anything(),
    );
  });

  // PR-10: should_propagate_onToolBefore_error_and_block_execution
  it('should_propagate_onToolBefore_error_and_block_execution', async () => {
    const onToolBefore = vi.fn().mockRejectedValue(new Error('before error'));
    const execute = vi.fn().mockResolvedValue('result');
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute,
    };
    const role: RoleRegistration = { tools: { testTool: toolDef }, onToolBefore };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    await expect(
      plugin.tool!.testTool.execute({ foo: 'bar' }, { session: { id: 'sess-1' } }),
    ).rejects.toThrow('before error');

    expect(execute).not.toHaveBeenCalled();
  });

  // PR-11: should_not_dispatch_idle_when_no_idle_handlers
  it('should_not_dispatch_idle_when_no_idle_handlers', () => {
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute: vi.fn().mockResolvedValue('result'),
    };
    const role: RoleRegistration = { tools: { testTool: toolDef } };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    expect(plugin.event).toBeUndefined();
  });

  // PR-12: should_continue_dispatching_to_remaining_roles_on_idle_error
  it('should_continue_dispatching_to_remaining_roles_on_idle_error', async () => {
    const onIdle1 = vi.fn().mockRejectedValue(new Error('idle error'));
    const onIdle2 = vi.fn().mockResolvedValue(undefined);
    const role1: RoleRegistration = { onIdle: onIdle1 };
    const role2: RoleRegistration = { onIdle: onIdle2 };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role1, role2]);

    await plugin.event!({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    expect(onIdle1).toHaveBeenCalled();
    expect(onIdle2).toHaveBeenCalled();
  });

  // PR-13: should_filter_null_roles
  it('should_filter_null_roles', () => {
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute: vi.fn().mockResolvedValue('result'),
    };
    const role: RoleRegistration = { tools: { testTool: toolDef } };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [null, role, null]);

    expect(plugin.tool).toBeDefined();
    expect(plugin.tool).toHaveProperty('testTool');
  });

  // PR-14: should_return_empty_object_when_all_roles_null
  it('should_return_empty_object_when_all_roles_null', () => {
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [null, null]);

    expect(plugin).toEqual({});
  });

  // PR-15: should_unwrap_event_event_before_dispatching_idle
  it('should_unwrap_event_event_before_dispatching_idle', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const role: RoleRegistration = { onIdle };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    // event with nested .event property (OpenCode wraps events this way)
    await plugin.event!({ event: { type: 'session.idle', properties: { sessionID: 'nested-sess' } } });

    expect(onIdle).toHaveBeenCalledWith('nested-sess', ctx.client);
  });

  // PR-16: should_pass_ctx_client_to_onIdle
  it('should_pass_ctx_client_to_onIdle', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const role: RoleRegistration = { onIdle };
    const client = { name: 'my-client' };
    const ctx = { client };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.event!({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    expect(onIdle).toHaveBeenCalledWith('sess-1', client);
  });

  // PR-17: should_ignore_non_idle_events
  it('should_ignore_non_idle_events', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const role: RoleRegistration = { onIdle };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.event!({ type: 'session.created', properties: { sessionID: 'sess-1' } });

    expect(onIdle).not.toHaveBeenCalled();
  });

  // PR-18: should_ignore_idle_event_without_sessionID
  it('should_ignore_idle_event_without_sessionID', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const role: RoleRegistration = { onIdle };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [role]);

    await plugin.event!({ type: 'session.idle', properties: {} });

    expect(onIdle).not.toHaveBeenCalled();
  });

  // PR-19: should_return_empty_object_when_roles_array_empty
  it('should_return_empty_object_when_roles_array_empty', () => {
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, []);

    expect(plugin).toEqual({});
  });

  // PR-20: should_filter_undefined_in_roles_array
  it('should_filter_undefined_in_roles_array', () => {
    const toolDef: ToolDefinition = {
      description: 'Test tool',
      args: {},
      execute: vi.fn().mockResolvedValue('result'),
    };
    const role: RoleRegistration = { tools: { testTool: toolDef } };
    const ctx = { client: {} };

    const plugin = assemblePlugin(ctx, [null, role, null]);

    expect(plugin.tool).toBeDefined();
    expect(plugin.tool).toHaveProperty('testTool');
  });

  describe('Phase 2: global hook dispatch', () => {
    // PR-21: should_populate_tool_execute_before_when_roles_have_onToolBefore
    it('should_populate_tool_execute_before_when_roles_have_onToolBefore', () => {
      const role: RoleRegistration = { onToolBefore: vi.fn().mockResolvedValue(null) };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role]);

      expect(plugin['tool.execute.before']).toBeDefined();
    });

    // PR-22: should_populate_tool_execute_after_when_roles_have_onToolAfter
    it('should_populate_tool_execute_after_when_roles_have_onToolAfter', () => {
      const role: RoleRegistration = { onToolAfter: vi.fn().mockResolvedValue(undefined) };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role]);

      expect(plugin['tool.execute.after']).toBeDefined();
    });

    // PR-23: should_call_each_onToolBefore_with_correct_params
    it('should_call_each_onToolBefore_with_correct_params', async () => {
      const onToolBefore1 = vi.fn().mockResolvedValue(null);
      const onToolBefore2 = vi.fn().mockResolvedValue(null);
      const role1: RoleRegistration = { onToolBefore: onToolBefore1 };
      const role2: RoleRegistration = { onToolBefore: onToolBefore2 };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role1, role2]);

      await plugin['tool.execute.before']!({
        tool: 'edit',
        args: { path: '/tmp/file' },
        sessionID: 'sess-123',
        callID: 'call-456',
      });

      expect(onToolBefore1).toHaveBeenCalledWith('edit', { path: '/tmp/file' }, 'sess-123', 'call-456');
      expect(onToolBefore2).toHaveBeenCalledWith('edit', { path: '/tmp/file' }, 'sess-123', 'call-456');
    });

    // PR-24: should_call_each_onToolAfter_with_correct_params
    it('should_call_each_onToolAfter_with_correct_params', async () => {
      const onToolAfter1 = vi.fn().mockResolvedValue(undefined);
      const onToolAfter2 = vi.fn().mockResolvedValue(undefined);
      const role1: RoleRegistration = { onToolAfter: onToolAfter1 };
      const role2: RoleRegistration = { onToolAfter: onToolAfter2 };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role1, role2]);

      await plugin['tool.execute.after']!({
        tool: 'write',
        args: { path: '/tmp/file', content: 'hello' },
        sessionID: 'sess-789',
        callID: 'call-abc',
        output: 'done',
      });

      expect(onToolAfter1).toHaveBeenCalledWith(
        'write',
        { path: '/tmp/file', content: 'hello' },
        'done',
        'sess-789',
        'call-abc',
      );
      expect(onToolAfter2).toHaveBeenCalledWith(
        'write',
        { path: '/tmp/file', content: 'hello' },
        'done',
        'sess-789',
        'call-abc',
      );
    });

    // PR-25: should_propagate_error_from_tool_execute_before
    it('should_propagate_error_from_tool_execute_before', async () => {
      const onToolBefore1 = vi.fn().mockRejectedValue(new Error('before fail'));
      const onToolBefore2 = vi.fn().mockResolvedValue(null);
      const role1: RoleRegistration = { onToolBefore: onToolBefore1 };
      const role2: RoleRegistration = { onToolBefore: onToolBefore2 };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role1, role2]);

      await expect(
        plugin['tool.execute.before']!({
          tool: 'edit',
          args: {},
          sessionID: 'sess-1',
          callID: 'call-1',
        }),
      ).rejects.toThrow('before fail');
    });

    // PR-26: should_continue_calling_remaining_onToolAfter_on_error
    it('should_continue_calling_remaining_onToolAfter_on_error', async () => {
      const onToolAfter1 = vi.fn().mockRejectedValue(new Error('after fail'));
      const onToolAfter2 = vi.fn().mockResolvedValue(undefined);
      const role1: RoleRegistration = { onToolAfter: onToolAfter1 };
      const role2: RoleRegistration = { onToolAfter: onToolAfter2 };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role1, role2]);

      await plugin['tool.execute.after']!({
        tool: 'Task',
        args: {},
        sessionID: 'sess-1',
        callID: 'call-1',
        output: 'result',
      });

      expect(onToolAfter1).toHaveBeenCalled();
      expect(onToolAfter2).toHaveBeenCalled();
    });

    // PR-27: should_omit_tool_execute_before_when_no_onToolBefore
    it('should_omit_tool_execute_before_when_no_onToolBefore', () => {
      const role: RoleRegistration = { tools: { testTool: { description: 'x', args: {}, execute: vi.fn() } } };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role]);

      expect(plugin['tool.execute.before']).toBeUndefined();
    });

    // PR-28: should_omit_tool_execute_after_when_no_onToolAfter
    it('should_omit_tool_execute_after_when_no_onToolAfter', () => {
      const role: RoleRegistration = { tools: { testTool: { description: 'x', args: {}, execute: vi.fn() } } };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role]);

      expect(plugin['tool.execute.after']).toBeUndefined();
    });

    // PR-29: should_pass_callID_through_to_both_hooks
    it('should_pass_callID_through_to_both_hooks', async () => {
      const onToolBefore = vi.fn().mockResolvedValue(null);
      const onToolAfter = vi.fn().mockResolvedValue(undefined);
      const role: RoleRegistration = { onToolBefore, onToolAfter };
      const ctx = { client: {} };

      const plugin = assemblePlugin(ctx, [role]);

      await plugin['tool.execute.before']!({
        tool: 'edit',
        args: {},
        sessionID: 'sess-1',
        callID: 'my-call-id',
      });

      await plugin['tool.execute.after']!({
        tool: 'edit',
        args: {},
        sessionID: 'sess-1',
        callID: 'my-call-id',
        output: 'ok',
      });

      expect(onToolBefore).toHaveBeenCalledWith('edit', {}, 'sess-1', 'my-call-id');
      expect(onToolAfter).toHaveBeenCalledWith('edit', {}, 'ok', 'sess-1', 'my-call-id');
    });
  });
});
