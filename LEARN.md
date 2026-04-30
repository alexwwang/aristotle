# Aristotle Learn Protocol

> Learn phase only. Do NOT load during REFLECT or REVIEW.
> Runs entirely in O's context. L never sees this file.

Learning retrieval: O receives L's request, extracts intent, queries MCP via S, filters/compresses results, returns distilled summary to L.

**Core constraint: context isolation.** L's context stays focused on user's primary task. L never learns about GEAR, MCP, `read_rules`, frontmatter, or reflection infrastructure. L does NOT provide field names or formats — O infers structure from free-form text.

**Tunable:** `MAX_LEARN_RESULTS` — max rule bodies loaded into O's context (default: **5**).

---

## STEP L1: RECEIVE LEARNING REQUEST

```
trigger:
  /aristotle learn <query>             → natural-language query
  /aristotle learn --domain X --goal Y → parameterized
  P3.3 passive signal                  → multi-agent error detected

input: natural-language string | explicit flags | internal signal
```

---

## STEP L2: EXTRACT INTENT (O's Role)

```
learning_request (O internal, L never sees):
  intent_tags:
    domain:     "inferred technical domain"
    task_goal:  "inferred task goal"
  failed_skill:  "previously failed tool (optional)"
  error_context: "brief error description (optional)"

domain inference keyword signals:
  file read/write, paths, permissions     → file_operations
  API calls, HTTP, external services      → api_integration
  database, queries, ORM, migration       → database_operations
  syntax errors, code generation          → code_generation
  compilation, bundling, dependencies     → build_system
  tests, assertions                       → testing
  CI/CD, deployment, configuration        → deployment
  cannot clearly classify                 → general (fallback)

threshold:
  domain non-empty     → proceed to L3
  domain empty, error_context non-empty → use keyword for full-text match
  both empty           → "🦉 Need more context to search. Describe the task or domain." STOP
```

---

## STEP L3: CONSTRUCT QUERY (S Function)

```
params = {status: "verified"}  # L only sees verified rules

if intent_tags.domain:     params.intent_domain = domain
if intent_tags.task_goal:  params.intent_task_goal = task_goal
if failed_skill:           params.failed_skill = failed_skill
if error_context:          params.keyword = extract_keywords(error_context)
                           # extract 2-3 core technical nouns, join with | for regex
                           # "Prisma connection pool timeout" → "prisma|timeout|pool"
                           # "TypeScript circular import" → "circular|import"
                           # "File not found during build" → "file.*not.*found|build"

All parameters AND-combined.
```

### L3c. Round 1: Lightweight Metadata Query

```
list_rules(**params) → paths + frontmatter only, no content bodies
collect all candidate paths and metadata
```

### L3d. Round 2: Parallel Subagent Scoring

```
O does NOT read rule content directly. Spawn one subagent per candidate
via task(run_in_background=true). Each subagent reads ONE rule file's
full content (frontmatter + markdown body) via load_rule_file:

subagent prompt:
  "Score this rule's relevance to: {query_context}
   Rule file: {rule_path}
   Read file, score 1-10 based on:
   - Does Context match the current task scenario? (most important)
   - Would Example's correct approach prevent this type of error?
   - Is error scene similar to what user is about to do?
   Return JSON: {score: N, reason: 'one-line justification'}"
```

### L3e. Collect and Rank

```
collect all subagent results → sort by score descending
take top MAX_LEARN_RESULTS (default: 5)
discard rules scoring below 3
optional: check_sync_status → sync_rules() if unsynced (self-healing, L never informed)
```

---

## STEP L4: COMPRESS AND FORMAT

O reads content **returned by subagents in their score results**, NOT from files directly.

```
dedup: same category + similar error_summary → keep most specific

for each retained rule, extract:
  error_summary → one-line error description
  content       → Rule section (core constraint)
  content       → Example section (correct/wrong behavior)
  metadata.id   → for error feedback reference
```

### Output Format

```
🦉 Found N relevant lessons from past sessions:

1. ⚠ [CATEGORY] error_summary
   Avoid: Core constraint from Proposed Rule (1-2 sentences)
   ✅ Correct approach | ❌ Wrong approach
   Rule ID: rec_xxx

2. ⚠ [CATEGORY] error_summary
   ...

No results:
  🦉 No relevant lessons found for this query.
     Try: /aristotle learn --domain <domain> --goal <goal>
```

---

## STEP L5: RETURN TO L

Deliver compressed summary. L receives only formatted text — no infrastructure details.

L's responsibilities:
1. **error_summary** → warning to actively avoid
2. **Avoid points** → constraints during execution
3. **Correct/Wrong examples** → reference for correct behavior
4. **Rule IDs** → record for potential error feedback

---

## STEP L6: ERROR FEEDBACK ESCALATION

```
if L learns lessons but still makes same type of error:
  L submits error scene report:
    intent_tags: {domain, task_goal}
    failed_skill: "..."
    applied_rules: ["rec_xxx", "rec_yyy"]  ← rules that failed to prevent
    error_description: "..."

  O handling:
    mark rules as needs_sync
    fire NEW Reflector with error scene report + original session context as context
    R generates improved rule proposal
    C reviews → verified/rejected
    notify L of outcome
```

---

## Learn Mode Permissions

```
allowed:
  READ   MCP tools, rule results, error scene reports
  CALL   read_rules, list_rules, stage_rule, commit_rule
  FIRE   Reflector subagents (REFLECT.md)
  RETURN compressed summaries to L

forbidden:
  expose MCP call details to L
  return raw rule file content to L
  load LEARN.md into L's context
  modify rule content directly (use MCP tools)
```
