# 模块 2c: Review revise action

> 验收标准覆盖: A5（Review 跨 session）

---

### TC-2-04: revise — fire_o 返回含 REVISE 模板的 prompt

- **测试函数名**: `test_revise_fires_o_with_revise_prompt`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动，`displayed_rules` 不为空
  3. 规则文件存在于磁盘
- **输入**:
  - `orchestrate_review_action(workflow_id, "revise", feedback="Remove the hallucinated API call", data_json='{"rule_index": 1}')`
- **预期输出**:
  - `{action: "fire_o", workflow_id: wf_id, o_prompt: "..."}`
  - `o_prompt` 包含 `ORIGINAL RULE FILE`、`USER FEEDBACK`、`DRAFT CONTEXT` 段落
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  rule_path = _make_staging_rule("HALLUCINATION", source_session="ses_test123")
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  
  # Verify displayed_rules not empty
  wf = _load_workflow(wf_id)
  assert len(wf["displayed_rules"]) > 0
  
  result = orchestrate_review_action(
      wf_id, "revise",
      feedback="Remove the hallucinated API call",
      data_json=json.dumps({"rule_index": 1}),
  )
  
  assert result["action"] == "fire_o"
  assert "o_prompt" in result
  assert "ORIGINAL RULE FILE" in result["o_prompt"]
  assert "USER FEEDBACK" in result["o_prompt"]
  assert "Remove the hallucinated API call" in result["o_prompt"]
  assert result["workflow_id"] == wf_id
  
  # workflow state 更新 pending_role
  wf = _load_workflow(wf_id)
  assert wf["pending_role"] == "O"
  assert wf.get("revise_rule_path") is not None
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → review（等待 o_done）

---

### TC-2-05: revise rule_index 解析 — displayed_rules[index]→rule_path

- **测试函数名**: `test_revise_rule_index_resolved_correctly`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动，`displayed_rules` 有 3 条规则
  3. 规则文件存在于磁盘
- **输入**:
  - `orchestrate_review_action(workflow_id, "revise", feedback="fix", data_json='{"rule_index": 2}')`
- **预期输出**:
  - `o_prompt` 引用 `displayed_rules[1]`（第 2 条规则，0-indexed）的路径
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  paths = []
  for i in range(3):
      p = _make_staging_rule(f"CAT_{i}", source_session="ses_test123")
      paths.append(p)
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  wf = _load_workflow(wf_id)
  
  # revise rule #2 (index 1)
  result = orchestrate_review_action(
      wf_id, "revise", feedback="fix",
      data_json=json.dumps({"rule_index": 2}),
  )
  
  assert result["action"] == "fire_o"
  displayed = wf["displayed_rules"]
  target_path = displayed[1] if len(displayed) > 1 else displayed[0]
  assert target_path in result["o_prompt"]
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → review

---

### TC-2-06: revise O 输出解析失败 — "Could not parse"

- **测试函数名**: `test_revise_o_done_parse_failure`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 处于 `phase=review`、`pending_role=O`（revise 后）
- **输入**:
  - `orchestrate_on_event("o_done", {workflow_id, result: "I cannot revise this rule because..."})`
- **预期输出**:
  - `{action: "notify", message: "⚠️ Could not parse revised rule from output."}`
  - workflow `phase="done"`
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  _make_staging_rule("HALLUCINATION", source_session="ses_test123")
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  
  # Fire revise
  revise_result = orchestrate_review_action(
      wf_id, "revise", feedback="fix it",
      data_json=json.dumps({"rule_index": 1}),
  )
  assert revise_result["action"] == "fire_o"
  
  # O returns unparseable output
  o_done = orchestrate_on_event("o_done", json.dumps({
      "workflow_id": wf_id,
      "result": "I cannot revise this rule because it's too complex.",
  }))
  
  assert o_done["action"] == "notify"
  assert "Could not parse" in o_done["message"]
  
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "done"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → done（解析失败）

---

### TC-2-07: revise O 成功 — write_rule + stage_rule + auto-commit

- **测试函数名**: `test_revise_o_done_auto_commits`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 处于 `phase=review`、`pending_role=O`
  3. 被修订的规则文件存在于磁盘，confidence 足够高触发 auto audit
- **输入**:
  - `orchestrate_on_event("o_done", {workflow_id, result: "FILE: <rule_path>\n---\nstatus: staging\n...\n---\n## Revised rule content"})`
- **预期输出**:
  - `{action: "notify", message: "✅ Rule revised and auto-committed: <rule_path>"}`
  - 规则文件内容更新
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  rule_path = _make_staging_rule("PATTERN_VIOLATION", confidence=0.9, source_session="ses_test123")
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  
  # Fire revise
  orchestrate_review_action(wf_id, "revise", feedback="improve",
                            data_json=json.dumps({"rule_index": 1}))
  
  # O returns valid revised rule
  revised_content = f"""FILE: {rule_path}
---
id: "rec_test"
status: "staging"
scope: "user"
category: "PATTERN_VIOLATION"
confidence: 0.9
risk_level: "low"
created_at: "2026-04-22T10:00:00+08:00"
---
## Revised Rule
**Rule**: Improved pattern check"""
  
  o_done = orchestrate_on_event("o_done", json.dumps({
      "workflow_id": wf_id,
      "result": revised_content,
  }))
  
  assert o_done["action"] == "notify"
  assert "revised" in o_done["message"].lower()
  
  # 规则文件内容已更新
  from pathlib import Path
  updated_content = Path(rule_path).read_text(encoding="utf-8")
  assert "Improved pattern check" in updated_content
  
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "done"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → done（auto-commit）

---

### TC-2-10: displayed_rules 为空时 revise 错误处理

- **测试函数名**: `test_revise_no_rules_available`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动，但 `displayed_rules=[]`（无关联规则）
- **输入**:
  - `orchestrate_review_action(workflow_id, "revise", feedback="fix it", data_json='{"rule_index": 1}')`
- **预期输出**:
  - `{action: "notify", message: "🦉 No rules available to revise."}`
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  
  wf = _load_workflow(wf_id)
  assert wf["displayed_rules"] == []
  
  result = orchestrate_review_action(
      wf_id, "revise", feedback="fix it",
      data_json=json.dumps({"rule_index": 1}),
  )
  
  assert result["action"] == "notify"
  assert "No rules" in result["message"]
  
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "review"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review（不转换）

---

### TC-2-11: revise rule_index 越界错误

- **测试函数名**: `test_revise_invalid_rule_index`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 有 2 条 `displayed_rules`
- **输入**:
  - `orchestrate_review_action(workflow_id, "revise", feedback="fix", data_json='{"rule_index": 5}')`
- **预期输出**:
  - `{action: "notify", message: "🦉 Invalid rule index. Choose 1-2."}`
- **断言**:
  ```python
  init_repo_tool()
  _setup_reflection_record(1)
  _create_draft_file(1)
  paths = [_make_staging_rule(f"CAT_{i}", source_session="ses_test123") for i in range(2)]
  
  review_result = orchestrate_start("review", json.dumps({"sequence": 1}))
  wf_id = review_result["workflow_id"]
  wf = _load_workflow(wf_id)
  n_rules = len(wf["displayed_rules"])
  assert n_rules > 0
  
  result = orchestrate_review_action(
      wf_id, "revise", feedback="fix",
      data_json=json.dumps({"rule_index": n_rules + 5}),
  )
  
  assert result["action"] == "notify"
  assert "Invalid rule index" in result["message"]
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review（不转换）
