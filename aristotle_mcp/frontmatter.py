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
    intent_domain: str | None = None,
    intent_task_goal: str | None = None,
    failed_skill: str | None = None,
    error_summary: str | None = None,
    reflection_sequence: int | None = None,
) -> list[Path]:
    results: list[Path] = []
    keyword_re = re.compile(keyword, re.IGNORECASE) if keyword else None
    scope_re = re.compile(rf'^scope:\s*["\']?({scope})["\']?', re.MULTILINE) if scope else None

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
                            # Read a few content lines for keyword search
                            for _ in range(10):
                                try:
                                    head += next(f)
                                except StopIteration:
                                    break
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

        _reflection_seq_re = None
        if reflection_sequence is not None:
            if reflection_sequence < 1:
                raise ValueError(f"reflection_sequence must be >= 1, got {reflection_sequence}")
            _reflection_seq_re = re.compile(r'^reflection_sequence:\s*(\d+)', re.MULTILINE)

        if _reflection_seq_re:
            m = _reflection_seq_re.search(fm_text)
            if not m or int(m.group(1)) != reflection_sequence:
                continue

        if keyword_re:
            values = " ".join(m.group(2) for m in _KV_RE.finditer(fm_text))
            if not keyword_re.search(values):
                # Also search content portion (after frontmatter) within the head buffer
                content_part = head[fm_match.end() :] if fm_match else head
                if not keyword_re.search(content_part):
                    continue

        needs_intent_filter = intent_domain or intent_task_goal or failed_skill or error_summary
        if needs_intent_filter:
            parsed = None
            try:
                parsed = yaml.safe_load(fm_text)
            except yaml.YAMLError:
                pass

            if isinstance(parsed, dict):
                intent_tags_dict = parsed.get("intent_tags") or {}
                if intent_domain:
                    val = str(intent_tags_dict.get("domain", ""))
                    if not re.search(intent_domain, val, re.IGNORECASE):
                        continue
                if intent_task_goal:
                    val = str(intent_tags_dict.get("task_goal", ""))
                    if not re.search(intent_task_goal, val, re.IGNORECASE):
                        continue
                if failed_skill:
                    val = str(parsed.get("failed_skill", ""))
                    if not re.search(failed_skill, val, re.IGNORECASE):
                        continue
                if error_summary:
                    val = str(parsed.get("error_summary", ""))
                    if not re.search(error_summary, val, re.IGNORECASE):
                        continue
            else:
                if intent_domain and not re.search(intent_domain, fm_text, re.IGNORECASE):
                    continue
                if intent_task_goal and not re.search(intent_task_goal, fm_text, re.IGNORECASE):
                    continue
                if failed_skill and not re.search(failed_skill, fm_text, re.IGNORECASE):
                    continue
                if error_summary and not re.search(error_summary, fm_text, re.IGNORECASE):
                    continue

        results.append(path)
        if limit and len(results) >= limit:
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
            if val is None and key in ("sample_size", "feedback_count", "reflection_sequence"):
                continue
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
    if isinstance(val, dict):
        if not val:
            return "null"
        lines = []
        for k, v in val.items():
            lines.append(f"  {k}: {_serialize(v)}")
        return "\n" + "\n".join(lines)
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
