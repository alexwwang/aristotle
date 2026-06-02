# 技术方案 M5: Learn Two-Round 检索

**日期:** 2026-04-22
**前置文档:** GEAR Phase 2 产品方案_260422.md §二
**范围:** `_orch_start.py` + `_orch_event.py` + `_orch_parsers.py` + `_orch_prompts.py` + `config.py`
**不涉及:** M6 feedback 闭环、M7 Δ log-norm、SKILL.md 重写、测试代码

---

## 一、模块概述

M5 将 learn 流从单轮检索升级为两轮：Round 1 返回 metadata-only 候选列表，Round 2 并行评分 subagent 读取完整内容并打分，O 做最终 Top-N 压缩。新增 `fire_score` action type，主 session 并行发起多个 `task()` 调用实现评分。

### 变更统计

| 文件 | 行数 | 性质 |
|------|------|------|
| `_orch_start.py` | +~15 行 | learn 分支 `search` phase 不再直接 done |
| `_orch_event.py` | +~55 行 | `score_done` + `scoring` handler，`o_done` + `compressing` handler |
| `_orch_parsers.py` | +~70 行 | 重构 `_do_search_and_notify` → `fire_score`，新增解析函数 |
| `_orch_prompts.py` | +~50 行 | `SCORING_PROMPT_TEMPLATE` + `COMPRESS_PROMPT_TEMPLATE` |
| `config.py` | +~8 行 | 5 个新常量 |

### 新增 action type

| Action | 用途 | 返回时机 |
|--------|------|---------|
| `fire_score` | 携带 prompt 列表，主 session 并行评分 | Round 1 search 完成后 |

### 新增 event type

| Event | Phase | 用途 |
|-------|-------|------|
| `score_done` | `scoring` | 所有评分 subagent 完成 |
| `o_done` | `compressing` | O 压缩完成 |

---

## 二、状态机扩展

### 2.1 Learn 流完整状态机

```
orchestrate_start("learn")
            │
    ┌───────┴────────┐
    │                │
有 domain+goal    无 domain+goal
    │                │
    ▼                ▼
phase: search   phase: intent_extraction
    │                │ (o_done)
    │                ▼
    │          phase: search
    │                │
    └───────┬────────┘
            │
     list_rules 结果?
     ┌──────┴──────┐
     │             │
   0 条         ≥1 条
     │             │
     ▼             ▼
  done         phase: scoring     ← 新增
  notify        │ (所有 score_done)
  "无匹配"       ▼
            phase: compressing   ← 新增
                │ (o_done)
                ▼
            done
            notify(压缩结果)
```

### 2.2 新增 phase

| Phase | 前置 | 后续 | 说明 |
|-------|------|------|------|
| `scoring` | `search` | `compressing` | 等待所有评分 subagent 完成 |
| `compressing` | `scoring` | `done` | O 执行压缩 |

---

## 三、文件变更详情

### 3.1 `config.py` — 新增常量

在现有 `WORKFLOW_DIR_NAME = ".workflows"` 之后（L56 后）追加：

```python
# ── M5: Learn Two-Round 检索 ──
SCORING_TOP_N = 5           # Round 2 评分候选数上限
SCORE_PARALLEL_MAX = 3      # 同时并行评分 subagent 数量
COMPRESS_TOP_N = 3          # 压缩后最终返回规则数
COMPRESS_MAX_CHARS = 800    # 压缩结果总字符数上限
COMPRESS_RULE_MAX_CHARS = 200  # 单条压缩规则字符数上限
```

**说明：** `SCORING_TOP_N` 是 Round 1 → Round 2 的候选截断数。Round 1 `list_rules` 可能返回超过 5 条结果，只取前 5 条进入评分阶段。

### 3.2 `_orch_prompts.py` — 新增 Prompt 模板

在现有 `REVISE_PROMPT_TEMPLATE` 之后（L74 后）追加：

```python
# ── M5: Two-Round 检索 Prompt 模板 ──

SCORING_PROMPT_TEMPLATE = """You are scoring the relevance of a GEAR rule to a user's learning query.

USER QUERY: {query}
INTENT DOMAIN: {domain}
INTENT TASK GOAL: {task_goal}

RULE FILE: {rule_path}

Read the rule file at the path above using your file reading tools, then score its relevance from 1 to 10:
- 10: Directly addresses the exact error/issue the user faces
- 7-9: Highly relevant, covers the same domain and similar task
- 4-6: Moderately relevant, shares domain but different task
- 1-3: Tangentially related at best

Return ONLY valid JSON:
{{"score": <int 1-10>, "summary": "<one-line summary of the rule, max 120 chars>"}}
"""

COMPRESS_PROMPT_TEMPLATE = """You are compressing scored GEAR rules into structured knowledge for injection into a Learner agent's context.

USER QUERY: {query}

SCORED RULES (sorted by score, highest first):
{scored_rules_text}

Select the Top-{top_n} most relevant rules. For each rule, output EXACTLY this format:

[id · scope]
## WHEN
<trigger conditions as key=value AND key~pattern predicates, max 80 chars>

## DO
1. <imperative action, verb-led, max 60 chars>
2. <imperative action, verb-led, max 60 chars>

## NEVER
- <common mistake to avoid, max 80 chars>

## CHECK (optional — include only if there is an executable verification step)
<run X → verify Y under condition Z, max 80 chars>

Separate rules with --- on its own line.

CONSTRAINTS:
1. "WHEN" must be specific trigger conditions, NOT vague descriptions
2. "DO" must be verb-led imperative actions, max 3 items, NO explanations
3. "NEVER" must describe what NOT to do, separated from "DO", max 3 items
4. "CHECK" is optional — only include when a concrete verification step exists
5. Each section is independently editable — no implicit cross-section dependencies
6. Each rule MUST NOT exceed {rule_max_chars} chars total
7. Total output MUST NOT exceed {max_chars} chars
8. Output ONLY the structured rules, no commentary, no markdown fences around the whole output
"""
```

### 3.3 `_orch_prompts.py` — 新增构建函数

```python
def _build_scoring_prompt(
    query: str,
    domain: str,
    task_goal: str,
    rule_path: str,
) -> str:
    """构建单条规则的评分 prompt。"""
    return SCORING_PROMPT_TEMPLATE.format(
        query=query[:500],
        domain=domain[:100],
        task_goal=task_goal[:100],
        rule_path=rule_path,
    )


def _build_compress_prompt(
    query: str,
    scored_rules_text: str,
    top_n: int = 3,
    rule_max_chars: int = 200,
    max_chars: int = 800,
) -> str:
    """构建压缩 prompt。"""
    return COMPRESS_PROMPT_TEMPLATE.format(
        query=query[:500],
        scored_rules_text=scored_rules_text,
        top_n=top_n,
        rule_max_chars=rule_max_chars,
        max_chars=max_chars,
    )
```

### 3.4 `_orch_parsers.py` — 重构 `_do_search_and_notify`

**核心变更：** `_do_search_and_notify` 不再直接返回 notify，改为返回 `fire_score` action（携带 prompt 列表）。0 结果时短路返回 done。

**替换位置：** 整个 `_do_search_and_notify` 函数（L95-139）。

```python
def _do_search_and_notify(workflow_id: str) -> dict:
    """Round 1: list_rules → 判断结果数量 → 返回 fire_score 或 done。"""
    from aristotle_mcp._tools_rules import list_rules
    from aristotle_mcp.config import SCORING_TOP_N
    from aristotle_mcp._orch_prompts import _build_scoring_prompt

    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"action": "notify", "workflow_id": workflow_id, "message": "🦉 Workflow state lost."}

    intent = workflow.get("intent_tags", {})
    keywords = workflow.get("keywords", "")

    params: dict = {"status_filter": "verified"}
    if intent.get("domain"):
        params["intent_domain"] = intent["domain"]
    if intent.get("task_goal"):
        params["intent_task_goal"] = intent["task_goal"]
    if keywords:
        params["keyword"] = keywords

    result = list_rules(**params)
    count = result.get("count", 0)
    rules = result.get("rules", [])

    # 零候选：短路到 done，避免进入 scoring 死等
    if count == 0:
        workflow["phase"] = "done"
        workflow["result_count"] = 0
        _save_workflow(workflow_id, workflow)
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": "🦉 No relevant lessons found for this query.",
            "result_count": 0,
        }

    # 截断候选数
    candidates = rules[:SCORING_TOP_N]

    # 保存候选元数据到 workflow（供 Round 2 使用）
    workflow["phase"] = "scoring"
    workflow["result_count"] = count
    workflow["candidates"] = [
        {
            "rule_id": r.get("metadata", {}).get("id", ""),
            "path": r.get("path", ""),
        }
        for r in candidates
    ]
    _save_workflow(workflow_id, workflow)

    # 构建 score_requests
    query = workflow.get("query", "")
    domain = intent.get("domain", "")
    task_goal = intent.get("task_goal", "")

    score_requests = []
    for c in candidates:
        prompt = _build_scoring_prompt(
            query=query,
            domain=domain,
            task_goal=task_goal,
            rule_path=c.get("path", ""),
        )
        # candidates 已展平为 {"rule_id": ..., "path": ...}，直接取 rule_id
        # 无 id 时从文件名派生作为 fallback
        rid = c.get("rule_id", "") or Path(c.get("path", "")).stem
        score_requests.append({
            "rule_id": rid,
            "prompt": prompt,
        })

    return {
        "action": "fire_score",
        "workflow_id": workflow_id,
        "score_requests": score_requests,
        "notify_message": f"🦉 Scoring {len(score_requests)} candidate rules...",
    }
```

**⚠ 注意：** `candidates` 列表中的 `rule_id` 需从 `rules` 列表项的 `metadata` 中提取。`list_rules` 返回的每项结构为 `{"path": "...", "metadata": {...}}`，其中 `metadata.id` 是规则 ID。

### 3.5 `_orch_parsers.py` — 新增解析函数

在 `_do_search_and_notify` 之后追加：

```python
def _parse_scores(score_done_data: dict) -> list[dict]:
    """解析 score_done 事件中的评分结果。

    每个评分项格式: {"rule_id": "rec_xxx", "score": 8, "summary": "..."}
    如果解析失败，返回中性评分 5。
    """
    raw_scores = score_done_data.get("scores", [])
    parsed = []
    for item in raw_scores:
        if isinstance(item, str):
            try:
                import json
                item = json.loads(item)
            except (json.JSONDecodeError, TypeError):
                item = {}
        if not isinstance(item, dict):
            item = {}

        score = item.get("score", 5)
        try:
            score = int(score)
            score = max(1, min(10, score))
        except (ValueError, TypeError):
            score = 5

        parsed.append({
            "rule_id": item.get("rule_id", ""),
            "score": score,
            "summary": str(item.get("summary", ""))[:120],
        })
    return parsed


def _format_scored_rules_for_compress(
    scores: list[dict],
    workflow: dict,
) -> str:
    """将评分结果格式化为压缩 prompt 的输入文本，包含完整规则内容。"""
    from pathlib import Path as _Path

    # 按 score 降序排列
    sorted_scores = sorted(scores, key=lambda x: x["score"], reverse=True)

    lines = []
    for s in sorted_scores:
        rule_id = s.get("rule_id", "")
        score = s.get("score", 0)
        summary = s.get("summary", "")

        # 从 workflow candidates 中找到路径
        candidates = workflow.get("candidates", [])
        rule_path = ""
        for c in candidates:
            if c.get("rule_id") == rule_id:
                rule_path = c.get("path", "")
                break

        # 读取完整规则内容供 O 压缩使用
        content = ""
        if rule_path:
            rp = _Path(rule_path)
            if rp.exists():
                content = rp.read_text(encoding="utf-8")
        lines.append(f"---\nRule: {rule_path or rule_id} (score: {score}/10)\nSummary: {summary}\n\n{content}")

    return "\n".join(lines)
```

**⚠ `read_rules` 导入说明已移除：** 改为直接通过 `Path.read_text` 读取完整规则内容注入压缩 prompt。SCORING_TOP_N=5 × ~500 chars = ~2500 chars，在 prompt 限制内。

### 3.6 `_orch_event.py` — 新增 score_done + compressing handler

**变更位置：** 在现有 `o_done + review` handler（L56-104）和 `o_done catch-all`（L106-112）之间插入新 handler。

**⚠ 实现顺序约束（产品方案 §2.4）：** 新增的 `o_done + compressing` handler 必须在 `o_done catch-all` **之前**。

```python
    # ═══ 2.5 Learn flow: o_done + compressing (NEW — M5) ═══
    if event_type == "o_done" and workflow.get("phase") == "compressing":
        compressed = data.get("result", "")
        if isinstance(compressed, dict):
            compressed = json.dumps(compressed)
        compressed = str(compressed)

        workflow["phase"] = "done"
        _save_workflow(workflow_id, workflow)

        count = workflow.get("result_count", 0)
        return {
            "action": "notify",
            "workflow_id": workflow_id,
            "message": f"🦉 Found {count} relevant lesson(s) (scored & compressed):\n\n{compressed}",
        }

    # ═══ 3. o_done catch-all ═══
    if event_type == "o_done":
        ...
```

新增 `score_done` handler，放在 `subagent_done + reflecting` handler 之前：

```python
    # ═══ 3.5 Learn flow: score_done + scoring (NEW — M5) ═══
    if event_type == "score_done" and workflow.get("phase") == "scoring":
        from aristotle_mcp._orch_parsers import _parse_scores, _format_scored_rules_for_compress
        from aristotle_mcp._orch_prompts import _build_compress_prompt
        from aristotle_mcp.config import COMPRESS_TOP_N, COMPRESS_RULE_MAX_CHARS, COMPRESS_MAX_CHARS

        scores = _parse_scores(data)

        # ── 强制降级检查：所有评分均为默认值时降级为单轮 ──
        if all(s["score"] == 5 and not s["summary"] for s in scores):
            workflow["phase"] = "done"
            _save_workflow(workflow_id, workflow)
            candidates = workflow.get("candidates", [])
            lines = [f"🦉 Found {workflow.get('result_count', 0)} relevant lesson(s):"]
            for i, c in enumerate(candidates[:5], 1):
                lines.append(f"  {i}. {c.get('path', '?')}")
            return {
                "action": "notify",
                "workflow_id": workflow_id,
                "message": "\n".join(lines),
            }
        # ── 降级检查 END ──

        scored_text = _format_scored_rules_for_compress(scores, workflow)

        workflow["phase"] = "compressing"
        workflow["scores"] = scores
        _save_workflow(workflow_id, workflow)

        o_prompt = _build_compress_prompt(
            query=workflow.get("query", ""),
            scored_rules_text=scored_text,
            top_n=COMPRESS_TOP_N,
            rule_max_chars=COMPRESS_RULE_MAX_CHARS,
            max_chars=COMPRESS_MAX_CHARS,
        )

        return {
            "action": "fire_o",
            "workflow_id": workflow_id,
            "o_prompt": o_prompt,
        }
```

### 3.7 `_orch_event.py` — 完整 dispatch 顺序

产品方案 §2.4 要求 compressing 在 catch-all 之前。技术方案将 compressing 放在 review 之后（§3.6 指定插入点为 review handler 和 catch-all 之间），功能等价——两个 handler 通过 phase 互斥匹配，顺序不影响行为。最终 dispatch 顺序：

```python
# ═══ 1. Learn: o_done + intent_extraction (现有，不变) ═══
# L37-54

# ═══ 2. Review: o_done + review (现有，不变) ═══
# L56-104

# ═══ 2.5 Learn: o_done + compressing (新增 — M5) ═══
# ← 新插入

# ═══ 3. o_done catch-all (现有，不变) ═══
# L106-112

# ═══ 3.5 Learn: score_done + scoring (新增 — M5) ═══
# ← 新插入

# ═══ 4. Reflect: subagent_done + reflecting (现有，不变) ═══
# L114-161

# ═══ 5. Reflect: subagent_done + checking (现有，不变) ═══
# L163-187

# ═══ 6. Catch-all (现有，不变) ═══
# L189-194
```

**注意：** `o_done + compressing` 必须在 `o_done catch-all` 之前，否则 compressing 阶段的 `o_done` 会被 catch-all 拦截返回 "Unexpected o_done" 错误。

### 3.8 `_orch_start.py` — learn 分支无需变更

**注意：** `_orch_start.py` 无 Python 代码变更。但 `_do_search_and_notify` 返回值新增 `fire_score` action type，SKILL.md 调度器必须理解此 action（见 §4 SKILL.md 扩展）。

验证：

```python
# _orch_start.py L64-70 (有 domain+goal 分支)
_save_workflow(workflow_id, {..., "phase": "search"})
return _do_search_and_notify(workflow_id)  # ← 直接透传，返回 fire_score 或 notify

# _orch_start.py L72-83 (无 domain+goal 分支)
_save_workflow(workflow_id, {..., "phase": "intent_extraction"})
return {"action": "fire_o", ...}
```

`_do_search_and_notify` 重构后返回 `fire_score` 或 `notify(0结果)`，`_orch_start.py` 透传即可。

---

## 四、fire_score action 执行流程

```
MCP: _do_search_and_notify 完成
  → 返回 {action: "fire_score", score_requests: [...]}
       │
       ▼
主 session (SKILL.md):
  1. 显示 notify_message: "🦉 Scoring 3 candidate rules..."
  2. 对每个 score_request 发起并行 task():
     - task(prompt=req_1.prompt, subagent_type="explorer")
     - task(prompt=req_2.prompt, subagent_type="explorer")
     - task(prompt=req_3.prompt, subagent_type="explorer")
     （最多 SCORE_PARALLEL_MAX=3 并行，超出排队）
  3. 每个 task 返回后解析 JSON: {"score": N, "summary": "..."}
  4. 全部完成后聚合:
     scores = [
       {"rule_id": "rec_001", "score": 8, "summary": "..."},
       {"rule_id": "rec_002", "score": 5, "summary": "..."},
       {"rule_id": "rec_003", "score": 3, "summary": "..."},
     ]
  5. 回调 MCP:
     orchestrate_on_event("score_done", {
       "workflow_id": "wf_xxxx",
       "scores": scores
     })
       │
       ▼
MCP: scoring → compressing
  → 返回 {action: "fire_o", o_prompt: compress_prompt}
       │
       ▼
主 session: fire O subagent → o_done → 最终压缩结果
```

### SKILL.md 扩展（~10 行）

```markdown
### If action is `fire_score`:
1. If `notify_message` present, display it
2. Fire up to SCORE_PARALLEL_MAX parallel task() calls from score_requests:
   - `task(prompt=item.prompt, subagent_type="explorer")`
   - If more items than SCORE_PARALLEL_MAX, process remaining after first batch completes
   - Parse the returned text as JSON for `score` and `summary`
   - If parse fails, use `{"score": 5, "summary": "parse failed"}`
3. Collect all results. For each result, merge the original `rule_id` from the corresponding `score_requests` item into the parsed output. Then call `aristotle_orchestrate_on_event`:
   - `event_type`: "score_done"
   - `data_json`: `{"workflow_id": "<id>", "scores": [<collected results>]}`
4. Process the returned action (should be `fire_o` for compressing)
```

---

## 五、降级策略

当 Round 2 评分 subagent 全部失败时（所有评分解析失败，均回退为默认值 5 且 summary 为空），`score_done` handler 中的**强制降级检查**直接返回 Round 1 结果，跳过压缩阶段。此检查已在 §3.6 `score_done` handler 中实现（非可选）。

**⚠ 降级路径不能调用重构后的 `_do_search_and_notify`**——会重新进入 scoring phase 形成死循环。必须直接返回 notify。

**部分失败场景：** 如果部分评分成功（非默认值），降级检查不触发，正常进入 compressing phase。`_format_scored_rules_for_compress` 通过 `Path.read_text` 读取完整规则内容，即使 summary 为空，O 仍能从原始规则内容生成压缩摘要。

---

## 六、数据流图

```
orchestrate_start("learn", {query})
        │
   domain+goal?
   ┌────┴────┐
   Yes       No → fire_o(intent_extraction)
   │                │ o_done
   │                ▼
   │          search phase
   │                │
   └────┬───────────┘
        │
  _do_search_and_notify()
        │
  list_rules 结果?
  ┌─────┴─────┐
  0 条       ≥1 条
  │           │
  ▼           ▼
 done     fire_score(action)
 notify    → 主 session 并行 task() ×N
                 │ 全部完成
                 ▼
           score_done(event)
                 │
                 ▼
           scoring → compressing
           fire_o(compress_prompt)
                 │ o_done
                 ▼
           done → notify(压缩结果)
```

---

## 七、实现顺序

| 阶段 | 步骤 | 内容 | 依赖 |
|------|------|------|------|
| A | A1 | `config.py` 新增 5 个常量 | 无 |
| | A2 | `_orch_prompts.py` 新增 2 个模板 + 2 个构建函数 | 无 |
| B | B1 | `_orch_parsers.py` 重构 `_do_search_and_notify` | A1, A2 |
| | B2 | `_orch_parsers.py` 新增 `_parse_scores` | 无 |
| | B3 | `_orch_parsers.py` 新增 `_format_scored_rules_for_compress` | 无 |
| C | C1 | `_orch_event.py` 新增 `o_done + compressing` handler | A2 |
| | C2 | `_orch_event.py` 新增 `score_done + scoring` handler | B2, B3, A2 |
| D | D1 | 验证 dispatch 顺序正确 | C1, C2 |
| E | E1 | pytest 回归 + 新测试 | D1 |

**关键路径：** A1→B1→C2→E1

---

## 八、验证

| # | 验证项 | 方法 |
|---|--------|------|
| V1 | list_rules 返回 0 结果时短路到 done | pytest: mock list_rules 返回空 |
| V2 | list_rules 返回 ≥1 结果时返回 fire_score | pytest: mock list_rules 返回 N 条 |
| V3 | fire_score 包含正确的 score_requests 列表 | pytest: 验证 prompt 内容 |
| V4 | score_done 事件触发 scoring → compressing 转换 | pytest: 模拟 score_done |
| V5 | o_done + compressing 返回压缩结果 | pytest: 模拟 compressing o_done |
| V6 | o_done + compressing 在 catch-all 之前匹配 | pytest: phase=compressing 不被 catch-all 拦截 |
| V7 | 评分解析失败时使用中性分 5 | pytest: 传入无效 JSON |
| V8 | 现有 227 pytest + 98 static 全部通过 | 回归测试 |
