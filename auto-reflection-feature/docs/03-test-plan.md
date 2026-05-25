# Test Plan: Aristotle Auto-Reflection for TDD Pipeline

## Test Strategy

This test plan covers 8 acceptance criteria from Phase 1. Tests are organized by:
- **Unit tests**: Individual module behavior in isolation
- **Integration tests**: Module interactions and data flow
- **Boundary tests**: Edge cases and error conditions

---

## Test Cases

### TC-1: SKIP_RED_PHASE Detection (AC-1)

| Field | Value |
|-------|-------|
| **Type** | Integration |
| **Input** | GPAV event: violation_type=SKIP_RED_PHASE, file_path=src/calc.py, context={operation:create, phase:4} |
| **Expected** | ViolationFilter.filter() returns the event unchanged |
| **Setup** | Mock GPAV emitting event after implementation file creation before test failure |
| **Validation** | Assert output.violation_type == SKIP_RED_PHASE |

**Edge Cases**:
- LLM reads tests first → still SKIP_RED_PHASE if writes implementation before running tests
- Multiple implementation files created → one event per file

### TC-2: MODIFIED_TEST Detection (AC-2)

| Field | Value |
|-------|-------|
| **Type** | Integration |
| **Input** | GPAV event: violation_type=MODIFIED_TEST, file_path=tests/test_calc.py, context={operation:modify, phase:5} |
| **Expected** | ViolationFilter.filter() returns the event |
| **Setup** | Mock GPAV detecting test file modification after implementation write |
| **Validation** | Assert output is not None |

**Edge Cases**:
- Test file deleted and recreated → detected as MODIFIED_TEST
- Test file modified before any implementation → not a violation (filtered out)

### TC-3: MISSING_TEST Detection (AC-3)

| Field | Value |
|-------|-------|
| **Type** | Integration |
| **Input** | GPAV event: violation_type=MISSING_TEST, file_path=src/utils.py, context={operation:create, phase:4} |
| **Expected** | ViolationFilter.filter() returns the event |
| **Setup** | Mock GPAV detecting implementation file with no corresponding test file |
| **Validation** | Assert output.violation_type == MISSING_TEST |

**Edge Cases**:
- Test created after implementation → still MISSING_TEST at detection time
- Test exists in different directory → detected if path mapping fails

### TC-4: Auto-Reflection Rule Generation (AC-4)

| Field | Value |
|-------|-------|
| **Type** | Integration |
| **Input** | ViolationEvent(violation_type=SKIP_RED_PHASE, file_path=src/calc.py) |
| **Expected** | Rule generated with auto_reflection=true, source=tdd-pipeline |
| **Setup** | Mock MCP server accepting write_rule calls |
| **Validation** | Assert rule frontmatter contains auto_reflection=true and source=tdd-pipeline |

**Edge Cases**:
- Multiple violations → one rule per unique (type, file) pair
- Duplicate violation → deduplicated within same pipeline

### TC-5: Auto-Commit Success (AC-5)

| Field | Value |
|-------|-------|
| **Type** | Unit |
| **Input** | Valid rule file with correct schema |
| **Expected** | commit_rule() called, status=verified |
| **Setup** | Mock rule file with valid frontmatter |
| **Validation** | Assert commit_rule MCP tool called with file_path |

**Edge Cases**:
- Commit fails → rule stays pending, error logged
- Git conflict → retry on next pipeline

### TC-6: Schema Validation Failure (AC-6)

| Field | Value |
|-------|-------|
| **Type** | Unit |
| **Input** | Rule with missing category or confidence > 1.0 |
| **Expected** | Validation error, rule NOT committed |
| **Setup** | Create rule with invalid frontmatter |
| **Validation** | Assert ValidationError raised, commit_rule NOT called |

**Edge Cases**:
- Confidence = 1.0 → valid (boundary)
- Confidence = 1.1 → invalid
- Missing error_summary → invalid

### TC-7: Summary Generation (AC-7)

| Field | Value |
|-------|-------|
| **Type** | Unit |
| **Input** | Pipeline completion with 2 violations, 1 rule generated |
| **Expected** | JSON summary with violation_count=2, rules_generated=1 |
| **Setup** | Mock pipeline execution tracking violations |
| **Validation** | Assert summary JSON structure matches spec |

**Edge Cases**:
- No violations → violation_count=0, rules_generated=0
- Multiple violation types → violation_types list contains all unique types

### TC-8: Queue Durability (AC-8)

| Field | Value |
|-------|-------|
| **Type** | Integration |
| **Input** | MCP unavailable, violation detected |
| **Expected** | Violation queued to durable store |
| **Setup** | Mock MCP unavailable (connection error) |
| **Validation** | Assert queue file exists, contains violation data |

**Edge Cases**:
- Process terminates → queue survives
- Queue replay → produces equivalent rule
- Queue corruption → logged, skipped

---

## Test Coverage Matrix

| AC | Unit | Integration | Boundary |
|----|------|-------------|----------|
| AC-1 | — | TC-1 | TC-1 edge |
| AC-2 | — | TC-2 | TC-2 edge |
| AC-3 | — | TC-3 | TC-3 edge |
| AC-4 | — | TC-4 | TC-4 edge |
| AC-5 | TC-5 | — | TC-5 edge |
| AC-6 | TC-6 | — | TC-6 edge |
| AC-7 | TC-7 | — | TC-7 edge |
| AC-8 | — | TC-8 | TC-8 edge |

---

## Test Data

### Mock ViolationEvent
```python
{
    "violation_type": "SKIP_RED_PHASE",
    "affected_file_path": "/workspace/project/src/calc.py",
    "timestamp": "2026-05-25T10:00:00Z",
    "context": {
        "operation": "create",
        "phase": 4
    }
}
```

### Mock Rule (Valid)
```python
{
    "category": "PATTERN_VIOLATION",
    "confidence": 0.85,
    "error_summary": "LLM skipped Red phase",
    "auto_reflection": True,
    "source": "tdd-pipeline"
}
```

### Mock Rule (Invalid)
```python
{
    "category": "",  # Empty → invalid
    "confidence": 1.5,  # Out of range → invalid
    "error_summary": "x" * 201  # Too long → invalid
}
```
