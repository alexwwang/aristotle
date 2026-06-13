import pytest
from signal_mapper import (
    SignalMapper,
    SIGNAL_TO_TYPE,
    SPECIAL_SIGNAL_TO_TYPE,
    PROTOCOL_SIGNALS,
)


class TestSignalMapper:
    # VH-001
    def test_should_map_all_regular_detection_signals(self):
        mapper = SignalMapper()
        for signal, expected_type in SIGNAL_TO_TYPE.items():
            result = mapper.classify(signal)
            assert result == expected_type

    # VH-002
    def test_should_map_all_special_detection_signals(self):
        mapper = SignalMapper()
        for signal, expected_type in SPECIAL_SIGNAL_TO_TYPE.items():
            result = mapper.classify(signal)
            assert result == expected_type

    # VH-003
    def test_should_raise_value_error_on_unknown_signal(self):
        mapper = SignalMapper()
        with pytest.raises(ValueError):
            mapper.classify("unknown-signal-xyz")

    # VH-004
    def test_should_accept_snake_case_run_id(self):
        mapper = SignalMapper()
        context = {"run_id": "run-001", "phase": 5}
        result = mapper.resolve_run_id(context)
        assert result == "run-001"

    # VH-005
    def test_should_accept_camel_case_run_id(self):
        mapper = SignalMapper()
        context = {"runId": "run-001", "phase": 5}
        result = mapper.resolve_run_id(context)
        assert result == "run-001"

    # VH-006
    def test_should_raise_when_context_phase_missing(self):
        mapper = SignalMapper()
        context = {"run_id": "run-001"}
        with pytest.raises(ValueError):
            mapper.validate_context(context)

    # VH-007
    def test_should_raise_when_context_phase_invalid(self):
        mapper = SignalMapper()
        context = {"run_id": "run-001", "phase": 0}
        with pytest.raises(ValueError):
            mapper.validate_context(context)

    # VH-121
    def test_should_exclude_protocol_signals_from_signal_to_type(self):
        for protocol_key in PROTOCOL_SIGNALS:
            assert protocol_key not in SIGNAL_TO_TYPE
            assert protocol_key not in SPECIAL_SIGNAL_TO_TYPE
        # Verify classify() rejects protocol signals
        mapper = SignalMapper()
        for protocol_key in PROTOCOL_SIGNALS:
            with pytest.raises(ValueError):
                mapper.classify(protocol_key)
