"""Auto-commit with validation."""
from dataclasses import dataclass
from typing import Dict, Any, List

_MAX_ERROR_SUMMARY_LENGTH = 200

@dataclass
class SchemaValidationResult:
    is_valid: bool
    errors: List[str]

class AutoCommitter:
    def validate_schema(self, frontmatter: Dict[str, Any]) -> SchemaValidationResult:
        """Validate frontmatter fields: required keys, confidence range, and summary length."""
        errors: List[str] = []
        
        if "category" not in frontmatter:
            errors.append("Missing required field: category")
        
        confidence = frontmatter.get("confidence")
        if confidence is not None:
            if not isinstance(confidence, (int, float)):
                errors.append("confidence must be numeric")
            elif not (0.0 <= confidence <= 1.0):
                errors.append("confidence must be between 0.0 and 1.0")
        
        error_summary = frontmatter.get("error_summary") or ""
        if len(error_summary) > _MAX_ERROR_SUMMARY_LENGTH:
            errors.append(f"error_summary exceeds {_MAX_ERROR_SUMMARY_LENGTH} characters")
        
        return SchemaValidationResult(is_valid=len(errors) == 0, errors=errors)
