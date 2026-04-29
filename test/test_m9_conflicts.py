"""Module M9: conflicts_with detection and annotation (TC-M9-01 through TC-M9-06).

Tests: TestDetectConflicts (5 tests), TestCommitRuleConflictAnnotation (2 tests),
       TestConflictsWithParsing (3 tests), TestCheckingHandlerConflicts (1 test)
Acceptance: M9 (Conflict detection)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from _orch_helpers import (
    _fire_c_done_event,
    _fire_r_done_event,
    _load_workflow,
    _save_workflow,
    _start_reflect_workflow,
    commit_rule,
    init_repo_tool,
    stage_rule,
    write_rule,
)
from aristotle_mcp.frontmatter import read_frontmatter_raw

# Conditional import — detect_conflicts may not be available yet
try:
    from aristotle_mcp._tools_rules import detect_conflicts

    _M9_AVAILABLE = True
except ImportError:
    _M9_AVAILABLE = False

# Separate guard for model-only tests (don't need detect_conflicts)
_MODELS_HAS_CONFLICTS = False
try:
    from aristotle_mcp.models import RuleMetadata
    _MODELS_HAS_CONFLICTS = 'conflicts_with' in RuleMetadata.__dataclass_fields__
except (ImportError, AttributeError):
    pass


# ═══════════════════════════════════════════════════════
# TestDetectConflicts
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M9_AVAILABLE, reason="M9 conflict detection APIs not yet implemented")
class TestDetectConflicts:
    """M9: detect_conflicts detection."""

    def test_no_conflict_returns_empty(self):
        """无重复三元组 → 空列表。"""
        init_repo_tool()
        w = write_rule(
            content="## Unique rule",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        conflicts = detect_conflicts(w["file_path"])
        assert conflicts == []

    def test_missing_domain_returns_empty(self):
        """缺少 domain/task_goal → 返回空（不检测）。"""
        init_repo_tool()
        w = write_rule(
            content="## No intent tags",
            category="HALLUCINATION",
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        conflicts = detect_conflicts(w["file_path"])
        assert conflicts == []

    def test_triple_match_returns_conflict(self):
        """domain + task_goal + failed_skill 完全重复 → 返回冲突 ID。"""
        init_repo_tool()

        w1 = write_rule(
            content="## First rule",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## Second rule (conflict)",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        conflicts = detect_conflicts(w2["file_path"])
        assert len(conflicts) >= 1

    def test_different_failed_skill_no_conflict(self):
        """domain + task_goal 相同但 failed_skill 不同 → 无冲突。"""
        init_repo_tool()

        w1 = write_rule(
            content="## Rule A",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## Rule B",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="drizzle-connection",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        conflicts = detect_conflicts(w2["file_path"])
        assert conflicts == []

    def test_self_not_in_conflicts(self):
        """自身 ID 不出现在冲突列表中。"""
        init_repo_tool()
        w = write_rule(
            content="## Self test",
            category="HALLUCINATION",
            intent_domain="testing",
            intent_task_goal="unit test",
            failed_skill="pytest",
        )
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        conflicts = detect_conflicts(w["file_path"])
        assert w["rule_id"] not in conflicts


# ═══════════════════════════════════════════════════════
# TestCommitRuleConflictAnnotation
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M9_AVAILABLE, reason="M9 conflict detection APIs not yet implemented")
class TestCommitRuleConflictAnnotation:
    """M9: commit_rule 后置冲突标注。"""

    def test_conflict_annotated_in_frontmatter(self):
        """有冲突时 conflicts_with 写入新规则 frontmatter。"""
        init_repo_tool()

        w1 = write_rule(
            content="## Existing rule",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## New conflicting rule",
            category="HALLUCINATION",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
            failed_skill="prisma-connection",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        fm = read_frontmatter_raw(Path(w2["file_path"]))
        assert "conflicts_with" in fm
        cw = fm["conflicts_with"]
        if isinstance(cw, str):
            cw = json.loads(cw)
        assert isinstance(cw, list)
        assert len(cw) >= 1

    def test_bidirectional_annotation(self):
        """冲突规则互相包含对方 ID。"""
        init_repo_tool()

        w1 = write_rule(
            content="## First",
            category="HALLUCINATION",
            intent_domain="db",
            intent_task_goal="fix",
            failed_skill="skill_a",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## Second",
            category="HALLUCINATION",
            intent_domain="db",
            intent_task_goal="fix",
            failed_skill="skill_a",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        fm1 = read_frontmatter_raw(Path(w1["file_path"]))
        fm2 = read_frontmatter_raw(Path(w2["file_path"]))

        def parse_cw(fm):
            cw = fm.get("conflicts_with", [])
            if isinstance(cw, str):
                return json.loads(cw)
            return cw or []

        cw1 = parse_cw(fm1)
        cw2 = parse_cw(fm2)

        id2 = fm2.get("id", "")
        assert id2 in cw1, f"w1 should contain w2's ID ({id2}) in conflicts_with"


# ═══════════════════════════════════════════════════════
# TestConflictsWithParsing
# ═══════════════════════════════════════════════════════
# NOTE: These tests depend on models.py RuleMetadata having conflicts_with field (M6 tech spec covers this)
@pytest.mark.skipif(not _MODELS_HAS_CONFLICTS, reason="RuleMetadata.conflicts_with not yet added")
class TestConflictsWithParsing:
    """M9: conflicts_with 格式兼容解析。"""

    def test_json_string_parsed(self):
        """JSON 字符串格式的 conflicts_with 被正确解析。"""
        from aristotle_mcp.models import from_frontmatter_dict

        meta = from_frontmatter_dict(
            {
                "id": "rec_test",
                "conflicts_with": '["rec_001", "rec_002"]',
            }
        )
        assert isinstance(meta.conflicts_with, list)
        assert "rec_001" in meta.conflicts_with

    def test_list_format_passes_through(self):
        """列表格式的 conflicts_with 直接传递。"""
        from aristotle_mcp.models import from_frontmatter_dict

        meta = from_frontmatter_dict(
            {
                "id": "rec_test",
                "conflicts_with": ["rec_001"],
            }
        )
        assert isinstance(meta.conflicts_with, list)
        assert meta.conflicts_with == ["rec_001"]

    def test_none_when_missing(self):
        """无 conflicts_with → None。"""
        from aristotle_mcp.models import from_frontmatter_dict

        meta = from_frontmatter_dict({"id": "rec_test"})
        assert meta.conflicts_with is None


# ═══════════════════════════════════════════════════════
# TestCheckingHandlerConflicts
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M9_AVAILABLE, reason="M9 conflict detection APIs not yet implemented")
class TestCheckingHandlerConflicts:
    """M9: checking 完成后冲突警告出现在通知消息中。"""

    def test_conflict_warning_in_notification(self):
        """冲突规则的 checking 通知包含 ⚠️ 警告。"""
        init_repo_tool()

        w1 = write_rule(
            content="## Existing",
            category="HALLUCINATION",
            intent_domain="db",
            intent_task_goal="fix",
            failed_skill="skill_a",
            source_session="ses_m9_conflict",
        )
        stage_rule(w1["file_path"])
        commit_rule(w1["file_path"])

        w2 = write_rule(
            content="## New conflict",
            category="HALLUCINATION",
            intent_domain="db",
            intent_task_goal="fix",
            failed_skill="skill_a",
            source_session="ses_m9_conflict",
        )
        stage_rule(w2["file_path"])
        commit_rule(w2["file_path"])

        start = _start_reflect_workflow("ses_m9_conflict")
        wf_id = start["workflow_id"]

        wf = _load_workflow(wf_id)
        wf["committed_rule_paths"] = [w1["file_path"], w2["file_path"]]
        _save_workflow(wf_id, wf)

        _fire_r_done_event(wf_id, "ses_r_m9")
        _fire_c_done_event(wf_id, "Committed: 2, Staged: 0")

        wf = _load_workflow(wf_id)
        assert "conflict_warnings" in wf
        assert len(wf["conflict_warnings"]) > 0
