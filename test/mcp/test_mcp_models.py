"""Tests for aristotle_mcp.models — RuleMetadata, YAML serialization, GEAR 2.0 fields."""

from __future__ import annotations


class TestModels:
    def test_rule_metadata_defaults(self):
        from aristotle_mcp.models import RuleMetadata

        m = RuleMetadata(id="t1")
        assert m.status == "pending"
        assert m.scope == "user"
        assert m.confidence == 0.7
        assert m.project_hash is None
        assert m.verified_at is None

    def test_to_frontmatter_string_basic(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="fm_test", status="verified", category="HALLUCINATION")
        s = to_frontmatter_string(m)
        assert s.startswith("---\n")
        assert s.endswith("\n---")
        assert "id: fm_test" in s
        assert "status: verified" in s
        assert "category: HALLUCINATION" in s
        assert "project_hash" not in s  # None values omitted

    def test_to_frontmatter_string_special_chars(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="special: test", category="has'quote")
        s = to_frontmatter_string(m)
        assert "id:" in s  # quoted because of ':'

    def test_from_frontmatter_dict_full(self):
        from aristotle_mcp.models import from_frontmatter_dict

        data = {
            "id": "rec_123",
            "status": "verified",
            "scope": "project",
            "category": "HALLUCINATION",
            "confidence": 0.9,
        }
        m = from_frontmatter_dict(data)
        assert m.id == "rec_123"
        assert m.scope == "project"
        assert m.confidence == 0.9

    def test_from_frontmatter_dict_defaults(self):
        from aristotle_mcp.models import from_frontmatter_dict

        m = from_frontmatter_dict({"id": "x"})
        assert m.status == "pending"
        assert m.confidence == 0.7
        assert m.source_session is None

    def test_roundtrip_frontmatter(self):
        from aristotle_mcp.models import (
            RuleMetadata,
            to_frontmatter_string,
            from_frontmatter_dict,
        )
        import yaml

        original = RuleMetadata(
            id="rt1",
            status="verified",
            category="PATTERN_VIOLATION",
            confidence=0.85,
            risk_level="low",
            verified_by="human",
        )
        fm_str = to_frontmatter_string(original)
        inner = fm_str.split("\n", 1)[1].rsplit("\n---", 1)[0]
        parsed = yaml.safe_load(inner)
        restored = from_frontmatter_dict(parsed)
        assert restored.id == original.id
        assert restored.status == original.status
        assert restored.category == original.category
        assert restored.confidence == original.confidence

    def test_rule_metadata_gear2_fields(self):
        from aristotle_mcp.models import RuleMetadata

        m = RuleMetadata(
            id="g1",
            intent_tags={"domain": "text_analysis", "task_goal": "extract_entity"},
            failed_skill="pdf_parser_v2",
            error_summary="Unable to identify tables in multi-column layout",
        )
        assert m.intent_tags == {
            "domain": "text_analysis",
            "task_goal": "extract_entity",
        }
        assert m.failed_skill == "pdf_parser_v2"
        assert m.error_summary is not None
        assert len(m.error_summary) > 0

    def test_to_frontmatter_intent_tags_nested(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(
            id="fm_intent",
            intent_tags={"domain": "database", "task_goal": "connection_pool"},
            failed_skill="prisma",
            error_summary="P2024 connection timeout",
        )
        s = to_frontmatter_string(m)
        assert "intent_tags:" in s
        assert "domain:" in s
        assert "database" in s
        assert "task_goal:" in s
        assert "connection_pool" in s
        assert "failed_skill: prisma" in s
        assert "error_summary:" in s
        assert "P2024" in s

    def test_to_frontmatter_intent_tags_null(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="no_intent")
        s = to_frontmatter_string(m)
        assert "intent_tags" not in s  # None values omitted

    def test_to_frontmatter_intent_tags_empty_dict(self):
        from aristotle_mcp.models import RuleMetadata, to_frontmatter_string

        m = RuleMetadata(id="empty_intent", intent_tags={})
        s = to_frontmatter_string(m)
        assert "intent_tags: null" in s

    def test_from_frontmatter_gear2_fields(self):
        from aristotle_mcp.models import from_frontmatter_dict

        data = {
            "id": "g2",
            "intent_tags": {"domain": "api", "task_goal": "auth"},
            "failed_skill": "jwt_lib",
            "error_summary": "Token expired without refresh",
        }
        m = from_frontmatter_dict(data)
        assert m.intent_tags == {"domain": "api", "task_goal": "auth"}
        assert m.failed_skill == "jwt_lib"
        assert m.error_summary == "Token expired without refresh"

    def test_roundtrip_with_gear2_fields(self):
        from aristotle_mcp.models import (
            RuleMetadata,
            to_frontmatter_string,
            from_frontmatter_dict,
        )
        import yaml

        original = RuleMetadata(
            id="rt_gear",
            status="verified",
            category="HALLUCINATION",
            intent_tags={"domain": "file_ops", "task_goal": "atomic_write"},
            failed_skill="pathlib",
            error_summary="Race condition on rename",
        )
        fm_str = to_frontmatter_string(original)
        inner = fm_str.split("\n", 1)[1].rsplit("\n---", 1)[0]
        parsed = yaml.safe_load(inner)
        restored = from_frontmatter_dict(parsed)
        assert restored.intent_tags == original.intent_tags
        assert restored.failed_skill == original.failed_skill
        assert restored.error_summary == original.error_summary

    def test_tool_return(self):
        from aristotle_mcp.models import ToolReturn

        t = ToolReturn(success=True, message="ok")
        assert t.success
        assert t.data is None
