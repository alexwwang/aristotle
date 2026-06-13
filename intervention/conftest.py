import sys
import subprocess
from pathlib import Path
from datetime import datetime

import pytest

# Make intervention/src/ importable as bare module names
# (rollback_engine, commit_guard, intervention_coordinator, etc.)
sys.path.insert(0, str(Path(__file__).parent / "src"))


@pytest.fixture
def repo_root(tmp_path):
    """Isolated git repository for testing."""
    git_dir = tmp_path / "test_repo"
    git_dir.mkdir()
    subprocess.run(["git", "init"], cwd=git_dir, check=True)
    ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
    subprocess.run(["git", "config", "user.email", f"test-{ts}@example.com"], cwd=git_dir, check=True)
    subprocess.run(["git", "config", "user.name", f"Test User {ts}"], cwd=git_dir, check=True)
    return str(git_dir)
