"""Tests for M5 Two-Round retrieval workflow.

Covers:
  - _do_search_and_notify: zero-result short-circuit, fire_score, truncation
  - score_done handler: scoring → compressing transition, degradation
  - o_done + compressing handler: compressed output, catch-all ordering
  - _parse_scores: JSON/string parsing, clamping, truncation
  - _format_scored_rules_for_compress: full content, sorting
  - Prompt templates: scoring & compress
  - Config constants: SCORING_TOP_N, COMPRESS_TOP_N, etc.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from _orch_helpers import (
    _load_workflow,
    _save_workflow,
    commit_rule,
    init_repo_tool,
    orchestrate_on_event,
    stage_rule,
    write_rule,
)

# M5-specific availability check
_M5_AVAILABLE = False
try:
    from aristotle_mcp._orch_parsers import _parse_scores
    from aristotle_mcp.config import SCORING_TOP_N

    _M5_AVAILABLE = True
except (ImportError, AttributeError):
    pass

# -- Conditional imports for M5 functions that may not exist yet -------------
try:
    from aristotle_mcp._orch_parsers import _do_search_and_notify
except ImportError:
    _do_search_and_notify = None  # type: ignore[assignment]

try:
    from aristotle_mcp._orch_parsers import _parse_scores
except ImportError:
    _parse_scores = None  # type: ignore[assignment]

try:
    from aristotle_mcp._orch_parsers import _format_scored_rules_for_compress
except ImportError:
    _format_scored_rules_for_compress = None  # type: ignore[assignment]

try:
    from aristotle_mcp._orch_prompts import _build_scoring_prompt
except ImportError:
    _build_scoring_prompt = None  # type: ignore[assignment]

try:
    from aristotle_mcp._orch_prompts import _build_compress_prompt
except ImportError:
    _build_compress_prompt = None  # type: ignore[assignment]

try:
    from aristotle_mcp.config import (
        COMPRESS_MAX_CHARS,
        COMPRESS_RULE_MAX_CHARS,
        COMPRESS_TOP_N,
        SCORE_PARALLEL_MAX,
        SCORING_TOP_N,
    )
except ImportError:
    SCORING_TOP_N = None  # type: ignore[misc]
    SCORE_PARALLEL_MAX = None  # type: ignore[misc]
    COMPRESS_TOP_N = None  # type: ignore[misc]
    COMPRESS_MAX_CHARS = None  # type: ignore[misc]
    COMPRESS_RULE_MAX_CHARS = None  # type: ignore[misc]


# ═══════════════════════════════════════════════════════
# TC-M5-01 / TC-M5-02: _do_search_and_notify
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestSearchAndNotify:
    """M5: _do_search_and_notify 重构。"""

    def test_zero_results_short_circuit_to_done(self):
        """list_rules 返回 0 结果 → 直接 done + notify。"""
        wf_id = "wf_0001a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "search",
                "intent_tags": {
                    "domain": "database_operations",
                    "task_goal": "fix timeout",
                },
                "keywords": "prisma|timeout|pool",
                "query": "How to fix Prisma connection pool timeout",
            },
        )

        with patch("aristotle_mcp._tools_rules.list_rules") as mock_lr:
            mock_lr.return_value = {"count": 0, "rules": []}
            result = _do_search_and_notify(wf_id)

        assert result["action"] == "notify"
        assert result["result_count"] == 0
        # 验证 workflow phase 已变为 done
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_lost_workflow_returns_error(self):
        """不存在的 workflow_id → 返回错误。"""
        result = _do_search_and_notify("wf_9999a1b2c3d4e5f6")
        assert result["action"] == "notify"
        assert "lost" in result.get("message", "").lower() or "not found" in result.get("message", "").lower()

    def test_zero_results_no_fire_score(self):
        """零结果时不返回 fire_score action。"""
        wf_id = "wf_0002a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "search",
                "intent_tags": {"domain": "testing", "task_goal": "mock"},
                "keywords": "pytest|mock",
                "query": "pytest mock",
            },
        )

        with patch("aristotle_mcp._tools_rules.list_rules") as mock_lr:
            mock_lr.return_value = {"count": 0, "rules": []}
            result = _do_search_and_notify(wf_id)

        assert result["action"] != "fire_score"

    def test_positive_results_return_fire_score(self):
        """list_rules 返回 ≥1 结果 → 返回 fire_score action。"""
        init_repo_tool()
        # 创建 verified 规则（带匹配 intent metadata）
        w = write_rule(
            content="## Prisma timeout fix\n**Rule**: increase pool size",
            category="SYNTAX_API_ERROR",
            intent_domain="database_operations",
            intent_task_goal="fix timeout",
        )
        assert w.get("success"), f"write_rule failed: {w.get('message', '')}"
        stage_rule(w["file_path"])
        commit_rule(w["file_path"])

        wf_id = "wf_0003a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "search",
                "intent_tags": {
                    "domain": "database_operations",
                    "task_goal": "fix timeout",
                },
                "keywords": "prisma|timeout",
                "query": "Prisma connection pool timeout fix",
            },
        )

        result = _do_search_and_notify(wf_id)

        assert result["action"] == "fire_score"
        assert "score_requests" in result
        assert isinstance(result["score_requests"], list)
        assert len(result["score_requests"]) >= 1

        # 验证每个 score_request 包含 rule_id 和 prompt
        for req in result["score_requests"]:
            assert "rule_id" in req
            assert "prompt" in req
            assert isinstance(req["prompt"], str)
            assert len(req["prompt"]) > 0

    def test_candidates_truncated_to_scoring_top_n(self):
        """候选数超过 SCORING_TOP_N 时截断。"""
        wf_id = "wf_0004a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "search",
                "intent_tags": {"domain": "general", "task_goal": "fix"},
                "keywords": "test",
                "query": "test query",
            },
        )

        # 模拟返回超过 SCORING_TOP_N 条结果
        fake_rules = [
            {
                "path": f"/fake/rule_{i}.md",
                "metadata": {"id": f"rec_{i}", "status": "verified"},
            }
            for i in range(SCORING_TOP_N + 5)
        ]

        with patch("aristotle_mcp._tools_rules.list_rules") as mock_lr:
            mock_lr.return_value = {"count": SCORING_TOP_N + 5, "rules": fake_rules}
            result = _do_search_and_notify(wf_id)

        assert len(result["score_requests"]) == SCORING_TOP_N

    def test_workflow_phase_transitions_to_scoring(self):
        """有结果时 workflow phase 变为 scoring。"""
        wf_id = "wf_0005a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "search",
                "intent_tags": {"domain": "general", "task_goal": "test"},
                "keywords": "test",
                "query": "test",
            },
        )

        fake_rules = [{"path": "/fake/r1.md", "metadata": {"id": "rec_1", "status": "verified"}}]

        with patch("aristotle_mcp._tools_rules.list_rules") as mock_lr:
            mock_lr.return_value = {"count": 1, "rules": fake_rules}
            _do_search_and_notify(wf_id)

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "scoring"
        assert "candidates" in wf


# ═══════════════════════════════════════════════════════
# TC-M5-03: score_done handler
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestScoreDoneHandler:
    """M5: score_done 事件处理。"""

    def test_score_done_transitions_to_compressing(self):
        """score_done 事件触发 scoring → compressing + fire_o。"""
        wf_id = "wf_0006a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "scoring",
                "command": "learn",
                "candidates": [
                    {"rule_id": "rec_1", "path": "/fake/r1.md"},
                ],
                "query": "test query",
            },
        )

        result = orchestrate_on_event(
            "score_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "scores": [{"rule_id": "rec_1", "score": 8, "summary": "Highly relevant"}],
                }
            ),
        )

        assert result["action"] == "fire_o"
        assert "o_prompt" in result

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "compressing"

    def test_all_default_scores_trigger_degradation(self):
        """所有评分为默认值（5 + 空 summary）→ 降级为单轮通知。"""
        wf_id = "wf_0007a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "scoring",
                "command": "learn",
                "candidates": [
                    {"rule_id": "rec_1", "path": "/fake/r1.md"},
                    {"rule_id": "rec_2", "path": "/fake/r2.md"},
                ],
                "result_count": 2,
                "query": "test query",
            },
        )

        result = orchestrate_on_event(
            "score_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "scores": [
                        {"rule_id": "rec_1", "score": 5, "summary": ""},
                        {"rule_id": "rec_2", "score": 5, "summary": ""},
                    ],
                }
            ),
        )

        # 降级路径：直接 notify，不进入 compressing
        assert result["action"] == "notify"
        assert "2 relevant lesson" in result["message"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_partial_failure_proceeds_to_compressing(self):
        """部分评分有效时正常进入 compressing。"""
        wf_id = "wf_0008a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "scoring",
                "command": "learn",
                "candidates": [
                    {"rule_id": "rec_1", "path": "/fake/r1.md"},
                    {"rule_id": "rec_2", "path": "/fake/r2.md"},
                ],
                "query": "test query",
            },
        )

        result = orchestrate_on_event(
            "score_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "scores": [
                        {"rule_id": "rec_1", "score": 8, "summary": "Relevant"},
                        {"rule_id": "rec_2", "score": 5, "summary": ""},  # 解析失败
                    ],
                }
            ),
        )

        assert result["action"] == "fire_o"  # 正常进入 compressing

    def test_empty_scores_list_triggers_degradation(self):
        """scores: [] 时触发降级为单轮通知。"""
        wf_id = "wf_000ba1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "scoring",
                "command": "learn",
                "candidates": [
                    {"rule_id": "rec_1", "path": "/fake/r1.md"},
                ],
                "result_count": 1,
                "query": "test query",
            },
        )

        result = orchestrate_on_event(
            "score_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "scores": [],
                }
            ),
        )

        assert result["action"] == "notify"
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_default_scores_with_summaries_proceeds_to_compressing(self):
        """score=5 但 summary 非空 → 正常进入 compressing（不降级）。"""
        wf_id = "wf_000ca1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "scoring",
                "command": "learn",
                "candidates": [
                    {"rule_id": "rec_1", "path": "/fake/r1.md"},
                ],
                "query": "test query",
            },
        )

        result = orchestrate_on_event(
            "score_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "scores": [
                        {"rule_id": "rec_1", "score": 5, "summary": "parse failed"},
                    ],
                }
            ),
        )

        assert result["action"] == "fire_o"
        wf = _load_workflow(wf_id)
        assert wf["phase"] == "compressing"


# ═══════════════════════════════════════════════════════
# TC-M5-04: o_done + compressing handler
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestCompressingHandler:
    """M5: o_done + compressing handler。"""

    def test_compressing_done_returns_compressed(self):
        """compressing 阶段 o_done 返回压缩结果。"""
        wf_id = "wf_0009a1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "compressing",
                "command": "learn",
                "result_count": 3,
            },
        )

        compressed = "## WHEN\nerror=prisma AND code=P2024\n\n## DO\n1. Increase pool size"
        result = orchestrate_on_event(
            "o_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "result": compressed,
                }
            ),
        )

        assert result["action"] == "notify"
        assert compressed in result["message"]
        assert "3 relevant lesson" in result["message"]

        wf = _load_workflow(wf_id)
        assert wf["phase"] == "done"

    def test_compressing_not_caught_by_catch_all(self):
        """phase=compressing 的 o_done 不被 catch-all 拦截。"""
        wf_id = "wf_000aa1b2c3d4e5f6"
        _save_workflow(
            wf_id,
            {
                "phase": "compressing",
                "command": "learn",
                "result_count": 1,
            },
        )

        result = orchestrate_on_event(
            "o_done",
            json.dumps(
                {
                    "workflow_id": wf_id,
                    "result": "compressed output",
                }
            ),
        )

        # 不应返回 "Unexpected o_done" 错误
        assert "Unexpected" not in result.get("message", "")
        assert result["action"] == "notify"


# ═══════════════════════════════════════════════════════
# TC-M5-05: _parse_scores
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestParseScores:
    """M5: 评分结果解析。"""

    def test_valid_json_scores(self):
        """正常 JSON 格式解析。"""
        data = {
            "scores": [
                {"rule_id": "rec_1", "score": 8, "summary": "Relevant rule"},
                {"rule_id": "rec_2", "score": 3, "summary": "Not relevant"},
            ]
        }
        result = _parse_scores(data)
        assert len(result) == 2
        assert result[0]["score"] == 8
        assert result[1]["score"] == 3

    def test_string_scores_parsed(self):
        """字符串形式的评分被解析。"""
        data = {
            "scores": [
                '{"rule_id": "rec_1", "score": 7, "summary": "Good"}',
            ]
        }
        result = _parse_scores(data)
        assert len(result) == 1
        assert result[0]["score"] == 7

    def test_invalid_json_defaults_to_5(self):
        """无效 JSON 回退为中性分 5。"""
        data = {
            "scores": [
                "not valid json {{{",
                {"score": "not_a_number"},
                None,
            ]
        }
        result = _parse_scores(data)
        assert len(result) == 3
        assert all(s["score"] == 5 for s in result)

    def test_score_clamped_to_range(self):
        """评分被限制在 1-10 范围内。"""
        data = {
            "scores": [
                {"rule_id": "rec_1", "score": 15},
                {"rule_id": "rec_2", "score": -3},
            ]
        }
        result = _parse_scores(data)
        assert result[0]["score"] == 10  # clamped
        assert result[1]["score"] == 1  # clamped

    def test_summary_truncated_to_120(self):
        """summary 被截断到 120 字符。"""
        long_summary = "A" * 200
        data = {"scores": [{"rule_id": "rec_1", "score": 5, "summary": long_summary}]}
        result = _parse_scores(data)
        assert len(result[0]["summary"]) == 120


# ═══════════════════════════════════════════════════════
# TC-M5-05b: _format_scored_rules_for_compress
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestFormatScoredRules:
    """M5: 压缩输入格式化包含完整规则内容。"""

    def test_format_includes_full_rule_content(self):
        """_format_scored_rules_for_compress 输出包含完整规则文件内容。"""
        init_repo_tool()
        # 创建含实际内容的规则
        rule_content = "## WHEN\nerror=prisma AND code=P2024\n\n## DO\n1. Increase pool size"
        w = write_rule(content=rule_content, category="HALLUCINATION")
        assert w.get("success"), f"write_rule failed: {w.get('message', '')}"
        rule_path = w["file_path"]

        scores = [{"rule_id": Path(rule_path).stem, "score": 8, "summary": "Relevant"}]
        workflow = {
            "candidates": [{"rule_id": Path(rule_path).stem, "path": rule_path}],
        }

        result = _format_scored_rules_for_compress(scores, workflow)

        # 输出应包含规则文件的实际内容
        assert "Increase pool size" in result
        assert "WHEN" in result
        assert "score: 8/10" in result

    def test_format_sorted_by_score_desc(self):
        """评分结果按 score 降序排列。"""
        scores = [
            {"rule_id": "rec_1", "score": 3, "summary": "Low"},
            {"rule_id": "rec_2", "score": 9, "summary": "High"},
        ]
        workflow = {
            "candidates": [
                {"rule_id": "rec_1", "path": "/fake/r1.md"},
                {"rule_id": "rec_2", "path": "/fake/r2.md"},
            ]
        }

        result = _format_scored_rules_for_compress(scores, workflow)

        # 高分在前
        high_pos = result.index("score: 9/10")
        low_pos = result.index("score: 3/10")
        assert high_pos < low_pos


# ═══════════════════════════════════════════════════════
# TC-M5-06: Prompt 模板
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestPromptTemplates:
    """M5: Prompt 模板格式化。"""

    def test_scoring_prompt_contains_path(self):
        """评分 prompt 包含规则路径。"""
        prompt = _build_scoring_prompt(
            query="Prisma timeout",
            domain="database_operations",
            task_goal="fix pool timeout",
            rule_path="/fake/rec_001.md",
        )
        assert "/fake/rec_001.md" in prompt
        assert "Prisma timeout" in prompt
        assert "1-10" in prompt

    def test_compress_prompt_contains_rules(self):
        """压缩 prompt 包含评分规则文本。"""
        # WHEN/DO/NEVER are template structural keywords, not input data
        scored_text = "---\nRule: /fake/r1.md (score: 8/10)\nSummary: Relevant\n\n## Rule content"
        prompt = _build_compress_prompt(
            query="test query",
            scored_rules_text=scored_text,
        )
        assert "score: 8/10" in prompt
        assert "WHEN" in prompt
        assert "DO" in prompt
        assert "NEVER" in prompt


# ═══════════════════════════════════════════════════════
# TC-M5-07: Config 常量
# ═══════════════════════════════════════════════════════
@pytest.mark.skipif(not _M5_AVAILABLE, reason="M5 Two-Round APIs not yet implemented")
class TestM5Config:
    """M5: 配置常量。"""

    def test_constants_exist_and_positive(self):
        """所有 M5 常量存在且为正数。"""
        assert SCORING_TOP_N > 0
        assert SCORE_PARALLEL_MAX > 0
        assert COMPRESS_TOP_N > 0
        assert COMPRESS_MAX_CHARS > 0
        assert COMPRESS_RULE_MAX_CHARS > 0

    def test_scoring_top_n_ge_compress_top_n(self):
        """评分候选数 >= 压缩输出数。"""
        assert SCORING_TOP_N >= COMPRESS_TOP_N
