# Known Issues — Phase 5 Code Review

## Pre-existing Code (Outside Phase 5 Scope)

### KI-01: conflicts_with metadata uncommitted after commit_rule
- Raised in: R2 (F-05), re-raised in R3 (F-01/F-28), R4
- Severity: M
- Location: `_tools_rules.py:480-513`
- Description: After `git_add_and_commit` at line 478, conflict metadata is written to disk at lines 488/512 but never committed. Leaves working tree dirty.
- Why deferred: Pre-existing code in `_tools_rules.py` not modified during Phase 5. The commit_rule function's conflict backlink logic existed before Phase 5.
- Plan: Fix in a dedicated commit_rules hardening task post-Phase 6.

### KI-02: keyword regex partial match for conflict_id
- Raised in: R2 (F-06), re-raised in R3
- Severity: M
- Location: `_tools_rules.py:491`
- Description: `list_rules(keyword=conflict_id)` uses regex matching — `rec_1` matches `rec_10`, `rec_11`, etc.
- Why deferred: Pre-existing `list_rules` behavior, not introduced by Phase 5.
- Plan: Add anchored regex or dedicated ID filter parameter to `list_rules`.

### KI-03: detect_conflicts can return None values
- Raised in: R3 (F-02)
- Severity: H (null safety)
- Location: `_tools_rules.py:806`
- Description: `conflicts.append(meta.get('id'))` can append `None` if rule has no `id` field. Downstream `json.dumps(conflicts)` produces `[null]`.
- Why deferred: Pre-existing code in `detect_conflicts()`, not modified in Phase 5.
- Plan: Add guard: `if meta.get('id'): conflicts.append(meta['id'])`.

### KI-04: rollback name parameter not validated for injection
- Raised in: R3 (F-11/F-12)
- Severity: M
- Location: `_tools_rollback.py:110, 231`
- Description: `create_rollback_point` and `rollback_to_checkpoint` don't validate `name` for special characters. Names with quotes/newlines could cause unexpected behavior in git stash messages or tag names.
- Why deferred: Pre-existing rollback code. Phase 5 added `_validate_ki_path` for ki_doc but name validation for rollback is a separate concern.
- Plan: Add whitelist regex `^[a-zA-Z0-9_-]+$` validation for checkpoint names.

### KI-05: empty commit return code not checked
- Raised in: R3 (F-30)
- Severity: M
- Location: `_tools_rollback.py:134-139`
- Description: `create_rollback_point` creates an empty commit for repos without HEAD but doesn't check the return code. If commit fails, subsequent stash creation will also fail.
- Why deferred: Pre-existing code.
- Plan: Check return code and return error if initial commit fails.

## Design Decisions (Not Bugs)

### KI-06: Dual audit format
- Raised in: R1 (F-03/F-04), re-raised R2 (F-07/F-08), R3 (F-07/F-08)
- Severity: I (design observation)
- Location: `_tools_reset.py:105` vs `_audit_log.py:16`
- Description: `_tools_reset` uses `audit-log.json` (JSON array), rollback/ki_doc use `audit.jsonl` (JSONL append-only). Two files, two formats.
- Why deferred: Documented design decision in `_tools_reset.py` module docstring (lines 9-11).
- Plan: Consider migration to JSONL in future refactor.

### KI-07: commit_rule guard opt-in design
- Raised in: R4 (F-14)
- Severity: P (proposal)
- Location: `_tools_rules.py:398-457`
- Description: Guard is opt-in (`enable_guard=False` default). In CI mode, guard still requires explicit `enable_guard=True`. Audit logs GUARD_BYPASSED for every normal commit.
- Why deferred: By design — backward compatibility. `enable_guard=False` default preserves existing behavior.
- Plan: Consider default True with explicit opt-out in future major version.

### KI-08: 3-layer fallback stubs inactive
- Raised in: R3 (F-16), R4 (F-16)
- Severity: I (documented)
- Location: `_tools_reset.py:85-97`
- Description: `_get_watchdog_observer` returns None, `_mcp_handler_reset` and `_pipeline_start_reset` raise RuntimeError. The fallback chain always fails in production.
- Why deferred: Framework awaiting integration with watchdog/MCP components. Tests pass via mocking.
- Plan: Activate when watchdog observer integration is implemented.
