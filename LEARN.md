# Aristotle Learn Protocol

> Loaded only during the LEARN phase. Do NOT load during REFLECT or REVIEW.
> This file runs entirely within O's (Aristotle's) context. L never sees this file.

This file defines the learning retrieval protocol: O receives L's natural-language request, extracts intent, delegates S to query MCP, filters/compresses results, and returns a distilled summary to L.

**Core constraint: context isolation.** L's context must stay focused on the user's primary task. L never learns about GEAR, MCP, `read_rules`, frontmatter, or any reflection infrastructure.

**Tunable parameter:**
- `MAX_LEARN_RESULTS` — Maximum number of rule bodies loaded into O's context (default: **5**). Controls context budget. Increase for broad queries, decrease for focused tasks.

---

## STEP L1: RECEIVE LEARNING REQUEST

### Trigger Scenarios

| Scenario | Trigger | Example |
|----------|---------|---------|
| Active trigger | User runs `/aristotle learn` | L explicitly requests lessons |
| Parameterized trigger | User runs `/aristotle learn --domain X --goal Y` | Explicit retrieval dimensions |
| Natural language | L sends a free-form query to O | "之前做数据库迁移踩过坑吗？" |
| Passive trigger (P3.3) | O detects error signal from conversation | Multi-agent error detected |

### Input

The request arrives as one of:
- A natural-language string (most common)
- Explicit `--domain` and `--goal` flags (parameterized)
- An internal signal from P3.3 passive monitoring

---

## STEP L2: EXTRACT INTENT (O's Role)

O infers structured intent from L's natural-language request. L does NOT provide field names or formats.

### L2a. Intent Extraction

From the request text, infer:

```
learning_request (O internal structure, L never sees this):
  intent_tags:
    domain: "inferred technical domain"
    task_goal: "inferred task goal"
  failed_skill: "previously failed skill/tool (optional)"
  error_context: "brief error description (optional)"
```

### L2b. Domain Inference

Use the same domain mapping as REFLECTOR.md:

| Keyword signals | domain |
|----------------|--------|
| File read/write, paths, permissions | `file_operations` |
| API calls, HTTP, external services | `api_integration` |
| Database, queries, ORM, migration | `database_operations` |
| Syntax errors, code generation | `code_generation` |
| Compilation, bundling, dependencies | `build_system` |
| Tests, assertions | `testing` |
| CI/CD, deployment, configuration | `deployment` |
| Cannot clearly classify | `general` |

### L2c. Threshold Evaluation

- `intent_tags.domain` non-empty → can proceed to query
- `intent_tags.domain` empty but `error_context` non-empty → use `keyword` parameter for full-text match
- Both empty → inform L: "🦉 Need more context to search for lessons. Please describe the task or domain." → STOP

---

## STEP L3: CONSTRUCT QUERY (S Function)

S is a function call within O. Input: the learning_request from L2. Output: `read_rules()` parameter dict.

### L3a. Build Parameters

```
params = {status: "verified"}  # L only sees verified rules

if intent_tags.domain non-empty:
  params.intent_domain = intent_tags.domain

if intent_tags.task_goal non-empty:
  params.intent_task_goal = intent_tags.task_goal

if failed_skill non-empty:
  params.failed_skill = failed_skill

if error_context non-empty:
  # Extract 2-3 core technical nouns, join with | for regex match
  params.keyword = extract_keywords(error_context)
```

All parameters are AND-combined.

### L3b. Keyword Extraction Strategy

From `error_context`, extract core technical nouns:

- "Prisma connection pool timeout" → `keyword = "prisma|timeout|pool"`
- "TypeScript circular import" → `keyword = "circular|import"`
- "File not found during build" → `keyword = "file.*not.*found|build"`

Use `|` to join for regex OR matching. Keep to 2-4 terms.

### L3c. Round 1: Lightweight Metadata Query

Call `list_rules(**params)` — returns paths + frontmatter only, **no content bodies**. This keeps O's context small even if many rules match. Collect all candidate paths and metadata.

### L3d. Round 2: Parallel Subagent Scoring

O does NOT read rule content itself. Instead, O spawns one subagent per candidate rule (via `task()` with `run_in_background=true`). Each subagent receives:

1. **Query context**: the original learning request (natural language or structured intent_tags)
2. **Rule path**: the file path to read
3. **Scoring instructions**: evaluate how relevant this rule is to the query

Each subagent:
1. Reads ONE rule file's full content (frontmatter + markdown body) via `load_rule_file`
2. Evaluates relevance by comparing the rule's Context, Rule, and Example against the query context
3. Returns a score (1–10) and a one-line relevance justification

```
Subagent prompt template:
  "Score this rule's relevance to the query: {query_context}
   Rule file: {rule_path}
   Read the file, then score 1-10 based on:
   - Does the rule's Context match the current task scenario? (most important)
   - Would the Example's correct approach prevent the current type of error?
   - Is the error scene similar to what the user is about to do?
   Return JSON: {score: N, reason: 'one-line justification'}"
```

### L3e. Collect and Rank

O collects all subagent results (background task completion notifications), sorts by score descending, and takes the top `MAX_LEARN_RESULTS` (default: 5).

Rules scoring below 3 are discarded — unlikely to be helpful.

O may optionally call `check_sync_status` to detect verified rules on disk not committed to git. If unsynced, call `sync_rules()`. This is internal self-healing — L is never informed.

---

## STEP L4: COMPRESS AND FORMAT (O's Role)

O now has the top-N rule bodies from the scoring subagents. O compresses them into minimal summaries for L. O reads the content **returned by subagents in their score results**, not from files directly.

### L4a. Dedup

Within the same category, if multiple rules have similar `error_summary`, keep the most specific one.

### L4b. Summary Compression

For each retained rule, extract only the essentials:

- `metadata.error_summary` → one-line error description
- `content` → extract the **Rule** section (core constraint)
- `content` → extract the **Example** section (correct/wrong behavior)
- `metadata.id` → for error feedback reference

### L4c. Output Format

```
🦉 Found N relevant lessons from past sessions:

1. ⚠ [CATEGORY] error_summary (one-line description of the error scenario)
   Avoid: Core constraint from Proposed Rule (1-2 sentences)
   ✅ Correct approach | ❌ Wrong approach
   Rule ID: rec_xxx (for error feedback reference)

2. ⚠ [CATEGORY] error_summary
   Avoid: ...
   ✅ ... | ❌ ...
   Rule ID: rec_yyy
```

If no results found:
```
🦉 No relevant lessons found for this query.
   Try: /aristotle learn --domain <domain> --goal <goal>
```

---

## STEP L5: RETURN TO L

Deliver the compressed summary from L4c to L. L receives only:
- The formatted text above
- No infrastructure details (no MCP calls, no frontmatter, no query logic)

L's responsibilities after receiving the summary:
1. **error_summary** → key warning to actively avoid during execution
2. **Avoid points** → constraints to follow when generating code/plans
3. **Correct/Wrong examples** → reference for correct behavior
4. **Rule IDs** → record for potential error feedback

---

## STEP L6: ERROR FEEDBACK ESCALATION

If L learns lessons but still makes the same type of error, L submits an "error scene report" back to O.

### L6a. Error Scene Report Format

```
Error scene report:
  intent_tags: {domain: "...", task_goal: "..."}
  failed_skill: "..." (if applicable)
  applied_rules: ["rec_xxx", "rec_yyy"]  ← rule IDs from learning, but still failed to avoid
  error_description: "..."
```

### L6b. O's Handling

On receiving an error scene report:
1. Mark the corresponding rules as `needs_sync` (update frontmatter status)
2. Fire a NEW Reflector subagent → `task()` with REFLECTOR.md protocol
   - Pass the error scene report as additional context in the prompt
   - Include the original session context that triggered the learning
3. R generates an improved rule proposal (new pending file)
4. C reviews the improved rule → verified / rejected
5. Notify L of the outcome

This escalation path ensures: learning failures trigger deeper reflection, and the rule base evolves.

---

## Learn Mode Permissions

In Learn mode, O IS allowed to:
- ✅ Call MCP tools (`read_rules` for retrieval)
- ✅ Parse and filter rule results in O's own context
- ✅ Return compressed summaries to L
- ✅ Receive error scene reports from L
- ✅ Fire Reflector subagents for error escalation (loading REFLECT.md)
- ✅ Update rule statuses via MCP (`stage_rule`, `commit_rule`)

O is NOT allowed to:
- ❌ Expose MCP call details to L
- ❌ Return raw rule file content to L
- ❌ Load LEARN.md into L's context
- ❌ Modify rule content directly (must use MCP tools)
