# 技术方案 M1 补丁: committed_rule_paths 优化

**日期:** 2026-04-22
**前置文档:** GEAR Phase 2 产品方案_260422.md §七
**范围:** `_orch_event.py` + `_orch_review.py`
**不涉及:** M5-M9 新功能代码、测试代码

---

## 一、模块概述

产品方案 §3.2.3 设计了 `committed_rule_paths` 字段，用于 review confirm 时直接定位 staging 规则路径，避免不精确的 keyword 搜索。当前代码中此字段为死代码——workflow state 从未写入此值，confirm 操作始终走 keyword fallback。

### 变更统计

| 文件 | 行数 | 性质 |
|------|------|------|
| `_orch_event.py` | +~12 行 | checking 完成后收集规则路径 |
| `_orch_review.py` | +~12 行 | confirm 优先使用 committed_rule_paths |

---

## 二、问题分析

### 当前 confirm 路径（`_orch_review.py:41-54`）

```python
if action == "confirm":
    target_session = workflow.get("target_session_id", "")
    rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)
    for r in rules_result.get("rules", []):
        meta = r.get("metadata", {})
        if meta.get("status") == "staging":
            commit_rule(file_path=r.get("path", ""))
```

**问题：** `keyword=target_session` 做全 frontmatter 正则匹配，命中 `source_session` 字段。但同一 session 可能产生多条规则，且 keyword 匹配精度依赖 regex 引擎行为，不稳定。

### 目标路径

```python
if action == "confirm":
    rule_paths = workflow.get("committed_rule_paths", [])
    if rule_paths:
        # 直接使用 C 创建时记录的路径
        for rp in rule_paths:
            commit_rule(file_path=rp)
    else:
        # 降级为 keyword 搜索（保持现有行为）
        ...
```

---

## 三、文件变更详情

### 3.1 `_orch_event.py` — checking 完成后写入路径

在 `subagent_done + checking` handler 中（当前 L164-187），C 完成后、标记 done 之前，收集 C 创建/操作的规则路径。

**⚠ 数据传播关键：** `committed_rule_paths` 写入的是 **reflect workflow** 的 state 文件。但用户后续运行 `/aristotle review N` 时，`orchestrate_start("review")` 会创建一个**全新的 review workflow**。必须将 `committed_rule_paths` 从 reflect workflow 传递到 review workflow。

**传递方案：** 在 `_orch_start.py` 的 `review` 命令中，查找关联的 reflect workflow 并复制路径。具体做法——在 `aristotle-state.json` 的 reflection record 中存储 `committed_rule_paths`，review 创建时从 record 读取：

**变更位置：** `_orch_event.py` checking handler 完成后，除了写入 workflow state，还需更新 reflection record：

```python
    # ═══ 5. Reflect flow: subagent_done + checking ═══
    if event_type == "subagent_done" and workflow.get("phase") == "checking":
        result = data.get("result", "")
        if isinstance(result, dict):
            result = json.dumps(result)

        committed, staged = _parse_checker_result(str(result))
        sequence = workflow.get("sequence")

        # ── [M1 补丁] 收集 C 创建的规则路径 ──
        target_session = workflow.get("target_session_id", "")
        rules_result = list_rules(
            status_filter="all", keyword=target_session, limit=20,
        )
        rule_paths = []
        for r in rules_result.get("rules", []):
            meta = r.get("metadata", {})
            if (meta.get("status") in ("staging", "verified")
                    and meta.get("source_session") == target_session
                    and r.get("path")):
                rule_paths.append(r["path"])
        # ── [M1 补丁 END] ──

        status = "auto_committed" if staged == 0 else "partial_commit"
        complete_reflection_record(
            sequence=sequence,
            status=status,
            rules_count=committed + staged,
        )

        # ── [M1 补丁] 将路径写入 reflection record，供 review workflow 使用 ──
        _update_record_field(sequence, "committed_rule_paths", rule_paths)

        workflow["phase"] = "done"
        workflow["committed_rule_paths"] = rule_paths  # [M1 补丁]
        _save_workflow(workflow_id, workflow)

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Aristotle done. {committed} rules committed, {staged} staged.\n"
                       f"   Review: /aristotle review {sequence}",
        }
```

**`_update_record_field` 实现：** 在 `_tools_reflection.py` 中新增：

```python
def _update_record_field(sequence: int, field: str, value) -> None:
    """更新 reflection record 的指定字段。"""
    state_path = resolve_repo_dir().parent / "aristotle-state.json"
    if not state_path.exists():
        return
    records = json.loads(state_path.read_text(encoding="utf-8"))
    idx = sequence - 1
    if 0 <= idx < len(records):
        records[idx][field] = value
        state_path.write_text(
            json.dumps(records, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
```

### 3.2 `_orch_start.py` — review workflow 从 record 读取路径

**⚠ 这是数据传播的关键补充：** `orchestrate_start("review")` 在创建 review workflow 时，从 reflection record 中读取 `committed_rule_paths`：

**变更位置：** `_orch_start.py` 的 `review` 分支（L126-187），在 `_save_workflow` 之前：

```python
    elif command == "review":
        # ... 现有验证逻辑 ...

        message = _format_review_output(sequence, target_record, draft_content, rules_result)

        # [M1 补丁] 从 reflection record 继承 committed_rule_paths
        committed_rule_paths = target_record.get("committed_rule_paths", [])

        _save_workflow(workflow_id, {
            "phase": "review",
            "command": "review",
            "sequence": sequence,
            "target_record": target_record,
            "displayed_rules": displayed_rules,
            "target_session_id": target_session,
            "re_reflect_count": target_record.get("re_reflect_count", 0),
            "committed_rule_paths": committed_rule_paths,  # [M1 补丁]
        })
```

### 3.3 `_orch_review.py` — confirm 优先使用路径

**变更位置：** L41-66，替换整个 `if action == "confirm":` 块。

```python
    if action == "confirm":
        target_session = workflow.get("target_session_id", "")
        rule_paths = workflow.get("committed_rule_paths", [])

        committed = 0
        failed = 0

        if rule_paths:
            # [M1 补丁] 优先使用 C 记录的路径
            for rp in rule_paths:
                # 二次校验：只 commit staging 状态的规则
                resolved, _ = _safe_resolve(rp)
                if not resolved or not resolved.exists():
                    failed += 1
                    continue
    fm = read_frontmatter_raw(resolved) or {}
                if fm.get("status") == "staging":
                    try:
                        commit_rule(file_path=rp)
                        committed += 1
                    except Exception:
                        failed += 1
                elif fm.get("status") == "verified":
                    # C 已 auto-commit，无需再次 commit
                    committed += 1
        else:
            # Phase 1 fallback: keyword 搜索
            rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)
            for r in rules_result.get("rules", []):
                meta = r.get("metadata", {})
                if meta.get("status") == "staging":
                    try:
                        commit_rule(file_path=r.get("path", ""))
                        committed += 1
                    except Exception:
                        failed += 1

        complete_reflection_record(sequence=sequence, status="auto_committed",
                                   rules_count=committed or None)

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"✅ Review confirmed. {committed} rules committed."
                       + (f" ⚠️ {failed} failed." if failed else ""),
        }
```

**关键细节：**

1. `committed_rule_paths` 存在时走新路径，不存在时降级为原 keyword 搜索——向后兼容
2. 二次校验 `status == "staging"`：防止 commit 已 verified 的规则（重复 commit 不致命但冗余）
3. `status == "verified"` 时计入 committed 但不调用 commit_rule——C 的 audit decision 已自动 commit
4. `_safe_resolve` + `read_frontmatter_raw` 需要在文件顶部导入（`read_frontmatter_raw` 从 `frontmatter` 模块）

### 3.3 导入变更

`_orch_review.py` 需新增导入：

```python
from aristotle_mcp.frontmatter import read_frontmatter_raw
```

`_orch_event.py` 需确保已有 `list_rules` 导入——检查当前导入：

```python
# _orch_event.py 当前导入（L7-12）
from aristotle_mcp._tools_rules import stage_rule, get_audit_decision, commit_rule
```

需新增：

```python
from aristotle_mcp._tools_rules import stage_rule, get_audit_decision, commit_rule, list_rules
```

---

## 四、数据流

```
R 完成 → C 启动 → C 执行 write_rule + stage_rule/commit_rule
                          │
                          ▼
              subagent_done(phase=checking)
                          │
                   ┌──────┴──────┐
                   │ 收集路径     │ [M1 补丁]
                   │ list_rules   │
                   │ → 路径列表    │
                   └──────┬──────┘
                          │
                   workflow["committed_rule_paths"] = [...]
                   workflow["phase"] = "done"
                          │
                          ▼
              用户: /aristotle review N
                          │
                   review workflow 加载
                   (committed_rule_paths 从 checking 阶段继承)
                          │
                          ▼
              用户: confirm
                          │
                   ┌──────┴──────────┐
                   │ rule_paths 存在? │
                   │     │           │
                   │   Yes          No → keyword fallback
                   │     │
                   │   二次校验 status
                   │   staging → commit
                   │   verified → 跳过
                   └───────────────┘
```

---

## 五、实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | `_orch_event.py` 导入 `list_rules` | 无 |
| 2 | `_orch_event.py` checking handler 插入路径收集 | 步骤 1 |
| 3 | `_orch_review.py` 导入 `read_frontmatter_raw` | 无 |
| 4 | `_orch_review.py` confirm 块替换 | 步骤 3 |
| 5 | pytest 回归验证 | 步骤 2, 4 |

**关键路径：** 步骤 1→2 和 步骤 3→4 可并行。步骤 5 串行在最后。

---

## 六、验证

| # | 验证项 | 方法 |
|---|--------|------|
| V1 | checking 完成后 workflow 包含 `committed_rule_paths` | pytest: 模拟 R→C 完成，检查 workflow state |
| V2 | confirm 使用 `committed_rule_paths` 直接 commit | pytest: 设置 workflow 含路径，验证不调用 list_rules |
| V3 | `committed_rule_paths` 为空时降级为 keyword 搜索 | pytest: 设置 workflow 无路径，验证走 list_rules |
| V4 | verified 规则不被重复 commit | pytest: 路径含 verified 规则，验证 commit_rule 不被调用 |
| V5 | 现有 227 pytest + 98 static 全部通过 | 回归测试 |
