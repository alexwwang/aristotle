# Requirements Document: Aristotle 规则正文结构规范

**日期:** 2026-04-27
**版本:** v1.0-draft
**前置文档:** GEAR v1.1 协议规范、GEAR Phase 2 产品方案
**目标:** 定义 Aristotle 规则文件 Markdown body 的完整结构，确保规则正文包含足够的错误现场信息以支撑跨 session 错误预防

---

## 背景与问题

当前 GEAR 协议定义了规则 frontmatter schema（id, status, intent_tags, error_summary 等），但规则正文（Markdown body）结构仅在 REFLECTOR.md 中作为实现约定存在，未在任何产品设计中明确定义。实际生成的规则存在以下问题：

- **Context 泛化过度**：写成抽象的触发条件（"Applies when user asks for behavior that conflicts with definitions"），而非具体的错误现场还原
- **错误本身丢失**：用户的原始任务描述和模型的错误输出没有在规则中保留，导致 Learner 无法精准匹配相似场景
- **Why 与 Context 混淆**：Why 解释错误原因，但 Context 没有承担还原错误的职责
- **缺少内容规范**：没有明确定义各部分应该写什么、长度约束、禁止写什么
- **DRAFT 信息过度压缩**：DRAFT 定位为"不可变的反思原始记录"，但内容仅包含 1-2 句话的 Error Excerpt / Correction Excerpt（Reflector 提炼后的摘要），而非原始对话的逐字引用。作为"原始凭证"，DRAFT 应包含与错误相关的最小原始对话子集

---

## User Stories

| # | Priority | User Story | Justification |
|---|---|---|---|
| US-1 | Core | As a **Scoring Subagent** (S role), I want rules to contain the original error scene, so that I can score relevance accurately by comparing the user's current task against historical errors | Core: Incident is the primary signal for Round 2 scoring. Without it, scoring subagents can only match metadata, not actual error scenes — leading to false positives in retrieval. |
| US-2 | Core | As a **Checker agent** (C role), I want explicit content specifications for each body section, so that I can validate rule quality objectively | Core: Checker is the gatekeeper of rule quality. Without clear specs, audit is subjective and rules accumulate noise. |
| US-3 | Core | As a **Resource Creator** (R role), I want clear guidance on what to write in each section, so that I generate consistent, high-quality rules | Core: R produces rules. Without guidance, R outputs vary wildly, breaking consistency and making retrieval unreliable. |
| US-4 | Secondary | As a **human reviewer**, I want the error scene to be self-contained in the rule, so that I don't need to re-read the original session to understand what went wrong | Secondary: Improves review UX but does not block rule functionality. A reviewer can always look up the original session via `source_session`. |
| US-5 | Secondary | As a **Search agent**, I want the Incident section to be indexed for keyword retrieval, so that keyword-based search can match terms from the original error scene | Secondary: Retrieval works via metadata (intent_tags, error_summary) even without full-text Incident indexing. Keyword search on Incident is an enhancement, not a requirement. |

---

## Acceptance Criteria

| # | User Story | Priority | Acceptance Criterion | Edge Cases |
|---|---|---|---|---|
| AC-1 | US-1 | Core | Given a rule is generated from an error session, When the rule body is written, Then the **Incident** section MUST contain two labeled sub-elements: `**User Request:**` (quoted verbatim or summarized if >300 chars) AND `**Model Wrong Output:**` (quoted verbatim or summarized if >300 chars) | User request spans multiple messages; Model output is a code block; Session file is unavailable |
| AC-2 | US-1 | Core | Given the Incident section is written, When the Checker validates it, Then the Incident MUST contain three labeled structural elements: `**User Request:**` (non-empty), `**Model Wrong Output:**` (non-empty), and at least one of `**User Correction:**` or `**Error Impact:**` (optional) | Ambiguous user request; Multiple errors in one session; Model partially correct |
| AC-3 | US-2 | Core | Given a rule body is submitted for validation, When the Checker validates it, Then each section MUST comply with its content specification (see Section Specs below) — non-compliant rules MUST be rejected or auto-corrected | Section missing entirely; Section present but empty; Section exceeds max length |
| AC-4 | US-3 | Core | Given the Reflector is generating a rule, When it writes the Context section, Then it MUST write "When this rule applies" (trigger conditions) and MUST NOT mix error scene details into Context | Reflector confuses Context with Incident; Session has no clear trigger pattern |
| AC-5 | US-3 | Core | Given the Reflector is generating a rule, When it writes the Why section, Then it MUST contain at least one conditional checkpoint sentence (pattern: "If [check] had been performed, [error] would have been caught") AND MUST NOT contain any verbatim quote from the Incident section | Why = surface cause only; Why = generic advice ("be more careful"); Why copies text from Incident |
| AC-6 | US-4 | Secondary | Given a rule is in verified status, When a user reads it without access to the original session, Then the user MUST be able to understand the full error scene from the Incident section alone | Original session deleted; Session snapshot corrupted |
| AC-7 | US-5 | Secondary | Given a keyword search is performed, When the search term appears in the Incident section, Then the rule MUST be returned in search results | Keyword in Why but not Incident; Keyword is common word ("the", "code") |

---

## 规则正文结构定义

规则正文由 **5 个标准 section** 组成，顺序固定，每个 section 以 Markdown heading（`###`）标识。

```markdown
---
[YAML frontmatter]
---

### Incident
[错误现场还原 — 用户原始任务 + 模型错误输出]

### Context
[适用条件 — 这条规则在什么场景下触发]

### Rule
[行动规则 — 以后遇到这种场景应该怎么做/避免什么]

### Why
[根因分析 — 为什么会犯这个错误，从 5-Why 提炼]

### Example
[正例 + 反例 — 正确做法和错误做法的对比]
```

---

## Section 内容规范

### 1. Incident（新增）

**职责**：还原原始错误现场。这是规则中最关键的部分 —— 它让 Scoring Subagent 能精确匹配历史错误，让 reviewer 无需回溯 session。

**结构**：Incident 必须包含带标签的子元素，使用 `**Label:**` 格式：

```markdown
### Incident

**User Request:** [用户的原始请求，逐字引用或精确摘要]

**Model Wrong Output:** [模型的错误输出，逐字引用或精确摘要]

**User Correction:** [可选 — 用户如何纠正，一句话]

**Error Impact:** [可选 — 错误的实际影响，如"导致测试失败"]
```

**各子元素规范**：

| 子元素 | 必填 | Max Length | 摘要阈值 | 摘要要求 |
|---|---|---|---|---|
| `**User Request:**` | 是 | 400 chars | >300 chars | 精确摘要：保留核心指令、关键参数、约束条件；删除寒暄、重复表述 |
| `**Model Wrong Output:**` | 是 | 400 chars | >300 chars | 精确摘要：保留错误的关键代码/语句；删除无关上下文 |
| `**User Correction:**` | 否 | 150 chars | — | 一句话说明用户纠正了什么 |
| `**Error Impact:**` | 否 | 100 chars | — | 一句话说明错误造成的后果 |
| **Incident 总计** | — | **1000 chars** | — | 超限时应优先完整保留 Model Wrong Output，其次 User Request |

**写作规范**：
- 使用直接引语或精确摘要，不添加解释性语言
- 代码块使用 4 空格缩进（避免 Markdown 嵌套问题）
- 精确摘要定义：保留原始内容的语义完整性，删除冗余措辞，不添加解释或推断

**禁止**：
- 不写 Incident（错误现场不可缺失 —— 见下方例外）
- 将 Incident 写成泛化描述（如"当用户要求不合理时"）
- 在 Incident 中加入 Why 的内容（原因分析放在 Why section）

**例外 — 非错误来源的规则**：
如果规则不是从错误 session 生成的（如用户手动创建、从最佳实践提炼），Incident  section 必须存在但可写为：
```markdown
### Incident

**User Request:** [NO_INCIDENT] Rule derived from proactive learning / manual authoring.
**Model Wrong Output:** N/A
```

**示例**：
```markdown
### Incident

**User Request:** "Please write a function to check if a number is prime, make sure 1 is treated as prime."

**Model Wrong Output:**
    def is_prime(n):
        if n <= 2:
            return True  # ← Wrong: makes 1 prime

**User Correction:** "1 is not prime in mathematics. Return False for n < 2."

**Error Impact:** Introduced mathematically incorrect behavior.
```

---

### 2. Context

**职责**：定义这条规则的适用边界。回答"什么时候应该想到这条规则"。

**必须包含**：
- 触发条件：什么样的任务/场景会命中这条规则
- 关键词/信号词：帮助 Learner 快速识别的特征

**写作规范**：
- 使用第三人称、泛化描述
- 长度限制：≤ 300 字符
- 可包含领域关键词（如"database", "API", "auth"）

**禁止**：
- 重复 Incident 中的具体内容
- 使用模糊词汇（"sometimes", "usually", "in some cases"）

**示例**：
```markdown
### Context

Applies when a user request contradicts well-established mathematical, scientific, or domain-specific definitions. Trigger: user asks to override a universally accepted convention.
```

---

### 3. Rule

**职责**：可执行的行动指令。回答"遇到这种场景，应该怎么做"。

**必须包含**：
- 明确的行动指令（祈使句）
- 可验证的判定标准（什么算做对、什么算做错）

**写作规范**：
- 每条规则 ≤ 3 条行动指令
- 使用祈使句开头（"Flag", "Check", "Validate", "Do not"）
- 长度限制：≤ 300 字符

**禁止**：
- 写泛泛而谈的建议（"be more careful", "think twice"）
- 混合原因分析（放在 Why）
- 混合示例（放在 Example）

**示例**：
```markdown
### Rule

When a user's request contradicts established definitions, flag the contradiction explicitly before implementing. Ask for confirmation rather than silently complying.
```

---

### 4. Why

**职责**：根因分析。回答"为什么会犯这个错误"。

**必须包含**：
- 从 5-Why 分析提炼的系统性原因
- 至少一个"如果当时做了 X，就能避免"的 checkpoint

**写作规范**：
- 解释思维模式/过程漏洞，不是重复错误现象
- 长度限制：≤ 400 字符

**禁止**：
- 写成 Incident 的复述
- 过于抽象（"human error"）

**示例**：
```markdown
### Why

The model prioritized user instruction over domain knowledge, treating "user said so" as sufficient reason to violate a mathematical definition. The missing checkpoint was: "Does this instruction contradict any universally accepted fact?" This pattern of silent compliance — executing without validating against known constraints — is a recurring failure mode.
```

---

### 5. Example

**职责**：具象化正确和错误做法。

**必须包含**：
- 正例（✅）：按照 Rule 执行的正确做法
- 反例（❌）：重现 Incident 中的错误做法

**写作规范**：
- 正例和反例必须成对出现
- 长度限制：正例 ≤ 200 字符，反例 ≤ 200 字符
- 可直接引用代码片段或对话片段

**示例**：
```markdown
### Example

✅ "Note: 1 is universally classified as non-prime in mathematics. Are you sure you want to treat it as prime? I'll implement it if so."

❌ Silently writing `if n <= 2: return True` because the user asked for it.
```

---

## 与压缩注入格式（WHEN/DO/NEVER/CHECK）的映射

规则存储格式（正文）与 Learner 注入格式（压缩格式）是不同的，但需要能互相转换：

| 存储 Section | 压缩映射 | 说明 |
|---|---|---|
| Incident | （不映射）| Incident 是历史记录，不注入 Learner |
| Context | WHEN | Context 的触发条件 → WHEN 的谓词表达式 |
| Rule | DO + NEVER | Rule 中的"应该做" → DO；"禁止做" → NEVER |
| Why | （不映射）| Why 是根因分析，不注入 Learner |
| Example | （不映射）| Example 用于 human review，不注入 Learner |

**关键原则**：Incident 和 Why 是"元信息"，用于规则检索时的人类理解和精确匹配；它们不注入 Learner context，避免污染。注入 Learner 的只有可执行部分（WHEN/DO/NEVER/CHECK）。

---

## 与 GEAR 协议 frontmatter 的关系

| Frontmatter 字段 | 正文对应 | 关系 |
|---|---|---|
| `error_summary` | Incident（摘要） | frontmatter 是 ≤200 字符的摘要；Incident 是完整还原 |
| `intent_tags.domain` | Context | Context 中应包含 domain 关键词 |
| `intent_tags.task_goal` | Incident | task_goal 从用户原始请求推断 |
| `source_session` + `message_range` | Incident（引用） | Incident 可引用 session 来源 |

---

## 长度约束汇总

| Section | Max Length | 理由 |
|---|---|---|
| Incident (total) | 1000 chars | 容纳典型错误场景（User Request ≤400 + Model Wrong Output ≤400 + optional ≤200） |
| Context | 300 chars | 触发条件应简洁，便于快速扫描 |
| Rule | 300 chars | 行动指令应聚焦，≤3 条 |
| Why | 400 chars | 根因分析应精炼，避免冗长 |
| Example | 200 chars × 2 | 正例 + 反例各 ≤200 字符 |
| **Total body** | **~2200 chars** | 控制单条规则体积，避免存储膨胀 |

---

## Checker 验证规则

Checker（C 角色）在验证规则时必须检查：

### 结构检查（binary pass/fail）
1. **Section 完整性**：5 个 section 是否全部存在（`### Incident`, `### Context`, `### Rule`, `### Why`, `### Example`）
2. **Section 非空**：每个 section 是否有实质内容（非空、非占位符、非仅 whitespace）
3. **Incident 结构**：是否包含 `**User Request:**` 和 `**Model Wrong Output:**` 两个 labeled 子元素，且各自非空
4. **长度合规**：各 section 是否超出 max length

### 质量检查（需要判断，非 binary）
5. **Incident 质量**：`User Request` 和 `Model Wrong Output` 是否为具体场景而非泛化描述
6. **职责分离**：Why 是否包含原因分析（而非复述 Incident）；Context 是否泛化（而非重复 Incident）

**自动修正**（Checker 可直接修改）：
- 缺少 `**User Request:**` 或 `**Model Wrong Output:**` → 标记 `[INCIDENT_STRUCTURE_INVALID]` 并拒绝
- 空 Incident → 标记 `[INCIDENT_MISSING]` 并拒绝
- 非错误来源的规则缺少 `[NO_INCIDENT]` 标记 → 添加 `[NO_INCIDENT]` 并允许通过
- 超过长度的 section → 截断至 max length 并标记 `[TRUNCATED]`
- Incident 中的泛化描述（"when user makes a mistake"）→ 标记 `[NEEDS_SPECIFIC_INCIDENT]` 并拒绝

---

## 迁移策略

**Actor**：迁移由 **Checker subagent** 在 C 验证阶段自动执行。Checker 读取现有规则 → 检查是否存在 Incident section → 如不存在，尝试从 `source_session` + `message_range` 读取 session 并生成 Incident。

**现有规则迁移**：
- 现有规则缺少 Incident section，只有 Context/Rule/Why/Example
- 迁移步骤：
  1. Checker 读取规则的 `source_session` 和 `message_range`
  2. 读取对应 session snapshot 文件
  3. 提取用户请求消息（最后一条用户消息）和模型错误输出消息（紧接着的模型回复）
  4. 生成 Incident section，插入到正文最上方（frontmatter 之后）
  5. 重新写入规则文件
- 无法读取 session 的旧规则：在 Incident 中写入 `[LEGACY: Incident reconstructed from error_summary]` + error_summary 内容

**新规则生效**：
- 本规范生效后，所有新产生的规则必须包含 Incident section
- Checker 对缺少 Incident 的规则拒绝通过（非错误来源的规则除外，见 Incident 例外条款）

---

## Constraints & Assumptions

- 假设原始 session 数据（或 snapshot）在规则生成时可用，否则 Incident 只能基于 error_summary 重建
- 假设 Learner 能区分"历史错误场景"（Incident）和"当前任务"（Context 触发）
- 规则正文使用 Markdown，section heading 用 `###` 以区别于压缩注入格式的 `##`
- 与 GEAR v1.1 协议兼容：Incident 是正文新增 section，不影响 frontmatter schema

---

## Resolved Decisions

以下问题已在本方案中做出明确决策：

| # | Decision | Rationale |
|---|---|---|
| D1 | 如果原始 session 已删除，Incident 如何生成？ | **三级降级路径**：① 查询 session snapshot（`*_snapshot.json`），从 `messages[]` 提取原始对话生成 Incident；② 如无 snapshot，查询 DRAFT 文件（`rec_{sequence}.md`），提取 Error Excerpt → `**Model Wrong Output:**`，Correction Excerpt → `**User Correction:**`；③ 如两者皆无，使用 error_summary + Why 反推，标记 `[RECONSTRUCTED]`。这是降级方案，无法保证完整性。 |
| D5 | 中间载体 → Incident 的字段映射规范 | **从 snapshot 提取**：用户消息 → `**User Request:**`，模型错误回复 → `**Model Wrong Output:**`。**从 DRAFT 提取**：Error Excerpt → `**Model Wrong Output:**`（并从中提取用户请求部分作为 `**User Request:**`）；Correction Excerpt → `**User Correction:**`（可选）；5-Why 的 Prevention 句作为 `**Error Impact:**`（可选）。 |
| D7 | DRAFT 的内容规范 | DRAFT 定位为"不可变的反思原始记录"，必须包含 **Incident**（原始对话现场的逐字引用，非摘要），而非仅含 1-2 句话的 Error Excerpt / Correction Excerpt。Incident 与 Analysis（5-Why、Rule、Context、Example）共同构成 DRAFT 的完整内容。 |
| D6 | 规则如何关联到 DRAFT 文件？ | frontmatter 新增 `draft_sequence: int` 字段（可选），Checker 通过该字段直接定位 DRAFT。如无该字段，Checker 通过 `source_session` 扫描 DRAFT 目录匹配。 |
| D2 | Incident 中的代码块是否会增加检索时的 token 开销？ | Incident 不注入 Learner，只用于存储和 human review，不影响检索开销。 |
| D3 | 多轮对话中的错误，Incident 应该引用哪几轮？ | 引用错误发生的最小 message range（通常 2-4 轮：用户请求 + 模型错误 + 用户纠正）。不引用无关上下文。 |
| D4 | 是否需要支持多语言 Incident？ | 是。Incident 使用原始对话语言（保留原始信息保真度）；Context/Rule/Why/Example 使用用户偏好的 review 语言（统一 review 体验）。 |

## Open Questions (pending resolution before Phase 2)

| # | Question | Blocker |
|---|---|---|
| Q1 | 是否需要在 frontmatter 中新增 `incident_present: bool` 字段，以便 `list_rules` 能快速筛选含/不含 Incident 的规则？ | Phase 2 schema 设计 |
| Q2 | Checker 自动迁移现有规则时，如果 session snapshot 不存在，是否静默标记 `[RECONSTRUCTED]` 还是通知用户？ | Phase 2 交互设计 |

---

*本文档基于 GEAR v1.1 协议规范和 Aristotle 现有实现约定编制。*
