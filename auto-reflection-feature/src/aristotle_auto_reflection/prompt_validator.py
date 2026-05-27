"""PromptValidator — detects forbidden patterns in prompts (FP-1 through FP-7)."""

import logging
import re
from aristotle_auto_reflection.intervention_types import ValidationResult, PatternMatch

logger = logging.getLogger(__name__)


class PromptValidator:
    # Pre-compiled English patterns
    EN_COMPILED = {
        "FP-1": [
            re.compile(p, re.IGNORECASE) for p in [r"\bstop condition\b", r"\bgate pass\b", r"\b2 consecutive rounds\b"]
        ],
        "FP-2": [
            re.compile(p, re.IGNORECASE) for p in [r"\bcumulative tally\b", r"\brunning total\b", r"\btotal [CHM]\b"]
        ],
        "FP-3": [
            re.compile(p, re.IGNORECASE)
            for p in [r"\bprior round\b", r"\bprevious round\b", r"\blast round\b", r"\bround \d+ found\b"]
        ],
        "FP-4": [
            re.compile(p, re.IGNORECASE)
            for p in [r"\bfix list\b", r"\bfixes applied\b", r"\baddressed items\b", r"\bresolved issues\b"]
        ],
        "FP-5": [
            re.compile(p, re.IGNORECASE)
            for p in [r"\bround \d+\b", r"\bround count\b", r"\bthis is round\b", r"\bloop round\b"]
        ],
        "FP-6": [
            re.compile(p, re.IGNORECASE) for p in [r"\bloop state\b", r"\bgate status\b", r"\bpass.?fail status\b"]
        ],
        "FP-7": [
            re.compile(p, re.IGNORECASE)
            for p in [r"\bonly check \w+\b", r"\blimit scope to\b", r"\bfocus only on\b", r"\bdo not review\b"]
        ],
    }

    # Pre-compiled Chinese patterns
    ZH_COMPILED = {
        k: [re.compile(p) for p in ps]
        for k, ps in {
            "FP-1": [
                r"停止条件",
                r"连续2轮",
                r"连续两轮",
                r"审查达标",
                r"质量达标",
            ],
            "FP-2": [
                r"累计计数",
                r"累计统计",
                r"总[CHM]数",
            ],
            "FP-3": [
                r"上一轮",
                r"前一轮",
                r"上轮发现",
                r"之前发现",
            ],
            "FP-4": [
                r"修复列表",
                r"已修复",
                r"已解决",
                r"修改清单",
            ],
            "FP-5": [
                r"第\d+轮",
                r"第几轮",
                r"当前轮次",
                r"loop轮次",
            ],
            "FP-6": [
                r"循环状态",
                r"审查状态",
                r"是否通过",
            ],
            "FP-7": [
                r"只检查[\w\u4e00-\u9fff]+",
                r"不要审查",
                r"限制范围",
                r"跳过审查",
            ],
        }.items()
    }

    _CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```", re.DOTALL)
    _INLINE_CODE_RE = re.compile(r"`[^`]+`")
    _QUOTED_RE = re.compile(r'"[^"]*"|' + r"'[^']*'")
    _HEADING_RE = re.compile(r"^#{1,6}\s+.*$", re.MULTILINE)

    def validate(self, prompt: str) -> ValidationResult:
        text = self._CODE_BLOCK_RE.sub("", prompt)
        text = self._INLINE_CODE_RE.sub("", text)
        text = self._QUOTED_RE.sub("", text)
        text = self._HEADING_RE.sub("", text)
        matches = self._match_compiled(text, self.EN_COMPILED, "en") + self._match_compiled(
            text, self.ZH_COMPILED, "zh"
        )
        return ValidationResult(is_valid=len(matches) == 0, matches=matches)

    def _match_compiled(self, text, compiled_map, lang):
        matches = []
        for category, cps in compiled_map.items():
            for cp in cps:
                for m in cp.finditer(text):
                    matches.append(PatternMatch(category, m.group(), text[: m.start()].count("\n") + 1, lang))
        return matches
