# Aristotle 用户测试问题整改方案

> 版本：3.0
> 日期：2026-04-21
> 前置文档：Aristotle 用户测试问题修复清单_260421.md
> 变更记录：
> - v1.0: 初始方案
> - v2.0: 整合自动化流程需求 + Momus v1.0/v2.0 审核意见
> - v3.0: 整合 scope 语义判定 + C subagent 架构（保持 GEAR 合规）+ 原型验证结果

---

## 一、整改策略

### 1.1 核心设计原则

**原则一：主 session 上下文零污染**

O（Coordinator）的任何输出都进入主 session 上下文。如无必要（需要通知用户的必要信息），不要将中间内容注入到主 session 的上下文中。

| O 的输出类别 | 允许 | 禁止 |
|-------------|------|------|
| 一行状态通知（task_id, review 命令） | ✅ | |
| 用户主动请求的 DRAFT 报告展示 | ✅ | |
| 规则自动写入成功/失败的摘要通知 | ✅ | |
| 协议推理/执行计划 | | ❌ |
| State file / Draft 原始内容 | | ❌ |
| MCP 调用细节、frontmatter 原始数据 | | ❌ |
| Schema 验证中间步骤 | | ❌ |

**原则二：自动化反思流程无中断，但保持 GEAR 合规**

O→R→C→Git 是自动化流程，不中断等待用户审核。用户审核是非必须流程节点。**但自动化不等于跳过 C 角色**——C 由独立 subagent 执行，保持 GEAR 角色分离。

**原则三：产品设计不与协议冲突**

GEAR 协议是架构约束。产品设计可以在协议范围内灵活安排流程，但不能违反协议的核心规则（角色分离、状态机、Git-backed 存储）。

### 1.2 原型验证结论

| 能力 | 结果 | 说明 |
|------|------|------|
| Subagent 文件写入 | ✅ 可用 | `mkdir` + `write` + `read` 正常 |
| Subagent MCP via skill_mcp | ❌ 不可用 | MCP server 未在 subagent skill 中加载 |
| Subagent 直接调用 aristotle tool | ✅ 可用 | `aristotle_write_rule()` 等直接函数可用 |

**架构决策**：Subagent 通过直接 tool 函数调用 Aristotle 工具（`aristotle_write_rule`, `aristotle_commit_rule` 等），不通过 `skill_mcp` protocol。

### 1.3 P3 问题延期说明

> Issue A（GEAR.md Δ 公式 log-normalization 因子）和 Issue B（GEAR frontmatter 字段 success_rate/failure_rate/sample_size/conflicts_with）为 P3，延后至 ROADMAP V1.2 实现。以协议（GEAR.md）为准，代码实现滞后是正常迭代。本周期不涉及 A/B 的代码改动。

---

## 二、阶段一：基础设施修复 ✅ 已完成

### 2.1 问题 8：首次安装未初始化 repo ✅

- install.sh / install.ps1 增加 Step 4（repo 初始化）
- server.py write_rule() 增加 graceful degradation
- 测试：111 pytest + 67 static 全部通过

### 2.2 问题 3：Shell 语法注入 ✅

- REFLECT.md STEP F4 state record 改用 `rec_N` 序号
- DRAFT 报告不含 rule_id
- 全局 grep 确认无残留 shell 语法
- 测试：111 pytest + 67 static 全部通过

---

## 三、阶段二：核心架构整改

### 3.1 自动化反思流程架构（问题 5+6+7）

#### 3.1.1 整体流程

```
                    自动化流程（O→R→C→Git，零用户中断）
                    ══════════════════════════════════════

  O 检测错误 / 用户触发 /aristotle
       │
       ▼
  O fire R subagent (background task)
       │
       ├─→ O 输出一行通知，STOP
       │
       ▼ (R subagent 内部)
  R: 读取 session → 检测错误 → 5-Why 分析 → 生成 DRAFT
       │
       ▼
  R: STEP R5 — 通过 aristotle_persist_draft() 持久化 DRAFT 到磁盘
       │
       ▼
  R: 输出 DRAFT + 结构化元数据，结束

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  O 收到 R 完成通知
       │
       ▼
  O fire C subagent (background task)
       │
       ├─→ O 不输出额外内容（等待 C 完成通知）
       │
       ▼ (C subagent 内部)
  C: 读取 DRAFT 文件 → Schema 校验 → 内容校验
       │
       ├─→ 校验通过：
       │     对每个 Reflection：
       │     1. 调用 aristotle_write_rule() → pending
       │     2. 调用 aristotle_stage_rule() → staging
       │     3. 调用 aristotle_get_audit_decision() → 获取 Δ
       │     4. Δ auto → 调用 aristotle_commit_rule() → verified
       │     5. Δ semi/manual → 保留 staging 状态，等用户事后审核
       │     6. 调用 aristotle_persist_draft() 保存 DRAFT 原始记录
       │
       ├─→ 校验失败（可自动修正）：
       │     修正后重新校验 → 通过则走上面流程
       │
       ├─→ 校验失败（需人工判断）：
       │     标记问题项，规则保留 staging 状态
       │
       ▼
  C: 输出结构化结果，结束

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  O 收到 C 完成通知
       │
       ▼
  O 输出一行通知：
  "🦉 Aristotle done [target]. N rules committed, M staged. Review: /aristotle review N"
       │
       ▼
  STOP

                    ──────────────────────────────
                    可选事后审核（用户主动）
                    ═══════════════════════════════

  用户: /aristotle review N
       │
       ▼
  O 从磁盘读取 DRAFT 原始记录 + 已 commit 规则 → 展示给用户
       │
       ▼
  用户反馈：
  ├─ "确认" → 无操作
  ├─ "修改 N: feedback" → O 修改规则 → C 校验 → 无冲突自动通过
  ├─ "re-reflect" → 发起新的 R→C 流程
  └─ "reject N" → 调用 aristotle_reject_rule()
```

#### 3.1.2 GEAR 角色对应

| GEAR 角色 | Aristotle 实现 | 职责边界 |
|-----------|---------------|---------|
| **O** (Orchestrator) | SKILL.md + REFLECT.md + REVIEW.md | 路由、fire R/C subagent、通知用户、处理事后审核 |
| **R** (Resource Creator) | REFLECTOR.md (subagent) | 分析错误、生成 DRAFT、持久化 DRAFT 原始记录 |
| **C** (Checker) | CHECKER.md (独立 subagent) | Schema 校验、内容校验、决定 scope、写入规则、执行状态转换 |
| **L** (Learner) | LEARN.md | 事后学习检索（本周期不涉及） |
| **S** (Searcher) | LEARN.md 内函数 | 检索查询（本周期不涉及） |

**关键设计决策**：R 只负责生产 DRAFT，C 负责校验和写入。两者由不同 subagent 执行，保持 GEAR Conformance #1 合规。

#### 3.1.3 Scope 判定（C 的职责）

Scope 不由项目路径是否存在决定，而由**错误的性质**决定。C subagent 在校验时判定：

| 错误性质 | scope | 判定依据 |
|---------|-------|---------|
| 推理偏差、上下文腐烂、工具误用等跨项目通用错误 | `user` | 错误根因与项目无关，规则对所有项目适用 |
| 违反项目特有的代码规范、架构约定、技术栈特定模式 | `project` | 错误根因高度依赖项目上下文，规则只对该项目适用 |

C subagent 通过分析 DRAFT 中的 Error Excerpt、5-Why Root Cause、Intent Tags 来判断 scope。判定逻辑：

```
如果 5-Why 根因分析指向：
  - 模型推理错误（如臆造 API、忽略约束）→ scope = "user"
  - 通用工具使用错误（如 edit tool 参数错误）→ scope = "user"
  - 项目特有的模式违反（如违反本项目特定的命名约定）→ scope = "project"
  - 项目特有的技术栈问题（如本项目使用的特定库版本问题）→ scope = "project"
  - 无法明确判断 → scope = "user"（保守策略，user 级规则更安全）
```

#### 3.1.4 DRAFT 的定位

DRAFT 是**反思原始记录**，不可修改，用途：

1. **事后审核参考**：`/aristotle review N` 展示 DRAFT + 已 commit 规则的对应关系
2. **Re-reflect 输入**：二次反思需要 DRAFT 中的 session id、message range、error excerpt
3. **审计链路**：DRAFT → 规则 是可追溯链路，DRAFT 相当于"原始凭证"

DRAFT 通过新增 MCP tool `persist_draft()` 持久化到 `~/.config/opencode/aristotle-drafts/rec_N.md`。

---

### 3.2 技术方案

#### 3.2.1 新增 MCP tool：persist_draft

在 `server.py` 中新增：

```python
@mcp.tool()
def persist_draft(sequence: int, content: str) -> dict:
    """Persist a DRAFT report to disk.
    
    Args:
        sequence: State record sequence number
        content: Full DRAFT report markdown content
        
    Returns dict with success, file_path.
    """
    drafts_dir = resolve_repo_dir().parent / "aristotle-drafts"
    drafts_dir.mkdir(parents=True, exist_ok=True)
    file_path = drafts_dir / f"rec_{sequence}.md"
    # Atomic write
    tmp = file_path.with_suffix(".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.rename(file_path)
    return {"success": True, "file_path": str(file_path)}
```

#### 3.2.2 REFLECTOR.md 修改

**STEP R4 保持不变**（生成 DRAFT 报告）。

**新增 STEP R4.5**（已移除——Schema 校验由 C 负责）。

**新增 STEP R5**：

```markdown
## STEP R5: PERSIST DRAFT TO DISK

After generating the DRAFT report, persist it using the persist_draft tool:

1. Call aristotle_persist_draft(sequence=DRAFT_SEQUENCE, content=<full DRAFT report text>)
2. Verify the call returned success

DRAFT file path will be: ~/.config/opencode/aristotle-drafts/rec_<N>.md

If the call fails, output: "⚠️ DRAFT persistence failed: [error]"

STOP after this step. You do NOT write rules to Git.
You do NOT call write_rule, stage_rule, or commit_rule.
The Checker subagent will handle validation and rule writing.
```

**移除 R6**（规则写入由 C subagent 负责，R 不再执行此步骤）。

#### 3.2.3 新增 C subagent 协议：CHECKER_AGENT.md

创建新文件 `CHECKER_AGENT.md`，作为 C subagent 的执行协议：

```markdown
# Aristotle Checker Subagent Protocol

You are Aristotle's Checker subagent (C role). You receive a DRAFT report 
produced by the Reflector (R), validate it, and write verified rules to Git.

You do NOT interact with the user directly.

## Parameters
- DRAFT_SEQUENCE: State record sequence number
- DRAFT_FILE: Path to the persisted DRAFT file
- PROJECT_DIRECTORY: Project directory (for scope determination)

## STEP C1: LOAD DRAFT

Read the DRAFT file from DRAFT_FILE path.

## STEP C2: SCHEMA VALIDATION

For each Reflection in the DRAFT, verify:
- category exists and is one of: MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, 
  PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, 
  OVERSIMPLIFICATION, SYNTAX_API_ERROR
- intent_tags.domain and intent_tags.task_goal are non-empty
- error_summary exists and ≤ 200 characters

Auto-correct trivial failures (limited to defaults):
- Missing/invalid category → SYNTAX_API_ERROR + mark [schema-auto-fixed]
- Missing domain → "general"
- Missing task_goal → "unspecified"  
- Overlong error_summary → truncate to 200 chars

Do NOT attempt complex inference for auto-correction.

## STEP C3: CONTENT ACCURACY CHECK

Cross-reference each Reflection's fields against Error/Correction Excerpts:
1. Category accuracy — does category match actual error type?
2. Intent tags accuracy — do domain/task_goal match user's task?
3. Error summary quality — concise, accurate, specific?
4. Proposed rule quality — specific, actionable, addresses root cause?

If content issues found, auto-correct with high confidence, or mark for 
staging review (do not auto-commit uncertain rules).

## STEP C4: DETERMINE SCOPE

For each Reflection, determine scope based on error nature:

- Error root cause is model reasoning failure (hallucination, misunderstanding) → scope = "user"
- Error root cause is tool misuse (generic, not project-specific) → scope = "user"
- Error root cause violates project-specific conventions → scope = "project"
- Error root cause is project-specific tech stack issue → scope = "project"
- Cannot determine → scope = "user" (conservative default)

## STEP C5: WRITE RULES TO GIT

For each validated Reflection:

1. Call aristotle_write_rule(content=<rule body>, scope=<from C4>, 
   category=<from DRAFT>, source_session=<from DRAFT>, message_range=<from DRAFT>,
   intent_domain=<from DRAFT>, intent_task_goal=<from DRAFT>,
   failed_skill=<from DRAFT>, error_summary=<from DRAFT>,
   project_path=<PROJECT_DIRECTORY if scope=project>)
   → Returns file_path and rule_id

2. Call aristotle_stage_rule(file_path=<returned path>)
   → Status becomes "staging"

3. Call aristotle_get_audit_decision(file_path=<path>)
   → Returns delta and audit_level

4. IF audit_level == "auto":
   → Call aristotle_commit_rule(file_path=<path>)
   → Rule committed to Git

5. IF audit_level == "semi" or "manual":
   → Leave in staging status. User can review via /aristotle review N.

## STEP C6: OUTPUT RESULT

Output a structured summary:

```
CHECKER RESULT:
- Rules processed: N
- Auto-committed: X
- Staged for review: Y
- Schema corrections: Z
- Scope decisions: [list each rule's scope and rationale]
```

STOP. Do not wait for user input.
```

#### 3.2.4 REFLECT.md 修改

**STEP F3 修改**：fire R subagent 后，在 F5 通知中不包含规则数量（R 不写规则）。

**新增 STEP F5.5**：收到 R 完成通知后，fire C subagent：

```markdown
## STEP F5.5: FIRE CHECKER SUBAGENT

When the Reflector's background task completes:

1. Read the state file, find the current record
2. Determine draft_file_path (construct from sequence: ~/.config/opencode/aristotle-drafts/rec_N.md)
3. Fire C subagent via task():
   - category: "unspecified-low"
   - load_skills: []
   - run_in_background: true
   - description: "Aristotle Checker: validate + commit rules"
   - prompt:
     ```
     You are Aristotle's Checker subagent. Read and execute the full protocol at
     ${SKILL_DIR}/CHECKER_AGENT.md (read the file first, then follow it step by step).
     
     DRAFT_SEQUENCE: ${sequence_number}
     DRAFT_FILE: ~/.config/opencode/aristotle-drafts/rec_${sequence_number}.md
     PROJECT_DIRECTORY: ${project_directory}
     ```

Do NOT output any intermediate information. Wait for C's completion notification.
```

**STEP F6 修改**：收到 C 完成通知后，输出最终通知：

```markdown
🦉 Aristotle done [${target_label}]. ${committed} rules committed, ${staged} staged for review.
   Review: /aristotle review N
```

#### 3.2.5 REVIEW.md 重写（事后审核模式）

```markdown
## STEP V1: LOAD DRAFT AND RULES

1. Read state file, find N-th record
2. Read DRAFT file from draft_file_path
3. Read corresponding rules via aristotle_read_rules(source_session=<target_session>)
4. Present: DRAFT 原始记录 + 对应的已 commit 规则 + 状态

## STEP V2: DISPLAY STATUS

展示每条规则的状态：
- verified → "✅ committed (Δ=X.XX, scope=user/project)"
- staging → "📋 staged (awaiting review)"
- rejected → "❌ rejected"

## STEP V3: PROCESS USER FEEDBACK

**"confirm"**: 无操作。

**"修改 N: feedback"**: 
1. 根据 feedback 构建新规则内容
2. 调用 aristotle_write_rule() 写入新版本
3. 执行内容校验（同 CHECKER_AGENT.md C3）
4. 无冲突 → 自动 commit → "✅ Rule revised and committed."
5. 有冲突 → 向用户列出具体问题

**"reject N"**: 调用 aristotle_reject_rule()

**"re-reflect"**: 发起新的 R→C 流程（REFLECT.md）
```

#### 3.2.6 State file 更新

```json
{
  "id": "rec_N",
  "reflector_session_id": "...",
  "checker_session_id": "...",          ← 新增
  "target_session_id": "...",
  "target_label": "...",
  "draft_file_path": "~/.config/opencode/aristotle-drafts/rec_N.md",
  "launched_at": "...",
  "completed_at": "...",                 ← 新增
  "status": "auto_committed",
  "rules_count": N
}
```

State file 清理规则：超过 50 条记录时，删除最旧记录及其对应 DRAFT 文件。

---

### 3.3 测试方案

| 测试项 | 方法 | 预期结果 |
|--------|------|----------|
| R→C 自动化流程 | 触发反思 → 等待完成 | R 完成 → C 自动启动 → 规则写入 Git → O 输出一行通知 |
| GEAR 角色分离 | 检查 R 和 C 的 session | R 不调用 write_rule/stage_rule/commit_rule |
| Scope 判定 — 跨项目错误 | 触发反思（通用推理错误） | C 判定 scope = "user" |
| Scope 判定 — 项目特定错误 | 触发反思（项目模式违反） | C 判定 scope = "project" |
| DRAFT 持久化 | 触发反思 → 检查 drafts 目录 | DRAFT 文件存在，内容完整 |
| 主 session 零 DRAFT 污染 | 触发反思 → 检查主 session | 只有通知行 |
| Δ auto 自动提交 | 低风险规则 | C 自动 commit |
| Δ semi/manual 暂存 | 高风险规则 | 状态 staging |
| 跨 session review | Session A 触发 → Session B review | 从磁盘文件加载 DRAFT + 规则 |
| 用户事后修改自动通过 | review → 修改 → C 校验 | 无冲突 → 自动 commit |
| 用户事后修改有冲突 | review → 修改引入矛盾 | 向用户列出冲突项 |
| DRAFT 文件损坏处理 | 写入一半的 DRAFT → review | 提示错误，给出 re-reflect 选项 |
| DRAFT 随 state 清理 | 51 次反思后 | 最旧 DRAFT 文件删除 |
| 新增 MCP tool persist_draft | pytest 单元测试 | 原子写入、路径验证、错误处理 |

---

## 四、阶段三：体验优化（依赖阶段二）

### 4.1 问题 2：协议思考泄露

SKILL.md CRITICAL RULES 增加：
```
- **NEVER** output protocol reasoning, execution plans, or internal decision-making.
```

REFLECT.md STEP F3 后增加：
```
After calling task(), immediately output notification and STOP.
```

### 4.2 问题 4：State file 内容泄露

REFLECT.md STEP F4 增加：
```
Do NOT display the state file content to the user.
```

### 4.3 问题 1：SKILL.md 瘦身

- SKILL.md 从 90 行精简到 ~40 行
- sessions 格式化逻辑移到 SESSIONS.md
- install.sh / install.ps1 增加 SESSIONS.md 到复制列表

---

## 五、实施依赖关系

```
阶段一 (问题 8 + 问题 3)           ✅ 已完成
  │
  ├─→ 阶段二 (问题 5+6+7)
  │     ├─ 3.2.1 新增 persist_draft MCP tool
  │     ├─ 3.2.2 修改 REFLECTOR.md（R 只负责 DRAFT）
  │     ├─ 3.2.3 新增 CHECKER_AGENT.md（C subagent 协议）
  │     ├─ 3.2.4 修改 REFLECT.md（fire R → fire C → 通知）
  │     ├─ 3.2.5 重写 REVIEW.md（事后审核）
  │     ├─ 3.2.6 更新 state file 格式
  │     └─ 3.3 测试验证
  │
  └─→ 阶段三 (问题 1+2+4，与阶段二部分可并行)
```

## 六、GEAR 合规声明

| GEAR Conformance | 方案合规性 | 说明 |
|-----------------|-----------|------|
| #1 角色分离 | ✅ 合规 | R (Reflector subagent) 和 C (Checker subagent) 由独立 subagent 执行 |
| #2 Git-backed 存储 | ✅ 合规 | 已 commit 规则通过 Git 读取 |
| #3 状态机强制 | ✅ 合规 | C 执行 pending → staging → verified 状态转换 |
| #4 Frontmatter schema | ✅ 合规 | C 的 schema 校验确保合规 |
| #5 意图驱动检索 | ✅ 合规 | intent_tags 保留 |
| #6 拒绝规则保留 | ✅ 合规 | restore 功能保留 |
| #7 原子写入 | ✅ 合规 | MCP 已实现 |
| #8 反馈信号追踪 | ⚠️ 延期 | ROADMAP V1.2 |
| #9 冲突声明 | ⚠️ 延期 | ROADMAP V1.2 |

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| C subagent 校验质量不确定 | 可能 commit 低质量规则 | Δ semi/manual 级别不自动 commit；用户可事后 reject |
| Scope 判定错误 | 规则被存到错误 scope | 保守策略（默认 user）；用户可事后修改 |
| 两次 subagent 开销 | 反思流程变慢 | R 和 C 都是 background task，不阻塞主 session |
| State file 并发 | 多 session 同时触发 | 短期接受，长期需加锁 |

## 八、验收标准

### 自动化流程
1. 触发反思 → R 完成 → C 自动启动 → 规则写入 Git → O 输出一行通知
2. R 不调用 write_rule/stage_rule/commit_rule（GEAR 合规）
3. Δ auto → 自动 committed；Δ semi/manual → staging
4. 主 session 零污染

### 事后审核
5. 跨 session review → 从磁盘加载 DRAFT + 规则
6. 用户修改无冲突 → 自动通过
7. 用户修改有冲突 → 向用户提出具体问题

### 基础设施
8. 全新安装 → repo 自动初始化
9. 无 shell 语法残留

### 测试不退化
10. test.sh → 全部通过（67 断言）
11. pytest → 全部通过（115 断言，含 persist_draft + state record 测试）

---

## 九、决策变更记录

本节记录方案从 v1.0 到最终实施的完整决策过程，包括用户反馈、方案迭代、审核结论和实施中的修正。

### 9.1 版本迭代概览

| 版本 | 核心变更 | 触发原因 |
|------|---------|---------|
| v1.0 | 初始方案：R 自行完成 schema 校验 + 规则写入 | 用户测试问题反馈 |
| v2.0 | 自动化流程需求：用户审核从必须变为可选 | 产品需求补充 |
| v3.0 | 引入独立 C subagent + scope 语义判定 + 原型验证 | 用户反馈设计问题 |
| 实施 | MCP 化 state 操作 + CHECKER.md 合并 + 计数器 MCP 化 | 实施中发现的技术改进 |

### 9.2 关键决策点

#### 决策 1：DRAFT 持久化方式

**初始方案（v1.0）**：Reflector subagent 自己 `mkdir` + `write` 写 DRAFT 文件到磁盘。

**用户反馈**：为什么 DRAFT 的持久化不由 MCP 直接实现？让 Reflector 自己先写是什么考虑？

**原型验证结果**：Subagent 可写文件，但 `skill_mcp` 不可用。直接调用 `aristotle_*` tool 函数可用。

**最终决策**：新增 MCP tool `persist_draft(sequence, content)`，Reflector 通过直接 tool 函数调用。原因：
- 与 R6 的 MCP 调用模式一致
- 存储位置由 MCP 统一控制
- 原子写入（tmp + rename）在 MCP 层实现更可靠

#### 决策 2：DRAFT 的定位

**初始方案（v1.0）**：DRAFT 是"待审核的草案"，用户必须 review 后才写入规则。

**v2.0 变更**：规则自动写入 Git，DRAFT 失去"待审核"的必要性。

**用户反馈**：既然 draft 默认是存为规则了，用户 review 的应该不是 draft，而是已经 commit 后的规则。但 DRAFT 也要作为原始记录加以保存，方便用户随时 review 或 re-reflect。

**最终决策**：DRAFT 定位为**不可变的反思原始记录**，用途：
1. 事后审核参考：展示 DRAFT + 已 commit 规则的对应关系
2. Re-reflect 输入：二次反思需要原始上下文
3. 审计链路：DRAFT → 规则 是可追溯链路

#### 决策 3：Scope 判定逻辑

**初始方案（v2.0）**：根据 PROJECT_DIRECTORY 是否存在来决定 scope。

**用户反馈**：scope 是 user 还是 project，不应该根据是否有项目路径来判断，而是要看错误本身——是具有跨项目的普遍性还是属于项目本身特有。如果是上下文腐烂导致的错误，就应该是 user 级；如果错误的上下文高度依赖项目情景，就应该是 project 级。

**最终决策**：Scope 由 C subagent 根据错误性质判定：

| 错误性质 | scope |
|---------|-------|
| 推理偏差、上下文腐烂、通用工具误用 | user |
| 项目特有的模式违反、技术栈特定问题 | project |
| 无法明确判断 | user（保守策略） |

判定依据：DRAFT 中的 5-Why 根因分析、Error Excerpt、Intent Tags。

#### 决策 4：R 是否执行 C 角色功能（GEAR 合规）

**初始方案（v1.0-v2.0）**：R 自行完成 schema 校验（R4.5）+ 规则写入（R6），无独立 C subagent。

**Momus v2.0 审核**：R 同时承担 R 和 C 角色违反 GEAR Conformance #1。

**用户反馈（关键）**：冲突 1 说明当前的产品设计有问题。虽然审核默认不用经过用户确认，但不代表可以由 R 自行完成审核——这正是协议存在的意义。产品设计不能和协议冲突。

**最终决策**：引入独立 C subagent（CHECKER.md 扩展为 C subagent 协议）。
- R 只负责生成 DRAFT + 持久化，不调用 write_rule/stage_rule/commit_rule
- C 负责校验 + scope 判定 + 规则写入 + 状态转换
- O 协调序列：O→R→C→Git
- GEAR 合规声明中 #1 角色分离标记为 ✅ 合规

#### 决策 5：CHECKER.md vs CHECKER_AGENT.md

**实施中产生**：阶段二实施时新建了 CHECKER_AGENT.md 作为 C subagent 协议，与现有 CHECKER.md（校验规则文档）并存。

**用户反馈**：根据渐进式披露原则设计，为什么需要两个文件？

**最终决策**：合并为单一 CHECKER.md，按渐进式披露组织：
- 上层：校验标准（schema + content accuracy）——原有内容
- 中层：Scope 判定逻辑——新增
- 下层：Subagent 操作协议（C1-C6 步骤）——新增
- 底层：Post-hoc 验证模式——新增

CHECKER_AGENT.md 已删除，install 脚本引用已更新。

#### 决策 6：State file 操作由 MCP 处理

**实施中发现**：REFLECT.md 中涉及计数器操作（读 state file → 数记录 → 计算序号 → 改 JSON → 写回 → 50 条清理时还要删 DRAFT 文件），模型做这些操作存在准确性风险。

**用户反馈**：reflect 里有涉及到计数器操作，这个操作是否交给 MCP 更合理？模型做是否存在准确性风险？

**最终决策**：新增两个 MCP tool：
- `create_reflection_record(target_session_id, target_label, reflector_session_id)`：创建记录、自动编号、50 条清理
- `complete_reflection_record(sequence, status, rules_count)`：更新状态和规则数

收益：
- JSON 读写准确性由代码保证
- 计数器逻辑确定性执行
- REFLECT.md 从 169 行降到 135 行（解决行数超限问题）

#### 决策 7：State file 50 条记录上限

**方案中提出**：超过 50 条时清理最旧记录及对应 DRAFT 文件。

**用户反馈**：这个限制对用户使用产生什么影响？是不是用户最多只能审核最近 50 条 draft？

**分析**：
- 50 条上限影响：用户只能 review 最近 50 条、超限后旧规则的 DRAFT 审计链路断裂、已 commit 规则不受影响（在 Git repo 中永久保存）
- 高频使用场景（每天多次反思）50 条可能很快用完

**最终决策**：本轮不改，记录为待办。不引入新的复杂度。后续可考虑提高上限或分层清理。

### 9.3 审核记录

| 轮次 | 审核方 | 结果 | 关键发现 |
|------|--------|------|---------|
| v1.0 | Momus | PASS WITH CONCERNS | Issues A/B 静默遗漏、install.sh 未更新 SESSIONS.md、DRAFT 生命周期未定义、state file 并发风险 |
| v2.0 | Momus | PASS WITH CONCERNS | 原型验证只测了文件写入未测 MCP 调用、R 执行 C 角色违反 GEAR #1、GIVE 偏差需文档化 |
| v3.0 | Momus | **PASS** | GEAR Conformance #1-#7 全部合规，scope 判定逻辑合理，无剩余协议冲突，方案可实施 |

### 9.4 原型验证结果

| 能力 | 结果 | 对架构的影响 |
|------|------|-------------|
| Subagent 文件写入（mkdir + write） | ✅ 可用 | 证明方案 A 可行，但最终选择 MCP tool 方式 |
| Subagent MCP via skill_mcp | ❌ 不可用 | 排除了 skill_mcp 调用方式 |
| Subagent 直接调用 aristotle_* tool 函数 | ✅ 可用 | 确定了 subagent 调用 MCP 的方式：直接 tool 函数 |

### 9.5 实施结果

| 阶段 | 测试结果 |
|------|---------|
| 阶段一（问题 8+3） | 67 静态 + 111 pytest ✅ |
| 阶段二（问题 5+6+7） | 67 静态 + 115 pytest ✅ |
| 阶段三（问题 1+2+4） | 67 静态 + 115 pytest ✅ |

### 9.6 文件改动清单

| 文件 | 改动类型 | 关联问题 |
|------|---------|---------|
| install.sh | 修改 | #8 repo 初始化、CHECKER.md 部署 |
| install.ps1 | 修改 | #8 repo 初始化、CHECKER.md 部署 |
| aristotle_mcp/server.py | 修改 | #8 graceful degradation、新增 persist_draft、新增 create/complete_reflection_record |
| test/test_mcp.py | 修改 | 新增 TestPersistDraft 4 个测试 |
| test.sh | 修改 | R5 断言从 assert_not_contains 改为 assert_contains |
| REFLECT.md | 重写 | #3 序号替代 shell 语法、O→R→C 两阶段流程、MCP 化 state 操作 |
| REFLECTOR.md | 修改 | STEP R5 持久化 DRAFT、GEAR 约束（R 不写规则） |
| REVIEW.md | 重写 | 事后审核模式（磁盘文件加载、用户修改 C 校验） |
| CHECKER.md | 扩展 | 从 64 行校验文档扩展为 138 行 C subagent 完整协议（含 scope 判定） |
| SKILL.md | 修改 | #2 禁止协议推理规则、sessions 格式精简、90→76 行瘦身 |
| README.md / README.zh-CN.md | 修改 | MCP tool 计数 11→14 |
| CHECKER_AGENT.md | 删除 | 合并到 CHECKER.md |
