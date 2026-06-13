"""Quarantine edge case tests."""
import pytest
from quarantine_engine import QuarantineEngine


@pytest.fixture
def engine(repo_root):
    return QuarantineEngine(repo_root=repo_root)


# === Q-123: Raise ValueError when file path is empty string ===

def test_should_raise_value_error_when_file_path_is_empty_string(engine):
    """Q-123: files=[''] raises ValueError for empty file path."""
    with pytest.raises(ValueError, match='empty'):
        engine.move_to_quarantine(
            files=[""], run_id="run-123", phase=4,
            violation_type="SKIP_RED_PHASE",
        )
