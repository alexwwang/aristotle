# R→C Chain: Bridge Plugin ↔ MCP Integration Design

> Created: 2025-04-25
> Status: Pending review
> Problem: Bridge Plugin idle handler completes R (Reflector) but cannot notify MCP to launch C (Checker)

## Background

### Current Architecture

```
opencode process (Node.js/Bun)       MCP process (Python, stdio)
┌──────────────────────┐             ┌─────────────────────────────┐
│ Bridge Plugin         │             │ _orch_event.py              │
│   idle-handler.ts     │   no        │   orchestrate_on_event()    │
│     markCompleted()   │ ────→ ???   │     subagent_done           │
│                        │             │     ↓ phase=reflecting     │
│ Available APIs:        │             │     build_checker_prompt() │
│   ctx.client.session.* │             │     ↓                      │
│   (opencode SDK only)  │             │     return fire_o (agent=C)│
└──────────────────────┘             └─────────────────────────────┘
```

### What Already Works

1. `fire_o` creates sub-session → promptAsync → Reflector runs (verified A1–A6)
2. idle handler detects session.idle → extracts result → markCompleted
3. `bridge-workflows.json` has completed R result
4. MCP `_orch_event.py` has full R→C logic: `subagent_done + phase=reflecting → checker prompt → fire_o (agent=C)`

### The Gap

Bridge Plugin and MCP server run in **separate processes** with **no direct communication channel**. The Plugin can only use opencode SDK (session API). MCP tools can only be invoked by LLM during conversation turns.

---

## Proposals

### A. promptAsync Inject into Parent Session

**Mechanism:** After `markCompleted`, idle handler calls `promptAsync` on the **parent session** with a system message that triggers the LLM to call `aristotle_orchestrate_on_event`.

```ts
// idle-handler.ts (after markCompleted)
const result = store.retrieve(wf.workflowId);
await this.client.session.promptAsync({
  path: { id: wf.parentSessionId },
  body: {
    parts: [{
      type: 'text',
      text: `[aristotle-bridge] Workflow ${wf.workflowId} completed. Call aristotle_orchestrate_on_event with event_type="subagent_done" and the result.`
    }]
  }
});
```

**Pros:**
- Event-driven, immediate response
- Uses existing opencode SDK (no new transport layer)
- No polling or file watching

**Cons:**
- **Pollutes user conversation** — injected message appears in chat history
- **Consumes tokens** — parent session LLM must process the injected prompt
- **Interrupt risk** — if user is actively chatting, injected prompt may conflict
- **Reliability** — depends on LLM following the instruction to call MCP tool

**Feasibility:** 70%. Technically straightforward but UX concerns are significant.

---

### B. SKILL.md Polling Instruction (Round-based)

**Mechanism:** Change SKILL.md dispatcher flow: after `fire_o`, immediately enter a polling loop using `aristotle_check` until status = completed, then call `orchestrate_on_event`.

```
SKILL.md PRE-RESOLVE flow:
1. orchestrate_start("reflect") → action: fire_o
2. fire_o (agent=R) → returns workflow_id
3. LOOP: aristotle_check(workflow_id) every N seconds until completed
4. orchestrate_on_event("subagent_done", result) → action: fire_o (agent=C)
5. LOOP: aristotle_check(new_workflow_id) until completed
6. orchestrate_on_event("subagent_done", checker_result) → done
```

**Pros:**
- No pollution of user conversation
- Uses existing tools (aristotle_check, orchestrate_on_event)
- Deterministic — SKILL.md explicitly controls the loop

**Cons:**
- **LLM polling is unreliable** — model may forget to loop, use wrong interval, or skip steps
- **Blocks dispatcher turn** — the dispatcher agent is occupied polling, can't respond to user
- **Token waste** — each poll iteration consumes input/output tokens
- **No true async** — the whole chain becomes synchronous from SKILL.md perspective

**Feasibility:** 50%. Works in theory but LLM-as-loop-controller is fragile.

---

### C. MCP File Watcher (Background Thread)

**Mechanism:** Add a background thread in the MCP Python server that watches `bridge-workflows.json` for status changes. When a workflow transitions to `completed`, automatically trigger `orchestrate_on_event` internally.

```python
# In MCP server startup
import watchdog.observer
class BridgeWorkflowHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path.endswith('bridge-workflows.json'):
            workflows = json.load(open(event.src_path))
            for wf in workflows:
                if wf['status'] == 'completed' and not wf.get('notified'):
                    result = orchestrate_on_event("subagent_done", json.dumps({
                        "workflow_id": wf["workflowId"], "result": wf["result"]
                    }))
                    # If result action is fire_o → need to call back into opencode
                    wf['notified'] = True
```

**Pros:**
- Fully automatic, no LLM involvement
- Clean separation of concerns
- No conversation pollution

**Cons:**
- **Half-bridge problem** — MCP can detect completion, but to `fire_o` it needs to call the opencode plugin, creating a circular dependency
- **File watching complexity** — cross-platform issues (macOS fsevents vs Linux inotify), race conditions
- **MCP server lifecycle** — background thread must be managed (start/stop/error recovery)
- **Increased MCP surface** — MCP now needs opencode SDK client or HTTP client

**Feasibility:** 40%. The circular dependency (MCP→opencode→MCP) is a fundamental architecture issue.

---

### D. Plugin Direct MCP Connection

**Mechanism:** Bridge Plugin opens a direct connection to the MCP server (via subprocess stdio or HTTP) and calls `orchestrate_on_event` directly after `markCompleted`.

```ts
// idle-handler.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const mcpClient = new Client(...);
await mcpClient.connect(new StdioClientTransport({
  command: 'uv', args: ['run', 'aristotle-mcp']
}));

// After markCompleted
const result = await mcpClient.callTool('aristotle_orchestrate_on_event', {
  event_type: 'subagent_done',
  data_json: JSON.stringify({ workflow_id: wf.workflowId, result: wf.result })
});

// If result.action === 'fire_o' → call executor.launch again
if (result.action === 'fire_o') {
  await executor.launch({ workflowId: result.workflow_id, oPrompt: result.o_prompt, agent: 'C' });
}
```

**Pros:**
- Cleanest architecture — direct process-to-process communication
- Full R→C chain runs entirely within Bridge Plugin process
- Event-driven, no polling, no file watching

**Cons:**
- **Complexity** — need to manage MCP client lifecycle (connect, reconnect, error handling)
- **Double MCP instances** — opencode already has one MCP connection; this creates a second
- **State synchronization** — MCP server has in-memory workflow state; second client may conflict
- **Fragile** — MCP protocol over stdio adds failure surface (process crashes, message framing)

**Feasibility:** 60%. Architecturally sound but implementation-heavy for the value delivered.

---

### E. Shared State File + Parent Session Trigger (Hybrid)

**Mechanism:** After `markCompleted`, write a signal file. Use `promptAsync` with `noReply: true` on the parent session, but only as a lightweight trigger (not instruction to call MCP). The parent session's next LLM turn picks up the signal.

Actually, `noReply: true` has a [known hang bug](https://github.com/opencode-ai/opencode/issues/4431). Discarded.

---

### F. Workflow File as MCP Input (Simplest Viable)

**Mechanism:** Don't connect Bridge↔MCP at all. Instead, change the MCP orchestrate flow to **read `bridge-workflows.json` directly** when called by the dispatcher LLM.

```
Current flow:
  LLM → orchestrate_start → fire_o (agent=R) → [gap] → ???

Proposed flow:
  LLM → orchestrate_start → fire_o (agent=R)
  [R completes, idle handler markCompleted]
  LLM → orchestrate_on_event("subagent_done") → MCP reads bridge-workflows.json → returns fire_o (agent=C)
  [C completes, idle handler markCompleted]
  LLM → orchestrate_on_event("subagent_done") → MCP reads bridge-workflows.json → returns done/notify
```

The key insight: **the dispatcher LLM is already in the loop**. After `fire_o` returns, the SKILL.md flow tells the LLM to wait, then call `orchestrate_on_event`. The MCP tool can read the result from `bridge-workflows.json` instead of receiving it as a parameter.

**Pros:**
- **Zero new infrastructure** — no new processes, no file watching, no direct MCP connection
- Uses existing tools and flow
- MCP already has access to the filesystem
- SKILL.md controls the timing (LLM calls when ready)

**Cons:**
- **LLM must poll** — but only once per phase transition (not continuous), and it's the SKILL.md instruction driving it
- **Timing sensitivity** — LLM might call before R completes; MCP must handle "still running" gracefully
- **State in two places** — MCP in-memory state + bridge-workflows.json file

**Feasibility:** 85%. Minimal change, leverages existing architecture.

---

## Comparison Matrix

| Criterion | A (promptAsync) | B (SKILL poll) | C (File Watcher) | D (Direct MCP) | F (Read File) |
|-----------|----------------|----------------|-------------------|----------------|---------------|
| Complexity | Low | Low | High | High | Low |
| Conversation pollution | Yes | No | No | No | No |
| Reliability | Medium | Low | Medium | Medium | High |
| Token cost | High | Medium | None | None | Low |
| New infrastructure | None | None | Watcher thread | MCP client | None |
| Feasibility | 70% | 50% | 40% | 60% | 85% |

## Open Questions

1. Should `orchestrate_on_event` accept `bridge_workflows_dir` as a parameter to read results from disk?
2. How to handle the "still running" case — return a retry instruction to the LLM?
3. Should the dispatcher timeout after N polling attempts?
4. What happens if the user sends another message while R is running — does the dispatcher lose context?

---

## Oracle Review (2025-04-25)

### Verdict: **Proposal F is the answer, and it's already implemented in SKILL.md.**

The "gap" the design doc identifies does not exist. SKILL.md lines 61-80 already implement the complete R→C chain via the MULTI-STAGE LOOP:

```
fire_o (R) → aristotle_check polling → completed → orchestrate_on_event("subagent_done")
→ MCP returns fire_sub (C) → fire_o (C) → polling → completed → orchestrate_on_event("subagent_done")
→ MCP returns notify/done → display to user
```

The dispatcher LLM is the bridge. No new infrastructure needed.

### Proposal Verdicts (Oracle)

| Proposal | Verdict | Reasoning |
|----------|---------|-----------|
| A (promptAsync) | ❌ Reject | Conversation pollution, race conditions, instruction-following brittleness. 40% reliable. |
| B (SKILL poll) | ⚠️ Already implemented | This IS the current design in SKILL.md lines 61-80. LLM as instruction pointer, not free-form polling. |
| C (File Watcher) | ❌ Reject | Half-bridge problem fatal: MCP detects completion but cannot fire_o. Circular dependency. |
| D (Direct MCP) | ❌ Overengineered | Double MCP instances, lifecycle complexity, premature abstraction. |
| E (noReply) | ❌ Discarded | Known hang bug. |
| F (Read File) | ✅ Recommended (95%) | Already implemented via SKILL.md loop. Zero new infrastructure. |

### Action Items (Oracle)

1. **Verify end-to-end** — Run full R→C chain and confirm it works
2. **Defensive handling** — `orchestrate_on_event` should handle empty result gracefully
3. **Global poll cap** — Set total budget across all stages (e.g., 80 polls)
4. **Skip A/C/D** — Add complexity without solving a problem that isn't already solved

### Explorer Research Conclusion

MCP has no native tool-calls-tool mechanism. All tool chaining goes through the host LLM. LLM-mediated polling via SKILL.md is the standard and only viable pattern for this architecture.
