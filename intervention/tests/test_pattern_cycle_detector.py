import pytest
from pattern_cycle_detector import PatternCycleDetector


class TestPatternCycleDetector:
    # VH-040
    def test_should_record_checkpoints_in_sliding_window(self):
        detector = PatternCycleDetector()
        for i in range(12):
            detector.record_checkpoint("run-001", "SKIP_RED_PHASE" if i % 3 == 0 else "checkpoint_clean")

    # VH-041
    def test_should_detect_threshold_at_exactly_3_in_10(self):
        detector = PatternCycleDetector()
        checkpoints = [
            ("t01", "SKIP_RED_PHASE"),
            ("t02", "checkpoint_clean"),
            ("t03", "MODIFIED_TEST"),
            ("t04", "checkpoint_clean"),
            ("t05", "SKIP_RED_PHASE"),
            ("t06", "checkpoint_clean"),
            ("t07", "checkpoint_clean"),
            ("t08", "checkpoint_clean"),
            ("t09", "checkpoint_clean"),
            ("t10", "SKIP_RED_PHASE"),
        ]
        for _, vtype in checkpoints:
            detector.record_checkpoint("run-001", vtype)
        detector.check_cycle("run-001", "SKIP_RED_PHASE")

    # VH-042
    def test_should_dilute_with_non_violation_checkpoints(self):
        detector = PatternCycleDetector()
        for i in range(10):
            if i in (0, 4, 9):
                detector.record_checkpoint("run-001", "SKIP_RED_PHASE")
            else:
                detector.record_checkpoint("run-001", "checkpoint_clean")
        detector.check_cycle("run-001", "SKIP_RED_PHASE")

    # VH-043
    def test_should_not_detect_when_out_of_window(self):
        detector = PatternCycleDetector()
        for i in range(15):
            if i in (0, 11, 13):
                detector.record_checkpoint("run-001", "SKIP_RED_PHASE")
            else:
                detector.record_checkpoint("run-001", "checkpoint_clean")
        count, reached = detector.check_cycle("run-001", "SKIP_RED_PHASE")
        assert not reached

    # VH-044
    def test_should_return_zero_for_unknown_run_id(self):
        detector = PatternCycleDetector()
        count, reached = detector.check_cycle("unknown-run", "SKIP_RED_PHASE")
        assert count == 0
        assert not reached

    # VH-048
    def test_should_start_fresh_window_after_crash(self):
        detector = PatternCycleDetector()
        count, reached = detector.check_cycle("run-001", "SKIP_RED_PHASE")
        assert not reached
