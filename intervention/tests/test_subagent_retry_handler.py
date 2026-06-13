import pytest
from subagent_retry_handler import SubagentRetryHandler


class TestSubagentRetryHandler:
    # VH-070
    def test_should_build_spawn_request_attempt_1(self):
        handler = SubagentRetryHandler()
        result = handler.build_spawn_request(
            template_id="T-7b", params={"files": ["src/auth.py"]},
            run_id="run-001", violation_type="MODIFIED_TEST", attempt=1,
        )
        assert result['template_id'] == 'T-7b'
        assert 'escalation_hint' not in result

    # VH-071
    def test_should_build_spawn_request_attempt_2_with_hint(self):
        handler = SubagentRetryHandler()
        result = handler.build_spawn_request(
            template_id="T-7b", params={"files": ["src/auth.py"]},
            run_id="run-001", violation_type="MODIFIED_TEST", attempt=2,
            last_error="Timeout after 30s",
        )
        assert 'Failed 1 time' in result.get('escalation_hint', '')

    # VH-072
    def test_should_build_spawn_request_attempt_3_with_hint(self):
        handler = SubagentRetryHandler()
        result = handler.build_spawn_request(
            template_id="T-7b", params={"files": ["src/auth.py"]},
            run_id="run-001", violation_type="MODIFIED_TEST", attempt=3,
            last_error="Invalid input parameter",
        )
        assert 'Failed 2 times' in result.get('escalation_hint', '')

    # VH-073
    def test_should_build_spawn_request_attempt_4_with_final_hint(self):
        handler = SubagentRetryHandler()
        result = handler.build_spawn_request(
            template_id="T-7b", params={"files": ["src/auth.py"]},
            run_id="run-001", violation_type="MODIFIED_TEST", attempt=4,
            last_error="Network error",
        )
        assert 'final' in result.get('escalation_hint', '').lower()

    # VH-074
    def test_should_degrade_after_4_failed_attempts(self):
        handler = SubagentRetryHandler()
        with pytest.raises(ValueError):
            handler.report_subagent_degradation(
                template_id="T-7b", run_id="run-001",
                violation_type="MODIFIED_TEST",
                errors=["timeout", "invalid input", "network error", "final failure"],
            )

    # VH-075
    def test_should_treat_timeout_as_failure(self):
        handler = SubagentRetryHandler()
        result = handler.build_spawn_request(
            template_id="T-7b", params={"files": ["src/auth.py"]},
            run_id="run-001", violation_type="MODIFIED_TEST", attempt=2,
            last_error="Timeout after 30s",
        )
        assert result.get('escalation_hint') != ''
        assert 'timeout' in str(result.get('escalation_hint', '')).lower()

    # VH-080
    def test_should_degrade_directly_when_mcp_call_fails(self):
        handler = SubagentRetryHandler()
        with pytest.raises(ValueError):
            handler.report_subagent_degradation(
                template_id="T-7b", run_id="run-001",
                violation_type="MODIFIED_TEST",
                errors=["MCP call failed"],
            )
