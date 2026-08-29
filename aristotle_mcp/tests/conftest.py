import pytest


@pytest.fixture
def tmp_repo(tmp_path, monkeypatch):
    """Redirect ARISTOTLE_REPO_DIR to a temp dir for every test."""
    monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    # Clean the shared state file to prevent cross-test sequence leakage
    state_path = tmp_path.parent / "aristotle-state.json"
    if state_path.exists():
        state_path.unlink()
    return tmp_path


@pytest.fixture(autouse=True)
def _reset_mcp_state(request):
    """Reset MCP module-level state between tests."""
    yield
    # Clear any cached state from MCP modules
    import importlib
    import aristotle_mcp.config

    importlib.reload(aristotle_mcp.config)


@pytest.fixture
def tmp_repo(tmp_path, monkeypatch):
    """Redirect ARISTOTLE_REPO_DIR to a temp dir for every test."""
    monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    # Clean the shared state file to prevent cross-test sequence leakage
    state_path = tmp_path.parent / "aristotle-state.json"
    if state_path.exists():
        state_path.unlink()
    return tmp_path


@pytest.fixture(autouse=True)
def _reset_mcp_state(request):
    """Reset MCP module-level state between tests."""
    yield
    # Clear any cached state from MCP modules
    import importlib
    import aristotle_mcp.config

    importlib.reload(aristotle_mcp.config)


"""Test fixtures for aristotle_mcp tests."""

import subprocess
from pathlib import Path
from datetime import datetime

import pytest


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


@pytest.fixture(autouse=True)
def _reset_polluted_state_for_isolation_tests(request):
    """Reset state that could leak between tests."""
    test_name = request.node.name
    # These tests check pollution isolation; ensure clean state
    if "polluted" in test_name or "isolation" in test_name:
        from aristotle_mcp.git_ops import _reset_dirty_tracking

        _reset_dirty_tracking()
    yield
