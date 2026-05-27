"""Auto-commit with validation."""
from dataclasses import dataclass
from typing import Dict, Any

@dataclass
class SchemaValidationResult:
    is_valid: bool
    errors: list

class AutoCommitter:
    def validate_schema(self, frontmatter: Dict[str, Any]) -> SchemaValidationResult:
        errors = []
        
        if "category" not in frontmatter:
            errors.append("Missing required field: category")
        
        confidence = frontmatter.get("confidence")
        if confidence is not None:
            if not isinstance(confidence, (int, float)):
                errors.append("confidence must be numeric")
            elif not (0.0 <= confidence <= 1.0):
                errors.append("confidence must be between 0.0 and 1.0")
        
        error_summary = frontmatter.get("error_summary", "")
        if len(error_summary) > 200:
            errors.append("error_summary exceeds 200 characters")
        
        return SchemaValidationResult(is_valid=len(errors) == 0, errors=errors)
