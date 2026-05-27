import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aristotle_auto_reflection.prompt_validator import PromptValidator
from aristotle_auto_reflection.intervention_types import ValidationResult, PatternMatch


CLEAN_PROMPT = "Review the following code changes for correctness and style. Check for edge cases in error handling."

FORBIDDEN_EN_SAMPLES = {
    "FP-1": "Make sure to check the stop condition before proceeding.",
    "FP-2": "Here is the cumulative tally of issues found.",
    "FP-3": "In the prior round, we found 3 issues.",
    "FP-4": "The fix list includes items 1 through 5.",
    "FP-5": "This is round 4 of the review loop.",
    "FP-6": "Current loop state: gate status is open.",
    "FP-7": "Only check the imports section of the file.",
}

FORBIDDEN_ZH_SAMPLES = {
    "FP-1": "请检查停止条件是否满足。",
    "FP-2": "累计计数显示共有5个问题。",
    "FP-3": "上一轮发现了3个问题。",
    "FP-4": "修复列表包含5个项目。",
    "FP-5": "这是第3轮审查。",
    "FP-6": "当前循环状态为进行中。",
    "FP-7": "不要审查这个文件。",
}


@pytest.fixture
def validator():
    return PromptValidator()


class TestCleanPrompt:
    def test_should_pass_clean_prompt(self, validator):
        result = validator.validate(CLEAN_PROMPT)
        assert isinstance(result, ValidationResult)
        assert result.is_valid is True
        assert result.matches == []

    def test_should_pass_empty_prompt(self, validator):
        result = validator.validate("")
        assert result.is_valid is True
        assert result.matches == []


class TestFlagENPatterns:
    def test_should_flag_prompt_with_forbidden_en_patterns(self, validator):
        prompt = FORBIDDEN_EN_SAMPLES["FP-1"]
        result = validator.validate(prompt)
        assert result.is_valid is False
        assert len(result.matches) >= 1


class TestExemptCodeBlocks:
    def test_should_exempt_patterns_in_code_blocks(self, validator):
        prompt = "```python\nstop condition gate pass\n```\nThis is normal text."
        result = validator.validate(prompt)
        code_block_matches = [m for m in result.matches if m.pattern in ("stop condition", "gate pass")]
        assert len(code_block_matches) == 0


class TestExemptInlineCode:
    def test_should_exempt_patterns_in_inline_code(self, validator):
        prompt = "Use `stop condition` to check. Also `cumulative tally` is not allowed."
        result = validator.validate(prompt)
        inline_matches = [m for m in result.matches if m.pattern in ("stop condition", "cumulative tally")]
        assert len(inline_matches) == 0


class TestExemptQuotedText:
    def test_should_exempt_patterns_in_quoted_reference_context(self, validator):
        prompt = 'The prompt says "stop condition" but that is just a reference.'
        result = validator.validate(prompt)
        quoted_matches = [m for m in result.matches if m.pattern == "stop condition"]
        assert len(quoted_matches) == 0


class TestExemptHeadings:
    def test_should_exempt_patterns_in_markdown_headings(self, validator):
        prompt = "# Stop condition check\n## Gate pass evaluation\nNormal text here."
        result = validator.validate(prompt)
        heading_matches = [m for m in result.matches if m.pattern in ("stop condition", "gate pass")]
        assert len(heading_matches) == 0


class TestPartialCodeBlock:
    def test_should_handle_pattern_partially_inside_code_block(self, validator):
        prompt = "```python\nstop condition gate pass\n```\nnormal text"
        result = validator.validate(prompt)
        assert result.is_valid is True
        assert result.matches == []


class TestReportDetails:
    def test_should_report_matched_pattern_details(self, validator):
        prompt = FORBIDDEN_EN_SAMPLES["FP-1"]
        result = validator.validate(prompt)
        assert result.is_valid is False
        match = result.matches[0]
        assert match.category.startswith("FP-")
        assert match.pattern != ""
        assert match.line_number > 0
        assert match.language in ("en", "zh")


class TestReportMultipleMatches:
    def test_should_report_all_matches_when_multiple(self, validator):
        prompt = f"{FORBIDDEN_EN_SAMPLES['FP-1']} {FORBIDDEN_EN_SAMPLES['FP-3']}"
        result = validator.validate(prompt)
        assert result.is_valid is False
        assert len(result.matches) >= 2


class TestZHPatterns:
    def test_should_detect_chinese_forbidden_patterns_via_bare_regex(self, validator):
        prompt = FORBIDDEN_ZH_SAMPLES["FP-1"]
        result = validator.validate(prompt)
        assert result.is_valid is False
        zh_matches = [m for m in result.matches if m.language == "zh"]
        assert len(zh_matches) >= 1


class TestMixedPrompt:
    def test_should_detect_both_en_and_zh_in_mixed_prompt(self, validator):
        prompt = f"{FORBIDDEN_EN_SAMPLES['FP-1']} {FORBIDDEN_ZH_SAMPLES['FP-3']}"
        result = validator.validate(prompt)
        assert result.is_valid is False
        en_matches = [m for m in result.matches if m.language == "en"]
        zh_matches = [m for m in result.matches if m.language == "zh"]
        assert len(en_matches) >= 1
        assert len(zh_matches) >= 1


class TestFP1EN:
    def test_should_detect_fp1_en_stop_condition_patterns(self, validator):
        for phrase in ["stop condition", "gate pass", "2 consecutive rounds"]:
            result = validator.validate(f"Check {phrase} now.")
            assert result.is_valid is False, f"FP-1 should detect: {phrase}"


class TestFP2EN:
    def test_should_detect_fp2_en_cumulative_tally_patterns(self, validator):
        for phrase in ["cumulative tally", "running total", "total C"]:
            result = validator.validate(f"Show the {phrase}.")
            assert result.is_valid is False, f"FP-2 should detect: {phrase}"


class TestFP3EN:
    def test_should_detect_fp3_en_prior_round_patterns(self, validator):
        for phrase in ["prior round", "previous round", "last round"]:
            result = validator.validate(f"In the {phrase}, we found issues.")
            assert result.is_valid is False, f"FP-3 should detect: {phrase}"


class TestFP4EN:
    def test_should_detect_fp4_en_fix_list_patterns(self, validator):
        for phrase in ["fix list", "fixes applied", "addressed items"]:
            result = validator.validate(f"Here is the {phrase}.")
            assert result.is_valid is False, f"FP-4 should detect: {phrase}"


class TestFP5EN:
    def test_should_detect_fp5_en_round_count_patterns(self, validator):
        for phrase in ["round 4", "round count", "this is round"]:
            result = validator.validate(f'Currently in {phrase} of review.')
            assert result.is_valid is False, f"FP-5 should detect: {phrase}"


class TestFP6EN:
    def test_should_detect_fp6_en_loop_state_patterns(self, validator):
        for phrase in ["loop state", "gate status", "pass/fail status"]:
            result = validator.validate(f"Current {phrase} is open.")
            assert result.is_valid is False, f"FP-6 should detect: {phrase}"


class TestFP7EN:
    def test_should_detect_fp7_en_scope_limiting_phrases(self, validator):
        for phrase in ["only check the imports", "limit scope to", "focus only on", "do not review"]:
            result = validator.validate(f"Please {phrase}.")
            assert result.is_valid is False, f"FP-7 should detect: {phrase}"


class TestFP7IndividualWords:
    def test_should_not_flag_individual_words_for_fp7(self, validator):
        result = validator.validate("skip this part")
        skip_matches = [m for m in result.matches if m.pattern.strip() == "skip"]
        assert len(skip_matches) == 0
        result2 = validator.validate("only that part matters")
        only_matches = [m for m in result2.matches if m.pattern.strip() == "only"]
        assert len(only_matches) == 0


class TestFP1ZH:
    def test_should_detect_fp1_zh_stop_condition_patterns(self, validator):
        for phrase in ["停止条件", "连续2轮", "连续两轮", "审查达标", "质量达标"]:
            result = validator.validate(f"请检查{phrase}。")
            assert result.is_valid is False, f"FP-1 ZH should detect: {phrase}"


class TestFP2ZH:
    def test_should_detect_fp2_zh_cumulative_tally_patterns(self, validator):
        for phrase in ["累计计数", "累计统计", "总C数"]:
            result = validator.validate(f"显示{phrase}。")
            assert result.is_valid is False, f"FP-2 ZH should detect: {phrase}"


class TestFP3ZH:
    def test_should_detect_fp3_zh_prior_round_patterns(self, validator):
        for phrase in ["上一轮", "前一轮", "上轮发现", "之前发现"]:
            result = validator.validate(f"{phrase}发现了问题。")
            assert result.is_valid is False, f"FP-3 ZH should detect: {phrase}"


class TestFP4ZH:
    def test_should_detect_fp4_zh_fix_list_patterns(self, validator):
        for phrase in ["修复列表", "已修复", "已解决", "修改清单"]:
            result = validator.validate(f"{phrase}如下。")
            assert result.is_valid is False, f"FP-4 ZH should detect: {phrase}"


class TestFP4ZHNegative:
    def test_should_not_flag_normal_zh_bug_fix_statement(self, validator):
        result = validator.validate("代码看起来没问题，可以继续下一步")
        assert result.is_valid is True


class TestFP5ZH:
    def test_should_detect_fp5_zh_round_count_patterns(self, validator):
        for phrase in ["第3轮", "第几轮", "当前轮次", "loop轮次"]:
            result = validator.validate(f"这是{phrase}审查。")
            assert result.is_valid is False, f"FP-5 ZH should detect: {phrase}"


class TestFP6ZH:
    def test_should_detect_fp6_zh_loop_state_patterns(self, validator):
        for phrase in ["循环状态", "审查状态", "是否通过"]:
            result = validator.validate(f"当前{phrase}为通过。")
            assert result.is_valid is False, f"FP-6 ZH should detect: {phrase}"


class TestFP7ZH:
    def test_should_detect_fp7_zh_scope_limiting_patterns(self, validator):
        for phrase in ["只检查代码", "不要审查", "限制范围", "跳过审查", "只检查导入部分"]:
            result = validator.validate(f"请{phrase}这个部分。")
            assert result.is_valid is False, f"FP-7 ZH should detect: {phrase}"


class TestCaseInsensitiveEN:
    def test_should_match_en_patterns_case_insensitively(self, validator):
        result = validator.validate("STOP CONDITION and GATE PASS detected.")
        assert result.is_valid is False


class TestPatternMatchFields:
    def test_should_populate_pattern_match_with_category_pattern_line_language(self, validator):
        result = validator.validate(FORBIDDEN_EN_SAMPLES["FP-1"])
        assert result.is_valid is False
        m = result.matches[0]
        assert m.category == "FP-1"
        assert m.pattern != ""
        assert isinstance(m.line_number, int)
        assert m.language == "en"


class TestLongPromptHandling:
    def test_should_handle_very_long_prompt(self, validator):
        long_prompt = "x " * 10000 + "stop condition"
        result = validator.validate(long_prompt)
        assert result.is_valid is False
        assert len(result.matches) > 0
        assert result.matches[0].category == "FP-1"
