from gpav_validator import GPAVValidator


def _make_submission(findings=None, run_id="run-001", round_num=1, **extra):
    return {
        "run_id": run_id,
        "round": round_num,
        "findings": findings or [],
        **extra,
    }


def _make_finding(fid="f1", severity="H", description="issue found", location="src/a.ts:10"):
    return {"id": fid, "severity": severity, "description": description, "location": location}


class TestGPAVValidator:
    # VH-106
    def test_should_reject_invalid_severity_enum(self):
        validator = GPAVValidator()
        submission = _make_submission(findings=[_make_finding(severity="X")])
        result = validator.validate(submission)
        assert not result.valid

    # VH-107
    def test_should_reject_non_monotonic_round(self):
        validator = GPAVValidator()
        submission = _make_submission(round_num=2, findings=[_make_finding()])
        validator.validate(submission)
        non_monotonic = _make_submission(round_num=1, findings=[_make_finding()])
        result = validator.validate(non_monotonic)
        assert not result.valid

    # VH-108
    def test_should_silently_truncate_findings_at_cap_50(self):
        validator = GPAVValidator()
        findings = [_make_finding(fid=f"f{i}", description=f"issue {i}") for i in range(55)]
        submission = _make_submission(findings=findings)
        result = validator.validate(submission)
        assert result.valid is True
        assert len(result.truncated_findings) == 50

    # VH-109
    def test_should_reject_duplicate_severity_description(self):
        validator = GPAVValidator()
        findings = [
            _make_finding(fid="f1", severity="H", description="same issue", location="src/a.ts:10"),
            _make_finding(fid="f2", severity="H", description="same issue", location="src/b.ts:20"),
        ]
        submission = _make_submission(findings=findings)
        result = validator.validate(submission)
        assert not result.valid

    # VH-110
    def test_should_reject_duplicate_finding_ids(self):
        validator = GPAVValidator()
        findings = [
            _make_finding(fid="f1", severity="H", description="issue A"),
            _make_finding(fid="f1", severity="M", description="issue B"),
        ]
        submission = _make_submission(findings=findings)
        result = validator.validate(submission)
        assert not result.valid

    # VH-134
    def test_should_prevent_later_gpav_steps_when_earlier_step_rejects(self):
        validator = GPAVValidator()
        submission = _make_submission(findings=[_make_finding(severity="INVALID")])
        result = validator.validate(submission)
        assert not result.valid
        assert result.rejection_reason != ""
