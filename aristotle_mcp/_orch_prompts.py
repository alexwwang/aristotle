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
SESSION_FILE: {session_file}
PROJECT_DIRECTORY: {project_directory}
USER_LANGUAGE: {user_language}
FOCUS_HINT: {focus_hint}
DRAFT_SEQUENCE: {sequence}

Your output is NOT shown to the user. The Coordinator reads your session and \
extracts the DRAFT. Follow REFLECTOR.md exactly — especially STEP R5 to persist \
the DRAFT via persist_draft(sequence={sequence}, content=...).

IMPORTANT: SESSION_FILE is a JSON file. If SESSION_FILE is non-empty, use the Read \
tool to read it, then parse the "messages" array. Each message has "index", "role", \
"content" fields. Do NOT attempt to use session_read or any session API. \
If SESSION_FILE is empty, output "No session data available for reflection." and STOP.
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
    session_file: str = "",
) -> str:
    safe_focus = focus_hint[:200]
    return REFLECTOR_PROMPT_TEMPLATE.format(
        skill_dir=str(SKILL_DIR),
        target_session_id=target_session_id,
        session_file=session_file,
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


SCORING_PROMPT_TEMPLATE = """You are a relevance scoring agent. Rate how relevant a rule is to the user's query.

USER QUERY:
```
{query}
```

INTENT:
- Domain: {domain}
- Task Goal: {task_goal}

RULE FILE: {rule_path}

Read the rule file and evaluate its relevance to the user's query on a scale of 1-10, where:
- 1-3: Not relevant
- 4-6: Somewhat relevant
- 7-8: Very relevant
- 9-10: Exactly what the user needs

Return ONLY valid JSON (no markdown, no explanation):
{{
  "score": <integer 1-10>,
  "summary": "<one-sentence summary of why this rule is or isn't relevant>"
}}
"""

COMPRESS_PROMPT_TEMPLATE = """You are a compression agent. Summarize the most relevant rules into a concise guide.

USER QUERY:
```
{query}
```

SCORED RULES:
{scored_rules_text}

Instructions:
- Select the top {top_n} most relevant rules
- Compress each rule to at most {rule_max_chars} characters
- Total output must not exceed {max_chars} characters

Output format (use --- as section separator):
---
WHEN: <describe when this rule applies>
DO: <describe what to do>
NEVER: <describe what to avoid>
CHECK: <describe how to verify>
---
"""


def _build_scoring_prompt(query: str, domain: str, task_goal: str, rule_path: str) -> str:
    return SCORING_PROMPT_TEMPLATE.format(
        query=query[:500],
        domain=domain or "general",
        task_goal=task_goal or "unspecified",
        rule_path=rule_path,
    )


def _build_compress_prompt(
    query: str,
    scored_rules_text: str,
    top_n: int = 3,
    rule_max_chars: int = 200,
    max_chars: int = 800,
) -> str:
    return COMPRESS_PROMPT_TEMPLATE.format(
        query=query[:500],
        scored_rules_text=scored_rules_text,
        top_n=top_n,
        rule_max_chars=rule_max_chars,
        max_chars=max_chars,
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
