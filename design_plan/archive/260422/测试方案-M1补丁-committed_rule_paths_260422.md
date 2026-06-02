# 测试方案 M1 补丁: committed_rule_paths 优化

**日期:** 2026-04-23
**前置文档:** 技术方案-M1补丁-committed_rule_paths_260422.md
**测试文件:** `test/test_m1_committed_paths.py`
**框架:** pytest + autouse `tmp_repo`

---

## 一、测试范围

| 测试目标 | 文件 | 类型 |
|---------|------|------|
| checking 完成后路径写入 workflow + reflection record | `_orch_event.py` | pytest |
| review workflow 从 record 继承路径 | `_orch_start.py` | pytest |
| confirm 优先使用 committed_rule_paths | `_orch_review.py` | pytest |
| 回归：confirm 降级为 keyword 搜索 | `_orch_review.py` | pytest |

**不测试:** `list_rules` 本身（已有测试）、git 操作（已有测试）、SKILL.md 调度逻辑。

---

## 二、测试前置条件

```python
# conftest.py 或测试文件顶部
import json
import pytest
from pathlib import Path

from unittest.mock import patch
from conftest import _NEW_APIS_AVAILABLE
from _orch_helpers import (
    _start_reflect_workflow,
    _fire_r_done_event,
    _fire_c_done_event,
    _load_workflow,
    _setup_reflection_record,
    init_repo_tool,
)
from aristotle_mcp._tools_rules import write_rule, stage_rule, commit_rule, list_rules
from aristotle_mcp._orch_start import orchestrate_start
from aristotle_mcp._orch_event import orchestrate_on_event
from aristotle_mcp._orch_review import orchestrate_review_action
```

---

## 三、测试用例

### TC-M1-01: checking 完成后 workflow 包含 committed_rule_paths

**验证项:** V1
**目的:** C 完成后，checking handler 收集 staging/verified 规则路径写入 workflow state

```python
@pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 committed_rule_paths APIs not available")
class TestCommittedPathsCollection:
    """M1 补丁: checking 完成后收集规则路径。"""

    def test_checking_done_writes_committed_paths(self):
        """R→C 完成后 workflow 包含 committed_rule_paths 列表。"""
        # 1. 启动 reflect workflow
        start = _start_reflect_workflow("ses_m1_test_01")
        wf_id = start["workflow_id"]

        # 2. 模拟 R 完成 → 触发 C
        r_done = _fire_r_done_event(wf_id, "ses_r_m1")
        assert r_done["action"] == "fire_sub"

        # 3. 模拟 C 完成（C 会创建规则，这里模拟 C 写入规则后的结果）
        # 先手动创建 staging 规则供 checking handler 收集
        init_repo_tool()
        w = write_rule(
            content="## Test rule\n**Rule**: check paths",
            category="HALLUCINATION",
            source_session="ses_m1_test_01",
        )
        stage_rule(w["file_path"])

        # 4. 模拟 C 完成
        c_done = _fire_c_done_event(wf_id, "Committed: 1, Staged: 0")
        assert c_done["action"] == "notify"

        # 5. 验证 workflow 包含路径
        wf = _load_workflow(wf_id)
        assert "committed_rule_paths" in wf
        assert isinstance(wf["committed_rule_paths"], list)
        assert len(wf["committed_rule_paths"]) >= 1

    def test_checking_done_writes_paths_to_reflection_record(self):
        """C 完成后 reflection record 也包含 committed_rule_paths。"""
        start = _start_reflect_workflow("ses_m1_test_02")
        wf_id = start["workflow_id"]
        wf = _load_workflow(wf_id)
        seq = wf["sequence"]

        r_done = _fire_r_done_event(wf_id, "ses_r_m1")
        c_done = _fire_c_done_event(wf_id, "Committed: 1, Staged: 0")

        # 验证 reflection record 包含 committed_rule_paths
        from aristotle_mcp.config import resolve_repo_dir
        state_path = resolve_repo_dir().parent / "aristotle-state.json"
        records = json.loads(state_path.read_text(encoding="utf-8"))
        record = records[seq - 1] if seq <= len(records) else {}
        assert "committed_rule_paths" in record

    def test_source_session_exact_match_filters_cross_session(self):
        """收集路径时 source_session 精确匹配，排除其他 session 的规则。"""
        init_repo_tool()
        # 创建属于当前 session 的规则
        w1 = write_rule(
            content="## Current session rule",
            category="HALLUCINATION",
            source_session="ses_m1_test_03",
        )
        stage_rule(w1["file_path"])

        # 创建属于另一个 session 的规则（不应被收集）
        w2 = write_rule(
            content="## Other session rule",
            category="SYNTAX_API_ERROR",
            source_session="ses_m1_test_03_extra",
        )
        stage_rule(w2["file_path"])

        start = _start_reflect_workflow("ses_m1_test_03")
        wf_id = start["workflow_id"]

        _fire_r_done_event(wf_id, "ses_r_m1")
        c_done = _fire_c_done_event(wf_id, "Committed: 2, Staged: 0")

        wf = _load_workflow(wf_id)
        paths = wf["committed_rule_paths"]
        # 只应包含 ses_m1_test_03 的规则
        for p in paths:
            from aristotle_mcp.frontmatter import read_frontmatter_raw
            fm = read_frontmatter_raw(Path(p))
            assert fm.get("source_session") == "ses_m1_test_03"

    def test_empty_path_not_collected(self):
        """空路径不会被收集到 committed_rule_paths。"""
        start = _start_reflect_workflow("ses_m1_test_04")
        wf_id = start["workflow_id"]

        _fire_r_done_event(wf_id, "ses_r_m1")
        c_done = _fire_c_done_event(wf_id, "Committed: 0, Staged: 0")

        wf = _load_workflow(wf_id)
        # 无规则时路径列表为空
        assert wf["committed_rule_paths"] == []
```

### TC-M1-02: confirm 使用 committed_rule_paths 直接 commit

**验证项:** V2
**目的:** review confirm 时优先使用 committed_rule_paths 而非 keyword 搜索

```python
@pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 committed_rule_paths APIs not available")
class TestConfirmUsesCommittedPaths:
    """M1 补丁: confirm 优先使用已记录的路径。"""

    def _setup_review_workflow(self, session_id="ses_m1_review"):
        """创建完整的 reflect→review workflow。"""
        init_repo_tool()

        # 创建 staging 规则
        w = write_rule(
            content="## Review test rule\n**Rule**: test",
            category="HALLUCINATION",
            source_session=session_id,
        )
        stage_rule(w["file_path"])
        rule_path = w["file_path"]

        # 创建 reflect workflow 并完成 R→C
        start = _start_reflect_workflow(session_id)
        wf_id = start["workflow_id"]
        wf = _load_workflow(wf_id)
        seq = wf["sequence"]

        _fire_r_done_event(wf_id, "ses_r_m1")
        _fire_c_done_event(wf_id, "Committed: 1, Staged: 0")

        # 启动 review workflow
        review_start = orchestrate_start("review", json.dumps({"sequence": seq}))
        review_wf_id = review_start["workflow_id"]

        return review_wf_id, rule_path, seq

    def test_confirm_uses_paths_from_record(self):
        """confirm 从 reflection record 继承的路径直接 commit staging 规则。"""
        review_wf_id, rule_path, seq = self._setup_review_workflow()

        with patch("aristotle_mcp._orch_review.list_rules") as mock_lr:
            result = orchestrate_review_action(
                workflow_id=review_wf_id,
                action="confirm",
            )

            assert result["action"] == "notify"
            mock_lr.assert_not_called()

        # 验证规则已被 commit（状态变为 verified）
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm = read_frontmatter_raw(Path(rule_path))
        assert fm.get("status") == "verified"

    def test_confirm_skips_already_verified_rules(self):
        """verified 规则不被重复 commit，但计入 committed 计数。"""
        review_wf_id, rule_path, seq = self._setup_review_workflow()

        # 预先将规则 commit（模拟 C auto-commit）
        commit_rule(rule_path)

        with patch("aristotle_mcp._orch_review.commit_rule") as mock_commit:
            result = orchestrate_review_action(
                workflow_id=review_wf_id,
                action="confirm",
            )

            # verified 规则应计入 committed 但不调用 commit_rule
            assert "confirmed" in result["message"].lower() or "✅" in result["message"]
            assert mock_commit.call_count == 0

    def test_confirm_fallback_when_paths_empty(self):
        """committed_rule_paths 为空时降级为 keyword 搜索。"""
        init_repo_tool()
        session_id = "ses_m1_fallback"

        # 创建 staging 规则
        w = write_rule(
            content="## Fallback test rule",
            category="HALLUCINATION",
            source_session=session_id,
        )
        stage_rule(w["file_path"])

        # 创建 reflect workflow
        start = _start_reflect_workflow(session_id)
        wf_id = start["workflow_id"]
        wf = _load_workflow(wf_id)
        seq = wf["sequence"]

        _fire_r_done_event(wf_id, "ses_r_m1")
        _fire_c_done_event(wf_id, "Committed: 1, Staged: 0")

        # 启动 review，但手动清除 committed_rule_paths
        review_start = orchestrate_start("review", json.dumps({"sequence": seq}))
        review_wf_id = review_start["workflow_id"]

        # 清除路径，强制降级
        from aristotle_mcp._orch_state import _save_workflow
        wf = _load_workflow(review_wf_id)
        wf["committed_rule_paths"] = []
        _save_workflow(review_wf_id, wf)

        with patch("aristotle_mcp._orch_review.list_rules") as mock_lr:
            result = orchestrate_review_action(
                workflow_id=review_wf_id,
                action="confirm",
            )

            # 降级路径仍应 commit 规则
            assert result["action"] == "notify"
            assert mock_lr.called
```

### TC-M1-03: 回归测试

**验证项:** V5

```python
@pytest.mark.skipif(not _NEW_APIS_AVAILABLE, reason="M1 committed_rule_paths APIs not available")
class TestM1Regression:
    """M1 补丁回归：现有功能不退化。"""

    def test_confirm_reject_still_works(self):
        """reject 操作不受 M1 补丁影响。"""
        init_repo_tool()
        session_id = "ses_m1_reject"

        w = write_rule(
            content="## Reject test",
            category="HALLUCINATION",
            source_session=session_id,
        )
        stage_rule(w["file_path"])

        start = _start_reflect_workflow(session_id)
        wf_id = start["workflow_id"]
        wf = _load_workflow(wf_id)
        seq = wf["sequence"]

        _fire_r_done_event(wf_id, "ses_r_m1")
        _fire_c_done_event(wf_id, "Committed: 1, Staged: 0")

        review_start = orchestrate_start("review", json.dumps({"sequence": seq}))
        review_wf_id = review_start["workflow_id"]

        result = orchestrate_review_action(
            workflow_id=review_wf_id,
            action="reject",
        )

        assert result["action"] == "notify"
        assert "rejected" in result["message"].lower() or "❌" in result["message"]
```

---

## 四、测试统计

| 类别 | 数量 | 用例 |
|------|------|------|
| 路径收集 | 4 | TC-M1-01 (4 个子测试) |
| confirm 路径使用 | 3 | TC-M1-02 (3 个子测试) |
| 回归 | 1 | TC-M1-03 |
| **总计** | **8** | |

---

## 五、执行命令

```bash
# 单独运行 M1 补丁测试
pytest test/test_m1_committed_paths.py -v

# 运行全部现有测试（回归验证）
pytest test/ -v
bash test/test.sh
```
