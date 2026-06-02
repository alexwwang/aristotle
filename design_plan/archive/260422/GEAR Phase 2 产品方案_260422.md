# GEAR Phase 2 产品方案 — 协议完整性补全

**日期:** 2026-04-22
**版本:** v1.0-draft (Round 1 Review 修订)
**前置文档:** GEAR.md v1.1、GEAR 全工作流编排产品方案_260422.md (v1.2)、GEAR开发备忘录_260422.md
**目标:** 补全 GEAR 协议规范已定义但 Phase 1 产品方案未覆盖的 7 项功能，使 Aristotle 达到 GEAR v1.1 完整一致性

---

## 一、差距总览

Phase 1（M1-M4）实现了 reflect / review / sessions / learn 四个编排工作流。与 GEAR.md v1.1 协议规范比对后，发现以下 7 项协议已定义但产品未覆盖的功能：

| # | GEAR 功能 | 协议位置 | 优先级 | 本方案模块 |
|---|----------|---------|--------|-----------|
| 1 | Learn Two-Round 检索 | §S — Searcher, §Core Workflow Step 3 | **P1** | M5 |
| 2 | Error Feedback 闭环 | §Core Workflow Step 5-6, §L — Learner | **P1** | M6 |
| 3 | Feedback Signal 追踪 | §Frontmatter Schema "Feedback Signal" | **P2** | M7 |
| 4 | Δ log-normalization | §Δ Decision Factor | **P2** | M7 |
| 5 | Passive Trigger 增强 | §L — Learner triggers | **P2** | M8 |
| 6 | conflicts_with 检测 | §Frontmatter Schema "Rule Relations" | **P3** | M9 |
| 7 | committed_rule_paths 优化 | §3.2.3 confirm 搜索策略 | **P3** | M1 补丁 |

**明确延期至 Phase 3：**

| # | GEAR 功能 | 协议位置 | 延期理由 |
|---|----------|---------|---------|
| — | needs_sync 自动闭环 | §Rule Lifecycle "needs_sync" | Phase 1 已实现 `check_sync_status` + `sync_rules` 工具，可手动检测和修复。自动闭环（O 检测 → 自动触发 C sync）需要 workflow 完成后的持续监控机制，当前架构无此能力（MCP 是被动服务，无法主动轮询）。Phase 3 考虑在 `orchestrate_start` 入口增加自动 sync 检查作为折中方案 |

**依赖关系：**

```
M5 (Two-Round 检索)
 ├─► M6 (Error Feedback，依赖 M5 的检索结果)
 │    └─► M7 (Feedback Signal + Δ log-norm，依赖 M6 的反馈通道)
 ├─► M8 (Passive Trigger，独立，仅依赖 M1)
 └─► M9 (conflicts_with，依赖 Phase 2.1 的 models.py 扩展)
```

---

## 二、M5：Learn Two-Round 检索

### 2.1 问题陈述

当前 learn 流使用单轮检索：`list_rules` 返回 metadata-only 结果后，直接 `read_rules` 加载完整内容返回给用户。GEAR 协议要求 S 角色执行两轮检索：

- **Round 1:** `list_rules` 返回 metadata-only 候选列表（最小化 context 开销）
- **Round 2:** 并行评分 subagent 读取每个候选规则的完整内容并打分（1-10），O 做最终 Top-N 筛选和压缩

### 2.2 目标行为

```
用户: /aristotle learn prisma connection timeout
                │
                ▼
  orchestrate_start("learn", {query: "prisma connection timeout"})
                │
                ▼
  ┌─ Round 1: intent_extraction (fire_o) ─────────────────┐
  │  O 提取 intent_tags + keywords                         │
  └───────────────────────────────────────────────────────┘
                │ o_done
                ▼
  ┌─ Round 1: search ─────────────────────────────────────┐
  │  list_rules(metadata-only) → 候选列表 (最多 20 条)     │
  └───────────────────────────────────────────────────────┘
                │
                ▼
  ┌─ Round 2: scoring (fire_o × N) ──────────────────────┐
  │  为每个候选规则 spawn 并行评分 subagent                │
  │  每个 subagent 读完整内容 → 打分 1-10 → 返回          │
  └───────────────────────────────────────────────────────┘
                │ score_done (所有评分完成)
                ▼
  ┌─ O 筛选 + 压缩 ──────────────────────────────────────┐
  │  Top-N 筛选 → 压缩摘要 → 返回给用户                   │
  └───────────────────────────────────────────────────────┘
```

### 2.3 状态机扩展

```
                     orchestrate_start("learn")
                              │
                    ┌─────────┴─────────┐
                    │                   │
              有 domain+goal       无 domain+goal
                    │                   │
                    ▼                   ▼
              phase: search     phase: intent_extraction
                    │                   │ (o_done)
                    │                   ▼
                    │             phase: search
                    │                   │
                    └───────┬───────────┘
                            │
                     list_rules 结果?
                     ┌──────┴──────┐
                     │             │
               0 条结果        ≥1 条结果
                     │             │
                     ▼             ▼
              phase: done    phase: scoring     ← 新增
              notify("无匹配")   │ (所有 score_done)
                                ▼
                         phase: compressing ← 新增
                                │
                                ▼
                         phase: done
```

### 2.4 新增 MCP 工具参数

#### orchestrate_on_event 扩展

| event_type | phase | 行为 |
|-----------|-------|------|
| `score_done` | `scoring` | 收集评分结果，全部完成后转入 compressing |
| `o_done` | `compressing` | O 完成压缩，返回最终结果 |

**⚠ 实现顺序约束：** 新增的 `o_done + compressing` handler 必须注册在现有 `_orch_event.py:107-112` 的 `o_done` catch-all **之前**，否则 catch-all 会拦截 compressing 阶段的 `o_done` 事件，返回 "Unexpected o_done" 错误。正确的 dispatch 顺序：

```python
# 1. learn: o_done + intent_extraction  (现有)
# 2. learn: o_done + compressing        (新增 — 在 catch-all 之前)
# 3. review: o_done + review             (现有)
# 4. o_done catch-all                    (兜底)
```

#### score_done 事件数据

```python
{
    "event_type": "score_done",
    "workflow_id": "wf_xxxx",
    "scores": [
        {"rule_id": "rec_001", "path": "user/rec_001.md", "score": 8, "summary": "..."},
        {"rule_id": "rec_002", "path": "user/rec_002.md", "score": 5, "summary": "..."},
    ]
}
```

### 2.5 评分 Prompt 模板

```python
SCORING_PROMPT_TEMPLATE = """You are scoring the relevance of a GEAR rule to a user's learning query.

USER QUERY: {query}
INTENT DOMAIN: {domain}
INTENT TASK GOAL: {task_goal}

RULE FILE: {rule_path}

Read the full rule file, then score its relevance from 1 to 10:
- 10: Directly addresses the exact error/issue the user faces
- 7-9: Highly relevant, covers the same domain and similar task
- 4-6: Moderately relevant, shares domain but different task
- 1-3: Tangentially related at best

Return ONLY valid JSON:
{{"score": <int 1-10>, "summary": "<one-line summary of the rule, max 120 chars>"}}
"""
```

### 2.6 压缩知识注入格式

Learner 上下文注入的压缩规则不是自由文本摘要，而是结构化 Markdown 块。每条规则由 `WHEN` / `DO` / `NEVER` 三个必需 section 和 `CHECK` 一个可选 section 组成，辅以 `id` 和 `scope` 元数据。

#### 2.6.1 格式定义与样例

每条压缩规则是独立的 Markdown 块，section 之间用空行分隔，规则之间用 `---` 分隔：

```markdown
[rec_1713283200 · user]
## WHEN
task=connection_pool AND env=serverless AND error~timeout

## DO
1. Set pool_size=5, connection_limit=3
2. Use Prisma connection_manager with handleDisconnects

## NEVER
- Use default pool size (10) in Lambda — causes connection exhaustion under concurrency

## CHECK
Run app → verify no P2024 in logs under 50 concurrent requests

---
[rec_1713350012 · project]
## WHEN
tool=ast_grep AND lang=typescript AND pattern~circular

## DO
1. Check import order — reverse if needed
2. Use dynamic import() for lazy-loaded modules

## NEVER
- Add barrel files to "fix" circular deps — hides the real dependency cycle

---
```

**元数据行：** `[rec_1713283200 · user]` — 方括号内为 `id · scope`，用于 feedback 关联和作用域识别。与正文空一行。

**`## CHECK` 可选性：** 当规则有明确的可执行验证步骤时包含（如"运行 X 验证 Y"）。纯行为准则类规则可省略。`## CHECK` 的存在让 M6 feedback 闭环有客观判定依据——Learner 可执行 check 步骤验证规则是否生效，而非依赖主观判断。

#### 2.6.2 五项设计约束

| # | 约束 | Section | 规则 |
|---|------|---------|------|
| 1 | **触发边界清晰** | `## WHEN` | 使用 `key=value` AND 连接的谓词表达式。匹配条件必须可机器解析（domain、task_goal、error 关键词、env/tool 标记）。不允许模糊描述如 "database-related issues"。≤80 chars |
| 2 | **控制密度高** | `## DO` | 仅包含可直接执行的操作指令，编号列表。每条指令动词开头的祈使句，不含解释、推理过程或背景信息。≤3 条，每条 ≤60 chars |
| 3 | **AVOID 显式分离** | `## NEVER` | 失败经验（不该做的）独立存储，用无序列表。`DO` 只写正确做法，`NEVER` 只写错误做法。不允许混合。≤3 条，每条 ≤80 chars |
| 4 | **结构可编辑** | 全部 section | 每个 section 是独立的 Markdown 块。revise 操作可只更新 `## DO` 而不影响 `## WHEN` / `## NEVER` / `## CHECK`。section 间无隐式依赖 |
| 5 | **体积有上限** | 单条约束 | 单条压缩规则总字符数 ≤ `COMPRESS_RULE_MAX_CHARS`（默认 200 chars）。总注入体积 ≤ `COMPRESS_MAX_CHARS`（默认 800 chars） |

#### 2.6.3 `## CHECK` 与 M6 Feedback 闭环

`## CHECK` 是连接 M5（检索注入）和 M6（反馈闭环）的关键桥梁：

```
M5: O 压缩规则 → 注入 L context（含 ## CHECK）
                │
                ▼
L 应用规则 → 执行 ## CHECK 步骤 → 通过？
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                        通过               未通过
                          │                   │
                          ▼                   ▼
                     任务继续        report_feedback(M6)
                                   → 更新 failure_rate
                                   → 触发新 R→C 循环
```

没有 `## CHECK` 时，L 只能靠主观判断"我是否正确应用了规则"。有了 `## CHECK`，L 有客观验证步骤——执行后结果是确定的（通过/未通过），feedback 信号更可靠。

#### 2.6.4 为什么是 Markdown 而非 YAML

| 维度 | YAML `rule:` 结构 | Markdown sections |
|------|-------------------|-------------------|
| LLM 直接可用 | 需要解析转换 | 原生可读，注入即生效 |
| `## NEVER` 信号强度 | `never: "..."` 与普通字段齐平 | section header 是强注意力锚点 |
| 编号列表可操作性 | 分号拼接，难以拆分 | `1. 2. 3.` 天然离散，可逐条修订 |
| `check` 支持 | `check:` 字段齐平，信号弱 | `## CHECK` 与其他 section 平级，可选 |
| 与 SKILL.md 一致 | 格式不同 | 格式统一，无需切换解析模式 |

#### 2.6.5 压缩 Prompt 模板

```python
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

### 2.7 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `SCORING_TOP_N` | 5 | Round 2 最多评分的候选数（从 Round 1 结果中按文件系统顺序取前 N 条，顺序由 Round 2 评分校正） |
| `SCORE_PARALLEL_MAX` | 3 | 同时并行的评分 subagent 数量 |
| `COMPRESS_TOP_N` | 3 | 压缩后返回给用户的规则数 |
| `COMPRESS_MAX_CHARS` | 800 | 压缩结果总字符数上限 |
| `COMPRESS_RULE_MAX_CHARS` | 200 | 单条压缩规则字符数上限（when≤80 + do≤80 + avoid≤80 + id/scope≈40） |

### 2.8 降级策略

当 Round 2 不可用时（如 subagent 调用失败），降级为当前的单轮检索：

```python
# Round 2 失败时直接返回 Round 1 结果
# ⚠ 不能调用重构后的 _do_search_and_notify，它会返回 fire_score 进入 scoring
# 必须直接返回 notify，跳过评分和压缩
if not all_scores_received:
    workflow["phase"] = "done"
    _save_workflow(workflow_id, workflow)
    return {
        "action": "notify",
        "workflow_id": workflow_id,
        "message": _format_single_round_results(rules_metadata, workflow),
    }
```

**⚠ 降级路径不经过 scoring phase：** 降级是绕过 Round 2 的应急通道，直接从 workflow state 中读取 Round 1 的 `list_rules` 结果，格式化后返回。绝不能调用重构后的 `_do_search_and_notify`（会重新进入 scoring），也不能调用原版函数（重构后已不存在）。

### 2.9 对现有代码的影响

| 文件 | 变更 |
|------|------|
| `_orch_start.py` | learn 分支 `search` phase 完成后新增 `scoring` phase，不再直接 done |
| `_orch_event.py` | 新增 `score_done` + `scoring` handler，`o_done` + `compressing` handler |
| `_orch_prompts.py` | 新增 `SCORING_PROMPT_TEMPLATE`、`COMPRESS_PROMPT_TEMPLATE`（结构化 Markdown 输出） |
| `_orch_parsers.py` | 重构 `_do_search_and_notify` → `search` phase 返回 `fire_score`（含 prompt 列表），新增 `_parse_scores`、`_parse_compressed_output` |
| `config.py` | 新增 `SCORING_TOP_N`、`SCORE_PARALLEL_MAX`、`COMPRESS_TOP_N`、`COMPRESS_MAX_CHARS`、`COMPRESS_RULE_MAX_CHARS` |
| `SKILL.md` | 新增 `fire_score` action 执行逻辑（~10 行） |

### 2.10 并行评分机制设计

**平台约束：** Subagent 无法嵌套——只有主 session 能调用 `task()`。因此并行评分必须由主 session 驱动，不能由 subagent 发起。

**方案：新增 `fire_score` action type**

MCP 返回 `fire_score` action 时携带一个 prompt 列表，主 session 并行发起多个 `task()` 调用。全部完成后，主 session 聚合结果并回调 MCP。

```
MCP: search phase 完成
  → 返回 {action: "fire_score", score_requests: [{prompt, rule_id}, ...]}
       │
       ▼
主 session: 并行发起 task() (max SCORE_PARALLEL_MAX 个)
  task(prompt=req_1.prompt) ──┐
  task(prompt=req_2.prompt) ──┤── 并行执行
  task(prompt=req_3.prompt) ──┘
       │ 全部 notification 到达
       ▼
主 session: 聚合评分结果
  → 调用 orchestrate_on_event("score_done", {workflow_id, scores: [...]})
       │
       ▼
MCP: scoring phase → compressing phase
  → 返回 {action: "fire_o", o_prompt: compress_prompt}
       │
       ▼
主 session: fire O subagent → o_done → 最终结果
```

**fire_score action 返回值：**

```python
{
    "action": "fire_score",
    "workflow_id": "wf_xxxx",
    "score_requests": [
        {"rule_id": "rec_001", "prompt": "score rec_001..."},
        {"rule_id": "rec_002", "prompt": "score rec_002..."},
        {"rule_id": "rec_003", "prompt": "score rec_003..."},
    ],
    "notify_message": "🦉 Scoring 3 candidate rules...",
}
```

**SKILL.md 扩展（~10 行）：**

```
### If action is `fire_score`:
1. If `notify_message` present, display it
2. Fire up to SCORE_PARALLEL_MAX parallel task() calls, one per score_request
3. As EACH notification arrives, collect the result (parse JSON for score)
4. When ALL score_requests have results:
   Call MCP orchestrate_on_event("score_done", {workflow_id, scores: <collected results>})
```

**为什么不用 fire_o 复用方案：** fire_o 只携带单个 prompt，主 session 无法从一个 fire_o 响应中知道还有多少个评分待完成。`fire_score` 携带 prompt 列表，主 session 明确知道要等几个 notification，聚合逻辑简单可靠。

---

## 三、M6：Error Feedback 闭环

### 3.1 问题陈述

GEAR 协议 §Core Workflow Step 5-6 定义了 Error Feedback 闭环：当 L 应用了规则但仍出错时，L 应向 O 报告，O 触发新的 R→C 循环。当前实现无此通道——learn 结果直接返回给用户，无反馈机制。

### 3.2 目标行为

```
┌─ 正常 Learn 流 ──────────────────────────────────────┐
│  L 获取规则 → 应用到任务 → 执行成功 → DONE           │
└───────────────────────────────────────────────────────┘

┌─ Error Feedback 流 ──────────────────────────────────┐
│  L 获取规则 → 应用到任务 → 仍然出错                    │
│    → 调 MCP report_feedback(...)                      │
│    → O 记录 feedback signal                           │
│    → O 触发新 reflect 流 (R → C)                      │
│    → 新规则进入 store → 下次 Learn 可检索              │
└───────────────────────────────────────────────────────┘
```

### 3.3 新增 MCP 工具

```python
@mcp.tool()
def report_feedback(
    rule_ids: list[str],        # 应用了哪些规则
    error_description: str,     # 仍然出现的错误描述
    context: str = "",          # 错误上下文（代码片段、命令输出等）
    session_id: str = "",       # 报告的 session ID
    auto_reflect: bool = True,  # 是否自动触发新 reflect
) -> dict:
    """Learner 报告规则应用后仍出错。
    
    记录 feedback signal，更新 rule 的 failure_rate/sample_size，
    可选触发新的 reflection cycle。
    """
```

**关键：workflow state 创建。** 当 `auto_reflect=True` 时，`report_feedback` 必须创建完整的 workflow state 文件（与 `orchestrate_start("reflect", ...)` 相同的结构），否则 R 完成后 `orchestrate_on_event("subagent_done", ...)` 会因找不到 workflow 而失败。

```python
# report_feedback 内部实现（auto_reflect=True 时）
workflow_id = f"wf_{uuid.uuid4().hex[:16]}"
sequence = _next_sequence()

r_prompt = _build_reflector_prompt(
    target_session_id=target_session_id,
    focus_hint="errors",
    sequence=sequence,
)

_save_workflow(workflow_id, {
    "phase": "reflecting",
    "command": "reflect",
    "source": "feedback",              # 标记来源，区别于手动触发
    "target_session_id": target_session_id,
    "sequence": sequence,
    "pending_role": "R",
    "record_created": False,
    "feedback_rule_ids": rule_ids,
    "feedback_error": error_description,
    "re_reflect_count": feedback_depth,  # 递归深度计数
})

return {
    "action": "fire_sub",
    "workflow_id": workflow_id,
    "sub_prompt": r_prompt,
    "sub_role": "R",
    "notify_message": "🦉 Feedback recorded. Launching new reflection...",
}
```

### 3.4 状态机扩展

```
report_feedback(auto_reflect=True)
         │
         ▼
  ┌──────────────┐
  │ 更新 feedback │  更新 rule 的 sample_size, failure_rate
  │ signal 字段   │  
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐     action: fire_sub
  │ phase:       │ ──────────────────► 主 session fire R
  │ reflecting   │   (新 reflect workflow)
  └──────────────┘   (workflow state 已创建)
         │ R 完成 (subagent_done)
         ▼
  orchestrate_on_event → phase: checking → fire C
         │ C 完成 (subagent_done)
         ▼
  phase: done → notify
```

### 3.5 递归深度限制（feedback→reflect→feedback 循环）

Error Feedback 可能产生无限递归：L 报告反馈 → R 生成新规则 → L 应用后又失败 → 再次反馈。

**防护机制：** `report_feedback` 内部检查每条 rule 的累计 feedback 次数，超过上限时拒绝 auto_reflect：

```python
MAX_FEEDBACK_REFLECT = 3  # 可配置

def report_feedback(...):
    # 检查递归深度
    feedback_depth = 0
    for rule_id in rule_ids:
        rules = list_rules(status_filter="verified", keyword=rule_id, limit=1)
        for r in rules.get("rules", []):
            meta = r.get("metadata", {})
            # 从 rule frontmatter 读取累计 feedback 次数
            depth = meta.get("feedback_count", 0)
            feedback_depth = max(feedback_depth, depth)
    
    if feedback_depth >= MAX_FEEDBACK_REFLECT:
        return {
            "action": "notify",
            "message": f"🦉 Max feedback reflect ({MAX_FEEDBACK_REFLECT}) reached for these rules. "
                       f"Manual review needed: /aristotle",
        }
    
    # 更新每条 rule 的 feedback_count
    for rule_id in rule_ids:
        # ... 更新 frontmatter: feedback_count += 1
```

**深度计数存储：** 新增 `feedback_count: int` 字段到 RuleMetadata。仅在 `auto_reflect=True` 且实际触发 reflect 时递增（而非每次 `report_feedback` 调用都递增），避免 `auto_reflect=False` 的纯反馈报告耗尽深度配额。

### 3.6 反馈信号更新逻辑

当 L 报告规则无效时：

```python
for rule_id in rule_ids:
    # ⚠ list_rules 无 id 专用搜索维度，keyword 做全 frontmatter 正则匹配
    # rule_id 格式为 rec_<timestamp>，碰撞概率极低，实际可接受
    # Phase 3 应为 list_rules 新增 id 精确匹配参数
    rules = list_rules(status_filter="verified", keyword=rule_id, limit=1)
    results = rules.get("rules", [])
    if not results:
        continue
    
    meta = results[0]["metadata"]
    rule_path = results[0]["path"]
    
    # 更新 feedback signal
    current_sample = meta.get("sample_size", 0)
    current_failures = meta.get("failure_rate", 0.0) * current_sample
    
    new_sample = current_sample + 1
    new_failures = current_failures + 1
    new_failure_rate = new_failures / new_sample
    new_success_rate = 1.0 - new_failure_rate
    
    # 写入规则 frontmatter（需将 int/float 转为 str）
    update_frontmatter_field(rule_path, "sample_size", str(new_sample))
    update_frontmatter_field(rule_path, "failure_rate", str(round(new_failure_rate, 3)))
    update_frontmatter_field(rule_path, "success_rate", str(round(new_success_rate, 3)))
```

### 3.7 SKILL.md 扩展

新增触发条件：

```
## AUTO-FEEDBACK
When you detect that:
1. You previously ran /aristotle learn <query>
2. You applied the suggested rules
3. The error STILL occurred (same or similar error pattern)

Then call MCP report_feedback(rule_ids=[...], error_description="...", auto_reflect=true)
```

### 3.8 对现有代码的影响

| 文件 | 变更 |
|------|------|
| `_tools_rules.py` 或新文件 `_tools_feedback.py` | 新增 `report_feedback` MCP 工具 |
| `_orch_event.py` | 无变更（reflect 流已支持自动拉起 R→C） |
| `frontmatter.py` | `update_frontmatter_field` 已存在，可直接使用 |
| `models.py` | RuleMetadata 需新增 `success_rate`、`failure_rate`、`sample_size` 字段 |
| `SKILL.md` | 新增 AUTO-FEEDBACK 触发条件 |

### 3.9 models.py 变更

```python
@dataclass
class RuleMetadata:
    # ... 现有字段 ...
    
    # --- Feedback Signal (M7) ---
    success_rate: float | None = None
    failure_rate: float | None = None
    sample_size: int = 0
    feedback_count: int = 0            # 累计 feedback→reflect 递归深度（M6 递归防护）
    conflicts_with: list[str] | None = None
```

---

## 四、M7：Feedback Signal 追踪 + Δ log-normalization

### 4.1 问题陈述

两个相关问题：

1. **Feedback Signal 字段缺失写入机制：** GEAR.md 定义了 `success_rate`、`failure_rate`、`sample_size` 三个 feedback signal 字段，当前 models.py 和 frontmatter 中已有声明但无任何代码写入这些值。

2. **Δ 计算缺少 log-normalization：** 当前 `evolution.py` 使用简化版 Δ = confidence × (1 − risk_weight)。GEAR v1.1 引入了基于 sample_size 的 log 归一化因子：

```
Δ = Δ_raw × normalize(log(sample_size + 1))
where normalize(x) = x / log(MAX_SAMPLES + 1)
```

### 4.2 Feedback Signal 写入时机

| 事件 | 写入逻辑 | 触发方 |
|------|---------|--------|
| Rule 被创建 | `sample_size=0, success_rate=null, failure_rate=null` | write_rule |
| L 报告规则有效 | `sample_size += 1, success_rate = successes / sample_size` | report_feedback (M6) |
| L 报告规则无效 | `sample_size += 1, failure_rate = failures / sample_size` | report_feedback (M6) |

### 4.3 Δ log-normalization 实现

```python
# evolution.py 变更

import math
from typing import Optional

MAX_SAMPLES = 20  # 可配置，存入 config.py

def compute_delta(
    confidence: float,
    risk_level: str,
    sample_size: Optional[int] = None,  # None = 旧公式，0 = 强制 manual
) -> float:
    """Compute Δ with optional log-normalization.
    
    Args:
        confidence: R's confidence score (0.0 – 1.0).
        risk_level: One of "high", "medium", "low".
        sample_size: Rule's application count.
            None → use legacy formula (Δ_raw only), preserves backward compat
            0    → log-normalization active, factor = 0, Δ = 0 (manual)
            N>0  → log-normalization active, factor scales with evidence
    
    Returns:
        Δ value clamped to [0.0, 1.0].
    """
    if risk_level not in RISK_WEIGHTS:
        raise ValueError(f"Unknown risk_level '{risk_level}'")
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence must be between 0.0 and 1.0, got {confidence}")
    
    risk_weight = RISK_WEIGHTS[risk_level]
    delta_raw = confidence * (1.0 - risk_weight)
    
    # Legacy mode: no normalization (backward compatible)
    if sample_size is None:
        return max(0.0, min(1.0, delta_raw))
    
    # GEAR v1.1 mode: log-normalization
    # math.log is natural log (ln). Base is irrelevant since both
    # numerator and denominator use the same base.
    norm_factor = math.log(sample_size + 1) / math.log(MAX_SAMPLES + 1)
    delta = delta_raw * norm_factor
    return max(0.0, min(1.0, delta))
```

**设计决策：** `sample_size: Optional[int] = None` 而非 `int = 0`。理由：

- 现有调用 `compute_delta(confidence=0.9, risk_level="low")` 返回 `0.72`（auto）。如果默认值改为 `0`，所有现有规则瞬间变成 `manual`——这是一个破坏性变更。
- `None` 明确表示"未启用 log-normalization"，是安全的默认值。
- M6 `report_feedback` 首次写入 `sample_size` 后，调用方显式传入 `sample_size=N`，此时 log-normalization 才生效。
- 这确保了**渐进式启用**：旧规则保持旧行为直到被 feedback 更新。

### 4.4 Sample Size 效果表（验证）

| sample_size | log(N+1) | normalize | Δ_raw=0.15 (high) | Δ_raw=0.50 (med) | Δ_raw=0.80 (low) |
|-------------|----------|-----------|-------------------|------------------|------------------|
| 0 | 0.00 | 0.000 | 0.000 (manual) | 0.000 (manual) | 0.000 (manual) |
| 1 | 0.69 | 0.227 | 0.034 (manual) | 0.114 (manual) | 0.182 (manual) |
| 3 | 1.39 | 0.455 | 0.068 (manual) | 0.228 (manual) | 0.364 (manual) |
| 5 | 1.79 | 0.588 | 0.088 (manual) | 0.294 (manual) | 0.471 (semi) |
| 10 | 2.40 | 0.789 | 0.118 (manual) | 0.395 (manual) | 0.631 (semi) |
| 20 | 3.04 | 1.000 | 0.150 (manual) | 0.500 (semi) | 0.800 (auto) |

**关键洞察：** high-risk 规则在当前阈值下永远无法达到 auto 级别（最高 Δ = 0.15 < 0.7）。这符合 GEAR 的设计意图——高风险错误必须经过更多验证。

### 4.5 向后兼容

`compute_delta` 新增 `sample_size` 参数，默认值 `None`。现有调用**行为完全不变**：

```python
# 现有调用（无 sample_size）：sample_size=None → 旧公式，不乘 normalization
delta = compute_delta(confidence=0.9, risk_level="low")
# 返回 0.72 (auto) — 与现在完全一致

# M6 feedback 写入 sample_size 后的调用：
delta = compute_delta(confidence=0.9, risk_level="low", sample_size=15)
# 返回 0.72 × 0.937 = 0.675 (semi) — log-norm 生效

# 新创建的规则（显式传入 0）：
delta = compute_delta(confidence=0.9, risk_level="low", sample_size=0)
# 返回 0.0 (manual) — 强制首次人工审核
```

**渐进式启用：** 只有被 `report_feedback` 更新过的规则才会传入 `sample_size=N`，从而启用 log-normalization。未被 feedback 更新的旧规则永远保持旧行为。这避免了"一刀切"破坏所有现有规则的审核级别。

### 4.6 对现有代码的影响

| 文件 | 变更 |
|------|------|
| `evolution.py` | `compute_delta` 新增 `sample_size` 参数 + log-normalization |
| `models.py` | RuleMetadata 新增 `success_rate`、`failure_rate`、`sample_size`、`conflicts_with` |
| `frontmatter.py` | `to_frontmatter_string` / `from_frontmatter_dict` 支持新字段 |
| `_tools_rules.py` | `write_rule` 初始化 feedback signal 字段 |
| `config.py` | 新增 `MAX_SAMPLES = 20` |

---

## 五、M8：Passive Trigger 增强

### 5.1 问题陈述

当前 SKILL.md 的 `description` 包含 error-correction 关键词，依赖 AI 的隐式匹配来触发 `/aristotle`。这是"被动触发"的原始形态，但存在两个问题：

1. **触发不可靠：** 依赖 AI 是否注意到 description 中的关键词，没有结构化保障
2. **上下文缺失：** 触发时无法自动携带错误上下文（session_id、错误类型、message range）

### 5.2 目标行为

```
AI 执行任务 → 出现错误 → AI 自我纠正成功/失败
                                    │
                                    ▼ (如果 AI 检测到 error-correction 模式)
                          ┌─────────────────────┐
                          │ Passive Trigger      │
                          │ 自动调 MCP:          │
                          │ orchestrate_start(   │
                          │   "reflect",         │
                          │   {                  │
                          │     target_session,  │
                          │     focus: "errors", │
                          │     trigger: "auto"  │
                          │   }                  │
                          │ )                    │
                          └─────────────────────┘
```

### 5.3 设计方案

**方案 A：SKILL.md 指令增强（推荐）**

在 SKILL.md 中增加明确的被动触发指令：

```markdown
## PASSIVE TRIGGER
Monitor the conversation for these patterns:
1. You corrected your own output (acknowledged a mistake)
2. User pointed out an error and you agreed
3. You tried an approach, it failed, and you switched approaches

When any pattern is detected, suggest:
"🦉 I detected an error pattern. Run /aristotle to reflect and prevent similar mistakes."
Do NOT auto-trigger. Only suggest.
```

**优势：** 不增加 MCP 复杂度，不改变 SKILL.md 行数约束（在 ≤60 行内）。

**方案 B：结构化 Trigger Signal**

在 SKILL.md 中增加 trigger signal 文件机制：

```markdown
## PASSIVE TRIGGER
When you detect an error pattern:
1. Write a signal file: echo '{"session_id":"current","error_type":"...","message_range":"..."}' > ~/.config/opencode/aristotle-trigger.signal
2. Suggest: "🦉 Error detected. Run /aristotle to reflect."
```

MCP 在 `orchestrate_start` 入口检查 trigger signal 文件，如果存在则自动附加上下文。

**优势：** 结构化上下文传递。**劣势：** 增加 SKILL.md 复杂度，signal 文件可能残留。

### 5.4 推荐：方案 A

Phase 2 采用方案 A（SKILL.md 指令增强），Phase 3 评估是否需要方案 B。理由：

1. 当前 AI 的 pattern detection 能力已足够识别 error-correction 场景
2. 不增加 MCP 代码和测试负担
3. "建议触发"比"自动触发"更安全，避免误触发

### 5.5 对现有代码的影响

| 文件 | 变更 |
|------|------|
| `SKILL.md` | 新增 PASSIVE TRIGGER 段落（~5 行，在 ≤60 行约束内） |

---

## 六、M9：conflicts_with 检测

### 6.1 问题陈述

GEAR.md 定义了 `conflicts_with` 字段用于声明规则间矛盾。当前数据模型有此字段但无检测逻辑。

### 6.2 冲突定义

两条规则冲突的条件：

| 冲突类型 | 检测条件 | 示例 |
|---------|---------|------|
| **直接否定** | 两条规则的 `intent_tags` 相同但 rule body 给出相反建议 | "Always use ORM" vs "Never use ORM for batch ops" |
| **范围重叠** | `domain` 相同、`task_goal` 互补但建议互斥 | "Use connection pooling" vs "Close connections immediately" |
| **过时覆盖** | 新规则与旧规则 `error_summary` 高度相似但 `category` 不同 | 旧: PATTERN_VIOLATION → 新: HALLUCINATION |

### 6.3 检测时机

冲突检测发生在 **C 完成 commit_rule 之后**（post-hoc），而非 C 验证过程中（validation gate）。

理由：`detect_conflicts` 需要读取新规则的完整 frontmatter，这只有在 `write_rule` + `stage_rule` 之后才可读。检测到冲突时规则已写入磁盘但尚未 commit，仍可通过 reject 回滚。

```
C: write_rule → stage_rule → commit_rule
                                   │
                                   ▼
                          detect_conflicts（post-commit 检测）
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
               检测到冲突                   无冲突
                     │                           │
                     ▼                           ▼
            写入 conflicts_with            流程结束
            通知 O 展示两条规则
            用户决定保留或 reject 新规则
```

### 6.4 检测算法

**Phase 2 简化版：** 基于 metadata 的静态检测（不涉及 NLP/语义匹配）

```python
def detect_conflicts(new_rule_meta: RuleMetadata) -> list[str]:
    """检测新规则与现有 verified 规则的冲突。
    
    返回冲突规则的 ID 列表。
    """
    conflicts = []
    
    # 查找同 domain + 同 task_goal 的已验证规则
    existing = list_rules(
        status_filter="verified",
        intent_domain=new_rule_meta.intent_tags.get("domain", ""),
        intent_task_goal=new_rule_meta.intent_tags.get("task_goal", ""),
    )
    
    for rule in existing.get("rules", []):
        meta = rule["metadata"]
        # 跳过自身
        if meta.get("id") == new_rule_meta.id:
            continue
        
        # 条件 1: 同 domain + 同 task_goal + 同 failed_skill → 可能重复或矛盾
        if (meta.get("intent_tags", {}).get("domain") == new_rule_meta.intent_tags.get("domain")
            and meta.get("intent_tags", {}).get("task_goal") == new_rule_meta.intent_tags.get("task_goal")
            and meta.get("failed_skill") == new_rule_meta.failed_skill):
            conflicts.append(meta["id"])
    
    return conflicts
```

**Phase 3 增强版：** 使用 LLM 判断规则 body 是否语义矛盾（fire O subagent 做语义分析）。

### 6.5 冲突处理流程

```
C 检测到冲突 → 写入 conflicts_with 字段 → O 展示两条规则给用户
                                              │
                                    ┌─────────┴─────────┐
                                    │                   │
                              保留两者             拒绝新规则
                                    │                   │
                                    ▼                   ▼
                              两条规则都 commit    reject 新规则
                              标注互为 conflict
```

### 6.6 对现有代码的影响

| 文件 | 变更 |
|------|------|
| `_tools_rules.py` | `commit_rule` 完成后调用 `detect_conflicts`（post-commit 检测） |
| `_orch_event.py` | C 完成（checking phase 结束）后检查 conflicts，有冲突时返回特殊 notify |
| `SKILL.md` | Review 展示时标注冲突规则（~2 行） |

---

## 七、M1 补丁：committed_rule_paths 优化

### 7.1 问题陈述

产品方案 §3.2.3 设计了 `committed_rule_paths` 字段，用于 review confirm 时直接定位 staging 规则，避免不精确的 keyword 搜索。当前代码中此字段为死代码——workflow state 从未写入此值。

### 7.2 修复方案

在 `orchestrate_on_event("subagent_done", phase="checking")` 中，C 完成后记录已创建的规则路径：

```python
# 在 C 完成后、通知用户前
if event_type == "subagent_done" and workflow.get("phase") == "checking":
    result = data.get("result", "")
    committed, staged = _parse_checker_result(str(result))
    
    # 新增：记录 C 创建/操作的规则路径
    target_session = workflow.get("target_session_id", "")
    rules_result = list_rules(status_filter="all", keyword=target_session, limit=20)
    rule_paths = []
    for r in rules_result.get("rules", []):
        meta = r.get("metadata", {})
        if meta.get("status") in ("staging", "verified"):
            rule_paths.append(r.get("path", ""))
    workflow["committed_rule_paths"] = rule_paths
```

然后在 `orchestrate_review_action("confirm")` 中优先使用：

```python
if action == "confirm":
    # 优先使用 committed_rule_paths
    rule_paths = workflow.get("committed_rule_paths", [])
    if rule_paths:
        for path in rule_paths:
            meta = read_frontmatter_raw(Path(path))
            if meta and meta.get("status") == "staging":
                commit_rule(file_path=path)
    else:
        # 降级为 keyword 搜索
        ...
```

### 7.3 对现有代码的影响

| 文件 | 变更 |
|------|------|
| `_orch_event.py` | checking 完成后写入 `committed_rule_paths` |
| `_orch_review.py` | confirm 优先使用 `committed_rule_paths` |

---

## 八、实施阶段

### 8.1 模块依赖与实施顺序

```
M1 补丁 (独立，可先行)
    │
    ▼
M5 (Two-Round 检索)
    │
    ├─► M6 (Error Feedback)
    │       │
    │       └─► M7 (Feedback Signal + Δ log-norm)
    │               │
    │               └─► M9 (conflicts_with)
    │
    └─► M8 (Passive Trigger, 独立并行)
```

### 8.2 各模块实施估算

| 模块 | 新增 MCP 代码 | 新增测试 | SKILL.md 变更 | 涉及文件 |
|------|-------------|---------|-------------|---------|
| M1 补丁 | ~20 行 | ~5 | 无 | `_orch_event.py`, `_orch_review.py` |
| M5 | ~150 行 | ~25 | ~10 行 | `_orch_start.py`, `_orch_event.py`, `_orch_prompts.py`, `config.py` |
| M6 | ~80 行 | ~15 | ~8 行 | 新增 `_tools_feedback.py`, `models.py` |
| M7 | ~40 行 | ~15 | 无 | `evolution.py`, `models.py`, `frontmatter.py` |
| M8 | 0 行 | 0 | ~5 行 | `SKILL.md` 仅 |
| M9 | ~60 行 | ~10 | ~2 行 | `_tools_rules.py`, `_orch_event.py` |
| **合计** | **~350 行** | **~70** | **~25 行** | |

### 8.3 Phase 2.1（先行 PR）

**M1 补丁 + M7 (models.py 扩展) + M8**

这三个变更互不依赖，可一次性提交：
- M1 补丁：修复 committed_rule_paths 死代码
- M7 models.py：前置扩展 RuleMetadata 字段（feedback signal + conflicts_with）
- M8：SKILL.md 被动触发增强

### 8.4 Phase 2.2（核心 PR）

**M5 + M6**

核心功能：
- M5：Learn Two-Round 检索 + 评分 + 压缩
- M6：Error Feedback 闭环 + report_feedback 工具

### 8.5 Phase 2.3（增强 PR）

**M7 (Δ log-norm) + M9**

增强功能：
- M7：Δ log-normalization 实现 + feedback signal 写入
- M9：conflicts_with 静态检测

---

## 九、GEAR v1.1 一致性映射

Phase 2 完成后，GEAR v1.1 协议一致性要求与实现的完整映射：

| # | GEAR 一致性要求 | Phase 1 实现 | Phase 2 补全 |
|---|----------------|-------------|-------------|
| 1 | Role separation (R/C/L 独立) | ✅ MCP 编排层分离 R/C/O | — |
| 2 | Git-backed storage | ✅ commit_rule + git show | — |
| 3 | State machine enforcement | ✅ pending → staging → verified | — |
| 4 | Frontmatter schema | ✅ RuleMetadata 覆盖 | M7 补全 feedback signal 字段 |
| 5 | Intent-driven retrieval | ✅ domain + task_goal + failed_skill | M5 增强 Two-Round 检索 |
| 6 | Rejected rule preservation | ✅ restore_rule | — |
| 7 | Atomic writes | ✅ write_text 直接写入 | — |
| 8 | Feedback signal tracking | ❌ 字段存在但无写入 | **M6 + M7 补全** |
| 9 | Conflict declaration | ❌ 字段存在但无检测 | **M9 补全** |

**Phase 2 完成后：9/9 一致性要求全部满足。**

---

## 十、风险评估

### 10.1 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| M5 并行评分 subagent 数量超出平台限制 | 中 | 高 | `SCORE_PARALLEL_MAX=3` 限制并发，超出的排队执行 |
| M5 评分 subagent 返回格式不稳定 | 中 | 中 | 评分结果增加 JSON 解析容错，解析失败时打分 5（中性） |
| M6 report_feedback 触发误报 | 中 | 低 | SKILL.md 明确触发条件，避免 AI 过度触发 |
| M7 Δ log-norm 导致所有新规则都是 manual | 低 | 中 | `sample_size=None` 默认值保留旧公式，只有显式传入 `sample_size=0` 时才强制 manual。渐进式启用，不影响现有规则 |
| M9 冲突检测误报 | 中 | 低 | Phase 2 仅用 metadata 匹配，Phase 3 引入 LLM 语义判断降低误报 |

### 10.2 产品风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Two-Round 检索增加延迟 | 高 | 中 | Round 1 候选数限制在 20 以内，Round 2 并行评分 |
| Feedback 闭环产生过多 reflect 流 | 中 | 中 | report_feedback 默认 auto_reflect=True，但可关闭 |
| Passive Trigger 建议被忽略 | 高 | 低 | 这是预期行为——建议而非强制，用户自主决定 |

---

## 十一、验收标准

### 11.1 Phase 2.1 验收

| # | 验收项 | 方法 |
|---|--------|------|
| A1 | committed_rule_paths 在 C 完成后被写入 | pytest 验证 workflow state |
| A2 | confirm 使用 committed_rule_paths 而非 keyword 搜索 | pytest 验证 |
| A3 | RuleMetadata 包含 feedback signal + conflicts_with 字段 | pytest 验证 models |
| A4 | SKILL.md ≤60 行，包含 PASSIVE TRIGGER | test.sh 断言 |

### 11.2 Phase 2.2 验收

| # | 验收项 | 方法 |
|---|--------|------|
| A5 | Learn 流执行两轮检索（Round 1 list + Round 2 score） | pytest 验证 scoring phase |
| A6 | 评分结果按 score 排序，返回 Top-N 压缩摘要 | pytest 验证 |
| A7 | 评分失败时降级为单轮检索 | pytest 验证降级路径 |
| A8 | report_feedback 更新 rule 的 sample_size/failure_rate | pytest 验证 |
| A9 | auto_reflect=True 时触发新 reflect workflow | pytest 验证 |
| A10 | 所有现有测试不退化 | 227 pytest + 98 static |

### 11.3 Phase 2.3 验收

| # | 验收项 | 方法 |
|---|--------|------|
| A11 | compute_delta 支持 sample_size 参数 + log-normalization | pytest 验证 evolution |
| A12 | sample_size=0 时 Δ=0（强制 manual） | pytest 边界验证 |
| A13 | detect_conflicts 返回冲突规则 ID 列表 | pytest 验证 |
| A14 | 冲突规则标注在 review 展示中 | pytest 验证 |
| A15 | GEAR v1.1 一致性 9/9 通过 | 对照文档逐项检查 |

---

## 附录 A：新增 Action 参考

### A.1 Learn 流扩展（M5）

```python
# Round 1: search → fire_score (并行评分)
{
    "action": "fire_score",
    "workflow_id": "wf_xxxx",
    "score_requests": [
        {"rule_id": "rec_001", "prompt": "Score rec_001..."},
        {"rule_id": "rec_002", "prompt": "Score rec_002..."},
        {"rule_id": "rec_003", "prompt": "Score rec_003..."},
    ],
    "notify_message": "🦉 Scoring 3 candidate rules...",
}

# score_done → compressing (fire O 压缩)
{
    "action": "fire_o",
    "workflow_id": "wf_xxxx",
    "o_prompt": "...",             # COMPRESS_PROMPT_TEMPLATE
}

# 压缩完成 → 最终结果
{
    "action": "notify",
    "workflow_id": "wf_xxxx",
    "message": "🦉 Found N relevant rules (scored):\n...",
}
```

### A.2 Feedback 工具（M6）

```python
# L 调用 report_feedback
report_feedback(
    rule_ids=["rec_1713283200", "rec_1713283456"],
    error_description="Connection pool timeout still occurs after applying rules",
    context="P2024 error in production Lambda handler",
    session_id="ses_xxx",
    auto_reflect=true
)

# MCP 返回（auto_reflect=false）
{
    "action": "notify",
    "message": "🦉 Feedback recorded for 2 rules. sample_size updated."
}

# MCP 返回（auto_reflect=true — 含完整 workflow state）
{
    "action": "fire_sub",
    "workflow_id": "wf_xxxx",
    "sub_prompt": "...",           # R prompt
    "sub_role": "R",
    "notify_message": "🦉 Feedback recorded. Launching new reflection...",
}
# 内部已创建 workflow state:
# .workflows/wf_xxxx.json: {phase: "reflecting", command: "reflect", source: "feedback", ...}

# MCP 返回（递归深度达上限）
{
    "action": "notify",
    "message": "🦉 Max feedback reflect (3) reached for these rules. Manual review needed: /aristotle"
}
```

---

## 附录 B：配置参数汇总

| 参数 | 默认值 | 位置 | 说明 |
|------|--------|------|------|
| `SCORING_TOP_N` | 5 | config.py | Round 2 评分候选数上限 |
| `SCORE_PARALLEL_MAX` | 3 | config.py | 并行评分 subagent 数量 |
| `COMPRESS_TOP_N` | 3 | config.py | 最终返回规则数 |
| `COMPRESS_MAX_CHARS` | 800 | config.py | 压缩结果总字符数上限 |
| `COMPRESS_RULE_MAX_CHARS` | 200 | config.py | 单条压缩规则字符数上限 |
| `MAX_SAMPLES` | 20 | config.py | Δ log-normalization 的样本上限 |
| `MAX_FEEDBACK_REFLECT` | 3 | config.py | feedback→reflect 最大递归深度 |
| `MAX_RE_REFLECT` | 3 | config.py | re-reflect 最大次数（已存在） |

---

*本文档基于 GEAR.md v1.1 协议规范和 GEAR开发备忘录_260422.md 差距分析编制，需与 M5-M9 技术方案配套使用。*
