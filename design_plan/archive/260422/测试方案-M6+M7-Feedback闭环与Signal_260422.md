# 测试方案 M6+M7: Error Feedback 闭环 + Feedback Signal 追踪

**日期:** 2026-04-23
**前置文档:** 技术方案-M6-Error-Feedback_260422.md + 技术方案-M7-Feedback-Signal及Delta-log-norm_260422.md
**测试文件:** `test/test_m6_feedback.py` + `test/test_m7_delta_norm.py`
**框架:** pytest + autouse `tmp_repo`

---

## 一、测试范围

| 模块 | 测试目标 | 文件 | 类型 |
|------|---------|------|------|
| M6 | `report_feedback` 工具：signal 更新 + workflow 创建 | `_tools_feedback.py` | pytest |
| M6 | 递归深度防护 + feedback_count 原子性 | `_tools_feedback.py` | pytest |
| M6 | RuleMetadata 新字段序列化 | `models.py` | pytest |
| M7 | `compute_delta` 向后兼容 + log-normalization | `evolution.py` | pytest |
| M7 | `get_audit_decision` 传入 sample_size | `_tools_rules.py` | pytest |
| M7 | 负值 sample_size 校验 | `evolution.py` | pytest |

---

## 二、测试用例

```python
# 公共导入与 M6 可用性检测
try:
    from aristotle_mcp._tools_feedback import report_feedback
    _M6_AVAILABLE = True
except ImportError:
    _M6_AVAILABLE = False

from aristotle_mcp._orch_state import _load_workflow
from pathlib import Path
import pytest
```

### TC-M6-01: report_feedback 更新 feedback signal

**验证项:** M6-V1

```python
@pytest.mark.skipif(not _M6_AVAILABLE, reason="M6 feedback APIs not yet implemented")
class TestFeedbackSignalUpdate:
    """M6: report_feedback 更新 sample_size/failure_rate/success_rate。"""

    def test_signal_update_on_feedback(self):
        """首次 feedback: sample_size=0→1, failure_rate=0→1.0。"""
        init_repo_tool()
        # 创建 verified 规则
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        rule_id = w.get("rule_id", "")

        result = report_feedback(
            rule_ids=[rule_id],
            error_description="Still getting timeout",
            auto_reflect=False,
        )

        assert result["action"] == "notify"
        # 验证 frontmatter 中的 signal
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 1
        assert fm.get("failure_rate") == 1.0
        assert fm.get("success_rate") == 0.0

    def test_incremental_signal_update(self):
        """第二次 feedback: sample_size=1→2, failure_rate 更新。"""
        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        rule_id = w.get("rule_id", "")

        # 第一次 feedback
        report_feedback(rule_ids=[rule_id], error_description="err1", auto_reflect=False)
        # 第二次 feedback
        report_feedback(rule_ids=[rule_id], error_description="err2", auto_reflect=False)

        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 2
        assert fm.get("failure_rate") == 1.0  # 2/2
        assert fm.get("success_rate") == 0.0

    def test_mixed_rule_ids_updates_only_existing(self):
        """混合存在/不存在的 rule_ids：只更新存在的规则 signal。"""
        init_repo_tool()
        w = write_rule(content="## Test\n**Rule**: check", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        rule_id = w.get("rule_id", "")

        result = report_feedback(
            rule_ids=[rule_id, "rec_nonexistent_xyz"],
            error_description="error",
            auto_reflect=False,
        )

        assert result["action"] == "notify"
        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 1
```

### TC-M6-02: auto_reflect=False 不创建 workflow

**验证项:** M6-V2

```python
    def test_no_reflect_no_workflow(self):
        """auto_reflect=False → 只更新 signal，不创建 workflow。"""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=False,
        )

        assert result["action"] == "notify"
        assert "workflow_id" not in result
        assert result.get("sub_role") is None
```

### TC-M6-03: auto_reflect=True 创建 workflow

**验证项:** M6-V3

```python
    def test_auto_reflect_creates_workflow(self):
        """auto_reflect=True → fire_sub + workflow state。"""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=True,
            session_id="ses_m6_test",
            project_directory="/tmp/project",
        )

        assert result["action"] == "fire_sub"
        assert result["sub_role"] == "R"
        assert "workflow_id" in result

        # 验证 workflow state
        wf = _load_workflow(result["workflow_id"])
        assert wf["phase"] == "reflecting"
        assert wf["source"] == "feedback"
        assert wf["project_directory"] == "/tmp/project"
        assert wf["feedback_rule_ids"] == [w.get("rule_id", "")]
```

### TC-M6-04: 递归深度限制

**验证项:** M6-V4

```python
@pytest.mark.skipif(not _M6_AVAILABLE, reason="M6 feedback APIs not yet implemented")
class TestFeedbackDepthGuard:
    """M6: 递归深度防护。"""

    def test_depth_limit_blocks_reflect(self):
        """feedback_count >= MAX_FEEDBACK_REFLECT → 拒绝 reflect。"""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        # 手动设置 feedback_count=3
        from aristotle_mcp.frontmatter import update_frontmatter_field
        update_frontmatter_field(Path(w["file_path"]), "feedback_count", "3")

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=True,
        )

        # 应被拒绝（但 signal 已更新）
        assert result["action"] == "notify"
        assert "max" in result["message"].lower() or "Max" in result["message"]

    def test_signal_updated_even_when_depth_exceeded(self):
        """深度超限时 signal 仍然更新（不被丢弃）。"""
        init_repo_tool()
        w = write_rule(content="## Test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        update_frontmatter_field(Path(w["file_path"]), "feedback_count", "3")

        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=True,
        )

        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm = read_frontmatter_raw(Path(w["file_path"]))
        assert fm.get("sample_size") == 1  # signal 已更新
```

### TC-M6-05: feedback_count 递增条件

**验证项:** M6-V5

```python
    def test_feedback_count_only_increments_on_auto_reflect(self):
        """feedback_count 仅在 auto_reflect=True 时递增。"""
        init_repo_tool()

        # True case
        w1 = write_rule(content="## Test1", category="HALLUCINATION")
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        report_feedback(
            rule_ids=[w1.get("rule_id", "")],
            error_description="err",
            auto_reflect=True,
        )

        from aristotle_mcp.frontmatter import read_frontmatter_raw
        fm1 = read_frontmatter_raw(Path(w1["file_path"]))
        assert fm1.get("feedback_count", 0) == 1

        # False case
        w2 = write_rule(content="## Test2", category="SYNTAX_API_ERROR")
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        report_feedback(
            rule_ids=[w2.get("rule_id", "")],
            error_description="err",
            auto_reflect=False,
        )

        fm2 = read_frontmatter_raw(Path(w2["file_path"]))
        assert fm2.get("feedback_count", 0) == 0  # 未递增
```

### TC-M6-06: 不存在的 rule_ids 被拒绝

```python
    def test_nonexistent_rule_ids_rejected(self):
        """rule_ids 无匹配规则 → 早期返回通知。"""
        result = report_feedback(
            rule_ids=["rec_nonexistent_xyz"],
            error_description="error",
            auto_reflect=True,
        )

        assert result["action"] == "notify"
        assert "no verified rules" in result["message"].lower() or "not found" in result["message"].lower()
```

### TC-M6-07: RuleMetadata 新字段序列化

**验证项:** M6-V6

```python
@pytest.mark.skipif(not _M6_AVAILABLE, reason="M6 feedback APIs not yet implemented")
class TestM6Models:
    """M6: RuleMetadata 新字段序列化/反序列化。"""

    def test_feedback_fields_roundtrip(self):
        """feedback signal 字段 write→read roundtrip。"""
        init_repo_tool()
        w = write_rule(content="## Roundtrip test", category="HALLUCINATION")
        path = w["file_path"]

        # 手动写入 feedback 字段
        from aristotle_mcp.frontmatter import update_frontmatter_field
        update_frontmatter_field(Path(path), "sample_size", "5")
        update_frontmatter_field(Path(path), "failure_rate", "0.4")
        update_frontmatter_field(Path(path), "success_rate", "0.6")
        update_frontmatter_field(Path(path), "feedback_count", "2")

        # 读取并验证
        r = read_rules(status="pending", keyword="Roundtrip", limit=1)
        assert r["count"] >= 1
        meta = r["rules"][0]["metadata"]
        assert meta.get("sample_size") == 5
        assert meta.get("failure_rate") == 0.4
        assert meta.get("feedback_count") == 2

    def test_default_zero_not_written(self):
        """sample_size=0 和 feedback_count=0 不写入 frontmatter。"""
        init_repo_tool()
        w = write_rule(content="## Zero default test", category="HALLUCINATION")
        path = w["file_path"]

        # 读取原始文件内容
        content = Path(path).read_text(encoding="utf-8")
        assert "sample_size" not in content
        assert "feedback_count" not in content

    def test_type_coercion_in_from_frontmatter(self):
        """from_frontmatter_dict 正确处理字符串类型的 sample_size。"""
        from aristotle_mcp.models import from_frontmatter_dict
        meta = from_frontmatter_dict({
            "id": "rec_test",
            "sample_size": "5",      # string, not int
            "feedback_count": "2",    # string, not int
        })
        assert isinstance(meta.sample_size, int)
        assert meta.sample_size == 5
        assert isinstance(meta.feedback_count, int)
        assert meta.feedback_count == 2

    def test_non_numeric_sample_size_handled(self):
        """sample_size 为非数字字符串时，report_feedback 优雅处理。"""
        init_repo_tool()
        w = write_rule(content="## Non-numeric test", category="HALLUCINATION")
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])
        path = w["file_path"]

        # 写入非数字 sample_size
        from aristotle_mcp.frontmatter import update_frontmatter_field
        update_frontmatter_field(Path(path), "sample_size", "abc")

        # report_feedback 应优雅处理
        result = report_feedback(
            rule_ids=[w.get("rule_id", "")],
            error_description="error",
            auto_reflect=False,
        )
        assert result["action"] == "notify"
```

---

## M7 测试用例

### TC-M7-01: compute_delta 向后兼容

**验证项:** M7-V1

```python
class TestComputeDeltaBackwardCompat:
    """M7: compute_delta 向后兼容。"""

    def test_no_sample_size_returns_legacy_value(self):
        """sample_size=None → 旧公式（与 Phase 1 完全一致）。"""
        from aristotle_mcp.evolution import compute_delta
        delta = compute_delta(confidence=0.9, risk_level="low")
        assert delta == pytest.approx(0.72, abs=0.001)

    def test_no_sample_size_medium_risk(self):
        """medium risk 无 sample_size → 旧公式。"""
        from aristotle_mcp.evolution import compute_delta
        delta = compute_delta(confidence=0.8, risk_level="medium")
        assert delta == pytest.approx(0.4, abs=0.001)
```

### TC-M7-02: sample_size=0 强制 Δ=0

**验证项:** M7-V2

```python
class TestComputeDeltaZeroSample:
    """M7: sample_size=0 → Δ=0 (manual)。"""

    def test_zero_sample_forces_zero_delta(self):
        """sample_size=0 → norm_factor=0 → Δ=0。"""
        from aristotle_mcp.evolution import compute_delta
        delta = compute_delta(confidence=0.99, risk_level="low", sample_size=0)
        assert delta == 0.0
```

### TC-M7-03: log-normalization 数值正确

**验证项:** M7-V3, V4

```python
class TestComputeDeltaLogNorm:
    """M7: log-normalization 数值验证。"""

    @pytest.mark.parametrize("sample_size,expected_approx", [
        (1, 0.164),    # ln(2)/ln(21) * 0.72
        (5, 0.424),    # ln(6)/ln(21) * 0.72
        (10, 0.568),   # ln(11)/ln(21) * 0.72
        (20, 0.720),   # ln(21)/ln(21) * 0.72 = 0.72
    ])
    def test_log_norm_values(self, sample_size, expected_approx):
        """log-normalization 在不同 sample_size 下的值。"""
        from aristotle_mcp.evolution import compute_delta
        import math
        from aristotle_mcp.config import MAX_SAMPLES

        delta = compute_delta(confidence=0.9, risk_level="low", sample_size=sample_size)
        # 手动计算预期值
        norm = math.log(sample_size + 1) / math.log(MAX_SAMPLES + 1)
        expected = 0.9 * (1.0 - 0.2) * norm  # confidence * (1 - risk_weight) * norm
        assert delta == pytest.approx(expected, abs=0.01)

    def test_high_risk_never_auto(self):
        """high risk 即使 sample_size=20 也为 manual。"""
        from aristotle_mcp.evolution import compute_delta, decide_audit_level
        delta = compute_delta(confidence=0.9, risk_level="high", sample_size=20)
        level = decide_audit_level(delta)
        assert level == "manual"

    def test_low_risk_max_sample_auto(self):
        """low risk + sample_size=20 → auto。"""
        from aristotle_mcp.evolution import compute_delta, decide_audit_level
        delta = compute_delta(confidence=0.9, risk_level="low", sample_size=20)
        level = decide_audit_level(delta)
        assert level == "auto"
```

### TC-M7-04: 负值 sample_size 校验

```python
    def test_negative_sample_size_raises(self):
        """sample_size < 0 → ValueError。"""
        from aristotle_mcp.evolution import compute_delta
        with pytest.raises(ValueError, match="sample_size must be >= 0"):
            compute_delta(confidence=0.9, risk_level="low", sample_size=-1)
```

### TC-M7-05: get_audit_decision 集成

**验证项:** M7-V5, V6

```python
class TestGetAuditDecisionIntegration:
    """M7: get_audit_decision 传入 sample_size。"""

    def test_new_rule_uses_legacy_formula(self):
        """新规则（无 sample_size frontmatter）→ 旧公式。"""
        init_repo_tool()
        w = write_rule(
            content="## New rule",
            category="HALLUCINATION",
            confidence=0.9,
        )
        # 不写入 sample_size → get_audit_decision 读到 None → 旧公式

        result = get_audit_decision(w["file_path"])
        delta = result.get("delta", 0)
        # high risk: 0.9 * (1 - 0.8) = 0.18
        assert delta == pytest.approx(0.18, abs=0.01)

    def test_feedback_updated_rule_uses_log_norm(self):
        """feedback 更新后的规则使用 log-normalization。"""
        init_repo_tool()
        w = write_rule(
            content="## Updated rule",
            category="HALLUCINATION",
            confidence=0.9,
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        # 模拟 feedback 更新 sample_size
        from aristotle_mcp.frontmatter import update_frontmatter_field
        update_frontmatter_field(Path(w["file_path"]), "sample_size", "10")

        result = get_audit_decision(w["file_path"])
        delta = result.get("delta", 0)
        # 应小于旧公式的 0.18（因为 log-norm 降低）
        assert delta < 0.18
```

---

## 三、测试统计

| 模块 | 类别 | 数量 |
|------|------|------|
| M6 | signal 更新 | 3 |
| M6 | auto_reflect 开关 | 2 |
| M6 | 递归深度 | 2 |
| M6 | feedback_count 条件 | 1 |
| M6 | 不存在 rule_ids | 1 |
| M6 | 混合 rule_ids | 1 |
| M6 | Models 序列化 | 4 |
| **M6 小计** | | **14** |
| M7 | 向后兼容 | 2 |
| M7 | sample_size=0 | 1 |
| M7 | log-norm 数值 | 4 |
| M7 | 负值校验 | 1 |
| M7 | get_audit_decision | 2 |
| **M7 小计** | | **10** |
| **总计** | | **24** |

---

## 四、执行命令

```bash
pytest test/test_m6_feedback.py test/test_m7_delta_norm.py -v
```

> **V7 回归执行备注:** 在合并 M6/M7 改动前，必须运行完整回归测试 `pytest test/ -v` 以验证现有 rule staging、evolution 和 audit 流程未受破坏。特别关注 `test_m7_delta_norm.py::TestComputeDeltaBackwardCompat` 确保向后兼容。
