from regression_counter import RegressionCounter


class TestRegressionCounter:
    # VH-033
    def test_should_increment_and_return_count(self):
        counter = RegressionCounter()
        assert counter.get_count("run-001") == 0
        counter.increment("run-001")
        assert counter.get_count("run-001") == 1
        counter.increment("run-001")
        assert counter.get_count("run-001") == 2
        counter.increment("run-001")
        assert counter.get_count("run-001") == 3

    # VH-034
    def test_should_reset_on_pipeline_resume(self):
        counter = RegressionCounter()
        counter.increment("run-001")
        counter.reset("run-001")
        assert counter.get_count("run-001") == 0

    # VH-133
    def test_should_start_child_pipeline_counters_at_zero_with_parent_unchanged(self):
        counter = RegressionCounter()
        counter.increment("parent-run-001")
        counter.increment("parent-run-001")
        counter.increment("parent-run-001")
        assert counter.get_count("child-run-001") == 0

    # VH-141
    def test_should_not_reset_cumulative_count_across_resume(self):
        counter = RegressionCounter()
        for _ in range(7):
            counter.increment("run-001")
        counter.reset("run-001")
        assert counter.get_cumulative_count("run-001") == 7
        counter.increment("run-001")
        assert counter.get_cumulative_count("run-001") == 8

    # VH-143
    def test_should_remove_all_counter_entries_on_cleanup_mcp_call(self):
        counter = RegressionCounter()
        for _ in range(5):
            counter.increment("run-001")
        result = counter.regression_counter_cleanup("run-001")
        assert counter.get_count("run-001") == 0
        assert counter.get_cumulative_count("run-001") == 0
        result2 = counter.regression_counter_cleanup("run-never-existed")
        assert isinstance(result2, dict)

    # VH-125
    def test_should_remap_to_pattern_cycle_at_cumulative_9(self):
        counter = RegressionCounter()
        for _ in range(9):
            counter.increment("run-001")
        assert counter.get_cumulative_count("run-001") == 9
        remap_state = counter.get_remap_state("run-001")
        assert remap_state.get('pattern') == 'repeated_violation'
        assert remap_state.get('cycle') >= 1

    # VH-126
    def test_should_prioritize_cumulative_remap_over_sliding_window(self):
        counter = RegressionCounter()
        for _ in range(5):
            counter.increment("run-001")
        counter.reset("run-001")
        for _ in range(4):
            counter.increment("run-001")
        assert counter.get_cumulative_count("run-001") == 9
        assert counter.get_count("run-001") == 4
        remap_state = counter.get_remap_state("run-001")
        assert isinstance(remap_state, dict)
