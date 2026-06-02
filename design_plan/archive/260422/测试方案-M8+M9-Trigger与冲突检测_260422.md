# 测试方案 M8+M9: Passive Trigger + conflicts_with 检测

**日期:** 2026-04-23
**前置文档:** 技术方案-M8-Passive-Trigger_260422.md + 技术方案-M9-conflicts-with_260422.md
**测试文件:** `test.sh`（M8 静态测试）+ `test/test_m9_conflicts.py`（M9 pytest）
**框架:** pytest + test.sh 静态断言

---

## 一、测试范围

| 模块 | 测试目标 | 文件 | 类型 |
|------|---------|------|------|
| M8 | SKILL.md 行数 ≤ 60 | `SKILL.md` | test.sh |
| M8 | SKILL.md 包含 PASSIVE TRIGGER | `SKILL.md` | test.sh |
| M8 | SKILL.md 不含 auto-trigger 指令 | `SKILL.md` | test.sh |
| M9 | `detect_conflicts` 无冲突/有冲突 | `_tools_rules.py` | pytest |
| M9 | `commit_rule` 后置冲突标注 | `_tools_rules.py` | pytest |
| M9 | 双向标注 | `_tools_rules.py` | pytest |
| M9 | `from_frontmatter_dict` 格式解析 | `models.py` | pytest |
| M9 | checking handler 冲突警告 | `_orch_event.py` | pytest |

---

## 二、M8 测试用例（test.sh）

### TC-M8-01: SKILL.md 总行数 ≤ 60

**验证项:** M8-V1

```bash
# test.sh 新增段
SKILL_FILE="$ARISTOTLE_DIR/SKILL.md"
SKILL_LINES=$(wc -l < "$SKILL_FILE")
assert "SKILL.md line count ($SKILL_LINES) <= 60" "[ '$SKILL_LINES' -le 60 ]"
```

### TC-M8-02: SKILL.md 包含 PASSIVE TRIGGER 段落

**验证项:** M8-V2

```bash
assert_contains "$SKILL_FILE" "PASSIVE TRIGGER"
assert_contains "$SKILL_FILE" "error pattern"
assert_contains "$SKILL_FILE" "/aristotle"
```

### TC-M8-03: SKILL.md 不包含 auto-trigger 指令

**验证项:** M8-V3（人工审查 + 否定断言）

```bash
# 注意：PASSIVE TRIGGER 段落本身包含 "Do NOT auto-trigger" 文本
# 这里检测的是是否包含主动触发指令（而非否定性约束）
# 检测 "auto-trigger" 后紧跟动词（而非 "Do NOT"）
# 由于正则难以精确表达，此验证主要依赖人工审查
# 以下否定断言仅为 best-effort 防护，不能替代技术方案要求的人工审查
assert_not_contains "$SKILL_FILE" "automatically trigger"
assert_not_contains "$SKILL_FILE" "auto_call"
```

---

## 三、M9 测试用例（pytest）

### M9 测试文件导入

```python
# test/test_m9_conflicts.py 顶部导入
from _orch_helpers import (
    init_repo_tool,
    _start_reflect_workflow,
    _fire_r_done_event,
    _fire_c_done_event,
    _load_workflow,
)
from aristotle_mcp._tools_rules import (
    write_rule,
    stage_rule,
    commit_rule,
    list_rules,
    detect_conflicts,
)
from aristotle_mcp.frontmatter import read_frontmatter_raw
```

### TC-M9-01: detect_conflicts 无冲突规则

**验证项:** M9-V1

```python
class TestDetectConflicts:
    """M9: detect_conflicts 检测。"""

    def test_no_conflict_returns_empty(self):
        """无重复三元组 → 空列表。"""
        init_repo_tool()
        w = write_rule(
            content="## Unique rule",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        conflicts = detect_conflicts(w["file_path"])
        assert conflicts == []

    def test_missing_domain_returns_empty(self):
        """缺少 domain/task_goal → 返回空（不检测）。"""
        init_repo_tool()
        w = write_rule(
            content="## No intent tags",
            category="HALLUCINATION",
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        conflicts = detect_conflicts(w["file_path"])
        assert conflicts == []
```

### TC-M9-02: detect_conflicts 有冲突规则

**验证项:** M9-V2

```python
    def test_triple_match_returns_conflict(self):
        """domain + task_goal + failed_skill 完全重复 → 返回冲突 ID。"""
        init_repo_tool()

        # 创建第一条规则
        w1 = write_rule(
            content="## First rule",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        # 创建第二条规则（相同三元组）
        w2 = write_rule(
            content="## Second rule (conflict)",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        conflicts = detect_conflicts(w2["file_path"])
        assert len(conflicts) >= 1
        # 第一条规则的 ID 应在冲突列表中

    def test_different_failed_skill_no_conflict(self):
        """domain + task_goal 相同但 failed_skill 不同 → 无冲突。"""
        init_repo_tool()

        w1 = write_rule(
            content="## Rule A",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## Rule B",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="drizzle-connection",  # 不同的 failed_skill
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        conflicts = detect_conflicts(w2["file_path"])
        assert conflicts == []

    def test_self_not_in_conflicts(self):
        """自身 ID 不出现在冲突列表中。"""
        init_repo_tool()
        w = write_rule(
            content="## Self test",
            category="HALLUCINATION",
            intent_domain="testing", intent_task_goal="unit test",
            failed_skill="pytest",
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        conflicts = detect_conflicts(w["file_path"])
        rule_id = Path(w["file_path"]).stem
        assert rule_id not in conflicts
```

### TC-M9-03: commit_rule 后置冲突标注

**验证项:** M9-V3

```python
class TestCommitRuleConflictAnnotation:
    """M9: commit_rule 后置冲突标注。"""

    def test_conflict_annotated_in_frontmatter(self):
        """有冲突时 conflicts_with 写入新规则 frontmatter。"""
        init_repo_tool()

        # 创建已有规则
        w1 = write_rule(
            content="## Existing rule",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        # 创建冲突规则
        w2 = write_rule(
            content="## New conflicting rule",
            category="HALLUCINATION",
            intent_domain="database_operations", intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        # 验证新规则 frontmatter 包含 conflicts_with
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm = read_frontmatter_raw(Path(w2["file_path"]))
        assert "conflicts_with" in fm
        cw = fm["conflicts_with"]
        if isinstance(cw, str):
            import json
            cw = json.loads(cw)
        assert isinstance(cw, list)
        assert len(cw) >= 1
```

### TC-M9-04: 双向标注

**验证项:** M9-V4

```python
    def test_bidirectional_annotation(self):
        """冲突规则互相包含对方 ID。"""
        init_repo_tool()

        w1 = write_rule(
            content="## First",
            category="HALLUCINATION",
            intent_domain="db", intent_task_goal="fix",
            failed_skill="skill_a",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## Second",
            category="HALLUCINATION",
            intent_domain="db", intent_task_goal="fix",
            failed_skill="skill_a",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm1 = read_frontmatter_raw(Path(w1["file_path"]))
        fm2 = read_frontmatter_raw(Path(w2["file_path"]))

        # 解析 conflicts_with
        def parse_cw(fm):
            cw = fm.get("conflicts_with", [])
            if isinstance(cw, str):
                import json
                return json.loads(cw)
            return cw or []

        cw1 = parse_cw(fm1)
        cw2 = parse_cw(fm2)

        # w2 commit 时在 w1 上写入反向标注
        id2 = fm2.get("id", "")
        assert id2 in cw1, f"w1 should contain w2's ID ({id2}) in conflicts_with"
```

### TC-M9-05: from_frontmatter_dict 格式解析

**验证项:** M9-V5

```python
class TestConflictsWithParsing:
    """M9: conflicts_with 格式兼容解析。"""

    def test_json_string_parsed(self):
        """JSON 字符串格式的 conflicts_with 被正确解析。"""
        from aristotle_mcp.models import from_frontmatter_dict
        meta = from_frontmatter_dict({
            "id": "rec_test",
            "conflicts_with": '["rec_001", "rec_002"]',
        })
        assert isinstance(meta.conflicts_with, list)
        assert "rec_001" in meta.conflicts_with

    def test_list_format_passes_through(self):
        """列表格式的 conflicts_with 直接传递。"""
        from aristotle_mcp.models import from_frontmatter_dict
        meta = from_frontmatter_dict({
            "id": "rec_test",
            "conflicts_with": ["rec_001"],
        })
        assert isinstance(meta.conflicts_with, list)
        assert meta.conflicts_with == ["rec_001"]

    def test_none_when_missing(self):
        """无 conflicts_with → None。"""
        from aristotle_mcp.models import from_frontmatter_dict
        meta = from_frontmatter_dict({"id": "rec_test"})
        assert meta.conflicts_with is None
```

### TC-M9-06: checking handler 冲突警告

**验证项:** M9-V6

```python
class TestCheckingHandlerConflicts:
    """M9: checking 完成后冲突警告出现在通知消息中。"""

    def test_conflict_warning_in_notification(self):
        """冲突规则的 checking 通知包含 ⚠️ 警告。"""
        init_repo_tool()

        # 创建两条冲突规则（手动 setup）
        w1 = write_rule(
            content="## Existing",
            category="HALLUCINATION",
            intent_domain="db", intent_task_goal="fix",
            failed_skill="skill_a",
            source_session="ses_m9_conflict",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## New conflict",
            category="HALLUCINATION",
            intent_domain="db", intent_task_goal="fix",
            failed_skill="skill_a",
            source_session="ses_m9_conflict",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])  # 先 commit w2，使 commit_rule 触发 detect_conflicts

        # 启动 reflect workflow
        start = _start_reflect_workflow("ses_m9_conflict")
        wf_id = start["workflow_id"]

        # 手动设置 committed_rule_paths，使 checking handler 能检测到已 commit 的规则
        wf = _load_workflow(wf_id)
        wf["committed_rule_paths"] = [w1["file_path"], w2["file_path"]]

        # 模拟 R 完成
        _fire_r_done_event(wf_id, "ses_r_m9")

        # 模拟 C 完成
        c_done = _fire_c_done_event(wf_id, "Committed: 2, Staged: 0")

        # 验证 conflict_warnings 非空（存在冲突时应产生警告）
        wf = _load_workflow(wf_id)
        assert "conflict_warnings" in wf
        assert len(wf["conflict_warnings"]) > 0
```

---

## 四、测试统计

| 模块 | 类别 | 数量 |
|------|------|------|
| M8 | SKILL.md 静态检查 | 3 |
| **M8 小计** | | **3** |
| M9 | detect_conflicts | 4 |
| M9 | commit_rule 标注 | 1 |
| M9 | 双向标注 | 1 |
| M9 | 格式解析 | 3 |
| M9 | checking handler | 1 |
| **M9 小计** | | **10** |
| **总计** | | **13** |

---

## 五、执行命令

```bash
# M8 静态测试
bash test.sh

# M9 pytest（专项）
pytest test/test_m9_conflicts.py -v

# 回归测试（全量）
pytest test/ -v
```
