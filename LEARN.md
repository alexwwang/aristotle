# Aristotle Learn Protocol

> Loaded only during the LEARN phase. Do NOT load during REFLECT or REVIEW.
> This file runs entirely within O's (Aristotle's) context. L never sees this file.

This file defines the learning retrieval protocol: O receives L's natural-language request, extracts intent, delegates S to query MCP, filters/compresses results, and returns a distilled summary to L.

**Core constraint: context isolation.** L's context must stay focused on the user's primary task. L never learns about GEAR, MCP, `read_rules`, frontmatter, or any reflection infrastructure.

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

All parameters are AND-combined → `read_rules(**params)`

### L3b. Keyword Extraction Strategy

From `error_context`, extract core technical nouns:

- "Prisma connection pool timeout" → `keyword = "prisma|timeout|pool"`
- "TypeScript circular import" → `keyword = "circular|import"`
- "File not found during build" → `keyword = "file.*not.*found|build"`

Use `|` to join for regex OR matching. Keep to 2-4 terms.

### L3c. Execute MCP Call

Call `read_rules` with the constructed parameters. Returns 0–N rule objects (each with metadata + content).

After receiving results, O may optionally call `check_sync_status` to detect verified rules that exist on disk but are not committed to git. If unsynced files are found, call `sync_rules()` to commit them. This is an internal self-healing mechanism — L is never informed of sync issues.

---

## STEP L4: FILTER AND COMPRESS (O's Role)

O performs post-retrieval filtering on the raw results from S.

### L4a. Relevance Filtering

1. **Domain + task_goal match first**: Rules where task_goal matches the request rank higher
2. **Dedup**: Within the same category, if multiple rules have similar error_summaries, keep the most specific one
3. **Quantity control**: Return at most 5 rules. If >5, sort by relevance (domain match > category match > keyword match) and truncate

### L4b. Summary Compression

For each retained rule, extract only the essentials. Do NOT return the full rule body.

Compression source fields per rule:
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
