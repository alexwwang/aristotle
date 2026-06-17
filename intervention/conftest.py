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


@pytest.fixture(autouse=True)
def _seed_initial_commit_for_clean_tree_tests(request):
    # Pre-seed a file for tests whose setup does `git add . && git commit -m init`
    # (fails on empty repo with no files to commit).
    test_name = request.node.name
    if test_name in (
        "test_ensure_committed_skips_when_tree_clean",
        "test_failure_counter_resets_on_clean_tree",
    ):
        repo_root = request.getfixturevalue("repo_root")
        (Path(repo_root) / ".gitignore").write_text("")
    yield
