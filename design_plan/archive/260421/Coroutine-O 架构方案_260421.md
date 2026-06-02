# Coroutine-O Architecture: O 作为独立 Agent 的实施方案

**日期:** 2026-04-21
**版本:** v1.0 (提案)
**状态:** 待确认核心设计问题

---

## 一、问题陈述

### 1.1 根本问题

当前 Aristotle 的 O（Orchestrator）由主 session LLM 承担，通过加载 SKILL.md + 按需加载 REFLECT.md / REVIEW.md / LEARN.md 实现。这意味着：

```
主 Session LLM = L（用户助手）+ O（反思协调者）
                 ↓ 加载 SKILL.md/REFLECT.md/REVIEW.md/LEARN.md
                 ↓ 协议推理污染主 session 上下文
                 ↓ 双重角色冲突
```

### 1.2 衍生问题

此架构缺陷直接导致了之前反复修补的问题：

| 问题 | 根因 |
|------|------|
| 协议思考泄露到主 session | O 和 L 共享 context，无法物理隔离 |
| SKILL.md 上下文膨胀 | O 的路由逻辑写在 SKILL.md 中 |
| State file 内容泄露 | 主 session 需要读取 state 来做决策 |
| 通知格式必须精简 | 所有输出都在主 session 中 |
| 需要抑制规则 ("NEVER output protocol reasoning") | 用规则弥补架构缺陷 |

**核心洞察：** 我们花了大量精力让 O "安静"——但根本原因是 O 不应该在主 session 里。

### 1.3 GEAR 协议的设计意图

GEAR 交互图中，L 和 O 之间是有向边（agent 间通信）：

```
L → O  (learn request, error feedback)
O → L  (compressed summaries, Top-N filter · compress · inject)
```

L 在评估自己的错误——GEAR 设计这个协议的原因恰恰是自我反思不可靠。

---

## 二、Coroutine-O 架构

### 2.1 核心洞察

O 并不需要持续运行。O 需要的是在离散的时间点做决策，中间都在等待。这天然适合**协程模式（Coroutine）**。

```
O(step1) ──fire R──► STOP
                          │
          R completes ◄───┘ (main session gets notification)
              │
  O(step2) ◄─┘ resume with R's result
  │
  ├──fire C──► STOP
                  │
          C completes ◄───┘
              │
  O(step3) ◄─┘ resume with C's result
  │
  └──► notify user (via main session)
```

每个 STOP 点恰好对应主 session 收到 notification 的时间点。主 session 不需要理解协议——它只需要把 notification 转发给 MCP 获取下一步指令。

### 2.2 三层架构

```
┌──────────────────────────────────────────────────┐
│  Layer 1: SKILL.md — Event Loop Dispatcher (~20行) │
│                                                    │
│  职责:                                             │
│    1. 解析用户命令 → 调用 MCP 获取第一步动作       │
│    2. 执行 MCP 返回的 action (fire O / show msg)   │
│    3. 收到 notification → 调用 MCP 获取下一步动作  │
│    4. 重复直到 MCP 返回 "done"                     │
│                                                    │
│  SKILL.md 不加载任何协议文件                        │
│  SKILL.md 不包含任何 GEAR 知识                      │
│  SKILL.md 不知道 R/C/S 的存在                       │
└────────────────────┬──────────────────────────────┘
                     │ 1. MCP call → action
                     │ 2. task(session_id=...) for O
                     │ 3. notification → MCP call
                     ▼
┌──────────────────────────────────────────────────┐
│  Layer 2: MCP Server — O 的 State Machine (Python) │
│                                                    │
│  新增 orchestration tools:                         │
│                                                    │
│  orchestrate_start(command, args)                  │
│    → 返回 {action: "fire_o", o_prompt: "..."}     │
│                                                    │
│  orchestrate_on_event(event_type, data)            │
│    → 返回 {action: "resume_o"|"notify"|"done",    │
│           session_id?, prompt?, message?}          │
│                                                    │
│  内部维护 O 的 workflow state:                     │
│    - current_phase: reflecting|checking|learning   │
│    - pending_tasks: {task_id → role}               │
│    - accumulated_results: []                       │
│    - o_session_id: for session continuity          │
│                                                    │
│  所有"该做什么"的决策都在这里                       │
│  主 session 只是执行手臂                            │
└────────────────────┬──────────────────────────────┘
                     │ O subagent reads protocol files
                     ▼
┌──────────────────────────────────────────────────┐
│  Layer 3: O Subagent — 协议执行 (有 session 记忆)  │
│                                                    │
│  O 在自己的 context 中加载:                        │
│    REFLECT.md, REVIEW.md, LEARN.md, CHECKER.md     │
│                                                    │
│  O 的每次激活做一件事:                              │
│    - 解析参数 → fire R → STOP                      │
│    - 读 R 结果 → fire C → STOP                    │
│    - 读 C 结果 → 构建 MCP 返回值 → STOP           │
│    - 读查询 → list_rules → fire S agents → STOP   │
│    - 收集 S scores → 压缩 → STOP                  │
│                                                    │
│  session_id 保证每次恢复都有完整 context            │
│  O 的 protocol 文件在 L 的 context 中不可见        │
└──────────────────────────────────────────────────┘
```

---

## 三、执行流详述

### 3.1 Reflect 流

```
用户: /aristotle
     │
     ▼
[SKILL.md ~20行]
  1. 解析: command="reflect", focus="last"
  2. 调用 MCP: orchestrate_start("reflect", {focus: "last", session: "ses_cur"})
  3. MCP 返回: {
       action: "fire_o",
       o_prompt: "You are O. Read REFLECT.md. Target: ses_cur, Focus: last. Execute STEP O1.",
       sequence: 1
     }
  4. fire O = task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
     → o_session_id = "ses_o1"
  5. 通知 MCP: orchestrate_on_event("o_fired", {o_session_id: "ses_o1"})
     → MCP 返回: {action: "wait"} → SKILL.md 显示 "🦉 Aristotle launched..." → STOP

     ... time passes ...

  [System Notification: R subagent bg_xxx completed]
     │
     ▼
[SKILL.md]
  1. 调用 MCP: orchestrate_on_event("subagent_done", {task_id: "bg_xxx", role: "R"})
  2. MCP 检查 state:
     - R done → next phase is checking
     - 记录 R 的输出
  3. MCP 返回: {
       action: "resume_o",
       session_id: "ses_o1",
       prompt: "R completed. Draft at ~/.config/.../rec_1.md. Execute STEP O3: fire C."
     }
  4. fire O = task(session_id="ses_o1", run_in_background=true, prompt=...)
  5. MCP 返回: {action: "wait"} → STOP

     ... time passes ...

  [System Notification: C subagent bg_yyy completed]
     │
     ▼
[SKILL.md]
  1. 调用 MCP: orchestrate_on_event("subagent_done", {task_id: "bg_yyy", role: "C"})
  2. MCP 检查 state:
     - C done → all phases complete
     - 记录 C 的输出
  3. MCP 返回: {
       action: "notify",
       message: "🦉 Aristotle done [current]. 2 rules committed. Review: /aristotle review 1"
     }
  4. SKILL.md 显示通知 → DONE
```

### 3.2 Learn 流

```
用户: /aristotle learn 数据库连接池相关
     │
     ▼
[SKILL.md]
  1. 解析: command="learn", query="数据库连接池相关"
  2. MCP: orchestrate_start("learn", {query: "数据库连接池相关"})
  3. MCP 返回: {action: "fire_o", o_prompt: "You are O. Read LEARN.md. Query: 数据库连接池相关. Execute L2-L3."}
  4. fire O → O runs:
     a. Extracts intent: domain="database_operations", task_goal="connection_pool_management"
     b. Calls list_rules(status="verified", intent_domain="database_operations")
     c. Gets 8 candidate paths
     d. Fires 8 scoring subagents (S role)
     e. Saves state to MCP: {pending_scores: [bg_s1..bg_s8]}
     f. STOPS
  5. SKILL.md 显示 "🦉 Searching..." → STOP

     ... scoring subagents complete one by one ...

  [System Notification: bg_s1 completed]
  [SKILL.md]
    MCP: orchestrate_on_event("score_done", {task_id: "bg_s1", score: 8, reason: "..."})
    MCP records score → checks: 3/8 done, not all → returns {action: "wait"} → STOP

  ... until all 8 done ...

  [System Notification: bg_s8 completed]
  [SKILL.md]
    MCP: orchestrate_on_event("score_done", ...) → 8/8 all done
    MCP 返回: {
      action: "resume_o",
      session_id: "ses_o2",
      prompt: "All 8 scores collected. Top 5: [list]. Execute STEP L4: compress."
    }
    fire O with session_id → O compresses → STOPS

  [System Notification: O completed]
  [SKILL.md]
    MCP: orchestrate_on_event("o_done", {result: compressed_summary})
    MCP 返回: {action: "notify", message: "🦉 Found 5 relevant lessons: ..."}
    SKILL.md shows to user → DONE
```

### 3.3 Review 流

Review 是用户主动请求的交互式流程，不需要协程模式：

```
用户: /aristotle review 1
     │
     ▼
[SKILL.md]
  1. MCP: orchestrate_start("review", {sequence: 1})
  2. MCP 读 DRAFT 文件 + committed rules → 返回格式化内容
  3. SKILL.md 直接展示给用户

用户: confirm / revise / reject
     │
     ▼
[SKILL.md]
  1. MCP: orchestrate_review_action(sequence=1, action="confirm")
  2. MCP 执行 → 返回结果
  3. SKILL.md 展示
```

Review 不需要 O subagent，因为它是纯 I/O 流程，没有复杂编排。MCP server 处理即可。

---

## 四、SKILL.md 最终形态

```markdown
# Aristotle — Dispatcher

## ROUTE
Parse command → call MCP `orchestrate_start()` → execute returned action.

## EVENT LOOP
On background task notification:
  call MCP `orchestrate_on_event()` → execute returned action.

## ACTIONS
  fire_o    → task(category="unspecified-low", run_in_background=true, prompt=...)
  resume_o  → task(session_id=..., run_in_background=true, prompt=...)
  notify    → show message to user
  wait      → do nothing, wait for next notification
  done      → flow complete
```

~20 行。零协议知识。零 GEAR 依赖。

---

## 五、对比：改动前 vs 改动后

| 维度 | 现在 | Coroutine-O |
|------|------|-------------|
| SKILL.md | 76 行路由 + 协议意识 | ~20 行纯 dispatcher |
| 主 session 加载 | SKILL.md + REFLECT/REVIEW/LEARN.md 按需 | 仅 SKILL.md (~20行) |
| 协议推理位置 | 主 session LLM context | O subagent context |
| State 管理 | 主 session 调 MCP | MCP 自管理 + O 读写 |
| Notification 处理 | 主 session 理解协议语义 | 主 session 只调 MCP，不理解语义 |
| Review 流 | 主 session 加载 REVIEW.md + CHECKER.md | MCP 直接处理，无需 LLM |
| GEAR 合规 | O 和 L 共享 context | O 有独立 context |
| 中间内容泄露 | 需要主动抑制（SKILL.md 规则） | 架构上不可能泄露 |
| 需要抑制规则 | "NEVER output protocol reasoning" 等 4 条 | 不需要—— dispatcher 无协议知识可泄露 |

---

## 六、风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| O subagent session_id 恢复丢失 context | 中 | O 每次激活从 MCP state 重建关键参数；session_id 只是优化，非依赖 |
| Learn 的 N 个评分 subagent 通知延迟 | 低 | MCP 记录已完成数，主 session 每个通知都调 MCP，无需等待全部 |
| MCP orchestrate 工具复杂度增长 | 中 | 每个工具只做状态转换 + 返回下一步动作，逻辑简单 |
| Review 完全在 MCP 中处理，LLM 不参与验证 | 需评估 | 简单 schema 验证 Python 够用；复杂语义验证可选择性调用 O |

---

## 七、实施路径（初版）

| Phase | 内容 | 依赖 |
|-------|------|------|
| Phase 1 | MCP orchestration tools: `orchestrate_start()`, `orchestrate_on_event()`, `orchestrate_review_action()` + O workflow state machine + 测试 | 无 |
| Phase 2 | SKILL.md 重写为 ~20 行 dispatcher，验证 reflect/review/learn 三个流程 | Phase 1 |
| Phase 3 | O subagent prompt 设计：最小启动指令 + 协议文件按需加载 + session continuity 测试 | Phase 2 |
| Phase 4 | 原型验证：反射流/学习流/审查流完整跑通 + Context 大小对比 | Phase 3 |
| Phase 5 | 清理：删除抑制规则，更新协议文件（可更详细），更新 README/设计文档 | Phase 4 |

---

## 八、待确认的核心设计问题

> **如果主 session 的 skill 退化为通知 hub 和 MCP dispatcher，那么 O 要由 MCP 来拉起吗？**
>
> 需要对 O 的每一项工作逐条审视，看哪些是 MCP（Python）能做的，哪些是 MCP 不能做的（需要 LLM），对应的方案应该是什么。

以下是对此问题的完整技术分析。

---

## 九、平台能力边界调研

### 9.1 MCP Server 的能力边界

**结论：MCP 是纯被动服务，不能拉起 agent。**

| 能力 | 支持 | 说明 |
|------|------|------|
| 响应 host 的 tool call | ✅ | `@mcp.tool()` 装饰的 Python 函数，返回 dict/list/str |
| 读写文件、Git 操作 | ✅ | `server.py` 中 14 个工具全是数据持久化操作 |
| 发送有限 notifications | ⚠️ | 仅限 6 种预定义类型：log、progress、resource/tool/prompt list changed |
| **调用 task() 拉起 subagent** | ❌ | MCP 进程内无 task() 函数，无 OpenCode API 访问权限 |
| **主动向 host 发送自定义消息** | ❌ | JSON-RPC stdio 模型，无自定义 outbound 机制 |
| **回调/事件系统** | ❌ | 无 callback 注册机制 |

**通信模型：** stdio JSON-RPC，Host → MCP（请求）→ Host（响应）。MCP 不能发起通信。

### 9.2 Subagent 的能力边界

**结论：Subagent 是不可编排的叶节点，不能接收 notification、不能 fire sub-subagent、不能与用户交互。**

| 能力 | 支持 | 说明 |
|------|------|------|
| 调用 MCP 工具（aristotle_* 函数） | ✅ | CHECKER.md 直接调用 `aristotle_write_rule()` 等 |
| 读写文件 | ✅ | REFLECTOR.md 调用 `persist_draft()` |
| 读取 session 数据 | ✅ | REFLECTOR.md 调用 `session_read()` |
| **接收 `<system-reminder>` notification** | ❌ | 只有发起 task() 的 session 才能收到 |
| **调用 task() fire sub-subagent** | ❌ | 代码库零嵌套 task() 先例；即使能 fire，notification 也回不来 |
| **与用户交互** | ❌ | 平台硬限制："architecturally non-interactive"（REFLECTOR.md L215） |
| **被 resume/继续** | ❌ | SKILL.md 明确："do NOT attempt to resume them" |

**Notification 流向：** 永远是 child → caller（发起 task() 的 session）。只有主 session 是顶层 caller。

### 9.3 主 Session 的独占能力

| 能力 | 仅主 Session 可做 |
|------|------------------|
| 调用 `task()` 发起 subagent | ✅ |
| 接收 subagent completion notification | ✅ |
| 与用户交互 | ✅ |
| 在 notification 到达后执行后续动作 | ✅ |

**这意味着：主 session 必须永远是 notification hub 和 task() 的发起者。MCP 做不了，subagent 做不了。这是平台硬约束，不可绕过。**

---

## 十、O 的全部职责逐条审计

### 10.1 职责清单与 LLM 需求分析

| # | O 的职责 | GEAR 来源 | 需要 LLM？ | 说明 |
|---|---------|----------|-----------|------|
| 1 | 解析用户命令（/aristotle、review N、learn） | §O "User invocation" | **不需要** | 固定格式，正则匹配 |
| 2 | 识别被动触发（multi-agent error signal） | §O "Unexpected events from agent" | **可能需要** | "这是否是值得反思的错误"需要语义理解，但可用关键词匹配降级 |
| 3 | 路由场景（reflect / review / learn） | §O "Route scenes" | **不需要** | 由命令决定，确定性逻辑 |
| 4 | 计算 audit level（Δ） | §O "Decide audit level" | **不需要** | 纯数值计算，已在 MCP `get_audit_decision()` |
| 5 | 选择 target session | §O "Route scenes" | **不需要** | 参数解析 + session_list 查询 |
| 6 | 为 R 构建 prompt | REFLECT.md F3 | **不需要** | 模板填充：target + focus + context |
| 7 | 为 C 构建 prompt | REFLECT.md F5.5 | **不需要** | 模板填充：DRAFT 路径 + project dir |
| 8 | 调度 S Round 1（list_rules） | LEARN.md L3c | **不需要** | MCP 查询 |
| 9 | 调度 S Round 2（fire scoring subagents） | LEARN.md L3d | **不需要 fire**，但 scoring 本身需要 LLM | 主 session fire，subagent 评分 |
| 10 | 自然语言 → intent tags 提取 | LEARN.md L2 | **需要** | "数据库连接池相关" → `{domain: "database_operations"}` |
| 11 | 自然语言 → 检索关键词提取 | LEARN.md L3b | **需要** | "Prisma connection pool timeout" → `"prisma\|timeout\|pool"` |
| 12 | 评分结果压缩（提取要点、生成摘要） | LEARN.md L4 | **需要** | 需要语义理解和摘要能力 |
| 13 | Review 展示格式化 | REVIEW.md V1 | **不需要** | 模板渲染 |
| 14 | Review confirm/reject 处理 | REVIEW.md V2 | **不需要** | MCP 调用 |
| 15 | Review revise 内容修改 | REVIEW.md V2 | **需要** | 理解用户反馈并修改规则内容 |
| 16 | Review re-reflect focus 构建 | REVIEW.md V6 | **可能需要** | 构建新的 focus 参数可能需要语义理解 |
| 17 | Post-hoc content 验证 | CHECKER.md "CONTENT ACCURACY" | **需要** | 规则语义正确性判断 |
| 18 | 维护 workflow state | 全流程 | **不需要** | 状态机管理 |
| 19 | Error feedback 接收与路由 | LEARN.md L6 | **需要** | 理解 L 的 error report 并决定是否触发新 cycle |

### 10.2 分类汇总

```
┌─────────────────────────────────────────────────────┐
│  MCP 独立完成（纯逻辑/计算，不需要 LLM）            │
│  #1  解析用户命令                                    │
│  #3  路由场景                                       │
│  #4  Δ 计算                                        │
│  #5  选择 target session                            │
│  #6  为 R 构建 prompt                               │
│  #7  为 C 构建 prompt                               │
│  #8  调度 S Round 1 (list_rules)                    │
│  #13 Review 展示格式化                              │
│  #14 Review confirm/reject 处理                     │
│  #18 维护 workflow state                            │
│                                                     │
│  共 10 项。这些全部由 MCP Python 代码处理。         │
│  主 session 只需调用 MCP 并执行返回的 action。       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  需要 LLM（语义理解/推理/生成）                      │
│  #10 自然语言 → intent tags 提取                    │
│  #11 自然语言 → 检索关键词提取                      │
│  #12 评分结果压缩                                   │
│  #15 Review revise 内容修改                         │
│  #17 Post-hoc content 验证                          │
│  #19 Error feedback 接收与路由                      │
│                                                     │
│  共 6 项。这些需要 LLM 推理能力。                   │
│  由主 session fire O subagent 处理，结果返回 MCP。   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  可能需要（取决于实现策略）                          │
│  #2  被动触发识别 → 可用关键词降级为 MCP 处理       │
│  #9  Scoring subagent 的 fire → 主 session 做       │
│  #16 Re-reflect focus 构建 → 可模板化或需要 LLM     │
│                                                     │
│  共 3 项。优先降级为 MCP 处理，必要时调用 LLM。     │
└─────────────────────────────────────────────────────┘
```

---

## 十一、修订后的架构：谁做什么

基于上述分析，修订三层架构的职责分配：

### 11.1 Layer 1: SKILL.md — 主 Session（不可消除的 notification hub）

**主 session 不可退化为纯 dispatcher。** 因为只有主 session 能：
1. 接收 `<system-reminder>` notification
2. 调用 `task()` 发起 subagent
3. 与用户交互

但主 session 可以做到**不包含任何协议知识**：

```
主 Session 的职责（不可消除）:
  ✅ 调用 MCP 获取下一步 action
  ✅ 执行 MCP 返回的 action（fire subagent / show message）
  ✅ 在 notification 到达时调用 MCP 获取下一步
  ✅ 与用户交互（仅传递 MCP 返回的消息）

主 Session 不做的（已消除）:
  ❌ 不理解协议语义
  ❌ 不做状态管理
  ❌ 不做语义推理（intent 提取、压缩等）
  ❌ 不加载 REFLECT.md / REVIEW.md / LEARN.md
```

### 11.2 Layer 2: MCP Server — 状态机 + 纯逻辑决策

MCP 处理全部 10 项纯逻辑职责，并作为 O workflow 的状态机：

```python
# 新增的 orchestration tools

@mcp.tool()
def orchestrate_start(command: str, args: dict) -> dict:
    """分析命令，初始化 workflow state，返回第一个 action。

    Returns:
        {action: "fire_o"|"notify"|"done",
         o_prompt?: str,
         message?: str}
    """

@mcp.tool()
def orchestrate_on_event(event_type: str, data: dict) -> dict:
    """接收事件通知，更新 state，返回下一个 action。

    event_type: "subagent_done" | "score_done" | "o_done" | "o_fired"
    """
    # 内部维护 workflow state:
    #   current_phase, pending_tasks, accumulated_results, o_session_id
    # 纯逻辑判断下一步做什么

@mcp.tool()
def orchestrate_review_action(sequence: int, action: str, feedback: str = "") -> dict:
    """处理 Review 流的用户反馈。

    action: "confirm" | "reject" | "revise"
    纯逻辑操作：MCP 直接处理 confirm/reject；
    revise 需要返回 fire_o action（LLM 处理）。
    """
```

### 11.3 Layer 3: O Subagent — 按需调用的语义推理服务

O subagent **不再是整个流程的持续协调者**，而是按需调用的 LLM 推理服务：

| 触发场景 | O 做什么 | 耗时 |
|---------|---------|------|
| Learn 流收到用户自然语言查询 | 提取 intent tags (#10) + 关键词 (#11) | ~10s |
| Learn 流 S 评分全部完成 | 压缩 Top-N 评分结果 (#12) | ~15s |
| Review 流用户提交 revise | 理解反馈、修改规则内容 (#15) | ~20s |
| Review 流用户请求 re-reflect | 构建 focus 参数 (#16) | ~5s |
| Post-hoc 验证 | 规则语义正确性判断 (#17) | ~10s |
| Error feedback | 理解 error report 并路由 (#19) | ~10s |

**关键变化：** O 不是协程（Coroutine），而是 **函数调用（Function Call）**。MCP 决定何时需要 LLM，主 session fire O subagent，O 完成后结果回到主 session，主 session 再调 MCP 获取下一步。

### 11.4 修正后的执行流

**Reflect 流（O subagent 不参与）：**

```
用户: /aristotle
  → MCP: orchestrate_start("reflect", {...})
  → MCP 返回: {action: "fire_r", prompt: "...", sequence: 1}
  → 主 session fire R subagent
  → R 完成 → notification
  → MCP: orchestrate_on_event("subagent_done", {role: "R", ...})
  → MCP 返回: {action: "fire_c", prompt: "..."}
  → 主 session fire C subagent
  → C 完成 → notification
  → MCP: orchestrate_on_event("subagent_done", {role: "C", ...})
  → MCP 返回: {action: "notify", message: "🦉 done..."}
  → 主 session 显示通知 → DONE
```

**Reflect 流全程不拉起 O subagent。** MCP 直接调度 R → C。

**Learn 流（O subagent 参与两次）：**

```
用户: /aristotle learn 数据库连接池相关
  → MCP: orchestrate_start("learn", {query: "..."})
  → MCP: 无法提取 intent（纯逻辑做不了），返回 {action: "fire_o", o_prompt: "extract intent from: ..."}
  → 主 session fire O → O 提取 intent + 关键词 → STOP
  → O 完成 → notification
  → MCP: orchestrate_on_event("o_done", {intent: {...}, keywords: "..."})
  → MCP: 执行 list_rules（纯逻辑），得到 8 候选
  → MCP 返回: {action: "fire_scores", prompts: [...8个...]}
  → 主 session fire 8 个 scoring subagent
  → 逐个完成 → 主 session 每次调 MCP
  → MCP: 8/8 完成 → 返回 {action: "fire_o", o_prompt: "compress top 5: ..."}
  → 主 session fire O → O 压缩摘要 → STOP
  → O 完成 → notification
  → MCP: orchestrate_on_event("o_done", {summary: "..."})
  → MCP 返回: {action: "notify", message: "🦉 Found 5 lessons: ..."}
  → 主 session 显示 → DONE
```

**Learn 流 O 参与两次：① intent 提取 ② 结果压缩。中间全是 MCP 纯逻辑。**

**Review 流（O subagent 按需参与）：**

```
用户: /aristotle review 1
  → MCP: orchestrate_start("review", {sequence: 1})
  → MCP 读 DRAFT + rules → 返回格式化内容（纯 I/O，无 LLM）
  → 主 session 展示

用户: confirm
  → MCP: orchestrate_review_action(1, "confirm")
  → MCP 直接处理 → 返回结果（无 LLM）

用户: revise 1: 规则应该更具体
  → MCP: orchestrate_review_action(1, "revise", feedback: "...")
  → MCP 返回: {action: "fire_o", o_prompt: "revise rule based on feedback: ..."}
  → 主 session fire O → O 修改内容 → STOP
  → O 完成 → notification
  → MCP: orchestrate_on_event("o_done", {revised_content: "..."})
  → MCP 写入规则 → 返回结果
```

---

## 十二、对 GEAR 合规性的影响

| GEAR 要求 | 当前实现 | 修订后实现 | 合规？ |
|-----------|---------|-----------|--------|
| O 路由场景 | 主 session LLM 做 | MCP state machine 做 | ✅ O 仍是系统整体 |
| O 决定 audit level | MCP get_audit_decision() | 同左 | ✅ 已在 MCP |
| O 提供知识服务 | 主 session LLM + MCP | MCP + O subagent 按需 | ✅ O 仍是协调者 |
| O 触发反思 cycle | 主 session fire R | 主 session fire R（MCP 指令） | ✅ |
| R/C/L 角色分离 | R 和 C 是独立 subagent | 同左 | ✅ 不变 |
| L 不感知 O 内部 | L 通过 SKILL.md 间接调用 | L 通过 SKILL.md 调 MCP | ✅ 更好 |

**GEAR 定义的是角色职责，不是实现方式。** O 由 MCP（纯逻辑部分）+ O subagent（语义推理部分）+ 主 session（notification hub）共同实现，仍是 GEAR 的 O。

---

## 十三、修订后的方案定位

**原方案（Coroutine-O）：** O 是持续运行的协程 subagent，主 session 退化为纯 dispatcher。
**修订方案（Function-Call-O）：** O 不是协程，而是按需调用的 LLM 函数。MCP state machine 是真正的协调者。

| 维度 | Coroutine-O（原方案） | Function-Call-O（修订方案） |
|------|---------------------|---------------------------|
| O 的角色 | 持续协调者（协程） | 按需语义推理服务 |
| 谁做决策 | O subagent | MCP state machine |
| O subagent 激活次数/流 | Reflect: 1次, Learn: 2次, Review: 0-1次 | Reflect: 0次, Learn: 2次, Review: 0-1次 |
| 主 session 职责 | 纯 dispatcher（~20行） | notification hub + action executor（~30行） |
| context 污染 | 零 | 零（不加载协议文件） |
| 复杂度 | O 需要 session continuity | O 是无状态的（每次独立 prompt） |
| GEAR 合规 | O 是独立 agent | O 是分布式系统（MCP + subagent + hub） |

**Function-Call-O 更简单：** O subagent 不需要 session continuity，不需要记住之前做了什么。每次调用都是独立的：MCP 给 prompt → O 执行 → 返回结果 → MCP 记录。

---

## 十四、修订后的实施路径

| Phase | 内容 | 依赖 |
|-------|------|------|
| **Phase 1** | MCP orchestration tools + state machine + 测试 | 无 |
| **Phase 2** | SKILL.md 重写为 ~30 行 notification hub + action executor | Phase 1 |
| **Phase 3** | O subagent prompt 模板设计（6 个语义推理场景） | Phase 2 |
| **Phase 4** | Reflect 流验证（O 不参与，MCP 直接调度 R→C） | Phase 3 |
| **Phase 5** | Learn 流验证（O 参与 2 次） | Phase 4 |
| **Phase 6** | Review 流验证（O 按需参与） | Phase 5 |
| **Phase 7** | Context 大小对比 + 文档更新 | Phase 6 |

---

## 十五、主 Session Context 影响评估

### 15.1 文件 Token 估算

| 文件 | Bytes | Lines | ~Tokens |
|------|-------|-------|---------|
| SKILL.md (当前) | 4,410 | 76 | ~1,260 |
| SKILL.md (新方案预估) | ~1,500 | ~30 | ~500 |
| REFLECT.md | 4,560 | 135 | ~1,300 |
| REVIEW.md | 6,731 | 180 | ~1,920 |
| LEARN.md | 9,024 | 246 | ~2,580 |
| CHECKER.md | 6,773 | 153 | ~1,930 |

### 15.2 逐场景 Context 对比

#### Reflect 流 (`/aristotle`)

| 内容来源 | 当前 | 新方案 | 差异 |
|---------|------|--------|------|
| SKILL.md | ~1,260 | ~500 | **-760** |
| REFLECT.md (加载到 context) | ~1,300 | 0 | **-1,300** |
| 主 session LLM 推理（协议决策） | ~300 | 0 | **-300** |
| MCP orchestrate 返回值 ×2 轮 | 无 | ~300 | **+300** |
| **总计** | **~2,860** | **~800** | **净减 ~2,060 (-72%)** |

#### Learn 流 (`/aristotle learn ...`)

| 内容来源 | 当前 | 新方案 | 差异 |
|---------|------|--------|------|
| SKILL.md + LEARN.md | ~3,840 | ~500 | **-3,340** |
| 主 session LLM 推理 (intent + 压缩) | ~400 | 0 | **-400** |
| MCP orchestrate 返回值 ×4 轮 | 无 | ~400 | **+400** |
| O subagent output ×2 | 无 | ~300 | **+300** |
| scoring subagent output ×N | ~N×100 | ~N×50 (只调 MCP 不收集内容) | **-N×50** |
| **总计** | **~4,940** | **~1,600** | **净减 ~3,340 (-68%)** |

#### Review 流 — confirm (`/aristotle review N` + confirm)

| 内容来源 | 当前 | 新方案 | 差异 |
|---------|------|--------|------|
| SKILL.md + REVIEW.md | ~3,180 | ~500 | **-2,680** |
| 主 session LLM 推理 | ~250 | 0 | **-250** |
| MCP 返回的格式化 DRAFT | 无 | ~500 | **+500** |
| MCP review_action 返回值 | 无 | ~50 | **+50** |
| **总计** | **~3,430** | **~1,050** | **净减 ~2,380 (-69%)** |

#### Review 流 — revise (`/aristotle review N` + revise)

| 内容来源 | 当前 | 新方案 | 差异 |
|---------|------|--------|------|
| SKILL.md + REVIEW.md + CHECKER.md | ~5,110 | ~500 | **-4,610** |
| 主 session LLM 推理 (revise + 验证) | ~650 | 0 | **-650** |
| O subagent output | 无 | ~150 | **+150** |
| MCP orchestrate 返回值 | 无 | ~150 | **+150** |
| **总计** | **~5,760** | **~950** | **净减 ~4,810 (-84%)** |

#### 被动触发（常驻 + 触发时）

| 内容来源 | 当前 | 新方案 | 差异 |
|---------|------|--------|------|
| SKILL.md frontmatter description (常驻) | ~500 | ~200 | **-300** |
| 触发后加载 REFLECT.md | ~1,300 | 0 | **-1,300** |
| 触发后 MCP 调用 | 无 | ~100 | **+100** |
| **总计** | **~1,800** | **~300** | **净减 ~1,500 (-83%)** |

### 15.3 Context 影响综合表

| 场景 | 当前开销 | 新方案开销 | 减少比例 |
|------|---------|-----------|---------|
| 被动触发（常驻 description） | ~500 | ~200 | **-60%** |
| `/aristotle` (Reflect) | ~2,860 | ~800 | **-72%** |
| `/aristotle review` (confirm) | ~3,430 | ~1,050 | **-69%** |
| `/aristotle review` (revise) | ~5,760 | ~950 | **-84%** |
| `/aristotle learn` | ~4,940 | ~1,600 | **-68%** |

### 15.4 Context 性质的变化（比数量更重要）

| 维度 | 当前 | 新方案 |
|------|------|--------|
| **内容性质** | 协议语义（LLM 需要"理解"才能执行） | 结构化 JSON（LLM 只需"执行"，不需要理解） |
| **推理负担** | LLM 做决策（路由、状态管理、验证） | LLM 不做决策（MCP 决策，LLM 执行） |
| **泄漏风险** | 高（协议内容在 context 中，可能被"说出去"） | 零（context 中没有协议可泄漏） |
| **抑制规则依赖** | 需要 4 条 CRITICAL ARCHITECTURE RULES | 不需要（架构上不可能泄漏） |
| **Compaction 友好性** | 差（协议文件是"理解型"知识，压缩后丢失语义） | 好（MCP 返回值是"事实型"数据，压缩后仍可用） |
| **MCP 往返代价** | 无 | ~50-100 tokens/轮（临时开销，可被 compaction 压缩） |

### 15.5 Compaction 差异的关键性

当 context window 接近上限时，LLM 会执行 compaction（压缩历史消息）。

**当前架构的问题：** 协议文件内容（REFLECT.md、LEARN.md）在 compaction 后可能被摘要化，丢失关键步骤语义。例如 "STEP F5.5: fire C subagent" 可能被压缩为 "协调者处理完成通知"，LLM 下次执行时可能遗漏步骤。

**新架构无此问题：** 主 session context 中不存在协议语义。MCP 返回的 `{action: "fire_c", prompt: "..."}` 即使被压缩，仍然是可执行的结构化指令。

---

## 十六、工作流打断评估

### 16.1 打断定义

**打断 = 主 session LLM 必须为 Aristotle 执行一个动作（而非被动等待 subagent 完成）。** 每次打断期间用户无法使用主 session。

### 16.2 逐流程打断对比

#### Reflect 流 (`/aristotle`)

**当前架构：3 次打断**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | 用户输入 `/aristotle` | 加载 SKILL.md + REFLECT.md → 解析参数 → session_list → fire R → create state → 展示通知 | ~5s |
| 2 | R 完成 (notification) | 读 R 输出 → fire C | ~3s |
| 3 | C 完成 (notification) | complete_reflection_record → 展示结果 | ~2s |
| | | **累计：3 次打断，~10s** | |

**新方案：3 次打断**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | 用户输入 | 加载 SKILL.md (~30行) → MCP orchestrate_start() → fire R | ~3s |
| 2 | R 完成 | MCP orchestrate_on_event() → fire C | ~2s |
| 3 | C 完成 | MCP orchestrate_on_event() → 展示通知 | ~1s |
| | | **累计：3 次打断，~6s** | |

**Reflect：打断次数不变，每次更短（~10s → ~6s）。**

#### Learn 流 (`/aristotle learn ...`)

**当前架构：2+N 次打断**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | 用户输入 | 加载 SKILL.md + LEARN.md → 提取 intent (LLM推理) → 提取关键词 (LLM推理) → list_rules → fire N scoring agents | ~8s |
| 2 | Scoring agent 1 完成 | 记录结果 | ~1s |
| ... | ... | 每个 scoring agent 完成都记录 | ~1s |
| 2+N | 全部完成 | 压缩 Top-N (LLM推理) → 格式化 → 展示 | ~5s |
| | | **累计：2+N 次打断，~16+N s** | |

**新方案：3+N 次打断**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | 用户输入 | 加载 SKILL.md → MCP orchestrate_start() → MCP 返回 fire O | ~2s |
| 2 | O 完成 (intent提取) | MCP orchestrate_on_event() → MCP 返回 fire N scoring agents | ~2s |
| 3 | Scoring agent 1 完成 | MCP orchestrate_on_event() → MCP 记录 → wait | ~1s |
| ... | ... | 每个 scoring agent 完成都调 MCP | ~1s |
| 3+N | 全部完成 | MCP → fire O (压缩) | ~2s |
| 4+N | O 完成 (压缩) | MCP → 展示通知 | ~1s |
| | | **累计：3+N 次打断，~8+N s** | |

**Learn：打断次数 +1（多一次 O 的 fire），但总等待时间从 ~16+N → ~8+N 秒。** 因为当前架构中 intent 提取和压缩都在主 session LLM 中做（耗时），新方案中这些在 O subagent 中并行完成。

#### Review 流 — confirm

**当前：2 次，新方案：2 次。** 差异可忽略。

#### Review 流 — revise

**当前架构：3 次打断**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | 用户输入 review N | 加载 SKILL.md + REVIEW.md → 读 DRAFT + rules → 展示 | ~3s |
| 2 | 用户说 revise | LLM 理解反馈 → 修改内容 → 加载 CHECKER.md 验证 → 写规则 | ~8s |
| 3 | | 展示结果 | ~1s |
| | | **累计：3 次打断，~12s** | |

**新方案：4 次打断**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | 用户输入 review N | MCP orchestrate_start() → 展示 MCP 格式化的 DRAFT | ~2s |
| 2 | 用户说 revise | MCP orchestrate_review_action() → MCP 返回 fire O | ~2s |
| 3 | O 完成 (修改) | MCP orchestrate_on_event() → MCP 写规则 | ~2s |
| 4 | | 展示结果 | ~1s |
| | | **累计：4 次打断，~7s** | |

**Review(revise)：打断次数 +1，但总等待时间从 ~12s → ~7s。** 因为当前架构中 LLM 在主 session 做"理解+修改+验证"是重的，新方案中 O subagent 做，主 session 只转发。

#### 被动触发

**当前：3 次打断，第 1 次很重**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | error signal 检测 | 加载 SKILL.md + REFLECT.md (76+135行) → 理解协议 → 解析 → fire R | **~5s (重)** |
| 2 | R 完成 | fire C | ~3s |
| 3 | C 完成 | 展示通知 | ~2s |
| | | **累计：3 次打断，~10s** | |

**新方案：3 次打断，第 1 次很轻**

| # | 触发 | 主 session 做什么 | 等待时间 |
|---|------|------------------|---------|
| 1 | error signal 检测 | 加载 SKILL.md (~30行) → MCP orchestrate_start() → fire R | **~2s (轻)** |
| 2 | R 完成 | MCP → fire C | ~2s |
| 3 | C 完成 | MCP → 展示通知 | ~1s |
| | | **累计：3 次打断，~5s** | |

**被动触发：打断次数不变，但第 1 次打断的"重量"显著减轻。** 这是用户体验最关键的改善——被动触发发生在用户正常工作期间，第 1 次打断从"LLM 需要理解 200+ 行协议"变为"LLM 执行一条 MCP 指令"。

### 16.3 打断次数汇总

| 流程 | 当前打断 | 新方案打断 | 变化 | 当前等待 | 新方案等待 |
|------|---------|-----------|------|---------|-----------|
| Reflect | 3 | 3 | 不变 | ~10s | ~6s |
| Learn | 2+N | 3+N | **+1** | ~16+N s | ~8+N s |
| Review (confirm) | 2 | 2 | 不变 | ~3s | ~2s |
| Review (revise) | 3 | 4 | **+1** | ~12s | ~7s |
| 被动触发 | 3 | 3 | 不变 | ~10s | ~5s |

### 16.4 打断的"重量"变化

打断次数基本不变（最多 +1），但**每次打断的性质发生了质变**：

| 维度 | 当前（每次打断） | 新方案（每次打断） |
|------|----------------|-------------------|
| 主 session 加载量 | 协议文件 (1,300-2,580 tokens) | SKILL.md only (~500 tokens) |
| LLM 需要做什么 | 理解协议语义 + 做决策 | 执行 MCP 返回的 action |
| LLM 推理负担 | 高（路由、状态、验证） | 近零（转发、fire、展示） |
| 对用户工作的干扰 | 重（LLM "思考"协议） | 轻（LLM "执行"指令） |
| 失败风险 | LLM 可能误解协议步骤 | MCP 返回明确的 action，不易出错 |

**结论：新方案的改善不在于"打断更少"，而在于"打断更轻"。** 用户感知到的不是"Aristotle 又打断我了"，而是"一个短暂的通知闪过"。
