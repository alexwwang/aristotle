"""RPSScanner — detects risky prompt suggestions.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from dataclasses import dataclass
from typing import List


@dataclass
class RPSMatch:
    pattern_id: str
    pattern: str
    location: int
    severity_tier: str


class RPSScanner:
    def scan(self, prompt: str, description: str = "") -> List[RPSMatch]:
        raise NotImplementedError
