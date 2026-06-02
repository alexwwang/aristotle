# Coroutine-O Merge Task Context

**Created**: 2026-04-22
**Branch**: test-coverage → merge coroutine-O → develop
**Status**: In Progress

---

## 1. Branch State

| Branch | Location | HEAD | server.py lines | MCP tools |
|--------|----------|------|-----------------|-----------|
| test-coverage | /Users/alex/aristotle | 7f9419b | 999 | 14 |
| coroutine-O | /Users/alex/aristotle-coroutine-o (worktree) | 3209333 | 1224 | 16 |

**Common ancestor**: `96eed0d` (fix: resolve all 8 user-reported issues)

### coroutine-O commits since fork (5 commits):
```
3209333 fix: SKILL.md conditional ROUTE + MCP result type safety + test assertion hardening
344c3aa fix: SKILL.md ACTIONS → conditional branch format + live-test grep -iqE
4b803f2 docs: add Layer 4 test reflection + SKILL.md notify fix
997329e feat: Layer 4 live test + dispatcher suppression guard
7ff2f41 feat: coroutine-O MVP — orchestration tools, dispatcher, and tests
```

**Working trees**: clean on both branches (no uncommitted changes)

---

## 2. What coroutine-O Adds (Purely Additive)

### 2.1 server.py Changes (appended after line 982)
- **2 new MCP tools**: `orchestrate_start(command, args_json)`, `orchestrate_on_event(event_type, data_json)`
- **5 helper functions**: `_workflow_dir()`, `_save_workflow()`, `_load_workflow()`, `_build_intent_extraction_prompt()`, `_do_search_and_notify()`
- **1 prompt template**: `O_INTENT_PROMPT`
- **New imports**: `json`, `uuid`
- **Location**: All new code is in lines 986-1224 (after `_rejected_dir_for`)

### 2.2 config.py Changes (2 lines added)
- `WORKFLOW_DIR_NAME = ".workflows"` (after line 55)
- `.workflows/` added to gitignore pattern (after line 59)

### 2.3 SKILL.md (REPLACEMENT — 39 lines vs 76 lines)
New 39-line dispatcher handles 2 routes:
- `/aristotle learn <query>` → MCP `orchestrate_start()`
- `/aristotle [anything else]` → MANDATORY load REFLECT.md

**MISSING from MVP SKILL.md (must add back)**:
- `/aristotle sessions` route
- `/aristotle review N` route
- `--model` / `--focus` parameter parsing

### 2.4 New Files
- `test/test_orchestration.py` (409 lines, ~34 tests)
- `test/live-test-orchestration.sh` (367 lines)
- `test/seed-test-rules.sh` (99 lines)

### 2.5 test.sh Extensions (+27 lines)
- T-ORCH-01 through T-ORCH-05 sections (16+ new assertions)

### 2.6 Files UNCHANGED between branches
- LEARN.md, REFLECT.md, REVIEW.md, CHECKER.md, REFLECTOR.md, GEAR.md — identical
- `persist_draft`, `create_reflection_record`, `complete_reflection_record` — byte-identical

---

## 3. Merge Strategy

### Conflicts Expected: SKILL.md ONLY
All other files are additive or identical. `git merge coroutine-O` should apply cleanly except SKILL.md.

### Merge Steps:
1. `git merge --no-commit coroutine-O`
2. Resolve SKILL.md manually (extend 39-line MVP to handle all 4 routes)
3. Update test.sh static assertions for new SKILL.md format
4. Run `uv run pytest test/test_mcp.py test/test_orchestration.py -v`
5. Run `bash test.sh`
6. Update README test count badges
7. Commit

### SKILL.md Target Design (merged version ~45 lines):
- learn route → MCP orchestration (from coroutine-O)
- reflect route → load REFLECT.md (from coroutine-O)
- review N route → load REVIEW.md (restored from test-coverage)
- sessions route → format and display state file (restored from test-coverage)
- Keep CRITICAL rules from coroutine-O (no protocol term leakage)

---

## 4. Test Plan Overview

### 4.1 Existing Tests (must continue passing)
- `test_mcp.py`: 1927 lines, 10 test classes, 134 assertions
- `test.sh`: ~259 lines, 67 static assertions
- `test/live-test.sh`: 8 E2E assertions

### 4.2 New Tests from coroutine-O Merge
- `test_orchestration.py`: 409 lines, ~34 tests
  - TestOrchestrateStart: 6 tests
  - TestOrchestrateOnEvent: 5 tests
  - TestWorkflowStateManagement: 4 tests
  - TestIntegrationMockO: 5 tests (end-to-end with mocked O)
  - Plus ~14 additional tests
- test.sh T-ORCH extensions: ~16 assertions
- live-test-orchestration.sh: 15 assertions (manual/live only)

### 4.3 Post-Merge Target Numbers
- pytest: 134 + 29 = ~163 tests
- static: 67 + 16 = ~83 assertions
- Total: ~246 automated + 15 live

### 4.4 Future Tests (NOT in this merge, from design_plan)
- LEARN tests: 43 (18 unit + 18 static + 7 E2E)
- Supplementary tests: 51 (CHECKER 17, Focus 12, State 14, Install 9)
- These are tracked in design_plan/ but NOT part of the coroutine-O merge

---

## 5. GEAR Protocol Alignment

### 8 Protocol Operations → All Mapped
| Operation | MCP Tool | Status |
|-----------|----------|--------|
| init | init_repo_tool | ✅ |
| produce | write_rule | ✅ |
| search | read_rules | ✅ |
| stage | stage_rule | ✅ |
| verify | commit_rule | ✅ |
| reject | reject_rule | ✅ |
| restore | restore_rule | ✅ |
| list | list_rules | ✅ |

### Orchestration Tools = O Coordination Layer (above GEAR)
- `orchestrate_start`: O decides what action to take
- `orchestrate_on_event`: O processes subagent results
- These implement the O workflow state machine, not GEAR operations

---

## 6. Key Design Decisions (from design_plan/)

### 6.1 Function-Call-O Architecture (Coroutine-O 架构方案_260421.md)
- O is NOT a coroutine — it's a function call
- MCP state machine is the real coordinator
- Main session is notification hub + action executor (cannot be eliminated)
- O subagent is stateless (each call is independent)

### 6.2 MVP Scope (Coroutine-O MVP 技术方案_260421.md)
- Learn flow intent extraction only
- No S Round 2 (scoring subagents)
- No result compression
- Reflect/Review not via MCP orchestration
- Reflect uses existing REFLECT.md protocol

### 6.3 Test Layer Structure
- Layer 1: MCP Unit Tests (pytest, no LLM)
- Layer 2: SKILL.md Static Tests (test.sh)
- Layer 3: Integration Tests (pytest, mock O)
- Layer 4: Live Tests (requires OpenCode session)

### 6.4 MVP Verification Results (14/15 PASS, 93%)
- S1 (fire_o): 5/5 ✅
- S2 (explicit params): 3/3 ✅
- S3 (context cleanliness): 1/2 ⚠️ (S3-P1 known limitation, downgraded)
- S4 (workflow state): 3/3 ✅
- S5 (reflect routing): 2/2 ✅

---

## 7. File Inventory for Merge

### Must Merge (from coroutine-O):
| File | Action | Risk |
|------|--------|------|
| aristotle_mcp/server.py | Add lines 986-1224 (orchestration code) | Low (additive) |
| aristotle_mcp/config.py | Add 2 lines | Low (additive) |
| SKILL.md | Replace with extended version | **HIGH** (manual resolution) |
| test/test_orchestration.py | New file | Low |
| test/live-test-orchestration.sh | New file | Low |
| test/seed-test-rules.sh | New file | Low |
| test.sh | Merge T-ORCH additions | Medium (assertion conflicts) |

### Must NOT Merge (test-coverage is newer):
| File | Reason |
|------|--------|
| README.md | test-coverage has updated badges |
| test/test_mcp.py | Identical, no need to merge |

### Must NOT Touch (identical):
| File | Reason |
|------|--------|
| LEARN.md | Identical |
| REFLECT.md | Identical |
| REVIEW.md | Identical |
| CHECKER.md | Identical |
| REFLECTOR.md | Identical |
| GEAR.md | Identical |
| install.sh | Identical |
| install.ps1 | Identical |

---

## 8. Acceptance Criteria

### Automated (CI-verifiable):
1. `uv run pytest test/test_mcp.py test/test_orchestration.py -v` → 163 passed, 0 failed
2. `bash test.sh` → 0 failures (~83 assertions)
3. `uv run python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools))"` → prints "16"
4. SKILL.md handles all 4 routes: learn, reflect, review, sessions

### Manual (post-merge verification):
5. Live test S1-S5 (if OpenCode session available)

---

## 9. Development Log Location
- `/Users/alex/aristotle/.sisyphus/plans/coroutine-o-devlog.md`

---

## 10. Coroutine-O server.py New Code (for reference)

### Imports added:
```python
import json
import uuid
from config import WORKFLOW_DIR_NAME
```

### orchestrate_start signature:
```python
@mcp.tool()
def orchestrate_start(command: str, args_json: str = "{}") -> dict:
```

### orchestrate_on_event signature:
```python
@mcp.tool()
def orchestrate_on_event(event_type: str, data_json: str) -> dict:
```

### Helper signatures:
```python
def _workflow_dir() -> Path:
def _save_workflow(workflow_id: str, state: dict) -> None:
def _load_workflow(workflow_id: str) -> dict | None:
def _build_intent_extraction_prompt(query: str) -> str:
def _do_search_and_notify(workflow_id: str) -> dict:
```

### config.py additions:
```python
WORKFLOW_DIR_NAME = ".workflows"
# In gitignore pattern: ".workflows/"
```
