# Requirements Document: Aristotle Auto-Reflection for TDD Pipeline

## Why Articulation

Phase 1 protects the accuracy of requirements understanding. The core risk here is ambiguity in defining what constitutes an "LLM behavioral error" during TDD Pipeline execution. If we define this too narrowly, we miss important violations; too broadly, we create noise and erode trust in the auto-reflection system.

Key risks:
1. **False positives**: Normal LLM behavior might be incorrectly flagged as violations
2. **False negatives**: Subtle TDD protocol violations might slip through
3. **Scope creep**: Expanding to detect design/code errors instead of focusing on behavioral violations

Approach: Define a precise, enumerable set of behavioral violations based on the TDD Pipeline protocol, with clear detection criteria.

---

## Prerequisites

Before implementing this feature, the following schema changes are required:
1. **RuleMetadata extension**: Add optional fields `auto_reflection` (bool, default false) and `source` (string, nullable) to the RuleMetadata dataclass
2. **write_rule() extension**: Accept optional `auto_reflection` and `source` parameters, forward to RuleMetadata
3. **to_frontmatter_string() extension**: Serialize new fields when present
4. **from_frontmatter_dict() extension**: Parse new fields when present
5. **commit_rule() extension**: Add schema validation (category non-empty, confidence in [0.0,1.0], error_summary <= 200 chars) before commit
6. **stream_filter_rules() extension**: Add optional `auto_reflection` filter parameter to enable querying auto-reflected rules
7. **GEAR conformance exception**: Auto-reflected rules follow abbreviated lifecycle `pending → verified` (bypassing staging). Role separation is maintained: GPAV acts as producer (R) by detecting violations, Aristotle reflection engine acts as auditor (C) by generating and validating rule content. The commit is a mechanical operation, not an audit decision. Documented as intentional exception for machine-generated rules.
8. **Security analysis**: All external input flows through GPAV violation events (trust boundary at GPAV→Aristotle interface). Violation events are validated before processing (violation_type whitelist, phase range check). No sensitive data exposure: rule content contains only behavioral patterns, not source code or user data. Authentication/authorization handled by MCP server.

---

## System Boundaries

- **In scope**:
  - Detection of LLM behavioral violations during TDD Pipeline execution
  - Automatic triggering of Aristotle reflection when violations are detected
  - Generation of reflection rules with TDD-specific metadata
  - Auto-commit of rules to the Aristotle rule repository
  - Frontmatter tagging: `auto_reflection: true`, `source: tdd-pipeline`

- **Out of scope**:
  - Detection of design document errors (e.g., incorrect requirements analysis)
  - Detection of code implementation errors (e.g., test failures, logic bugs)
  - Detection of Aristotle MCP tool call errors
  - Manual review of auto-generated rules (out of scope: system is fully automated)
  - Cross-session analysis (only within single TDD Pipeline execution)

- **External dependencies**:
  - **Aristotle MCP Server**: Provides `write_rule`, `commit_rule`, `init_repo` tools. Requires schema extensions (see Prerequisites).
  - **TDD Pipeline Watchdog (GPAV)**: Monitors LLM file operations and detects protocol violations. GPAV = Guarded Pipeline Authority Verification. Provides violation events containing:
    - `violation_type` (enum): SKIP_RED_PHASE | MODIFIED_TEST | MISSING_TEST
    - `affected_file_path` (string)
    - `timestamp` (ISO 8601)
    - `context` (JSON object with mandatory keys: `operation` [create|modify|delete], `phase` [integer: 1-5])
  - **LLM session context**: opencode session file system operations (observable via file watchers)

---

## User Stories

| # | Priority | User Story |
|---|----------|-----------|
| US-1 | Core | As a TDD Pipeline user, I want the system to automatically detect when the LLM skips the Red phase (writes implementation before tests fail), so that TDD protocol is enforced |
| US-2 | Core | As a TDD Pipeline user, I want the system to detect when the LLM modifies test files to make them pass, so that test integrity is maintained |
| US-3 | Core | As a TDD Pipeline user, I want the system to detect when the LLM writes implementation for a module that has no corresponding test file at all, so that test coverage is enforced |
| US-4 | Core | As a TDD Pipeline user, I want detected violations to automatically trigger Aristotle reflection and generate preventive rules, so that future violations are prevented |
| US-5 | Core | As a TDD Pipeline user, I want auto-generated rules to be committed immediately with proper metadata, so that they enter the rule corpus without manual intervention |
| US-6 | Secondary | As a TDD Pipeline user, I want to see a summary of violations detected and rules generated after each pipeline execution, so that I can monitor LLM behavior trends |

---

## Acceptance Criteria

| # | User Story | Priority | Acceptance Criterion | Edge Cases |
|---|-----------|----------|---------------------|------------|
| AC-1 | US-1 | Core | Given LLM creates implementation code before any test is run and fails, When GPAV scans the session, Then violation `SKIP_RED_PHASE` is detected with context showing the file creation timestamps | LLM reads tests first but still writes implementation before running them |
| AC-2 | US-2 | Core | Given LLM modifies a test file after first implementation write, When GPAV detects observable file content change, Then violation `MODIFIED_TEST` is detected with file path | LLM deletes and recreates test with same name → detected as MODIFIED_TEST |
| AC-3 | US-3 | Core | Given LLM writes implementation for a module with no corresponding test file in the tests/ directory, When GPAV scans the session, Then violation `MISSING_TEST` is detected with module path | LLM creates test file after implementation → still MISSING_TEST at time of implementation write |
| AC-4 | US-4 | Core | Given a violation event from GPAV with valid `violation_type` and `context`, When reflection is triggered, Then Aristotle generates a rule with category classifying the violation type and frontmatter fields `auto_reflection: true`, `source: tdd-pipeline` | Multiple violations in one session → one rule per unique (violation_type, affected_file) per pipeline execution |
| AC-5 | US-5 | Core | Given a rule is generated with `auto_reflection=true` and valid schema (category non-empty, confidence in [0.0,1.0], error_summary <= 200 chars), When commit is triggered, Then the rule follows abbreviated lifecycle `pending → verified` and is committed without manual review | Commit fails → rule remains in pending status, error is logged, retry on next pipeline execution |
| AC-6 | US-5 | Core | Given a rule is generated with invalid schema (missing required frontmatter field), When commit is attempted, Then validation error is raised, rule is NOT committed, violation is logged for retry | Invalid confidence value (>1.0 or <0.0) → validation error, rule rejected |
| AC-7 | US-6 | Secondary | Given TDD Pipeline completes, When summary is requested, Then a structured JSON summary is appended to the pipeline execution log containing: `violation_count` (integer), `rules_generated` (integer), `violation_types` (list of string), `auto_reflection_enabled` (boolean) | No violations → violation_count=0, rules_generated=0, violation_types=[] |
| AC-8 | US-4 | Core | Given Aristotle MCP is unavailable, When violations are detected, Then violations are persisted to a local durable queue. When the next pipeline execution starts, Then queued violations are detected and processed | Queue survives process termination. Queued violations produce rules with equivalent violation_type, affected_file_path, category, auto_reflection=true, and source=tdd-pipeline as immediately processed violations |

---

## Constraints & Assumptions

- **Assumption**: TDD Pipeline Watchdog (GPAV) has access to session file system operations (create, modify, delete) via file watchers
- **Assumption**: Aristotle MCP server is running and accessible during TDD Pipeline execution
- **Assumption**: The LLM operates in a file-based workspace where operations are observable
- **Assumption**: Existing rules without `auto_reflection`/`source` fields are unaffected; consumers treat these fields as optional
- **Constraint**: Auto-reflection only triggers for behavioral violations, not design/code quality issues
- **Constraint**: Rules are committed automatically without human review (trust in automated generation)
- **Constraint**: Violation detection is synchronous (identifies violation immediately) but non-blocking to the pipeline. Rule generation via Aristotle reflection is asynchronous.
- **Constraint**: If GPAV cannot observe file system operations, the feature degrades gracefully: auto-reflection is disabled for that pipeline run, warning is logged
- **Constraint**: Auto-reflected rules follow abbreviated GEAR lifecycle `pending → verified` with documented role separation exception (see Prerequisites #7)
