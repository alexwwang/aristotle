"""Tests for M7: Feedback Signal Δ log-normalization."""

from __future__ import annotations

import inspect
import math
from pathlib import Path

import pytest

from aristotle_mcp.evolution import compute_delta, decide_audit_level

try:
    from aristotle_mcp.config import MAX_SAMPLES
except ImportError:
    MAX_SAMPLES = 20

# ── Feature-detection for M7 sample_size support ─────────────────────
_M7_DELTA_HAS_SAMPLE_SIZE = "sample_size" in inspect.signature(compute_delta).parameters

try:
    from aristotle_mcp._tools_rules import get_audit_decision as _get_audit_fn

    _M7_AUDIT_HAS_SAMPLE_SIZE = "sample_size" in inspect.getsource(_get_audit_fn)
except (OSError, TypeError):
    _M7_AUDIT_HAS_SAMPLE_SIZE = False


# ── TC-M7-01: Backward compatibility ─────────────────────────────────


class TestComputeDeltaBackwardCompat:
    """M7: compute_delta 向后兼容。"""

    def test_no_sample_size_returns_legacy_value(self):
        """sample_size=None → 旧公式（与 Phase 1 完全一致）。"""
        delta = compute_delta(confidence=0.9, risk_level="low")
        assert delta == pytest.approx(0.72, abs=0.001)

    def test_no_sample_size_medium_risk(self):
        """medium risk 无 sample_size → 旧公式。"""
        delta = compute_delta(confidence=0.8, risk_level="medium")
        assert delta == pytest.approx(0.4, abs=0.001)


# ── TC-M7-02: sample_size=0 forces Δ=0 ───────────────────────────────


@pytest.mark.skipif(
    not _M7_DELTA_HAS_SAMPLE_SIZE,
    reason="M7 sample_size not yet implemented in compute_delta",
)
class TestComputeDeltaZeroSample:
    """M7: sample_size=0 → Δ=0 (manual)。"""

    def test_zero_sample_forces_zero_delta(self):
        """sample_size=0 → norm_factor=0 → Δ=0。"""
        delta = compute_delta(confidence=0.99, risk_level="low", sample_size=0)
        assert delta == 0.0


# ── TC-M7-03: Log-normalization numeric correctness ──────────────────


@pytest.mark.skipif(
    not _M7_DELTA_HAS_SAMPLE_SIZE,
    reason="M7 sample_size not yet implemented in compute_delta",
)
class TestComputeDeltaLogNorm:
    """M7: log-normalization 数值验证。"""

    @pytest.mark.parametrize(
        "sample_size,expected_approx",
        [
            (1, 0.164),  # ln(2)/ln(21) * 0.72
            (5, 0.424),  # ln(6)/ln(21) * 0.72
            (10, 0.568),  # ln(11)/ln(21) * 0.72
            (20, 0.720),  # ln(21)/ln(21) * 0.72 = 0.72
        ],
    )
    def test_log_norm_values(self, sample_size, expected_approx):
        """log-normalization 在不同 sample_size 下的值。"""
        delta = compute_delta(confidence=0.9, risk_level="low", sample_size=sample_size)
        # 手动计算预期值
        norm = math.log(sample_size + 1) / math.log(MAX_SAMPLES + 1)
        expected = 0.9 * (1.0 - 0.2) * norm  # confidence * (1 - risk_weight) * norm
        assert delta == pytest.approx(expected, abs=0.01)

    def test_high_risk_never_auto(self):
        """high risk 即使 sample_size=20 也为 manual。"""
        delta = compute_delta(confidence=0.9, risk_level="high", sample_size=20)
        level = decide_audit_level(delta)
        assert level == "manual"

    def test_low_risk_max_sample_auto(self):
        """low risk + sample_size=20 → auto。"""
        delta = compute_delta(confidence=0.9, risk_level="low", sample_size=20)
        level = decide_audit_level(delta)
        assert level == "auto"


# ── TC-M7-04: Negative sample_size validation ────────────────────────


@pytest.mark.skipif(
    not _M7_DELTA_HAS_SAMPLE_SIZE,
    reason="M7 sample_size not yet implemented in compute_delta",
)
class TestComputeDeltaValidation:
    """M7: sample_size 边界校验。"""

    def test_negative_sample_size_raises(self):
        """sample_size < 0 → ValueError。"""
        with pytest.raises(ValueError, match="sample_size must be >= 0"):
            compute_delta(confidence=0.9, risk_level="low", sample_size=-1)


# ── TC-M7-05: get_audit_decision integration ─────────────────────────


@pytest.mark.skipif(
    not _M7_AUDIT_HAS_SAMPLE_SIZE,
    reason="M7 sample_size integration not yet in get_audit_decision",
)
class TestGetAuditDecisionIntegration:
    """M7: get_audit_decision 传入 sample_size。"""

    def test_new_rule_uses_legacy_formula(self, tmp_repo):
        """新规则（无 sample_size frontmatter）→ 旧公式。"""
        from aristotle_mcp.server import (
            get_audit_decision,
            init_repo_tool,
            write_rule,
        )

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

    def test_feedback_updated_rule_uses_log_norm(self, tmp_repo):
        """feedback 更新后的规则使用 log-normalization。"""
        from aristotle_mcp.frontmatter import update_frontmatter_field
        from aristotle_mcp.server import (
            commit_rule,
            get_audit_decision,
            init_repo_tool,
            stage_rule,
            write_rule,
        )

        init_repo_tool()
        w = write_rule(
            content="## Updated rule",
            category="HALLUCINATION",
            confidence=0.9,
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        # 模拟 feedback 更新 sample_size
        update_frontmatter_field(Path(w["file_path"]), "sample_size", "10")

        result = get_audit_decision(w["file_path"])
        delta = result.get("delta", 0)
        # 应小于旧公式的 0.18（因为 log-norm 降低）
        assert delta < 0.18
