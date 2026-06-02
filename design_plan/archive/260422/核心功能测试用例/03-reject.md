# 模块 2b: Review reject action

> 验收标准覆盖: A5（Review 跨 session）

---

### TC-2-03: reject — reject_rule 调用 + state status 更新为 rejected

- **测试函数名**: `test_reject_rejects_rules_and_updates_state`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动
  3. 至少 1 条 staging 规则关联到 target
- **输入**:
  - `orchestrate_review_action(workflow_id, "reject")`
- **预期输出**:
  - `{action: "notify", message: "❌ Reflection #1 rejected. N rules removed."}`
  - 规则移至 `rejected/` 目录
  - state record status 更新为 `rejected`
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  rule_path = _make_staging_rule("PATTERN_VIOLATION", source_session="ses_test123")
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  
  result = orchestrate_review_action(wf_id, "reject")
  
  assert result["action"] == "notify"
  assert "rejected" in result["message"].lower()
  assert "#1" in result["message"]
  
  # 规则文件移至 rejected/ 且原路径不存在
  from aristotle_mcp.config import resolve_repo_dir
  rejected_path = resolve_repo_dir() / "rejected" / "user" / Path(rule_path).name
  assert rejected_path.exists() and not Path(rule_path).exists()
  
  # workflow done
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "done"
  
  # state record rejected
  state_path = resolve_repo_dir().parent / "aristotle-state.json"
  records = json.loads(state_path.read_text(encoding="utf-8"))
  assert records[0]["status"] == "rejected"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → done
