"""ValidityEliminator unit tests — Phase 4 TDD Red Phase."""

from priority_pipeline import ValidityEliminator
from intervention_types import ViolationEvent


def _event(vtype, filepath="", phase=5, **ctx_extra):
    ctx = {"phase": phase}
    ctx.update(ctx_extra)
    return ViolationEvent(vtype, filepath, "2026-06-12T10:00:00Z", ctx)


# VH-020
def test_should_not_eliminate_p1_cross_independence():
    # Given: SKIP_RED_PHASE quarantines src/a.py
    # When: ValidityEliminator checks MODIFIED_TEST (tests/test_b.py) and MISSING_TEST (src/c.py)
    # Then: Both remain valid — P1 fixes targeting different files are independent
    eliminator = ValidityEliminator()
    applied = _event("SKIP_RED_PHASE", filepath="src/a.py")
    pending = [
        _event("MODIFIED_TEST", filepath="tests/test_b.py"),
        _event("MISSING_TEST", filepath="src/c.py"),
    ]
    result = eliminator.eliminate(pending, applied)
    assert len(result) == 2
    assert result[0].violation_type == "MODIFIED_TEST"
    assert result[1].violation_type == "MISSING_TEST"
