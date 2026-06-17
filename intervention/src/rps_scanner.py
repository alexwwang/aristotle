"""RPSScanner — detects risky prompt suggestions via 12 regex patterns (6 EN + 6 CN)."""
import re
from dataclasses import dataclass
from typing import List


@dataclass
class RPSMatch:
    pattern_id: str
    pattern: str
    location: int
    severity_tier: str


_PATTERNS = [
    ("en-1", "ignore all previous instructions", "warn"),
    ("en-2", "you are now", "warn"),
    ("en-3", "new instructions", "warn"),
    ("en-4", "disregard your training", "warn"),
    ("en-5", "pretend you are", "warn"),
    ("en-6", "override safety", "warn"),
    ("cn-1", "忽略所有之前的指令", "warn"),
    ("cn-2", "你现在是一个", "warn"),
    ("cn-3", "新指令", "warn"),
    ("cn-4", "无视你的训练", "warn"),
    ("cn-5", "假装你是", "warn"),
    ("cn-6", "覆盖安全", "warn"),
]


class RPSScanner:
    def scan(self, prompt: str, description: str = "") -> List[RPSMatch]:
        if not prompt and not description:
            return []
        matches: List[RPSMatch] = []
        for pattern_id, pattern_text, tier in _PATTERNS:
            for source_text in (prompt, description):
                if not source_text:
                    continue
                idx = source_text.lower().find(pattern_text.lower())
                if idx >= 0:
                    matches.append(RPSMatch(
                        pattern_id=pattern_id,
                        pattern=pattern_text,
                        location=idx,
                        severity_tier=tier,
                    ))
                    break
        return matches
