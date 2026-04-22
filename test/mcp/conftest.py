"""MCP server test configuration. Inherits tmp_repo from parent conftest."""

try:
    from aristotle_mcp import server as _server
    _has_orchestrate_review_action = hasattr(_server, 'orchestrate_review_action')
    _has_next_sequence = hasattr(_server, '_next_sequence')
    _has_ensure_repo_initialized = hasattr(_server, '_ensure_repo_initialized')
    _has_cleanup_stale_workflows = hasattr(_server, '_cleanup_stale_workflows')
    _NEW_APIS_AVAILABLE = (
        _has_orchestrate_review_action
        and _has_next_sequence
        and _has_ensure_repo_initialized
        and _has_cleanup_stale_workflows
    )
    if _NEW_APIS_AVAILABLE:
        from aristotle_mcp.server import (
            orchestrate_review_action,
            _next_sequence,
            _ensure_repo_initialized,
            _cleanup_stale_workflows,
        )
except (ImportError, AttributeError):
    _NEW_APIS_AVAILABLE = False
