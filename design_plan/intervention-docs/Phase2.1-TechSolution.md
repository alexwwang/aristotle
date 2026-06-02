# Phase 2.1 Technical Solution

**Version**: 1.0
**Status**: Approved
**Date**: 2026-05-19

---

## Feature 1: GPAV (Gate Pass Auto-Validation)

### Schema Changes (`schema.ts`)

Bump `SCHEMA_VERSION` to 3.

New types:
```typescript
interface RoundRecord {
  round: number
  counts: { C: number; H: number; M: number; L: number; I: number }
  submittedAt: string
}

interface FindingSubmission {
  severity: 'C' | 'H' | 'M' | 'L' | 'I'
  description: string
  original?: 'C' | 'H' | 'M' | 'L' | 'I'
  downgrade_reason?: string
}
```

Add to `RalphLoopState`:
- `roundRecords: RoundRecord[]` — authoritative per-round counts
- `autoValidated: boolean` — set true on first `ralph_round_finding`

Add to `CheckpointEvent` union: `'ralph_round_finding'`

Migration in `readState()`: fill `roundRecords: []`, `autoValidated: false` for SCHEMA_VERSION < 3.

### New Event: `ralph_round_finding`

**Validation** (`validateTransition`):
- Requires state !== null, ralph !== null, phaseStatus === 'ralph_loop'
- `payload.round` must be `ralph.round + 1`
- `payload.findings` must be non-empty array of FindingSubmission objects
- Each finding: severity must be valid, description must be non-empty
- If `original` is set and `severity < original` (lexicographic C<H<M<L<I), `downgrade_reason` is required

**Apply** (`applyTransition`):
- Compute counts from findings array
- Create `RoundRecord` or append to existing round record
- Set `autoValidated = true`
- Return new state

### Modified Event: `ralph_round_complete`

**When `autoValidated === true`** (GPAV mode):
- Round MUST have a matching `roundRecords` entry
- `consecutiveZero` computed from `roundRecords` with strict definition: C=0 AND H=0 AND M=0 (P/L excluded)
- Agent's `tally` is validated against Watchdog's counts (must match)
- If agent's tally doesn't match Watchdog's counts → violation

**When `autoValidated === false`** (legacy mode):
- Current behavior unchanged (C+H+M==0 for consecutiveZero, agent's tally accepted)

### Modified Event: `ralph_terminate`

**When `autoValidated === true`**:
- `early_stop`: Validate `consecutiveZero >= EARLY_STOP_CONSECUTIVE` from Watchdog's computation
- `gate_pass`: Validate last roundRecord has C=H=M=0
- `max_rounds`: Validate last roundRecord has C+H+M > 0

**When `autoValidated === false`**:
- Current behavior unchanged

### Key Design Decisions

1. **Strict early stop in GPAV**: L must also be 0 (AC-G2). This is a tightening from legacy mode.
2. **Agent tally validated, not ignored**: If agent submits mismatched tally in GPAV mode, it's rejected. This prevents agents from gaming by submitting correct findings but wrong round_complete tally.
3. **`autoValidated` is sticky**: Once true, stays true. If agent stops submitting findings mid-loop, subsequent rounds will fail validation (no roundRecords entry).

---

## Feature 2: RPS (Reviewer Prompt Sanitization)

### New Module: `prompt-scanner.ts`

Pure function:
```typescript
interface SanitizeResult {
  flagged: boolean
  matchedPatterns: Array<{ pattern: string; match: string }>
}

function scanPrompt(prompt: string, patterns?: RegExp[]): SanitizeResult
```

Default patterns (10 prohibited patterns from requirements):
- `consecutive.*zero`, `early.?stop`, `gate.?pass`, `round\s+\d+.*found`
- `running.?total`, `previous.*review.*found`, `fix.?list`
- `R\d+.*(found|identified|fixed)`, `should.?find.?no`, `verify.?that.*no`

### Observer Changes (`observer.ts`)

In `handle()`, Path 1 (ralph_loop + Task):
1. Extract `prompt` from Task args (`args.prompt` or `args[0]`)
2. Call `scanPrompt(prompt)`
3. If flagged:
   - Append audit entry: event type `PROMPT_INJECTION_DETECTED`, decision `BLOCK`
   - Log warning with matched patterns
4. Continue to record `_reviewer_spawned` observation (regardless — detection is warn-only for MVP)

### Config Changes (`watchdog-config.ts`)

Extend `WatchdogConfig` with optional:
```typescript
promptSanitization?: {
  enabled: boolean
  mode: 'warn' | 'block'   // MVP: only 'warn' implemented
  prohibitedPatterns?: string[]  // override defaults
}
```

Default: `{ enabled: true, mode: 'warn' }` when section is absent.

### Audit Event Type

Add `'PROMPT_INJECTION_DETECTED'` to `AuditLogEntry.event` union.

Add `OBS_TYPE_PROMPT_INJECTION` constant.

---

## File Touch List

| File | Change Type | Description |
|------|-------------|-------------|
| `src/schema.ts` | Modify | +3 types, +1 event, +2 RalphLoopState fields, +1 audit event, SCHEMA_VERSION=3 |
| `src/prompt-scanner.ts` | Create | Pure function + default patterns |
| `src/transitions.ts` | Modify | +1 event handler, modify 2 event handlers |
| `src/observer.ts` | Modify | +prompt scanning in Task handler |
| `src/watchdog-config.ts` | Modify | +promptSanitization config section |
| `src/index.ts` | Modify | Wire PromptScanner into Observer |
| `test/transitions.test.ts` | Modify | +GPAV tests (~15 test cases) |
| `test/prompt-scanner.test.ts` | Create | +RPS tests (~7 test cases) |
| `test/observer.test.ts` | Modify | +RPS integration tests (~3 test cases) |
