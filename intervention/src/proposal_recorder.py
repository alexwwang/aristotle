"""ProposalRecorder — records GPAV proposals and parses locations.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""
from typing import List, Tuple


class ProposalRecorder:
    def record_proposals(self, submission: dict) -> List[dict]:
        raise NotImplementedError

    def parse_location(self, location: str) -> Tuple[List[str], int, int]:
        raise NotImplementedError
