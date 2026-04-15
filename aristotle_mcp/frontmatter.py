from __future__ import annotations

import os
import re
from pathlib import Path

import frontmatter
import yaml

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
_STATUS_RE = re.compile(r'^status:\s*["\']?(\w+)["\']?', re.MULTILINE)
_CATEGORY_RE = re.compile(r'^category:\s*["\']?(\w+)["\']?', re.MULTILINE)
_KV_RE = re.compile(r"^(\w+):\s*(.+)$", re.MULTILINE)


def stream_filter_rules(
    base_dir: Path,
    status_filter: str = "all",
    keyword: str | None = None,
    category: str | None = None,
    scope: str | None = None,
    limit: int = 50,
) -> list[Path]:
    results: list[Path] = []
    keyword_re = re.compile(keyword, re.IGNORECASE) if keyword else None
    scope_re = (
        re.compile(rf'^scope:\s*["\']?({scope})["\']?', re.MULTILINE) if scope else None
    )

    for path in base_dir.rglob("*.md"):
        if path.name.startswith("_"):
            continue

        try:
            with path.open("r", encoding="utf-8") as f:
                head = ""
                delim_count = 0
                for i, line in enumerate(f):
                    if i >= 50:
                        break
                    head += line
                    if line.strip() == "---":
                        delim_count += 1
                        if delim_count == 2:
                            break
        except (OSError, UnicodeDecodeError):
            continue

        fm_match = _FRONTMATTER_RE.match(head)
        if not fm_match:
            continue

        fm_text = fm_match.group(1)

        if status_filter != "all":
            m = _STATUS_RE.search(fm_text)
            if not m or m.group(1) != status_filter:
                continue

        if category:
            m = _CATEGORY_RE.search(fm_text)
            if not m or m.group(1) != category:
                continue

        if scope_re:
            if not scope_re.search(fm_text):
                continue

        if keyword_re:
            values = " ".join(m.group(2) for m in _KV_RE.finditer(fm_text))
            if not keyword_re.search(values):
                continue

        results.append(path)
        if len(results) >= limit:
            break

    return results


def load_rule_file(path: Path) -> dict:
    post = frontmatter.load(str(path))
    return {"metadata": dict(post.metadata), "content": post.content}


def write_rule_file(path: Path, metadata: dict, content: str) -> dict:
    tmp = path.with_suffix(".md.tmp")
    try:
        lines = ["---\n"]
        for key, val in metadata.items():
            lines.append(f"{key}: {_serialize(val)}\n")
        lines.append("---\n")
        if content and not content.startswith("\n"):
            lines.append("\n")
        lines.append(content)

        with tmp.open("w", encoding="utf-8") as f:
            f.writelines(lines)

        os.replace(str(tmp), str(path))
        return {"success": True, "path": str(path), "message": "Written atomically"}
    except Exception as exc:
        if tmp.exists():
            tmp.unlink()
        return {"success": False, "path": str(path), "message": str(exc)}


def _serialize(val: object) -> str:
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val)
    if any(ch in s for ch in (":", "#", "{", "}", '"', "'")):
        escaped = s.replace('"', '\\"')
        return f'"{escaped}"'
    return s


def read_frontmatter_raw(path: Path) -> dict | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            head = ""
            delim_count = 0
            for i, line in enumerate(f):
                if i >= 100:
                    break
                head += line
                if line.strip() == "---":
                    delim_count += 1
                    if delim_count == 2:
                        break
    except (OSError, UnicodeDecodeError):
        return None

    fm_match = _FRONTMATTER_RE.match(head)
    if not fm_match:
        return None

    try:
        result = yaml.safe_load(fm_match.group(1))
        return result if isinstance(result, dict) else None
    except yaml.YAMLError:
        return None


def update_frontmatter_field(path: Path, field: str, value: str | None) -> dict:
    data = load_rule_file(path)
    metadata = data["metadata"]
    metadata[field] = value
    return write_rule_file(path, metadata, data["content"])
