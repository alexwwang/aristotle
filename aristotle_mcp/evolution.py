"""Delta decision engine for GEAR audit-level routing.

Computes Δ = confidence × (1 − risk_weight) and maps the result to
an audit level (auto / semi / manual).

This module is stateless — no evolution stats, no level tracking.
Those are deferred to a future phase (see design_plan progress doc).
"""

from __future__ import annotations

from aristotle_mcp.config import AUDIT_THRESHOLDS, RISK_WEIGHTS


def compute_delta(confidence: float, risk_level: str) -> float:
    """Compute the Δ decision factor.

    Args:
        confidence: R's confidence score for the rule (0.0 – 1.0).
        risk_level: One of "high", "medium", "low" (from RISK_MAP).

    Returns:
        Δ value clamped to [0.0, 1.0].

    Raises:
        ValueError: If risk_level is not recognised.
    """
    if risk_level not in RISK_WEIGHTS:
        raise ValueError(
            f"Unknown risk_level '{risk_level}'. Must be one of {list(RISK_WEIGHTS)}"
        )
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence must be between 0.0 and 1.0, got {confidence}")
    risk_weight = RISK_WEIGHTS[risk_level]
    delta = confidence * (1.0 - risk_weight)
    # Clamp for floating-point safety
    return max(0.0, min(1.0, delta))


def decide_audit_level(delta: float) -> str:
    """Map a Δ value to an audit level.

    Thresholds are read from config.AUDIT_THRESHOLDS.

    Returns:
        "auto"   — Δ > threshold_auto  (default 0.7)
        "semi"   — threshold_semi < Δ ≤ threshold_auto (default 0.4–0.7)
        "manual" — Δ ≤ threshold_semi (default ≤ 0.4)
    """
    auto_threshold = AUDIT_THRESHOLDS["auto"]
    semi_threshold = AUDIT_THRESHOLDS["semi"]

    if delta > auto_threshold:
        return "auto"
    if delta > semi_threshold:
        return "semi"
    return "manual"
