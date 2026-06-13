"""SignalMapper — maps detection signals to violation types.

Phase 4 TDD Stub: All methods raise NotImplementedError.
"""

from typing import Dict, Any

# Regular detection signals → ViolationType
SIGNAL_TO_TYPE: Dict[str, str] = {
    'no-business-code-before-phase5': 'SKIP_RED_PHASE',
    'no-test-modification-during-green': 'MODIFIED_TEST',
    'write-business-code-without-test-file': 'MISSING_TEST',
    'test-runner-exit-nonzero-was-passing': 'REGRESSION',
    'no-phase-advance-without-gate': 'SKIP_REVIEW',
    'ralph-round-complete-without-reviewer': 'INSUFFICIENT_REVIEW',
    'ralph-rounds-exceeded': 'UNFIXED_ISSUES',
    'violation-gate-block': 'UNFIXED_ISSUES',
    'phase-complete-dirty-tree': 'UNCOMMITTED_PHASE',
    'phase-complete-no-ki-doc': 'MISSING_KI_DOC',
    'phase-complete-outdated-ki-doc': 'KI_DOC_OUTDATED',
    'phase-complete-no-assessment': 'MISSING_KI_ASSESSMENT',
    'review-uncommitted': 'UNCOMMITTED_REVIEW',
    'review-prompt-matches-forbidden-pattern': 'INVALID_REVIEW_PROMPT',
}

# Special detection signals → SpecialViolationType
SPECIAL_SIGNAL_TO_TYPE: Dict[str, str] = {
    'same-violation-3-in-10-rounds': 'PATTERN_CYCLE',
    'file-too-large': 'FILE_SPLIT_NEEDED',
    'prompt-injection-detected': 'PROMPT_INJECTION_BLOCKED',
}

# Protocol signals → handler method names
PROTOCOL_SIGNALS: Dict[str, str] = {
    'ralph-round-finding-valid-submission': '_handle_gpav_submission',
    'ralph-round-finding-severity-p': '_handle_proposal',
    'ralph-prompt-contamination': '_handle_rps_scan',
    'gpav-validation-failure': '_handle_gpav_validation_failure',
}


class SignalMapper:
    def classify(self, signal: str) -> str:
        raise NotImplementedError

    def resolve_run_id(self, context: Dict[str, Any]) -> str:
        raise NotImplementedError

    def validate_context(self, context: Dict[str, Any]) -> None:
        raise NotImplementedError
