"""Tests for aristotle_mcp.evolution — Δ decision engine."""

from __future__ import annotations

import pytest


class TestEvolution:
    def test_compute_delta_high_risk(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(1.0, "high") == pytest.approx(0.2)
        assert compute_delta(0.5, "high") == pytest.approx(0.1)

    def test_compute_delta_medium_risk(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(1.0, "medium") == pytest.approx(0.5)
        assert compute_delta(0.8, "medium") == pytest.approx(0.4)

    def test_compute_delta_low_risk(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(1.0, "low") == pytest.approx(0.8)
        assert compute_delta(0.5, "low") == pytest.approx(0.4)

    def test_compute_delta_zero_confidence(self):
        from aristotle_mcp.evolution import compute_delta

        assert compute_delta(0.0, "high") == 0.0
        assert compute_delta(0.0, "low") == 0.0

    def test_compute_delta_invalid_risk_level(self):
        from aristotle_mcp.evolution import compute_delta

        with pytest.raises(ValueError, match="Unknown risk_level"):
            compute_delta(0.5, "critical")

    def test_compute_delta_invalid_confidence(self):
        from aristotle_mcp.evolution import compute_delta

        with pytest.raises(ValueError, match="confidence must be between"):
            compute_delta(1.5, "high")
        with pytest.raises(ValueError, match="confidence must be between"):
            compute_delta(-0.1, "low")

    def test_decide_audit_level_auto(self):
        from aristotle_mcp.evolution import decide_audit_level

        assert decide_audit_level(0.75) == "auto"
        assert decide_audit_level(0.7 + 0.001) == "auto"
        assert decide_audit_level(1.0) == "auto"

    def test_decide_audit_level_semi(self):
        from aristotle_mcp.evolution import decide_audit_level

        assert decide_audit_level(0.5) == "semi"
        assert decide_audit_level(0.7) == "semi"
        assert decide_audit_level(0.4 + 0.001) == "semi"

    def test_decide_audit_level_manual(self):
        from aristotle_mcp.evolution import decide_audit_level

        assert decide_audit_level(0.4) == "manual"
        assert decide_audit_level(0.3) == "manual"
        assert decide_audit_level(0.0) == "manual"

    def test_delta_audit_integration(self):
        """End-to-end: confidence + risk → Δ → audit level."""
        from aristotle_mcp.evolution import compute_delta, decide_audit_level

        # Low risk, high confidence → auto
        d = compute_delta(0.95, "low")
        assert decide_audit_level(d) == "auto"

        # High risk, moderate confidence → manual
        d = compute_delta(0.4, "high")
        assert decide_audit_level(d) == "manual"

        # Medium risk, high confidence → semi
        d = compute_delta(0.9, "medium")
        assert decide_audit_level(d) == "semi"
