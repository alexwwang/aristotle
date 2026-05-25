# Technical Solution: Aristotle Auto-Reflection for TDD Pipeline

## Why Articulation

Phase 2 protects the traceability of architectural decisions. The key risk is designing a system that either (a) cannot reliably detect LLM behavioral violations without false positives, or (b) generates low-quality rules that pollute the Aristotle rule corpus. Our approach uses a pipeline architecture with clear separation of concerns: detection (GPAV) → reflection (Aristotle MCP) → validation → commit.

Key risks:
1. **Tight coupling**: If auto-reflection is tightly coupled to GPAV, changes in either system break the other
2. **Rule quality**: Auto-generated rules may lack actionable specificity, reducing their value
3. **Performance**: Synchronous detection with asynchronous reflection creates race conditions

Approach: Event-driven pipeline with durable queue, schema validation gate, and clear module boundaries.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TDD Pipeline Execution                    │
│  (Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5)        │
└──────────────────────┬──────────────────────────────────────┘
                       │ File operations (create/modify/delete)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  GPAV Watchdog                                              │
│  - Observes file system operations                          │
│  - Classifies operations by phase                           │
│  - Detects behavioral violations                            │
│  - Emits ViolationEvent                                     │
└──────────────┬──────────────────────────────────────────────┘
               │ ViolationEvent
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Auto-Reflection Pipeline (this feature)                    │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  watchdog   │───▶│  reflector  │───▶│   queue     │    │
│  │  (filter)   │    │  (trigger)  │    │  (buffer)   │    │
│  └─────────────┘    └──────┬──────┘    └──────┬──────┘    │
│                            │                    │          │
│                            ▼                    ▼          │
│                     ┌─────────────┐    ┌─────────────┐    │
│                     │rule_generator│   │  durable    │    │
│                     │  (create)   │    │   store     │    │
│                     └──────┬──────┘    └─────────────┘    │
│                            │                              │
│                            ▼                              │
│                     ┌─────────────┐                       │
│                     │  committer  │                       │
│                     │(validate+   │                       │
│                     │   commit)   │                       │
│                     └──────┬──────┘                       │
│                            │                              │
└────────────────────────────┼──────────────────────────────┘
                             │ Rule file
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Aristotle Rule Repository                       │
│              (.config/opencode/aristotle-repo)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Module Design

### 1. watchdog.py

**Responsibility**: Receive ViolationEvents from GPAV, filter for behavioral violations only.

**Interface**:
```python
class ViolationFilter:
    def __init__(self, allowed_types: Set[str] = None)
    def filter(self, event: ViolationEvent) -> Optional[ViolationEvent]
    def is_behavioral_violation(self, event: ViolationEvent) -> bool
```

**Key Logic**:
- Only passes events with `violation_type` in {SKIP_RED_PHASE, MODIFIED_TEST, MISSING_TEST}
- Drops events where `context.phase` is not in 1-5 (out of TDD scope)
- Validates mandatory context keys: operation, phase

### 2. reflector.py

**Responsibility**: Trigger Aristotle reflection via MCP tools when violations are detected.

**Interface**:
```python
class AutoReflector:
    def __init__(self, mcp_client: MCPClient)
    async def reflect(self, event: ViolationEvent) -> Optional[ReflectionResult]
    def build_reflection_prompt(self, event: ViolationEvent) -> str
```

**Key Logic**:
- Calls Aristotle MCP `write_rule` tool with auto_reflection=true
- Builds reflection prompt from violation context
- Handles MCP unavailability → delegates to queue

### 3. rule_generator.py

**Responsibility**: Generate rule content with TDD-specific metadata.

**Interface**:
```python
class RuleGenerator:
    def generate(self, event: ViolationEvent) -> RuleContent
    def build_frontmatter(self, event: ViolationEvent) -> Dict[str, Any]
    def build_body(self, event: ViolationEvent) -> str
```

**Key Logic**:
- Frontmatter includes: auto_reflection=true, source=tdd-pipeline, violation_type
- Body includes: Context/Rule/Why/Example sections
- Category derived from violation_type mapping

### 4. committer.py

**Responsibility**: Validate schema and auto-commit rules.

**Interface**:
```python
class AutoCommitter:
    def __init__(self, mcp_client: MCPClient)
    async def commit(self, rule_path: str) -> CommitResult
    def validate_schema(self, frontmatter: Dict) -> ValidationResult
```

**Key Logic**:
- Validates: category non-empty, confidence in [0.0,1.0], error_summary <= 200 chars
- On validation failure: logs error, does NOT commit
- On success: calls MCP `commit_rule` (pending→verified abbreviated lifecycle)

### 5. queue.py

**Responsibility**: Persist violations when MCP unavailable, replay on next pipeline.

**Interface**:
```python
class DurableQueue:
    def __init__(self, queue_dir: str = ".opencode/aristotle-queue/")
    def enqueue(self, event: ViolationEvent)
    def dequeue_all(self) -> List[ViolationEvent]
    def peek(self) -> Optional[ViolationEvent]
    def clear(self)
```

**Key Logic**:
- JSON file per violation: `{timestamp}_{violation_type}_{hash}.json`
- dequeue_all returns all queued events, sorted by timestamp
- Clear after successful processing

---

## Data Flow

```
Phase 1: Detection (Synchronous, Non-blocking)
  GPAV Watchdog ──► ViolationFilter ──► ViolationEvent
                      │
                      ▼
Phase 2: Reflection (Asynchronous)
  AutoReflector ──► MCP write_rule ──► RuleContent
                      │
                      ▼
Phase 3: Validation (Synchronous)
  AutoCommitter ──► Schema Validation ──► Valid? ──► Commit
                      │                         │
                      ▼                         ▼
              Validation Error           commit_rule()
                      │                         │
                      ▼                         ▼
                 Log + Retry              status=verified
                      │                         │
                      ▼                         ▼
              DurableQueue (if MCP         Rule Repository
              unavailable)
```

**Flow Description**:
1. **Detection Phase**: GPAV observes file operations → ViolationFilter classifies → ViolationEvent emitted
2. **Reflection Phase**: AutoReflector receives event → Builds reflection prompt → Calls MCP write_rule → Rule generated with auto_reflection=true
3. **Validation Phase**: AutoCommitter validates schema → If valid: commit_rule() → pending→verified → Rule Repository. If invalid: log error, retry on next pipeline
4. **Queue Fallback**: If MCP unavailable during reflection, ViolationEvent is persisted to DurableQueue. On next pipeline execution, queued events are replayed through Phase 2-3.

**Key Transitions**:
- Detection → Reflection: Event-driven, async (non-blocking)
- Reflection → Validation: Synchronous (within reflection callback)
- Validation → Commit: Synchronous (git operation)
- Validation → Queue: On MCP unavailable or validation failure

---

## Data Models

### ViolationEvent

```python
@dataclass
class ViolationEvent:
    violation_type: str       # SKIP_RED_PHASE | MODIFIED_TEST | MISSING_TEST
    affected_file_path: str   # Path to the file involved
    timestamp: str            # ISO 8601
    context: Dict[str, Any]   # Must contain: operation, phase
```

### ReflectionResult

```python
@dataclass
class ReflectionResult:
    rule_id: str              # Generated rule ID
    rule_path: str            # Path in repo
    success: bool
    error: Optional[str]
```

---

## Error Handling Strategy

| Error Scenario | Strategy | Retry |
|----------------|----------|-------|
| MCP unavailable | Queue violation, continue pipeline | Next pipeline execution |
| Schema validation fail | Log error, skip commit, keep violation | Manual fix required |
| Rule generation fail | Log error, skip commit | No retry (content issue) |
| Commit fail (git) | Rule stays pending, log error | Next pipeline execution |
| Queue read fail | Log error, skip queued items | No retry (data corruption) |

---

## GEAR Lifecycle Exception

**Justification**: Auto-reflected rules are machine-generated and machine-validated. The detection (GPAV) and generation (Aristotle reflection) are separate automated processes that together fulfill the role separation requirement. The commit is a mechanical operation, not a human audit decision.

**Implementation**:
- Rules are created with status="pending"
- `commit_rule()` sets status="verified" directly
- Documented as intentional exception in Prerequisites #7

---

## Performance Considerations

- Violation detection is synchronous but non-blocking (< 10ms per event)
- Reflection is asynchronous (does not block pipeline)
- Queue I/O is file-based, durable but not high-performance (acceptable for low-frequency violations)
- Deduplication is per-pipeline, no cross-pipeline state

---

## Security & Trust Boundaries

**Trust Boundaries**:
1. **GPAV → Auto-Reflection Pipeline**: Violation events are the only external input. Events are validated against whitelist (violation_type ∈ {SKIP_RED_PHASE, MODIFIED_TEST, MISSING_TEST}) before processing.
2. **Auto-Reflection Pipeline → Aristotle MCP**: Rule content is generated by the pipeline, not external users. Schema validation prevents injection.
3. **Aristotle MCP → Git Repository**: Git operations are atomic. Failed commits leave repo in clean state.

**Input Validation**:
- All violation events validated: mandatory keys (operation, phase), phase range (1-5), violation_type whitelist
- Frontmatter validated: category non-empty, confidence ∈ [0.0, 1.0], error_summary ≤ 200 chars
- No user-generated content enters the pipeline without validation

---

## Backward Compatibility

- **Schema extensions**: `auto_reflection` and `source` fields are optional in RuleMetadata. Existing rules without these fields remain valid.
- **API changes**: `write_rule()` accepts optional `auto_reflection` and `source` parameters. Callers not using these parameters see no behavioral change.
- **GEAR lifecycle**: Abbreviated lifecycle `pending → verified` is an opt-in exception for auto-reflected rules only. Human-reviewed rules continue to use full `pending → staging → verified` lifecycle.
- **Queue format**: JSON queue files use versioned schema. Future format changes will support migration.
