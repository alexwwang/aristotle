"""Tests for violation-gate-block rollback + pipeline reset workflow."""

import json
from pathlib import Path

import pytest

from aristotle_mcp._intervention_bridge import run_intervene_batch


@pytest.fixture
def git_repo(tmp_path, monkeypatch):
    """Create a temp git repo and redirect ARISTOTLE_REPO_DIR to it."""
    import subprocess

    monkeypatch.setenv("ARISTOTLE_REPO_DIR", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True, check=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=str(tmp_path),
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=str(tmp_path),
        capture_output=True,
        check=True,
    )
    return tmp_path


class TestViolationGateBlockWorkflow:
    def test_phase_enter_checkpoint_creates_stash(self, git_repo: Path):
        payload = json.dumps(
            {
                "context": {"run_id": "r1", "phase": 5},
                "violations": [
                    {
                        "signal": "phase-enter-checkpoint",
                        "context": {"phase": 5, "run_id": "r1"},
                    }
                ],
            }
        )
        result = run_intervene_batch(payload)

        assert result["error"] is None
        assert result["failed"] == 0
        assert result["succeeded"] == 1
        action = result["results"][0]["action"]
        assert action == "checkpoint_created"

    def test_gate_block_rolls_back_and_resets_state(self, git_repo: Path):
        import subprocess

        # 1. create a file and commit it
        test_file = git_repo / "tracked.txt"
        test_file.write_text("before")
        subprocess.run(["git", "add", "tracked.txt"], cwd=str(git_repo), capture_output=True)
        subprocess.run(["git", "commit", "-m", "initial"], cwd=str(git_repo), capture_output=True)

        # 2. create checkpoint at phase enter
        run_intervene_batch(
            json.dumps(
                {
                    "context": {"run_id": "r1", "phase": 5},
                    "violations": [
                        {
                            "signal": "phase-enter-checkpoint",
                            "context": {"phase": 5, "run_id": "r1"},
                        }
                    ],
                }
            )
        )

        # 3. modify file
        test_file.write_text("after")

        # 4. gate block should rollback + reset
        payload = json.dumps(
            {
                "context": {"run_id": "r1", "phase": 5},
                "violations": [
                    {
                        "signal": "violation-gate-block",
                        "context": {"phase": 5, "run_id": "r1"},
                    }
                ],
            }
        )
        result = run_intervene_batch(payload)

        assert result["error"] is None
        assert result["failed"] == 0
        assert result["succeeded"] == 1
        item = result["results"][0]
        assert item["action"] == "blocked"
        assert item["pipeline_action"] == "blocked"
        assert "Rolled back to phase-5-start" in item["user_message"]
        assert "Pipeline state reset" in item["user_message"]
        assert "git-stash" in item["files_affected"]
        assert "pipeline-state" in item["files_affected"]

        # working tree restored
        assert test_file.read_text() == "before"

        # pipeline state reset
        state_file = git_repo / ".aristotle" / "pipeline-state.json"
        assert state_file.exists()
        state = json.loads(state_file.read_text())
        assert state.get("phase") == 1
