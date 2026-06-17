"""ProposalRecorder — records GPAV proposals and parses locations."""
import re
from typing import List, Optional, Tuple


_SOURCE_EXTENSIONS = (
    ".ts", ".py", ".js", ".tsx", ".jsx", ".go", ".rs", ".java", ".rb",
    ".c", ".cpp", ".h", ".cs", ".swift", ".kt", ".scala", ".php", ".vue",
    ".svelte", ".lua", ".css", ".scss", ".yaml", ".yml", ".json", ".sh",
    ".sql", ".md",
)

# Ordered longest-first for greedy match
_LOCATION_PATTERNS = [
    re.compile(r"^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+)-(?P<endLine>\d+):(?P<endCol>\d+)$"),
    re.compile(r"^(?P<path>.+?):(?P<line>\d+)-(?P<endLine>\d+)$"),
    re.compile(r"^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+)$"),
    re.compile(r"^(?P<path>.+?):(?P<line>\d+)$"),
]


def _is_source_file(path: str) -> bool:
    lowered = path.lower()
    return any(lowered.endswith(ext) for ext in _SOURCE_EXTENSIONS)


class ProposalRecorder:
    def record_proposals(self, submission: dict) -> List[dict]:
        if submission.get("gpav_rejected"):
            return []
        proposals = []
        for finding in submission.get("findings", []):
            if finding.get("severity") != "P":
                continue
            files, _, _ = self.parse_location(finding.get("location", "")) or ([], 0, 0)
            proposals.append({
                "id": finding.get("id"),
                "description": finding.get("description"),
                "location": finding.get("location"),
                "files": files,
                "round": submission.get("round"),
                "run_id": submission.get("run_id"),
            })
        return proposals

    def parse_location(self, location: str) -> Optional[Tuple[List[str], int, int]]:
        if not location:
            return None
        for pattern in _LOCATION_PATTERNS:
            m = pattern.match(location)
            if not m:
                continue
            path = m.group("path")
            if not path or path.startswith("/") or ".." in path.split("/"):
                return None
            line = int(m.group("line"))
            col = int(m.group("col")) if "col" in m.groupdict() and m.group("col") else 0
            if not _is_source_file(path):
                return [], line, 0
            return [path], line, col
        return None
