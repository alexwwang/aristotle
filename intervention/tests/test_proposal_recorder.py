from proposal_recorder import ProposalRecorder


class TestProposalRecorder:
    # VH-115
    def test_should_record_severity_p_finding_to_round_records(self):
        recorder = ProposalRecorder()
        submission = {
            "run_id": "run-001",
            "round": 1,
            "findings": [
                {"id": "f1", "severity": "P", "description": "minor issue", "location": "src/a.ts:10"},
            ],
        }
        result = recorder.record_proposals(submission)
        assert len(result) > 0

    # VH-116
    def test_should_parse_all_4_location_patterns(self):
        recorder = ProposalRecorder()
        result1 = recorder.parse_location("src/a.ts:10")
        assert result1[0] == ["src/a.ts"]
        result2 = recorder.parse_location("src/a.ts:10:5")
        assert result2[0] == ["src/a.ts"]
        result3 = recorder.parse_location("src/a.ts:10-25")
        assert result3[0] == ["src/a.ts"]
        result4 = recorder.parse_location("src/a.ts:10:5-25:8")
        assert result4[0] == ["src/a.ts"]

    # VH-137
    def test_should_apply_longest_match_first_for_proposal_location_parsing(self):
        recorder = ProposalRecorder()
        result = recorder.parse_location("src/auth.ts:10:5-25:8")
        assert result[0] == ["src/auth.ts"]

    # VH-117
    def test_should_sanitize_paths_rejecting_traversal_and_absolute(self):
        recorder = ProposalRecorder()
        result1 = recorder.parse_location("../etc/passwd:10")
        assert result1 is None
        result2 = recorder.parse_location("/absolute/path/a.ts:10")
        assert result2 is None
        result3 = recorder.parse_location(":10")
        assert result3 is None

    # VH-118
    def test_should_never_record_for_gpav_rejected_submission(self):
        recorder = ProposalRecorder()
        submission = {
            "run_id": "run-001",
            "round": 1,
            "findings": [
                {"id": "f1", "severity": "H", "description": "bad", "location": "src/a.ts:10"},
            ],
            "gpav_rejected": True,
        }
        result = recorder.record_proposals(submission)
        assert len(result) == 0
