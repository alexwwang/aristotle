from __future__ import annotations

from aristotle_mcp.config import SKILL_DIR

O_INTENT_PROMPT = """You are a semantic analysis agent. Extract structured intent from the user's learning query.

USER QUERY:
```
{query}
```

Extract the following fields and return ONLY valid JSON (no markdown, no explanation):

{{
  "intent_tags": {{
    "domain": "<one of: file_operations, api_integration, database_operations, code_generation, build_system, testing, deployment, general>",
    "task_goal": "<short phrase describing the user's intended outcome>"
  }},
  "keywords": "<2-4 core technical terms joined by | for regex matching, e.g. prisma|timeout|pool>"
}}

Rules:
- domain must be one of the listed values
- task_goal should describe the user's intent, NOT the error
- keywords should capture the most distinctive technical terms
- Return ONLY the JSON object, nothing else
"""

REFLECTOR_PROMPT_TEMPLATE = """You are Aristotle's Reflector subagent. Read and execute the full protocol at
{skill_dir}/REFLECTOR.md (read the file first, then follow it step by step).

TARGET_SESSION_ID: {target_session_id}
PROJECT_DIRECTORY: {project_directory}
USER_LANGUAGE: {user_language}
FOCUS_HINT: {focus_hint}
DRAFT_SEQUENCE: {sequence}

Your output is NOT shown to the user. The Coordinator reads your session and \
extracts the DRAFT. Follow REFLECTOR.md exactly — especially STEP R5 to persist \
the DRAFT via persist_draft(sequence={sequence}, content=...).
"""

CHECKER_PROMPT_TEMPLATE = """You are Aristotle's Checker subagent. Read and execute the full protocol at
{skill_dir}/CHECKER.md (read the file first, then follow it step by step).

DRAFT_SEQUENCE: {sequence}
DRAFT_FILE: {draft_file}
PROJECT_DIRECTORY: {project_directory}

Your output is NOT shown to the user. Follow CHECKER.md exactly — read the \
DRAFT from DRAFT_FILE, validate each Reflection, and write rules via \
aristotle_write_rule / aristotle_stage_rule / aristotle_commit_rule.
"""

REVISE_PROMPT_TEMPLATE = """You are revising an Aristotle rule based on user feedback.

ORIGINAL RULE FILE: {rule_path}
ORIGINAL RULE CONTENT:
```
{original_content}
```

USER FEEDBACK: {feedback}

DRAFT CONTEXT:
```
{draft_summary}
```

Write the revised rule. Your output MUST follow this EXACT format:
Line 1: FILE: {rule_path}
Line 2+: The complete revised rule in YAML frontmatter + Markdown body format.
Do NOT include any other text, explanation, or commentary.
"""


def _build_intent_extraction_prompt(query: str) -> str:
    safe_query = query[:500]
    return O_INTENT_PROMPT.format(query=safe_query)


def _build_reflector_prompt(
    target_session_id: str,
    focus_hint: str,
    sequence: int,
    project_directory: str = "",
    user_language: str = "en-US",
) -> str:
    safe_focus = focus_hint[:200]
    return REFLECTOR_PROMPT_TEMPLATE.format(
        skill_dir=str(SKILL_DIR),
        target_session_id=target_session_id,
        project_directory=project_directory,
        user_language=user_language,
        focus_hint=safe_focus,
        sequence=sequence,
    )


def _build_checker_prompt(
    sequence: int,
    draft_file: str,
    project_directory: str = "",
) -> str:
    return CHECKER_PROMPT_TEMPLATE.format(
        skill_dir=str(SKILL_DIR),
        sequence=sequence,
        draft_file=draft_file,
        project_directory=project_directory,
    )


def _build_revise_prompt(rule_path: str, original_content: str,
                         feedback: str, draft_summary: str) -> str:
    _esc = lambda s: s.replace("{", "{{").replace("}", "}}")
    safe_feedback = feedback[:2000]
    return REVISE_PROMPT_TEMPLATE.format(
        rule_path=rule_path,
        original_content=_esc(original_content),
        feedback=_esc(safe_feedback),
        draft_summary=_esc(draft_summary),
    )
