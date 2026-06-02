# 模块 2d: Review re_reflect action

> 验收标准覆盖: A5（Review 跨 session）

---

### TC-2-08: re_reflect — 创建新 workflow + count 递增 + parent 字段

- **测试函数名**: `test_re_reflect_creates_new_workflow`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动（`re_reflect_count=0`）
- **输入**:
  - `orchestrate_review_action(workflow_id, "re_reflect")`
- **预期输出**:
  - `{action: "fire_sub", workflow_id: "wf_<NEW>", sub_role: "R", notify_message: "🦉 Re-reflecting (#1/3)..."}`
  - 新 workflow: `phase=reflecting`, `re_reflect_count=1`, `parent_review_sequence=<原 sequence>`, `parent_workflow_id=<原 wf_id>`
  - 原 review workflow: `phase=done`
- **断言**:
  ```python
  review_result = _start_review_workflow(1)
  wf_id = review_result["workflow_id"]
  
  result = orchestrate_review_action(wf_id, "re_reflect")
  
  assert result["action"] == "fire_sub"
  assert result["sub_role"] == "R"
  new_wf_id = result["workflow_id"]
  assert new_wf_id != wf_id  # 新 workflow_id
  assert "Re-reflecting" in result["notify_message"]
  assert "#1/3" in result["notify_message"]
  
  # 原 review workflow done
  wf_old = _load_workflow(wf_id)
  assert wf_old["phase"] == "done"
  
  # 新 workflow 状态
  wf_new = _load_workflow(new_wf_id)
  assert wf_new["phase"] == "reflecting"
  assert wf_new["command"] == "reflect"
  assert wf_new["re_reflect_count"] == 1
  assert wf_new["parent_review_sequence"] == 1
  assert wf_new["parent_workflow_id"] == wf_id
  assert wf_new["pending_role"] == "R"
  assert wf_new["record_created"] is False
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review → done（原）, 新 reflecting workflow 启动

---

### TC-2-09: re_reflect max count=3 — 阻止进一步 re_reflect

- **测试函数名**: `test_re_reflect_max_count_blocked`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动且 `re_reflect_count=3`（从 record 继承）
- **输入**:
  - `orchestrate_review_action(workflow_id, "re_reflect")`
- **预期输出**:
  - `{action: "notify", message: "🦉 Max re-reflect (3) reached. Use /aristotle to start fresh."}`
- **断言**:
  ```python
  review_result = _start_review_workflow(1, re_reflect_count=3)
  wf_id = review_result["workflow_id"]
  
  # Verify workflow inherited count
  wf = _load_workflow(wf_id)
  assert wf["re_reflect_count"] == 3
  
  result = orchestrate_review_action(wf_id, "re_reflect")
  
  assert result["action"] == "notify"
  assert "Max re-reflect" in result["message"]
  assert "3" in result["message"]
  
  # workflow 仍为 review（未变成 done）
  wf = _load_workflow(wf_id)
  assert wf["phase"] == "review"
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: review（被阻止，不转换）

---

### TC-2-12: workflow 不在 review phase 时拒绝 action

- **测试函数名**: `test_review_action_wrong_phase`
- **所属类**: `TestOrchestrateReviewAction`
- **前置条件**:
  1. `tmp_repo` 生效
  2. reflect workflow 处于 `phase=reflecting`（非 review）
- **输入**:
  - `orchestrate_review_action(wf_id, "confirm")`
- **预期输出**:
  - `{action: "notify", message: "🦉 Workflow not in review phase (current: reflecting)."}`
- **断言**:
  ```python
  start = _start_reflect_workflow("ses_tgt")
  wf_id = start["workflow_id"]
  
  result = orchestrate_review_action(wf_id, "confirm")
  
  assert result["action"] == "notify"
  assert "not in review" in result["message"].lower()
  ```
- **覆盖的验收标准**: A5
- **状态机路径**: 无（被拒绝）
