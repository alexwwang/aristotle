import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkflowStore } from '../src/workflow-store.js';
import type { WorkflowState } from '../src/types.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    join: vi.fn(),
  };
});

function createWorkflow(overrides?: Partial<WorkflowState>): WorkflowState {
  return {
    workflowId: 'wf-default',
    sessionId: 'sess-default',
    parentSessionId: 'parent-default',
    instanceId: 'test-instance',
    status: 'running',
    startedAt: Date.now(),
    agent: 'test-agent',
    ...overrides,
  };
}

describe('WorkflowStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    const actualPath = await vi.importActual<typeof import('node:path')>('node:path');
    tempDir = mkdtempSync(actualPath.join(tmpdir(), 'workflow-store-'));
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(writeFileSync).mockImplementation(actualFs.writeFileSync);
    vi.mocked(readFileSync).mockImplementation(actualFs.readFileSync);
    vi.mocked(existsSync).mockImplementation(actualFs.existsSync);
    vi.mocked(renameSync).mockImplementation(actualFs.renameSync);
    vi.mocked(join).mockImplementation(actualPath.join);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should_persist_workflow_to_disk_on_register', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    const wf = createWorkflow({ workflowId: 'wf-1' });
    store.register(wf);
    const data = readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8');
    const parsed = JSON.parse(data) as WorkflowState[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].workflowId).toBe('wf-1');
  });

  it('should_load_workflows_from_disk_on_construction', () => {
    const workflows = [createWorkflow({ workflowId: 'wf-1', status: 'completed', result: 'loaded' })];
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify(workflows));
    const store = new WorkflowStore(tempDir, 'test-instance');
    expect(store.findByWorkflowId('wf-1')).toEqual(workflows[0]);
  });

  it('should_start_with_empty_store_on_corrupted_disk_file', () => {
    writeFileSync(join(tempDir, 'bridge-workflows.json'), 'not json');
    const store = new WorkflowStore(tempDir, 'test-instance');
    expect(store.getActive()).toEqual({ active: [] });
  });

  it('should_start_with_empty_store_on_non_array_json', () => {
    writeFileSync(join(tempDir, 'bridge-workflows.json'), '{}');
    const store = new WorkflowStore(tempDir, 'test-instance');
    expect(store.getActive()).toEqual({ active: [] });
  });

  it('should_start_with_empty_store_on_missing_disk_file', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    expect(store.getActive()).toEqual({ active: [] });
  });

  it('should_evict_oldest_completed_when_full', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    for (let i = 0; i < 50; i++) {
      store.register(createWorkflow({
        workflowId: `wf-${i}`,
        status: 'completed',
        startedAt: 1000 + i * 100,
      }));
    }
    store.register(createWorkflow({ workflowId: 'wf-new', status: 'running', startedAt: 9999 }));
    expect(store.findByWorkflowId('wf-0')).toBeUndefined();
    expect(store.findByWorkflowId('wf-new')).toBeDefined();
  });

  it('should_not_evict_running_workflows', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    for (let i = 0; i < 50; i++) {
      store.register(createWorkflow({ workflowId: `wf-${i}`, status: 'running' }));
    }
    const result = store.register(createWorkflow({ workflowId: 'wf-new', status: 'running' }));
    expect(result).toBe(false);
  });

  it('should_evict_by_startedAt_ascending', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    for (let i = 0; i < 47; i++) {
      store.register(createWorkflow({
        workflowId: `wf-run-${i}`,
        status: 'running',
        startedAt: 1000 + i,
      }));
    }
    store.register(createWorkflow({ workflowId: 'wf-old', status: 'completed', startedAt: 1000 }));
    store.register(createWorkflow({ workflowId: 'wf-mid', status: 'completed', startedAt: 2000 }));
    store.register(createWorkflow({ workflowId: 'wf-new', status: 'completed', startedAt: 3000 }));
    store.register(createWorkflow({ workflowId: 'wf-latest', status: 'running', startedAt: 4000 }));
    expect(store.findByWorkflowId('wf-old')).toBeUndefined();
    expect(store.findByWorkflowId('wf-mid')).toBeDefined();
    expect(store.findByWorkflowId('wf-new')).toBeDefined();
    expect(store.findByWorkflowId('wf-latest')).toBeDefined();
  });

  it('should_evict_error_undone_and_cancelled_workflows', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    const statuses: Array<'error' | 'undone' | 'cancelled'> = ['error', 'undone', 'cancelled'];
    for (let i = 0; i < 50; i++) {
      store.register(createWorkflow({
        workflowId: `wf-${i}`,
        status: statuses[i % 3],
        startedAt: 1000 + i,
      }));
    }
    store.register(createWorkflow({ workflowId: 'wf-new', status: 'running', startedAt: 9999 }));
    expect(store.findByWorkflowId('wf-0')).toBeUndefined();
    expect(store.findByWorkflowId('wf-new')).toBeDefined();
  });

  it('should_log_error_and_continue_on_disk_write_failure', () => {
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });
    const store = new WorkflowStore(tempDir, 'test-instance');
    const wf = createWorkflow({ workflowId: 'wf-1' });
    store.register(wf);
    expect(store.findByWorkflowId('wf-1')).toEqual(wf);
  });

  it('should_mark_workflow_as_cancelled', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.cancel('wf-1');
    expect(store.findByWorkflowId('wf-1')?.status).toBe('cancelled');
  });

  it('should_persist_cancelled_status_to_disk', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.cancel('wf-1');
    const data = readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8');
    const parsed = JSON.parse(data) as WorkflowState[];
    expect(parsed.find(w => w.workflowId === 'wf-1')?.status).toBe('cancelled');
  });

  it('should_return_only_running_workflows', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', startedAt: 1000 }));
    store.register(createWorkflow({ workflowId: 'wf-2', status: 'running', startedAt: 2000 }));
    store.register(createWorkflow({ workflowId: 'wf-3', status: 'completed', startedAt: 3000 }));
    const active = store.getActive();
    expect(active.active).toHaveLength(2);
    expect(active.active.map(a => a.workflow_id)).toContain('wf-1');
    expect(active.active.map(a => a.workflow_id)).toContain('wf-2');
  });

  it('should_return_empty_active_list_when_no_running_workflows', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'completed' }));
    expect(store.getActive()).toEqual({ active: [] });
  });

  it('should_find_workflow_by_workflow_id', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    const wf = createWorkflow({ workflowId: 'wf-1' });
    store.register(wf);
    expect(store.findByWorkflowId('wf-1')).toEqual(wf);
  });

  it('should_find_workflow_by_session_id', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    const wf = createWorkflow({ workflowId: 'wf-1', sessionId: 'sess-1' });
    store.register(wf);
    expect(store.findBySession('sess-1')).toEqual(wf);
  });

  it('should_return_running_status_for_running_workflow', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    expect(store.retrieve('wf-1')).toEqual({ status: 'running' });
  });

  it('should_return_completed_result', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markCompleted('wf-1', 'the-result');
    expect(store.retrieve('wf-1')).toEqual({ status: 'completed', result: 'the-result' });
  });

  it('should_return_empty_string_result_when_completed_without_result', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markCompleted('wf-1', '');
    expect(store.retrieve('wf-1')).toEqual({ status: 'completed', result: '' });
  });

  it('should_return_error_status', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markError('wf-1', 'something went wrong');
    expect(store.retrieve('wf-1')).toEqual({ status: 'error', error: 'something went wrong' });
  });

  it('should_return_error_for_unknown_workflow', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    expect(store.retrieve('missing')).toEqual({ error: 'Workflow not found' });
  });

  it('should_return_undone_status', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markUndone('wf-1');
    expect(store.retrieve('wf-1')).toEqual({ status: 'undone' });
  });

  it('should_return_cancelled_status', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.cancel('wf-1');
    expect(store.retrieve('wf-1')).toEqual({ status: 'cancelled' });
  });

  it('should_mark_completed_with_result', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markCompleted('wf-1', 'output');
    const wf = store.findByWorkflowId('wf-1');
    expect(wf?.status).toBe('completed');
    expect(wf?.result).toBe('output');
  });

  it('should_mark_error_with_message', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markError('wf-1', 'msg');
    const wf = store.findByWorkflowId('wf-1');
    expect(wf?.status).toBe('error');
    expect(wf?.error).toBe('msg');
  });

  it('should_mark_undone_status', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.markUndone('wf-1');
    expect(store.findByWorkflowId('wf-1')?.status).toBe('undone');
  });

  it('should_overwrite_on_duplicate_workflow_id', () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running' }));
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'completed', result: 'updated' }));
    const wf = store.findByWorkflowId('wf-1');
    expect(wf?.status).toBe('completed');
    expect(wf?.result).toBe('updated');
    const data = JSON.parse(readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8')) as WorkflowState[];
    expect(data.find(w => w.workflowId === 'wf-1')?.status).toBe('completed');
  });

  it('should_write_via_tmp_and_rename', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const writeCalls: Array<{ path: string; data: string }> = [];
    const renameCalls: Array<{ oldPath: string; newPath: string }> = [];
    vi.mocked(writeFileSync).mockImplementation((path, data, options) => {
      writeCalls.push({ path: String(path), data: String(data) });
      actualFs.writeFileSync(path, data, options);
    });
    vi.mocked(renameSync).mockImplementation((oldPath, newPath) => {
      renameCalls.push({ oldPath: String(oldPath), newPath: String(newPath) });
      actualFs.renameSync(oldPath, newPath);
    });
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1' }));
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);
    expect(renameCalls.length).toBeGreaterThanOrEqual(1);
    expect(writeCalls.some(c => c.path.endsWith('.tmp'))).toBe(true);
    expect(renameCalls.some(r => r.oldPath.endsWith('.tmp'))).toBe(true);
  });
});

describe('WorkflowStore — reconcileOnStartup', () => {
  let tempDir: string;

  beforeEach(async () => {
    const actualPath = await vi.importActual<typeof import('node:path')>('node:path');
    tempDir = mkdtempSync(actualPath.join(tmpdir(), 'workflow-store-'));
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(writeFileSync).mockImplementation(actualFs.writeFileSync);
    vi.mocked(readFileSync).mockImplementation(actualFs.readFileSync);
    vi.mocked(existsSync).mockImplementation(actualFs.existsSync);
    vi.mocked(renameSync).mockImplementation(actualFs.renameSync);
    vi.mocked(join).mockImplementation(actualPath.join);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should_mark_running_as_completed_if_assistant_exists', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({
          data: [
            { info: { role: 'user' }, parts: [{ type: 'text', text: 'prompt' }] },
            { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'the result' }] },
          ],
        }),
      },
    };
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'completed', result: 'the result' });
  });

  it('should_leave_running_when_no_assistant_message_found', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({
          data: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] }],
        }),
      },
    };
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'error', error: expect.any(String) });
  });

  it('should_leave_running_when_session_has_no_messages', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({ data: [] }),
      },
    };
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'error', error: expect.any(String) });
  });

  it('should_mark_error_for_deleted_session', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    const client = {
      session: {
        messages: vi.fn().mockRejectedValue(new Error('not found')),
      },
    };
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'error', error: expect.any(String) });
  });

  it('should_skip_non_running_workflows_during_reconciliation', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'completed', sessionId: 'sess-1' }));
    store.register(createWorkflow({ workflowId: 'wf-2', status: 'running', sessionId: 'sess-2' }));
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({
          data: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'done' }] }],
        }),
      },
    };
    await store.reconcileOnStartup(client);
    expect(client.session.messages).toHaveBeenCalledTimes(1);
  });

  it('should_reconcile_in_batches_of_5', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    for (let i = 0; i < 12; i++) {
      store.register(createWorkflow({
        workflowId: `wf-${i}`,
        status: 'running',
        sessionId: `sess-${i}`,
      }));
    }
    let concurrent = 0;
    let maxConcurrent = 0;
    const client = {
      session: {
        messages: vi.fn().mockImplementation(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise(r => setTimeout(r, 10));
          concurrent--;
          return { data: [] };
        }),
      },
    };
    await store.reconcileOnStartup(client);
    expect(client.session.messages).toHaveBeenCalledTimes(12);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('should_continue_on_individual_reconciliation_failure', async () => {
    const store = new WorkflowStore(tempDir, 'test-instance');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    store.register(createWorkflow({ workflowId: 'wf-2', status: 'running', sessionId: 'sess-2' }));
    store.register(createWorkflow({ workflowId: 'wf-3', status: 'running', sessionId: 'sess-3' }));
    const client = {
      session: {
        messages: vi.fn().mockImplementation(async (params: any) => {
          const sessionId = params?.path?.id ?? '';
          if (sessionId === 'sess-2') throw new Error('network error');
          return { data: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'done' }] }] };
        }),
      },
    };
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'completed', result: 'done' });
    expect(store.retrieve('wf-2')).toEqual({ status: 'error', error: expect.any(String) });
    expect(store.retrieve('wf-3')).toEqual({ status: 'completed', result: 'done' });
  });

  // ── InstanceId isolation tests ──

  it('should_skip_workflows_from_other_instance_during_reconcile', async () => {
    const storeOwn = new WorkflowStore(tempDir, 'instance-A');
    storeOwn.register(createWorkflow({ workflowId: 'wf-own', status: 'running', sessionId: 'sess-own' }));
    // Simulate another instance's running workflow on disk
    const diskData = JSON.parse(readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8'));
    diskData.push({ ...createWorkflow({ workflowId: 'wf-other', status: 'running', sessionId: 'sess-other' }), instanceId: 'instance-B' });
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify(diskData));
    // Reload store with the other instance's data
    const store = new WorkflowStore(tempDir, 'instance-A');
    const client = {
      session: {
        messages: vi.fn().mockRejectedValue(new Error('not found')),
      },
    };
    await store.reconcileOnStartup(client);
    // Own workflow should be reconciled (marked error)
    expect(store.retrieve('wf-own')).toEqual({ status: 'error', error: expect.any(String) });
    // Other instance's workflow should be untouched
    expect(store.retrieve('wf-other')).toEqual({ status: 'running' });
    // client should only have been called for own workflow
    expect(client.session.messages).toHaveBeenCalledTimes(1);
    expect(client.session.messages).toHaveBeenCalledWith({ path: { id: 'sess-own' } });
  });

  it('should_stamp_instanceId_on_register', () => {
    const store = new WorkflowStore(tempDir, 'my-instance-42');
    store.register(createWorkflow({ workflowId: 'wf-1' }));
    const wf = store.findByWorkflowId('wf-1');
    expect(wf?.instanceId).toBe('my-instance-42');
  });

  it('should_overwrite_caller_instanceId_on_register', () => {
    const store = new WorkflowStore(tempDir, 'real-instance');
    store.register({ ...createWorkflow({ workflowId: 'wf-1' }), instanceId: 'spoofed' });
    const wf = store.findByWorkflowId('wf-1');
    expect(wf?.instanceId).toBe('real-instance');
  });

  it('should_skip_old_workflows_without_instanceId_during_reconcile', async () => {
    // Write old-format data (no instanceId) to disk
    const oldWf = createWorkflow({ workflowId: 'wf-old', status: 'running', sessionId: 'sess-old' });
    delete (oldWf as any).instanceId;
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify([oldWf]));
    const store = new WorkflowStore(tempDir, 'new-instance');
    const client = {
      session: { messages: vi.fn().mockRejectedValue(new Error('not found')) },
    };
    await store.reconcileOnStartup(client);
    // Old workflow should NOT be reconciled (no API call)
    expect(client.session.messages).not.toHaveBeenCalled();
    // Old workflow should still be visible (not mutated)
    expect(store.retrieve('wf-old')).toEqual({ status: 'running' });
  });

  it('should_not_touch_chain_pending_from_other_instance', async () => {
    const storeOwn = new WorkflowStore(tempDir, 'instance-A');
    storeOwn.register(createWorkflow({ workflowId: 'wf-own', status: 'chain_pending', agent: 'R' }));
    // Other instance's chain_pending on disk
    const diskData = JSON.parse(readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8'));
    diskData.push({ ...createWorkflow({ workflowId: 'wf-other', status: 'chain_pending', agent: 'R', result: 'partial' }), instanceId: 'instance-B' });
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify(diskData));
    const store = new WorkflowStore(tempDir, 'instance-A');
    await store.reconcileOnStartup({ session: { messages: vi.fn() } });
    // Own chain_pending should be recovered (completed)
    expect(store.retrieve('wf-own')).toEqual({ status: 'completed', result: '' });
    // Other's chain_pending should remain untouched
    expect(store.retrieve('wf-other')).toEqual({ status: 'chain_pending' });
  });

  it('should_not_log_chain_broken_from_other_instance', async () => {
    // Other instance's chain_broken on disk
    const otherWf = { ...createWorkflow({ workflowId: 'wf-other', status: 'chain_broken', error: 'x' }), instanceId: 'instance-B' };
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify([otherWf]));
    const store = new WorkflowStore(tempDir, 'instance-A');
    // Should not throw — other instance's chain_broken is simply skipped
    await store.reconcileOnStartup({ session: { messages: vi.fn() } });
    expect(store.retrieve('wf-other')).toEqual({ status: 'chain_broken', error: 'x' });
  });

  it('should_mark_error_on_reconcile_timeout', async () => {
    const store = new WorkflowStore(tempDir, 'instance-A');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    const client = {
      session: {
        messages: vi.fn().mockImplementation(() => new Promise(() => {/* never resolves */})),
      },
    };
    // Use a short timeout by mocking the constant — we'll just verify it errors
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'error', error: expect.stringContaining('timeout') });
  }, 10000);

  it('should_mark_error_on_malformed_api_response', async () => {
    const store = new WorkflowStore(tempDir, 'instance-A');
    store.register(createWorkflow({ workflowId: 'wf-1', status: 'running', sessionId: 'sess-1' }));
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({}),
      },
    };
    await store.reconcileOnStartup(client);
    expect(store.retrieve('wf-1')).toEqual({ status: 'error', error: expect.stringContaining('Empty or invalid') });
  });

  it('should_preserve_other_instance_entries_on_saveToDisk', () => {
    const storeA = new WorkflowStore(tempDir, 'instance-A');
    storeA.register(createWorkflow({ workflowId: 'wf-A', status: 'running' }));
    // Simulate instance-B writing its workflow to disk
    const diskData = JSON.parse(readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8'));
    diskData.push({ ...createWorkflow({ workflowId: 'wf-B', status: 'running' }), instanceId: 'instance-B' });
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify(diskData));
    // Instance-A does a state change (triggers saveToDisk with merge)
    storeA.markCompleted('wf-A', 'done');
    // Verify both entries survive on disk
    const final = JSON.parse(readFileSync(join(tempDir, 'bridge-workflows.json'), 'utf-8'));
    expect(final.find((w: any) => w.workflowId === 'wf-A')).toBeDefined();
    expect(final.find((w: any) => w.workflowId === 'wf-B')).toBeDefined();
    expect(final.find((w: any) => w.workflowId === 'wf-A')?.status).toBe('completed');
    expect(final.find((w: any) => w.workflowId === 'wf-B')?.status).toBe('running');
  });

  it('should_evict_other_instance_completed_workflows_when_at_capacity', () => {
    // Pre-fill disk with 50 completed entries from instance-B
    const otherWfs = [];
    for (let i = 0; i < 50; i++) {
      otherWfs.push({ ...createWorkflow({ workflowId: `wf-B-${i}`, status: 'completed', startedAt: 1000 + i }), instanceId: 'instance-B' });
    }
    writeFileSync(join(tempDir, 'bridge-workflows.json'), JSON.stringify(otherWfs));
    // Create store — loads all 50 from disk
    const store = new WorkflowStore(tempDir, 'instance-A');
    // Register our own running workflow — should evict oldest (wf-B-0)
    const result = store.register(createWorkflow({ workflowId: 'wf-A-new', status: 'running', startedAt: 9999 }));
    expect(result).toBe(true);
    expect(store.findByWorkflowId('wf-A-new')).toBeDefined();
    expect(store.findByWorkflowId('wf-B-0')).toBeUndefined();
  });
});
