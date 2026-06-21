"""Tests for aristotle_mcp._intervention_bridge.run_intervene_batch.

Mocks InterventionCoordinator to verify the bridge wiring without
exercising the real intervention engine. Co-located with intervention
tests so the conftest.py path insertion (intervention/src/) is active.
"""
import json
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture
def base_payload():
    return {
        "context": {
            "project_id": "proj-1",
            "run_id": "run-1",
            "phase": 5,
            "current_phase": 5,
            "ki_doc_path": "/tmp/ki.md",
        },
        "violations": [],
    }


def _result(*, success=True, action="noop", user_message="", violation_type="", files=None, pipeline_action=None):
    return {
        "violation_type": violation_type or "TEST",
        "action": action,
        "success": success,
        "user_message": user_message,
        "files_affected": files or [],
        "pipeline_action": pipeline_action,
    }


class TestRunInterveneBatch:
    def test_empty_violations_returns_empty_envelope(self, base_payload):
        from aristotle_mcp._intervention_bridge import run_intervene_batch

        result = run_intervene_batch(json.dumps(base_payload))

        assert result["results"] == []
        assert result["total"] == 0
        assert result["succeeded"] == 0
        assert result["failed"] == 0
        assert result["error"] is None

    def test_single_violation_dispatches_to_coordinator(self, base_payload):
        from aristotle_mcp._intervention_bridge import run_intervene_batch

        base_payload["violations"] = [{
            "signal": "violation-gate-block",
            "context": {"phase": 5, "run_id": "run-1"},
            "affected_file_paths": ["src/app.py"],
        }]

        mock_coordinator = MagicMock()
        mock_coordinator.intervene_from_signal.return_value = MagicMock(
            violation_type="UNFIXED_ISSUES",
            action="instructed",
            success=True,
            user_message="proceed with fixes",
            files_affected=["src/app.py"],
            pipeline_action=None,
        )

        with patch(
            "aristotle_mcp._intervention_bridge.InterventionCoordinator",
            create=True,
        ) as mock_cls:
            # The bridge does `from intervention_coordinator import InterventionCoordinator`
            # so we patch the symbol actually imported into the bridge module namespace.
            pass

        # Patch at the source import location (the bridge re-imports each call)
        with patch("intervention_coordinator.InterventionCoordinator") as mock_cls:
            mock_cls.return_value = mock_coordinator
            result = run_intervene_batch(json.dumps(base_payload))

        assert result["total"] == 1
        assert result["succeeded"] == 1
        assert result["failed"] == 0
        assert result["results"][0]["action"] == "instructed"
        assert result["results"][0]["success"] is True
        mock_coordinator.intervene_from_signal.assert_called_once()
        call_args = mock_coordinator.intervene_from_signal.call_args
        assert call_args[0][0] == "violation-gate-block"
        assert call_args[0][1]["phase"] == 5
        assert call_args[0][1]["run_id"] == "run-1"

    def test_multiple_violations_aggregates_counts(self, base_payload):
        from aristotle_mcp._intervention_bridge import run_intervene_batch

        base_payload["violations"] = [
            {"signal": "violation-gate-block", "context": {"phase": 5, "run_id": "run-1"}},
            {"signal": "no-test-modification-during-green", "context": {"phase": 5, "run_id": "run-1"},
             "affected_file_paths": ["tests/t.py"]},
            {"signal": "violation-gate-block", "context": {"phase": 5, "run_id": "run-1"}},
        ]

        side_effects = [
            MagicMock(violation_type="UNFIXED_ISSUES", action="instructed", success=True,
                      user_message="ok1", files_affected=[], pipeline_action=None),
            MagicMock(violation_type="MODIFIED_TEST", action="blocked", success=False,
                      user_message="rollback test", files_affected=["tests/t.py"],
                      pipeline_action="suspended"),
            MagicMock(violation_type="UNFIXED_ISSUES", action="instructed", success=True,
                      user_message="ok2", files_affected=[], pipeline_action=None),
        ]

        mock_coordinator = MagicMock()
        mock_coordinator.intervene_from_signal.side_effect = side_effects

        with patch("intervention_coordinator.InterventionCoordinator") as mock_cls:
            mock_cls.return_value = mock_coordinator
            result = run_intervene_batch(json.dumps(base_payload))

        assert result["total"] == 3
        assert result["succeeded"] == 2
        assert result["failed"] == 1
        assert result["results"][0]["success"] is True
        assert result["results"][1]["success"] is False
        assert result["results"][1]["action"] == "blocked"
        assert result["results"][1]["pipeline_action"] == "suspended"
        assert result["results"][2]["success"] is True
        assert mock_coordinator.intervene_from_signal.call_count == 3

    def test_invalid_json_returns_empty_envelope_with_error(self):
        from aristotle_mcp._intervention_bridge import run_intervene_batch

        result = run_intervene_batch("not valid json {{{")

        assert result["results"] == []
        assert result["total"] == 0
        assert result["succeeded"] == 0
        assert result["failed"] == 0
        assert result["error"] is not None
        assert "json" in result["error"].lower() or "invalid" in result["error"].lower()
