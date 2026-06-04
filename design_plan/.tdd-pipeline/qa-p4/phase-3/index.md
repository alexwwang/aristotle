---
version: 1
date: 2026-06-02
previous_version: -
change: "Initial QA-P4 Phase 3 Test Plan — index.md"
---

# QA-P4 Phase 3 Test Plan — Index

## Shared Contracts

### Source of Truth
- **Phase 1 spec**: `05-phase4-merge.md` (10 ACs)
- **Phase 2 spec**: `01-interfaces.md` §3.0.7 (McpAuditEntry), §3.0.8 (Constants), §3.0.3a (P4 triggers)
- **ADR**: `adr.md` ADR-016 (CommitGuard no validate_schema)
- **Python source**: `intervention/src/{rollback_engine,ki_doc_manager,commit_guard,committer,intervention_types}.py`

### Migrated Public APIs

| Module | Source Class | Source Methods | Target Location |
|--------|-------------|---------------|-----------------|
| RollbackEngine | `RollbackEngine` | `validate_path()` only | `aristotle_mcp/_tools_rollback.py` — rollback() replaced by stash-based MCP tools (create_rollback_point/rollback_to_checkpoint) |
| KiDocManager | `KiDocManager` | `record_intervention()`, `ensure_assessment()`, `ensure_updated()`, `record_merge()` | `aristotle_mcp/_tools_ki_doc.py` |
| CommitGuard | `CommitGuard` | `ensure_committed()` | Inline into `commit_rule()` guard |
| AutoCommitter | `AutoCommitter` | `validate_schema()` | Inline into `commit_rule()` guard |

### New MCP Tools (5)

| Tool | Purpose | Module |
|------|---------|--------|
| `create_rollback_point` | Stash current state with `aristotle-rollback:` prefix | rollback-tools |
| `rollback_to_checkpoint` | Restore from named stash, return `pipeline_reset_required` | rollback-tools |
| `cleanup_rollback_stashes` | Prune stashes, keep N most recent | rollback-tools |
| `write_ki_doc` | Write KI entry to markdown doc | ki-doc-tools |
| `read_ki_docs` | Read KI entries with optional filter; also supports freshness checking (ensure_updated timestamp comparison) | ki-doc-tools |

### New Infrastructure

| Component | Purpose | Module |
|-----------|---------|--------|
| McpAuditEntry | JSONL audit log for MCP tool calls | mcp-audit-log |
| `.aristotle/audit.jsonl` | Append-only, 4KB/line limit, 500-char truncation | mcp-audit-log |
| `commit_rule` guard | staging check + schema validation, skip_guard bypass | commit-guard |
| `pipeline_reset` trigger | 3-layer fallback from rollback_to_checkpoint | pipeline-reset |

### Constants (from §3.0.8)

| Constant | Value | Used By |
|----------|-------|---------|
| MCP_AUDIT_JSONL_LINE_LIMIT | 4KB | mcp-audit-log |
| ERROR_SUMMARY_TRUNCATION | 500 chars | mcp-audit-log (applies to McpAuditEntry.error field per §3.0.7, legacy name references frontmatter error_summary field). **Measured in Unicode code points (characters), not bytes.** |
| KI_FRESHNESS_THRESHOLD | 24h (86400s) | ki-doc-tools (ensure_updated freshness check) |
| STASH_WARNING_THRESHOLD | 5 | rollback-tools |
| STASH_HARD_LIMIT | 10 | rollback-tools |
| STASH_CLEANUP_KEEP | 3 | rollback-tools |
| UNTRACKED_FILES_THRESHOLD | 100MB | rollback-tools |
| MCP_TOOL_COUNT_POST_MERGE | 27 | integration | Post-merge count: 22 existing + 5 new. Note: Phase 1 spec §3.0.8 originally specified MCP_TOOL_COUNT_POST_MERGE=25 as a pre-implementation estimate. Updated to 27 after implementation verification. **Spec reconciliation needed**: 01-interfaces.md §3.0.8 should update MCP_TOOL_COUNT_CURRENT=22 and MCP_TOOL_COUNT_POST_MERGE=27 during Phase 4. |

**Note**: P3 constants (SCHEMA_VERSION_TARGET, SEV_ORDER, VALID_SEVERITIES) are out of scope for Phase 4 test plan — they are tested in Phase 3 test suite.

### Test Infrastructure
- **Framework**: pytest + `tmp_repo` fixture (monkeypatch ARISTOTLE_REPO_DIR)
- **Subprocess mocking**: `subprocess.run` for git operations (via `monkeypatch.setattr` or `unittest.mock.patch`)
- **File fixtures**: `tmp_path` for KI docs, audit logs
- **Existing test pattern**: `aristotle_mcp/tests/test_mcp_server_tools.py` — class-based, direct function imports

## Dependency Map

```
{rollback-tools: [mcp-audit-log],      # rollback ops write audit entries
 commit-guard:  [mcp-audit-log],       # guard check writes audit entries
 ki-doc-tools:  [mcp-audit-log],       # KI writes write audit entries
 pipeline-reset: [rollback-tools],     # uses rollback_to_checkpoint return value
 integration:   [rollback-tools, ki-doc-tools, commit-guard, mcp-audit-log, pipeline-reset]}
```

## Execution Order

1. `mcp-audit-log` (leaf — no deps)
2. `rollback-tools` (depends on mcp-audit-log)
3. `ki-doc-tools` (depends on mcp-audit-log)
4. `commit-guard` (depends on mcp-audit-log)
5. `pipeline-reset` (depends on rollback-tools)
6. `integration` (depends on all)

**Failure propagation**: Individual module test failures are reported independently. Cross-module propagation is not implemented in Phase 4 — each module's test suite runs independently.

## Module Summaries

### mcp-audit-log
McpAuditEntry type, append-only `.aristotle/audit.jsonl` writer with 4KB line limit, 500-char error field truncation, .gitignore on init_repo. Tests: append, truncation, line limit, .gitignore creation. (concurrent_access N/A per ADR-007 single-agent)

### rollback-tools
3 MCP tools: create_rollback_point (git stash with prefix), rollback_to_checkpoint (git stash apply + pipeline_reset signal), cleanup_rollback_stashes (prune keeping N). Tests: stash lifecycle, prefix filtering, untracked file warnings, hard/soft limits, cleanup keep count.

### ki-doc-tools
2 MCP tools: write_ki_doc (append entry to KI markdown), read_ki_docs (read with optional filter). Migrates KiDocManager 4 methods into 2 MCP-facing tools. Tests: write/read round-trip, filter, doc creation, timestamp parsing, merge entries.

### commit-guard
Enhances existing `commit_rule()` with staging status check + schema validation (from AutoCommitter.validate_schema). skip_guard parameter bypasses checks. ARISTOTLE_CI=true disables skip_guard. Tests: guard blocks non-staging, schema validation, skip_guard bypass, CI env override.
**Note**: CommitGuard.ensure_committed and AutoCommitter.validate_schema are inlined into commit_rule(). The CommitGuard and AutoCommitter classes referenced here are defined in the commit-guard.md module test plan.

### pipeline-reset
Tests the 3-layer fallback chain for pipeline_reset: (1) Watchdog Observer detects rollback_to_checkpoint return → auto-calls tdd_checkpoint('pipeline_reset'), (2) if Watchdog not running → MCP handler directly triggers, (3) if both fail → next pipeline_start resets. Tests: fallback chain order, state reset correctness.

### integration
End-to-end: tool count = 27 (22 existing + 5 new), intervention/ directory deleted, functional equivalence (all original tests pass), import verification, no session state dependency.

## Cross-Cutting Concerns

1. **No session state dependency** — All 5 new tools must be stateless (AC-5). No `session_id` stored across calls.
2. **Git safety** — All operations accepting file paths must use `validate_path()` for security (from RollbackEngine pattern). No path traversal. Rollback operations using stash references (create_rollback_point, rollback_to_checkpoint, cleanup_rollback_stashes) are exempt as they operate on git stash names, not filesystem paths. **Note**: `validate_path()` is directly tested in rollback-tools (tests #12-15). For ki-doc-tools (ki_doc_path) and commit-guard (rule file_path), the shared `validate_path()` function provides the security guarantee; Phase 4 integration tests should verify these tools call it for path parameters.
3. **Audit logging** — Every MCP tool call writes McpAuditEntry. Tests verify audit entry content.
4. **Prefix convention** — Only `aristotle-rollback:` prefixed stashes are managed. Non-prefixed stashes are never touched.
5. **Error recovery** — Stash creation failure blocks rollback. Untracked >100MB returns warning but proceeds.
6. **Backward compatibility** — commit_rule existing behavior unchanged when guard conditions not met (staging status, frontmatter present).