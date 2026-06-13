from checkpoint_bounded_counter import CheckpointBoundedCounter


class TestCheckpointBoundedCounter:
    # VH-127
    def test_should_create_new_key_on_spreading_violation(self):
        counter = CheckpointBoundedCounter()
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts", "user.ts"])
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 1
        assert counter.get_count("REGRESSION", ["auth.ts", "user.ts"]) == 1

    # VH-128
    def test_should_persist_across_suspend_resume(self):
        counter = CheckpointBoundedCounter()
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 2
        counter.checkpoint()
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 4

    # VH-139
    def test_should_reset_after_2_consecutive_clean_checkpoints(self):
        counter = CheckpointBoundedCounter()
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_success("REGRESSION", ["auth.ts"])
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 2
        counter.record_success("REGRESSION", ["auth.ts"])
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 0

    # VH-140
    def test_should_reset_on_successful_resolution(self):
        counter = CheckpointBoundedCounter()
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_success("REGRESSION", ["auth.ts"])
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 0

    # VH-131
    def test_should_pause_pipeline_at_checkpoint_bounded_counter_threshold_4(self):
        counter = CheckpointBoundedCounter()
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        counter.record_failure("REGRESSION", ["auth.ts"])
        count = counter.record_failure("REGRESSION", ["auth.ts"])
        assert count == 4
        assert counter.get_count("REGRESSION", ["auth.ts"]) == 4
