# 模块 2a: Review confirm action

> 验收标准覆盖: A5（Review 跨 session）

---

### TC-2-01: confirm — staging 规则 commit + state 更新 + notify

- **测试函数名**: `test_confirm_commits_staging_rules`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. `_start_review_workflow(sequence=1)` 返回 `workflow_id`
  3. 至少 1 条 staging 状态规则关联到 `target_session_id="ses_test123"`
- **输入**:
  - `orchestrate_review_action(workflow_id, "confirm")`
- **预期输出**:
  - `{action: "notify", message: "✅ Review confirmed. N rules committed."}`
  - staging 规则状态变为 `verified`
  - review workflow `phase="done"`
- **断言**:
  ```python
  # Setup: 创建 staging 规则
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  
  result = orchestrate_review_action(wf_id, "confirm")
  
  assert result["action"] == "notify"
  assert "committed" in result["message"].lower()
  assert "confirmed" in result["message"].lower()
  
  # 规则已 commit（status=verified）
  from aristotle_mcp.frontmatter import read_frontmatter_raw
  fm = read_frontmatter_raw(Path(rule_path))
  assert fm.get("status") == "verified"
  
  # workflow done
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "done"
  
  # state record 更新
  from aristotle_mcp.config import resolve_repo_dir
  state_path = resolve_repo_dir().parent / "aristotle-state.json"
  records = json.loads(state_path.read_text(encoding="utf-8"))
  assert records[0]["status"] == "auto_committed"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → done

---

### TC-2-02: confirm 无 staging 规则 — "0 rules committed"

- **测试函数名**: `test_confirm_no_staging_rules`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动
  3. 无 staging 规则（所有规则已 verified 或无关联规则）
- **输入**:
  - `orchestrate_review_action(workflow_id, "confirm")`
- **预期输出**:
  - `{action: "notify", message: "✅ Review confirmed. 0 rules committed."}`
- **断言**:
  ```python
  review_result = _start_review_workflow(1)
  wf_id = review_result["workflow_id"]
  
  result = orchestrate_review_action(wf_id, "confirm")
  
  assert result["action"] == "notify"
  assert "0 rules committed" in result["message"]
  assert "confirmed" in result["message"].lower()
  
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "done"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → done
