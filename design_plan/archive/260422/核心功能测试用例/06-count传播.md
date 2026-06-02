# 模块 3: re_reflect_count 跨 workflow 传播（R4 修复）

> 验收标准覆盖: A4, A5
> 产品方案引用: §3.2.3.2 re_reflect 循环防护、R4-FIX

---

### TC-3-01: 单次 re_reflect — count 0→1，新 reflect workflow 继承 count

- **测试函数名**: `test_re_reflect_count_increments_to_new_workflow`
- **所属类**: `TestReReflectCountPropagation`
- **前置条件**:
  1. `tmp_repo` 生效
  2. review workflow 已启动（`re_reflect_count=0`）
- **输入**:
  - Step 1: `orchestrate_review_action(wf_id, "re_reflect")`
  - Step 2: 模拟 R done → `orchestrate_on_event("subagent_done", {new_wf_id, session_id: "ses_r2"})`
- **预期输出**:
  - Step 1: 新 workflow `re_reflect_count=1`
  - Step 2: `aristotle-state.json` 最新 record 含 `re_reflect_count=1`
- **断言**:
  ```python
  # Step 1: re_reflect from review
  review_result = _start_review_workflow(1)
  wf_id = review_result["workflow_id"]
  
  re_result = orchestrate_review_action(wf_id, "re_reflect")
  new_wf_id = re_result["workflow_id"]
  
  wf_new = _load_workflow(new_wf_id)
  assert wf_new["re_reflect_count"] == 1
  
  # Step 2: R done → record 创建 + count 传播
  r_done = _fire_r_done_event(new_wf_id, "ses_r2")
  
  # Verify count propagated to state record
  from aristotle_mcp.config import resolve_repo_dir
  state_path = resolve_repo_dir().parent / "aristotle-state.json"
  records = json.loads(state_path.read_text(encoding="utf-8"))
  latest_record = records[-1]
  assert latest_record["re_reflect_count"] == 1
  
  # Verify R done triggered C
  assert r_done["action"] == "fire_sub"
  assert r_done["sub_role"] == "C"
  
  # Step 3: C done
  c_done = _fire_c_done_event(new_wf_id, "Committed: 1, Staged: 0")
  assert c_done["action"] == "notify"
  
  # Step 4: 新 review 启动时继承 count
  review2_result = orchestrate_start("review", json.dumps({"sequence": 2}))
  wf2 = _load_workflow(review2_result["workflow_id"])
  assert wf2["re_reflect_count"] == 1  # 继承自 record
  ```
- **覆盖的验收标准**: A4, A5
- **状态机路径**: review→done(原), reflecting→checking→done(新), review(新)

---

### TC-3-02: 反复 re_reflect — count 1→2→3→error

- **测试函数名**: `test_re_reflect_count_cascades_to_max`
- **所属类**: `TestReReflectCountPropagation`
- **前置条件**:
  1. `tmp_repo` 生效
  2. 第 1 轮 review 完成 re_reflect（count=1）
  3. 模拟第 2 轮 reflect 完成，启动第 2 轮 review
- **输入**:
  - Round 2: `orchestrate_review_action(wf2_id, "re_reflect")`（count 应为 1→2）
  - Round 3: 模拟 reflect 完成，启动第 3 轮 review
  - Round 4: `orchestrate_review_action(wf3_id, "re_reflect")`（count=3→阻止）
- **预期输出**:
  - Round 2: 新 workflow `re_reflect_count=2`
  - Round 3: 新 workflow `re_reflect_count=3`
  - Round 4: `"Max re-reflect (3) reached"`
- **断言**:
  ```python
  # === Round 1: review → re_reflect (count 0→1) ===
  review1 = _start_review_workflow(1)
  wf1_id = review1["workflow_id"]
  rr1 = orchestrate_review_action(wf1_id, "re_reflect")
  assert rr1["action"] == "fire_sub"
  new_wf1_id = rr1["workflow_id"]
  
  # Verify count=1 in new workflow
  wf_r1 = _load_workflow(new_wf1_id)
  assert wf_r1["re_reflect_count"] == 1
  
  # Simulate R+C done for round 1 reflect
  _fire_r_done_event(new_wf1_id, "ses_r_round1")
  _fire_c_done_event(new_wf1_id, "Committed: 1, Staged: 0")
  
  # === Round 2: new review → re_reflect (count 1→2) ===
  review2 = orchestrate_start("review", json.dumps({"sequence": 2}))
  wf2_id = review2["workflow_id"]
  wf2 = _load_workflow(wf2_id)
  assert wf2["re_reflect_count"] == 1  # inherited from record
  
  rr2 = orchestrate_review_action(wf2_id, "re_reflect")
  assert rr2["action"] == "fire_sub"
  assert "#2/3" in rr2["notify_message"]
  new_wf2_id = rr2["workflow_id"]
  
  wf_r2 = _load_workflow(new_wf2_id)
  assert wf_r2["re_reflect_count"] == 2
  
  # Simulate R+C done for round 2 reflect
  _fire_r_done_event(new_wf2_id, "ses_r_round2")
  _fire_c_done_event(new_wf2_id, "Committed: 0, Staged: 0")
  
  # === Round 3: new review → re_reflect (count 2→3) ===
  review3 = orchestrate_start("review", json.dumps({"sequence": 3}))
  wf3_id = review3["workflow_id"]
  wf3 = _load_workflow(wf3_id)
  assert wf3["re_reflect_count"] == 2  # inherited
  
  rr3 = orchestrate_review_action(wf3_id, "re_reflect")
  assert rr3["action"] == "fire_sub"
  assert "#3/3" in rr3["notify_message"]
  new_wf3_id = rr3["workflow_id"]
  
  wf_r3 = _load_workflow(new_wf3_id)
  assert wf_r3["re_reflect_count"] == 3
  
  # Simulate R+C done for round 3
  _fire_r_done_event(new_wf3_id, "ses_r_round3")
  _fire_c_done_event(new_wf3_id, "Committed: 0, Staged: 0")
  
  # === Round 4: new review → re_reflect BLOCKED (count=3) ===
  review4 = orchestrate_start("review", json.dumps({"sequence": 4}))
  wf4_id = review4["workflow_id"]
  wf4 = _load_workflow(wf4_id)
  assert wf4["re_reflect_count"] == 3
  
  rr4 = orchestrate_review_action(wf4_id, "re_reflect")
  assert rr4["action"] == "notify"
  assert "Max re-reflect" in rr4["message"]
  assert "3" in rr4["message"]
  ```
- **覆盖的验收标准**: A4, A5
- **状态机路径**: review→reflecting→checking→done→review (×3) → review（被阻止）

---

### TC-3-03: re_reflect_count 从 reflection record 继承到新 review workflow

- **测试函数名**: `test_re_reflect_count_inherited_from_record`
- **所属类**: `TestReReflectCountPropagation`
- **前置条件**:
  1. `tmp_repo` 生效
  2. `aristotle-state.json` 中第 2 条 record 含 `re_reflect_count=2`（模拟经过 2 次 re_reflect）
- **输入**:
  - `orchestrate_start("review", {"sequence": 2})`
- **预期输出**:
  - review workflow 的 `re_reflect_count=2`（从 record 继承）
- **断言**:
  ```python
  init_repo_tool()
  from aristotle_mcp.config import resolve_repo_dir
  state_path = resolve_repo_dir().parent / "aristotle-state.json"
  state_path.parent.mkdir(parents=True, exist_ok=True)
  records = [
      {
          "id": "rec_1",
          "status": "auto_committed",
          "target_label": "current",
          "target_session_id": "ses_1",
          "rules_count": 1,
          "launched_at": "2026-04-22T10:00:00+08:00",
          "draft_file_path": str(resolve_repo_dir().parent / "aristotle-drafts" / "rec_1.md"),
      },
      {
          "id": "rec_2",
          "status": "auto_committed",
          "target_label": "current",
          "target_session_id": "ses_1",
          "rules_count": 0,
          "launched_at": "2026-04-22T11:00:00+08:00",
          "draft_file_path": str(resolve_repo_dir().parent / "aristotle-drafts" / "rec_2.md"),
          "re_reflect_count": 2,
      },
  ]
  state_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
  
  _create_draft_file(2, "## DRAFT for re_reflect test")
  
  result = orchestrate_start("review", json.dumps({"sequence": 2}))
  wf_id = result["workflow_id"]
  
  wf = _load_workflow(wf_id)
  assert wf["re_reflect_count"] == 2  # 从 record 继承
  assert wf["phase"] == "review"
  
  # 进一步 re_reflect 应该 count=2→3（仍有 1 次机会）
  rr = orchestrate_review_action(wf_id, "re_reflect")
  assert rr["action"] == "fire_sub"
  new_wf = _load_workflow(rr["workflow_id"])
  assert new_wf["re_reflect_count"] == 3
  ```
- **覆盖的验收标准**: A4, A5
- **状态机路径**: review(继承 count=2) → re_reflect → 新 reflecting(count=3)

---

### TC-3-04: re_reflect_count=0 时不写入 record（默认行为）

- **测试函数名**: `test_re_reflect_count_zero_not_written_to_record`
- **所属类**: `TestReReflectCountPropagation`
- **前置条件**:
  1. `tmp_repo` 生效
  2. 首次 reflect（无 re_reflect）
- **输入**:
  - 启动 reflect → R done（`re_reflect_count` 未设置或为 0）
- **预期输出**:
  - `aristotle-state.json` 新 record 不含 `re_reflect_count` 字段（或值为 0）
- **断言**:
  ```python
  start = _start_reflect_workflow("ses_first")
  wf_id = start["workflow_id"]
  
  # R done (re_reflect_count=0 by default)
  _fire_r_done_event(wf_id, "ses_r_first")
  
  from aristotle_mcp.config import resolve_repo_dir
  state_path = resolve_repo_dir().parent / "aristotle-state.json"
  records = json.loads(state_path.read_text(encoding="utf-8"))
  
  latest = records[-1]
  assert latest.get("re_reflect_count", 0) == 0
  
  # 确认未写入非零值
  assert latest.get("re_reflect_count") is None or latest["re_reflect_count"] == 0
  ```
- **覆盖的验收标准**: A4
- **状态机路径**: reflecting → checking（count=0，不传播）
