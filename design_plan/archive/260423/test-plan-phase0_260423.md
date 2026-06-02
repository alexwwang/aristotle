# Test Plan: Session Snapshot Bridge (Phase 0)

**From**: `aristotle-bridge-technical-design_260423.md` §九 Phase 0 tests
**Scope**: 5 Python files + 2 protocol files, ~30 lines of business code

---

## Test Coverage Matrix

### Unit Tests (pytest)

| # | Acceptance Criterion | Test File | Test Name | Description |
|---|---------------------|-----------|-----------|-------------|
| 1 | config.py provides sessions dir | `test/test_phase0_snapshot.py` | `should_resolve_sessions_dir_under_opencode_config` | `resolve_sessions_dir()` returns `~/.config/opencode/aristotle-sessions/` |
| 2 | Prompt includes SESSION_FILE | `test/test_phase0_snapshot.py` | `should_include_session_file_in_reflector_prompt` | Prompt contains `SESSION_FILE: /path`, IMPORTANT block, and "If SESSION_FILE is empty" instruction |
| 3 | Empty session_file handled | `test/test_phase0_snapshot.py` | `should_handle_empty_session_file_gracefully` | Prompt contains `SESSION_FILE:` (empty) and STOP instruction |
| 4 | orchestrate_start passes session_file | `test/test_phase0_snapshot.py` | `should_pass_session_file_to_reflector_prompt` | `orchestrate_start("reflect", {"session_file": "/x", ...})` produces prompt containing `/x` |
| 5 | orchestrate_start returns use_bridge | `test/test_phase0_snapshot.py` | `should_return_use_bridge_true_when_marker_exists` | When `.bridge-active` exists, response has `use_bridge: True` |
| 6 | orchestrate_start default no bridge | `test/test_phase0_snapshot.py` | `should_return_use_bridge_false_by_default` | Without marker file, `use_bridge` is `False` |
| 7 | on_undo marks undone | `test/test_phase0_snapshot.py` | `should_mark_workflow_undone_on_undo` | `on_undo(wf_id)` sets workflow status to `"undone"` |
| 8 | on_undo unknown workflow | `test/test_phase0_snapshot.py` | `should_return_unknown_for_nonexistent_undo` | `on_undo("nonexistent")` returns `{"status": "unknown_workflow"}` |
| 9 | on_undo optional params | `test/test_phase0_snapshot.py` | `should_use_defaults_for_missing_undo_params` | `on_undo(wf_id)` sets `undo_scope="unknown"` and `undo_received_at=0` |
| 10 | event ignores undone workflow | `test/test_phase0_snapshot.py` | `should_ignore_events_for_undone_workflow` | `orchestrate_on_event` on undone workflow returns ignored message |
| 10b | on_undo idempotent | `test/test_phase0_snapshot.py` | `should_remain_undone_on_double_undo` | Calling `on_undo(wf_id)` twice: status stays "undone", second call overwrites timestamp |

### Static Checks (test.sh)

| # | Acceptance Criterion | Assertion | Description |
|---|---------------------|-----------|-------------|
| 11 | REFLECTOR.md no session_read | `assert_not_contains REFLECTOR.md "session_read"` | Old tool reference removed. **Note**: existing test.sh T6 line 216 asserts `session_read` IS present — must update/remove that line |
| 12 | Prompt template has SESSION_FILE | `assert_contains _orch_prompts.py "SESSION_FILE"` | New parameter present |
| 13 | SKILL.md has session_file | `assert_contains SKILL.md "session_file"` | ROUTE passes param |
| 14 | config.py has SESSIONS_DIR | `assert_contains config.py "SESSIONS_DIR"` | New constant present |
| 15 | server.py registers undo | `assert_contains server.py "undo"` | New tool registered |

### Protocol Checks (manual verification)

| # | Acceptance Criterion | Method | Description |
|---|---------------------|--------|-------------|
| 16 | REFLECTOR.md R1b reads file | Manual read | R1b says "Use Read tool to read SESSION_FILE" not "session_read" |
| 17 | REFLECTOR.md validates version | Manual read | Instructions check `version === 1` |
| 18 | REFLECTOR.md handles empty | Manual read | "If SESSION_FILE is empty, output warning and STOP" |
| 19 | SKILL.md PRE-RESOLVE extracts | Manual read | Step 2 includes t_session_search + JSON format + write |
| 20 | SKILL.md Bridge fallback | Manual read | "If aristotle_fire_o fails → fall through to task()" |

---

## Edge Cases & Error Paths

| Case | Test | Expected |
|------|------|----------|
| session_file path with spaces | UT-2 with path `/tmp/my session/snap.json` | Prompt contains exact path |
| t_session_search unavailable | SKILL.md instruction (manual) | session_file="" → Reflector STOPs gracefully |
| Snapshot JSON invalid (Phase 0 LLM) | SKILL.md instruction (manual) | Validation step deletes bad file, session_file="" |
| Snapshot file deleted between extract and read | REFLECTOR.md instruction (manual) | "File not found" → STOP |
| Snapshot version ≠ 1 | REFLECTOR.md instruction (manual) | "Incompatible snapshot version" → STOP |
| on_undo called twice on same workflow | UT-10b | Second call still works, status stays "undone" |
| .bridge-active marker stale | SKILL.md fallback (manual) | aristotle_fire_o fails → task() blocking path |

---

## Test Data

- **Workflow fixtures**: Use existing `_save_workflow` / `_load_workflow` pattern from `_orch_state.py`
- **Marker file**: Create `.bridge-active` in temp dir for UT-5, verify cleanup doesn't affect tests
- **Snapshot path**: UT-1 uses `monkeypatch.setattr(Path, "home", lambda: tmp_path)` for isolation（`resolve_sessions_dir` 直接读 `Path.home()`，无 env var 覆盖）
- **Reflector prompt**: Call `_build_reflector_prompt` directly, assert string contains expected substrings

---

## Dependencies Between Tests

- UT-5/6 depend on `resolve_sessions_dir` existing as code (compile-time), but not on UT-1 passing
- UT-4 needs `_build_reflector_prompt` changes → depends on UT-2/3
- UT-7-10 need `_tools_undo.py` → independent of UT-1-6
- All tests can run in parallel (no shared state)

## Migration Note

test.sh line 216 (`assert_contains REFLECTOR.md "session_read"`) must be updated/removed when REFLECTOR.md changes. This is a known conflict — the new SC-11 replaces it.

---

## Open Questions

- None. All test infrastructure exists (pytest + test.sh patterns established).
