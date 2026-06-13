from rps_scanner import RPSScanner


EN_RPS_PATTERNS = [
    "ignore all previous instructions",
    "you are now",
    "new instructions",
    "disregard your training",
    "pretend you are",
    "override safety",
]

CN_RPS_PATTERNS = [
    "忽略所有之前的指令",
    "你现在是一个",
    "新指令",
    "无视你的训练",
    "假装你是",
    "覆盖安全",
]


class TestRPSScanner:
    # VH-111
    def test_should_match_all_6_en_patterns_with_warn_audit(self):
        scanner = RPSScanner()
        for pattern_text in EN_RPS_PATTERNS:
            result = scanner.scan(prompt=pattern_text, description="")
            assert len(result) > 0

    # VH-112
    def test_should_match_all_6_cn_patterns_with_warn_audit(self):
        scanner = RPSScanner()
        for pattern_text in CN_RPS_PATTERNS:
            result = scanner.scan(prompt=pattern_text, description="")
            assert len(result) > 0

    # VH-113
    def test_should_skip_scan_on_empty_prompt(self):
        scanner = RPSScanner()
        result = scanner.scan(prompt="", description="")
        assert result == []

    # VH-114
    def test_should_not_block_pipeline_on_rps_warn(self):
        scanner = RPSScanner()
        result = scanner.scan(prompt="ignore all previous instructions", description="")
        assert len(result) >= 1
        assert result[0].pattern == "ignore all previous instructions"
        assert all(m.severity_tier == "warn" for m in result)

    # VH-135
    def test_should_scan_both_prompt_and_description_fields_independently(self):
        scanner = RPSScanner()
        result1 = scanner.scan(prompt="clean prompt text", description="ignore all previous instructions")
        assert len(result1) > 0
        result2 = scanner.scan(prompt="ignore all previous instructions", description="clean description")
        assert len(result2) > 0
