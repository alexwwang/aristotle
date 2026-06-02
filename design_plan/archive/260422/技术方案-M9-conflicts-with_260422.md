# 技术方案 M9: conflicts_with 检测

**日期:** 2026-04-22
**前置文档:** GEAR Phase 2 产品方案_260422.md §六
**范围:** `_tools_rules.py` + `_orch_event.py` + SKILL.md
**不涉及:** M6 feedback 闭环、M7 Δ log-norm、LLM 语义冲突检测（Phase 3）、测试代码

---

## 一、模块概述

M9 实现基于 metadata 的静态冲突检测。在 C 完成 `commit_rule` 之后（post-commit），检查新规则与现有 verified 规则是否存在 `domain + task_goal + failed_skill` 三元组重复。检测到冲突时写入 `conflicts_with` 字段并通知用户。

### 变更统计

| 文件 | 行数 | 性质 |
|------|------|------|
| `_tools_rules.py` | +~40 行 | 新增 `detect_conflicts` 函数 + `commit_rule` 后置调用 |
| `_orch_event.py` | +~15 行 | checking 完成后检查冲突、返回冲突通知 |
| `SKILL.md` | +~2 行 | review 展示冲突标注 |

---

## 二、冲突检测设计

### 2.1 检测时机

**Post-commit（C 完成 commit_rule 之后）**，不是 validation gate。

理由：
1. `detect_conflicts` 需要读取新规则的完整 frontmatter，只有在 `write_rule` + `stage_rule` 之后才可读
2. 检测发生在 checking handler 中 C 完成（`subagent_done + checking`）之后、通知用户之前
3. 检测到冲突时规则已 commit 到 git，但可通过 `reject_rule` 回滚

### 2.2 检测算法（Phase 2 简化版）

基于 metadata 的静态匹配，不涉及 LLM 语义分析。

**冲突条件：** 两条规则的 `intent_tags.domain` + `intent_tags.task_goal` + `failed_skill` 完全相同。

最终实现签名为 `detect_conflicts(file_path: str) -> list[str]`（见 §3.1），内部读取 frontmatter 后执行以下匹配逻辑：

```python
# 匹配逻辑（在 detect_conflicts 内部）
new_tags = meta.get("intent_tags", {}) or {}
new_domain = new_tags.get("domain", "")
new_task_goal = new_tags.get("task_goal", "")
new_failed_skill = meta.get("failed_skill", "")
new_id = meta.get("id", "")

    if not new_domain or not new_task_goal:
        return []  # 缺少关键维度，无法检测

    result = list_rules(
        status_filter="verified",
        intent_domain=new_domain,
        intent_task_goal=new_task_goal,
    )

    conflicts = []
    for r in result.get("rules", []):
        meta = r.get("metadata", {})
        if meta.get("id") == new_id:
            continue  # 跳过自身

        if meta.get("failed_skill") == new_failed_skill:
            conflicts.append(meta.get("id", ""))

    return [c for c in conflicts if c]  # 过滤空字符串
```

### 2.3 冲突处理流程

```
C 完成 → commit_rule → detect_conflicts
                │
     ┌──────────┴──────────┐
     │                     │
   无冲突               有冲突
     │                     │
     ▼                     ▼
  正常通知            写入 conflicts_with
  (现有行为)          双向标注
                     通知用户展示冲突
```

---

## 三、文件变更详情

### 3.1 `_tools_rules.py` — 新增 `detect_conflicts`

```python
def detect_conflicts(file_path: str) -> list[str]:
    """检测指定规则与现有 verified 规则的冲突。

    Args:
        file_path: 新规则的文件路径

    Returns:
        冲突规则 ID 列表
    """
    from aristotle_mcp.frontmatter import read_frontmatter_raw
    from aristotle_mcp._utils import _safe_resolve

    resolved, _ = _safe_resolve(file_path)
    if not resolved or not resolved.exists():
        return []

    meta = read_frontmatter_raw(resolved)
    if not meta:
        return []

    new_tags = meta.get("intent_tags", {}) or {}
    new_domain = new_tags.get("domain", "")
    new_task_goal = new_tags.get("task_goal", "")
    new_failed_skill = meta.get("failed_skill", "")
    new_id = meta.get("id", "")

    if not new_domain or not new_task_goal:
        return []

    result = list_rules(
        status_filter="verified",
        intent_domain=new_domain,
        intent_task_goal=new_task_goal,
    )

    conflicts = []
    for r in result.get("rules", []):
        r_meta = r.get("metadata", {})
        if r_meta.get("id") == new_id:
            continue
        if r_meta.get("failed_skill") == new_failed_skill:
            conflicts.append(r_meta.get("id", ""))

    return [c for c in conflicts if c]
```

### 3.2 `_tools_rules.py` — `commit_rule` 后置冲突检测

在 `commit_rule` 函数完成 git commit 后，调用 `detect_conflicts` 并写入 `conflicts_with` 字段。

**变更位置：** `commit_rule` 函数末尾，git commit 成功之后。

```python
    # ... 现有 git commit 逻辑 ...

    # ── M9: Post-commit 冲突检测 ──
    conflicts = detect_conflicts(file_path)
    if conflicts:
        # 读取新规则 ID
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        new_meta = read_frontmatter_raw(_safe_resolve(file_path)[0]) or {}
        new_id = new_meta.get("id", "")

        # 写入新规则的 conflicts_with 字段（JSON 字符串格式）
        update_frontmatter_field(file_path, "conflicts_with", json.dumps(conflicts))

        # 反向标注：在冲突规则上也写入 conflicts_with
        for conflict_id in conflicts:
            existing = list_rules(
                status_filter="verified",
                keyword=conflict_id,
                limit=1,
            )
            for er in existing.get("rules", []):
                existing_path = er.get("path", "")
                existing_meta = er.get("metadata", {})
                # 解析已有 conflicts_with（可能是 JSON 字符串或列表）
                raw_cw = existing_meta.get("conflicts_with", []) or []
                if isinstance(raw_cw, str):
                    try:
                        existing_conflicts = json.loads(raw_cw)
                    except (json.JSONDecodeError, TypeError):
                        existing_conflicts = []
                elif isinstance(raw_cw, list):
                    existing_conflicts = raw_cw
                else:
                    existing_conflicts = []

                if new_id not in existing_conflicts:
                    existing_conflicts.append(new_id)
                    update_frontmatter_field(
                        existing_path,
                        "conflicts_with",
                        json.dumps(existing_conflicts),
                    )
```

**⚠ `conflicts_with` 格式：** 在 frontmatter 中存储为 JSON 字符串（`["rec_001", "rec_002"]`）。读取时必须做 `json.loads` 解析，因为 `yaml.safe_load` 将带引号的 JSON 字符串解析为 `str` 而非 `list`。反向标注代码已包含格式兼容处理。

### 3.3 `models.py` — `conflicts_with` 解析

`from_frontmatter_dict` 中的 `conflicts_with` 字段需要处理两种格式：

```python
# YAML 中可能是字符串 "['rec_001']" 或列表 ["rec_001"]
raw = data.get("conflicts_with")
if isinstance(raw, str):
    try:
        import json
        conflicts_with = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        conflicts_with = None
else:
    conflicts_with = raw
```

在 M6 技术方案中 `from_frontmatter_dict` 已包含 `conflicts_with=data.get("conflicts_with")`。此处需增加格式兼容解析。

### 3.4 `_orch_event.py` — checking 完成后展示冲突

冲突检测已在 `commit_rule` 内部完成（§3.2）。checking handler 从 `commit_rule` 的执行结果中收集冲突信息，无需再次调用 `detect_conflicts`。

**架构说明：** 冲突检测的责任归属于 `commit_rule`（每次 commit 都检测），而非 checking handler。checking handler 只需检查 C 期间 commit 的规则的 frontmatter，发现已写入的 `conflicts_with` 字段后展示警告。

**变更位置：** L164-187 中，`workflow["phase"] = "done"` 之前。

```python
    if event_type == "subagent_done" and workflow.get("phase") == "checking":
        result = data.get("result", "")
        if isinstance(result, dict):
            result = json.dumps(result)

        committed, staged = _parse_checker_result(str(result))
        sequence = workflow.get("sequence")

        # ... [M1 补丁] 收集路径 ...（已在 M1 技术方案中）

        status = "auto_committed" if staged == 0 else "partial_commit"
        complete_reflection_record(
            sequence=sequence,
            status=status,
            rules_count=committed + staged,
        )

        # ── M9: 从已 commit 的规则中读取冲突警告 ──
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        conflict_warnings = []
        rule_paths = workflow.get("committed_rule_paths", [])
        for rp in rule_paths:
            try:
                resolved, _ = _safe_resolve(rp)
                if resolved and resolved.exists():
                    fm = read_frontmatter_raw(resolved) or {}
                    cw = fm.get("conflicts_with")
                    if cw:
                        if isinstance(cw, str):
                            import json as _json
                            cw = _json.loads(cw)
                        if isinstance(cw, list) and cw:
                            conflict_warnings.append(
                                f"⚠️ {fm.get('id', rp)}: conflicts with {', '.join(cw)}"
                            )
            except Exception:
                pass

        workflow["phase"] = "done"
        workflow["conflict_warnings"] = conflict_warnings
        _save_workflow(workflow_id, workflow)

        # 构造通知消息
        msg = f"🦉 Aristotle done. {committed} rules committed, {staged} staged."
        if conflict_warnings:
            msg += "\n" + "\n".join(conflict_warnings)
        msg += f"\n   Review: /aristotle review {sequence}"

        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": msg,
        }
```

### 3.5 `SKILL.md` 扩展

在 review 展示逻辑中标注冲突规则（~2 行）：

```markdown
### Review display enhancement:
When showing associated rules, if a rule has `conflicts_with` field,
append: " ⚠️ conflicts with: <ids>"
```

---

## 四、冲突标注持久化

```
commit_rule(rec_003)
    │
    ▼
detect_conflicts → ["rec_001", "rec_002"]
    │
    ├─ update rec_003 frontmatter: conflicts_with: ["rec_001", "rec_002"]
    │
    ├─ update rec_001 frontmatter: conflicts_with: [..., "rec_003"]
    │
    └─ update rec_002 frontmatter: conflicts_with: [..., "rec_003"]
```

**双向标注：** 两条规则互为冲突，`conflicts_with` 字段互相包含对方 ID。这确保从任一规则出发都能发现冲突关系。

**frontmatter 写入但未 commit：** `update_frontmatter_field` 只修改文件内容，不自动 git commit。冲突标注在下次 `commit_rule` 或 `sync_rules` 时持久化。如果冲突标注丢失，下次 `detect_conflicts` 会重新检测。

---

## 五、实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 0 | M1 补丁（`committed_rule_paths` 传播至 review workflow） | 无 |
| 1 | `models.py` `RuleMetadata` 扩展（`conflicts_with` 字段）+ `from_frontmatter_dict` 格式解析 + `to_frontmatter_string` 列表序列化 | M6（字段定义） |
| 2 | `_tools_rules.py` 新增 `detect_conflicts` 函数 | 无 |
| 3 | `_tools_rules.py` `commit_rule` 后置冲突检测 + 双向标注 | 步骤 1, 2 |
| 4 | `_orch_event.py` checking handler 读取冲突警告 | 步骤 0, 1 |
| 5 | `SKILL.md` review 展示冲突标注 | 无 |

**关键路径：** 步骤 0→4, 1→3。步骤 4 依赖 M1 补丁的 `committed_rule_paths`；步骤 1 确保 `RuleMetadata` round-trip 不丢失 `conflicts_with`。

---

## 六、Phase 3 增强方向

当前 Phase 2 仅实现基于 metadata 三元组的静态匹配。以下场景未覆盖：

| 场景 | Phase 2 处理 | Phase 3 方向 |
|------|-------------|-------------|
| 语义冲突（相同 domain 不同 task_goal 但建议互斥） | 不检测 | LLM 语义分析（fire O subagent） |
| 范围重叠（domain 相同、task_goal 互补但建议矛盾） | 不检测 | 规则 body NLP 匹配 |
| 过时覆盖（error_summary 相似但 category 不同） | 不检测 | 差异度计算 |

---

## 七、验证

| # | 验证项 | 方法 |
|---|--------|------|
| V1 | `detect_conflicts` 对无冲突规则返回空列表 | pytest: 创建无重复规则 |
| V2 | `detect_conflicts` 对三元组重复规则返回冲突 ID | pytest: 创建重复规则 |
| V3 | `commit_rule` 后 `conflicts_with` 写入新规则 frontmatter | pytest: 检查文件内容 |
| V4 | 双向标注——冲突规则也包含新规则 ID | pytest: 检查已有规则 |
| V5 | `from_frontmatter_dict` 正确解析 JSON 字符串和列表格式 | pytest: 两种格式 roundtrip |
| V6 | checking 完成后冲突警告出现在通知消息中 | pytest: 模拟冲突场景 |
| V7 | 缺少 domain/task_goal 时不检测（返回空列表） | pytest: 无 intent_tags 规则 |
| V8 | 现有 227 pytest + 98 static 全部通过 | 回归测试 |
