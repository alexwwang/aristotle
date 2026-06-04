"""Tests for committer module."""
import pytest
from committer import AutoCommitter

class TestAutoCommitter:
    def test_validate_schema_valid(self):
        committer = AutoCommitter()
        frontmatter = {
            "category": "PATTERN_VIOLATION",
            "confidence": 0.85,
            "error_summary": "LLM skipped Red phase"
        }
        result = committer.validate_schema(frontmatter)
        assert result.is_valid

    def test_validate_schema_missing_category(self):
        committer = AutoCommitter()
        frontmatter = {
            "confidence": 0.85,
            "error_summary": "LLM skipped Red phase"
        }
        result = committer.validate_schema(frontmatter)
        assert not result.is_valid

    def test_validate_schema_confidence_out_of_range(self):
        committer = AutoCommitter()
        frontmatter = {
            "category": "PATTERN_VIOLATION",
            "confidence": 1.5,
            "error_summary": "LLM skipped Red phase"
        }
        result = committer.validate_schema(frontmatter)
        assert not result.is_valid

    def test_validate_schema_error_summary_too_long(self):
        committer = AutoCommitter()
        frontmatter = {
            "category": "PATTERN_VIOLATION",
            "confidence": 0.85,
            "error_summary": "x" * 201
        }
        result = committer.validate_schema(frontmatter)
        assert not result.is_valid
