# 技术设计：增强型审核阶段用户体验

## 架构概览

这是对Aristotle审核流程的**展示层增强**，包含少量数据模型扩展。本次改动涉及`aristotle_mcp/`目录下的4个文件、2个提示词模板文件和1个数据模型，无新增MCP工具端点，无新增依赖。

### 数据流

```
R (Reflector):
  └─ DRAFT 现在包含 ## 关键发现 部分，其中附带错误→规则配对

C (Checker) [本设计不做改动 — 仅更新规范]:
  └─ 从DRAFT中提取proposed_rule_summary → 传递给write_rule(rule_summary=...)
  └─ 将 ### Rule Summary 附加到规则正文

磁盘上的规则文件:
  ├─ frontmatter: rule_summary = "proposed_rule_summary 文本内容"
  └─ 正文: ### Incident / ### Rule Summary / ### Context / ### Rule / ...

orchestrate_start("review")
  │
  ├─ list_rules(keyword=target_session)  ← 现有调用，返回包含置信度、风险等级、冲突信息的元数据
  │
  ├─ [新增] 为每个staging规则调用get_audit_decision(rule_path)  ← 仅读取文件，不调用LLM
  │
  ├─ [新增] _enrich_rules_metadata(rules_result) → (staging_rules, verified_rules, audit_decisions)
  │
  ├─ [新增] 解析DRAFT获取关键发现摘要  ← 字符串解析，不调用LLM
  │
  ├─ [重写] _format_review_output(sequence, target_record, draft_content, staging_rules, verified_rules, audit_decisions)
  │     │
  │     ├─ 头部 (来自audit_decisions的Δ + 审计等级)
  │     ├─ DRAFT 摘要 (关键发现或降级内容)
  │     ├─ "待审核规则" 部分 (staging规则，带编号，附带置信度/风险/冲突信息)
  │     ├─ "自动提交" 部分 (verified规则，无编号，单行展示)
  │     └─ 操作菜单 (现有4项 + 2项新增：inspect N, show draft)
  │
  └─ _save_workflow (附带staging_rule_paths用于inspect操作)

orchestrate_review_action(workflow_id, action)
  │
  ├─ [现有] confirm / reject / re_reflect  ← 无改动
  ├─ [修改] revise — 现在从staging_rule_paths索引 (与inspect一致) ← 用户可见编号仅针对staging规则
  │
  ├─ [新增] "inspect N" → 读取规则文件 → 返回正文
  │
  └─ [新增] "show draft" → 读取DRAFT文件 → 返回完整内容
```

## 组件拆分

| 组件 | 优先级 | 职责 | 满足第一阶段验收条件 | 接口 | 依赖 |
|-----------|----------|-----------------|---------------------|-----------|-------------|
| `_format_review_output` | 核心 | 用增强后的数据格式化审核通知：头部(Δ)、DRAFT摘要、staging/verified分段展示、每条规则的置信度/风险/冲突信息 | AC-2, AC-3, AC-4, AC-5, AC-7 | `(sequence, target_record, draft_content, staging_rules, verified_rules, audit_decisions) → str` | `_parse_draft_summary` (内部) |
| `_parse_draft_summary` | 核心 | 从DRAFT内容中提取关键发现部分，降级策略为前3行内容 | AC-5 | `(draft_content: str) → tuple[list[str], int]` (摘要行列表, 总字符数) | 无 (纯字符串解析) |
| `_enrich_rules_metadata` | 核心 | 计算每条规则的audit_decisions，并将规则整理为staging和verified分组 | AC-4, AC-7 | `(rules_result: dict) → tuple[list[dict], list[dict], list[dict | None]]` (staging规则列表, verified规则列表, 审计决策列表) | `get_audit_decision` |
| `orchestrate_review_action` (inspect分支) | 核心 | 处理`inspect N`操作：解析规则路径、读取文件、返回正文 | AC-1 | `action="inspect"`, `data_json='{"rule_index": N}'` | `workflow["staging_rule_paths"]`, `_safe_resolve`, `Path.read_text` |
| `orchestrate_review_action` (show_draft分支) | 核心 | 处理`show draft`操作：读取DRAFT文件、返回完整内容 | AC-6 | `action="show draft"` | `workflow["draft_file_path"]`, `Path.read_text` |
| `orchestrate_start` (review分支) | 核心 | 在调用格式化器前计算审计决策；在工作流中存储staging_rule_paths | AC-1, AC-4 | `orchestrate_start`中修改后的review分支 | `_enrich_rules_metadata`, `_format_review_output` |
| REFLECTOR.md 更新 | 外围 | 向DRAFT模板添加`## 关键发现`部分说明，附带错误→规则配对格式：`- [error_summary]: [proposed_rule_summary]` | AC-5 (DRAFT格式保证) | 对REFLECTOR.md的文本编辑 | 无 |
| `RuleMetadata.rule_summary` | 核心 | 新增frontmatter字段，存储proposed_rule_summary用于搜索和审核展示 | AC-2 (信息增强) | `RuleMetadata`数据类中的`rule_summary: str | None`字段 | 无 (仅数据模型) |
| CHECKER.md 更新 | 外围 | 指导Checker从DRAFT中提取proposed_rule_summary并作为新参数传递给`write_rule`；在规则正文附加`### Rule Summary`行 | AC-5 (数据持久化) | 对CHECKER.md C5步骤的文本编辑 | REFLECTOR.md 关键发现格式 |

## 数据模型变更

### `RuleMetadata` — 新增字段：`rule_summary`

```python
# 在models.py中，添加到RuleMetadata数据类：
rule_summary: str | None = None  # 单行规则提案摘要（来自DRAFT的关键发现）
```

**持久化链路**：
1. `to_frontmatter_string()` — 已经遍历非None字段；`rule_summary`会自动序列化
2. `from_frontmatter_dict()` — 在构造函数调用中添加`rule_summary=data.get("rule_summary")`
3. `list_rules()` — 通过`read_frontmatter_raw`返回完整frontmatter；`rule_summary`会包含在元数据字典中

**规则正文格式** — Checker在`### Incident`后附加：

```markdown
### Rule Summary

[proposed_rule_summary text]

### Context
...
```

**`rule_summary`来源**：Checker从DRAFT的`### Reflection N`块中提取，具体是`**Proposed Rule**`字段。相同的值会作为配对中的`[proposed_rule_summary]`部分出现在`## 关键发现`中。

### `write_rule` — 新增参数

```python
# 在 _tools_rules.py 的 write_rule() 中添加参数：
def write_rule(
    ...,
    rule_summary: str | None = None,  # 新增
) -> dict:
    # 传递给RuleMetadata构造函数：
    metadata = RuleMetadata(..., rule_summary=rule_summary)
```

## 数据模型 / API 契约

### `_parse_draft_summary(draft_content: str) → tuple[list[str], int]`

```python
def _parse_draft_summary(draft_content: str) -> tuple[list[str], int]:
    """从DRAFT内容中提取关键发现。

    返回：
        (summary_lines, total_chars)，其中summary_lines是要展示的行列表，total_chars是DRAFT的总字符数。

    提取逻辑：
        1. 查找"## Key Findings"标题（去除首尾空白后精确匹配）
        2. 收集后续`line.lstrip().startswith("- ")`的行，直到遇到以"##"开头的行（任意标题）—— 在该行之前停止。允许列表项之间有空行，不会终止收集。
        3. 如果没有关键发现部分 → 降级策略：前3行非空行（`line.strip()`为真值的行）
        4. 如果draft_content为空 → 返回 (["DRAFT报告为空"], 0)
        5. total_chars始终等于len(draft_content)
    """
```

### `_enrich_rules_metadata(rules_result: dict) → tuple[list[dict], list[dict], list[dict | None]]`

```python
def _enrich_rules_metadata(rules_result: dict) -> tuple[list[dict], list[dict], list[dict | None]]:
    """将规则整理为staging/verified分组并计算审计决策。

    返回：
        (staging_rules, verified_rules, audit_decisions)

    - staging_rules: metadata.status == "staging"的规则
    - verified_rules: metadata.status == "verified"的规则
    - audit_decisions: staging规则对应的get_audit_decision()结果列表
      每个条目: {"delta": float, "audit_level": str, ...} 或出错时为None
      **audit_decisions[i] 与 staging_rules[i] 位置一一对应**

    头部审计等级逻辑：
        对于AC-4，展示非None条目中delta最小值对应的delta和audit_level。由于decide_audit_level是delta的单调递减函数，最小的delta始终对应最严格的审计等级。
    """
```

### `_format_review_output` — 新签名

```python
# 审计等级 → 展示标签映射（AC-4要求精确标签）
_AUDIT_LABELS: dict[str, str] = {
    "auto": "automatic",
    "semi": "review suggested",
    "manual": "manual review required",
}

def _format_review_output(
    sequence: int,
    target_record: dict,
    draft_content: str,
    staging_rules: list[dict],    # 由_enrich_rules_metadata预先拆分
    verified_rules: list[dict],   # 由_enrich_rules_metadata预先拆分
    audit_decisions: list[dict | None],  # 与staging_rules并行；None = 审计决策失败
) -> str:
```

### `orchestrate_review_action` — 新分支

```python
# 在orchestrate_review_action中，现有elif块之后：

elif action == "inspect":
    # 从data_json解析规则索引
    # 验证：1 ≤ 索引 ≤ len(staging_rule_paths)
    # 读取文件，返回正文
    # 返回：{"action": "notify", "message": <规则正文或错误>}

elif action == "show draft":
    # 从workflow["target_record"]["draft_file_path"]读取draft_file_path
    # 如果文件不存在 → 返回"DRAFT file not found"
    # 如果内容为空字符串 → 返回"(empty DRAFT)" （AC-6边界情况）
    # 否则 → 返回完整内容
    # 返回：{"action": "notify", "message": <完整草稿或错误>}
```

### 工作流状态 — 新增字段

```python
# 在orchestrate_start的review分支中添加到工作流字典：
"staging_rule_paths": list[str]   # 替换displayed_rules；仅存储staging规则的路径
# "displayed_rules" 已移除 — inspect和revise都从staging_rule_paths索引
# draft_file_path从workflow["target_record"]["draft_file_path"]读取（现有路径，无重复字段）
```

**注意**：`displayed_rules`（按文件系统顺序存储所有规则路径）已被`staging_rule_paths`（仅存储staging规则）替换。这确保`inspect N`和`revise N`使用相同的1-based索引，与用户可见的"待审核规则"部分一致。"自动提交"部分的verified规则无编号且不可修改 — 它们已经被提交。`_orch_review.py`中现有的`revise`操作目前从`displayed_rules`索引，将更新为从`staging_rule_paths`索引。

## 关键决策

| 决策 | 设计理由 | 被拒绝的替代方案 |
|----------|-----------|----------------------|
| `inspect N`仅索引staging规则（从1开始） | AC-1明确规定"索引N仅指代带编号的staging规则（根据AC-7，verified规则无编号）"。混合不同类型的索引会让用户产生混淆。 | 索引所有规则（staging+verified）—— 被拒绝原因是verified规则已经自动提交且无编号，查看它们没有价值 |
| 审核展示时调用每条规则的`get_audit_decision` | 仅文件读取操作，无LLM成本。数据始终是最新的（置信度可能已被Checker更新） | 在Checker阶段预计算 — 被拒绝原因是置信度可能在staging到审核之间被更新；同时会增加与Checker流程的耦合 |
| DRAFT摘要由格式化器解析（而非R） | 零LLM成本。格式化器是Python函数，对`## Key Findings`的字符串解析非常简单 | R生成摘要 — 被拒绝原因是对于子串提取操作，调用LLM完全没有必要 |
| `staging_rule_paths`存储在工作流状态中 | `inspect N`需要将N解析为文件路径。工作流已经存储了`displayed_rules`（所有规则）；添加仅包含staging规则的列表可以保持inspect逻辑简洁 | 在inspect时重新调用`list_rules` — 被拒绝原因是不必要的I/O；数据可能在展示和inspect之间发生变化 |
| `show draft`从工作流中的`draft_file_path`读取 | DRAFT路径已经可以从工作流中存储的`target_record.draft_file_path`获取，无需额外查找 | 从状态文件重新读取 — 被拒绝原因是不必要的间接访问；工作流中已经存在该路径 |
| `_parse_draft_summary`作为独立函数 | 可测试性。DRAFT解析逻辑有4种边界情况（空内容、无关键发现、少于3条发现、正常情况）。将其隔离便于编写针对性的单元测试 | 在格式化器中内联实现 — 被拒绝原因是更难测试，将格式化与解析逻辑混合 |
| 风险指示器使用文本标签（HIGH/MEDIUM/LOW） | Unicode符号（⚠/●/○）可能在极简终端中无法渲染。文本标签始终可读。测试基于文本标签断言 | 仅使用Unicode — 被拒绝原因是存在终端兼容性风险；Unicode+文本 — 被拒绝原因是行长度过长 |
| `staging_rule_paths`完全替换`displayed_rules` | `inspect N`和`revise N`应该索引同一个列表 — 即用户可见的带编号规则。维护两个独立的路径列表（`displayed_rules`用于revise，`staging_rule_paths`用于inspect）会导致索引错位和混淆。Verified规则已自动提交且不可修改 | 同时保留两个列表 — 被拒绝原因是双重索引极易引发bug；在操作时重新查询 — 被拒绝原因是不必要的I/O |
| 移除10条规则的展示上限 | 第一阶段约束：展示所有返回的规则。重写中移除了旧的`rules[:10]`切片。格式化器遍历所有staging和verified规则，不做切片。`list_rules`已经限制为最多20条 | 保留上限 — 被拒绝原因是第一阶段明确要求移除 |
| `rule_summary`同时持久化到frontmatter和规则正文 | 既可以通过`list_rules`搜索，也可以在`inspect N`时便于人工阅读。`error_summary` frontmatter字段记录了问题内容；`rule_summary`记录了预防规则 — 两者共同构成关键发现配对 | 仅存储到frontmatter — 被拒绝原因是`inspect`时不便于人工阅读；仅存储到规则正文 — 被拒绝原因是无法通过`list_rules`搜索 |

## 故障模式处理

| 故障场景 | 优先级 | 设计应对方案 |
|-----------------|----------|----------------|
| `get_audit_decision()`针对某个staging规则抛出异常 | 核心 | 捕获异常，将`audit_decisions`中对应的条目设为`None`。如果所有audit_decisions都是None，格式化器会完全跳过Δ行；否则基于非None条目计算最小值。 |
| `get_audit_decision()`返回`success: False` | 外围 | 视为`None`处理 — 与异常情况相同的降级逻辑 |
| 规则文件在展示和`inspect N`之间被删除 | 核心 | `_safe_resolve`返回错误路径；inspect操作返回"Rule file not found" |
| DRAFT文件在展示和`show draft`之间被删除 | 核心 | 执行`Path.exists()`检查；返回"DRAFT file not found" |
| 规则frontmatter缺失`confidence`字段 | 外围 | 展示默认值0.7（与`write_rule`的默认值一致）。`get_audit_decision`已经默认使用0.7。 |
| 规则frontmatter的`confidence`是非数值类型 | 外围 | `get_audit_decision`可能因非数值置信度失败，在audit_decisions中返回None。**格式化器独立读取`metadata.confidence`**，尝试`float()`转换，失败时降级为0.7。每条规则的置信度行始终展示（不会省略），使用转换后的值或默认值。符合AC-2要求："视为缺失，展示默认值0.7。" |
| 规则frontmatter缺失`conflicts_with`字段 | 外围 | `metadata.get("conflicts_with")`返回None → 格式化器跳过该规则的冲突行 |
| `conflicts_with`在frontmatter中存储为JSON字符串 | 核心 | `commit_rule`将`conflicts_with`存储为`json.dumps(list)`，因此`read_frontmatter_raw`返回Python字符串而非列表。**格式化器必须通过`models.py`中的`_parse_conflicts_with()`解析**（该函数处理None、列表、字符串和无效JSON情况）。如果解析返回空列表，跳过冲突行。 |
| DRAFT内容为空 | 外围 | `_parse_draft_summary`返回`(["DRAFT报告为空"], 0)` |
| DRAFT没有`## Key Findings`部分 | 外围 | 降级策略：前3行非空行 |
| 0条staging规则（全部自动提交） | 外围 | 展示"无需审核规则" + 自动提交部分；完全省略Δ行 |
| `inspect`调用时索引无效（0, -1, >S） | 核心 | 返回"无效的规则索引。请选择1-{S}范围内的值。" |
| `inspect`调用时规则正文为空 | 外围 | 返回"(empty rule body)" |
| frontmatter缺失`rule_summary`（历史规则） | 外围 | 对于metadata.rule_summary为None的规则，格式化器不展示rule_summary行。没有该字段的旧规则不受影响。 |

## 非功能约束

| 维度 | 需求 | 设计应对方案 |
|-----------|-------------|-----------------|
| 并发/阻塞 | 单用户CLI工具，顺序执行操作 | 无并发问题 |
| 操作可逆性 | `inspect`和`show draft`是只读操作；无状态修改 | 不适用 — 本质安全 |
| 数据隔离 | 规则正文内容在主会话中展示给用户；无LLM上下文泄露风险 | `inspect`结果返回给编排器，再传递给用户 |
| 资源边界 | `get_audit_decision`仅为文件读取操作（无LLM、无网络）；`list_rules`已经返回元数据 | 无新增资源问题 |
| 扩展能力 | 新操作（`inspect`、`show draft`）遵循与现有`revise`相同的模式（操作字符串 + data_json） | 新增未来操作仅需添加新的elif分支 |
| 认证/授权 | 不适用 — 本地CLI工具 | 不适用 |
| 加密 | 不适用 — 本地文件系统 | 不适用 |
| 延迟目标 | 每个staging规则的`get_audit_decision`调用：~1-5ms（文件读取 + frontmatter解析）。10条规则总耗时<50ms。 | 可接受；无需优化 |
| 吞吐量 | 单次仅处理一个审核 | 不适用 |
| 成本约束 | 零新增LLM成本 — 所有新逻辑均为文件I/O和字符串解析 | 不适用 |
| 合规 | 不适用 | 不适用 |

## 可观测性设计

| 信号 | 指标 / 日志 | 告警条件 | 负责人 |
|--------|-------------|-----------------|-------|
| 审计决策失败 | `_enrich_rules_metadata`中的异常计数 | 超过50%的staging规则审计决策失败 | 开发者（通过测试套件） |
| DRAFT解析降级率 | "无关键发现"降级的次数 | 通过测试覆盖率监控 | 开发者 |

**注意**：这是展示层改动，无生产监控。通过边界情况的单元测试覆盖率保证可观测性。

## 成本估算

| 条目 | 类型 | 预估成本 | 备注 |
|------|------|---------------|-------|
| 每条规则的`get_audit_decision`调用 | 经常性 | ~0ms LLM耗时，~5ms I/O耗时/每条规则 | 仅文件读取，无LLM成本 |
| `_parse_draft_summary` | 经常性 | ~0ms | 纯字符串解析 |
| 开发 | 一次性 | 第2-5阶段合计约4-5小时 | 4个Python文件 + 2个模板文件 + 1个数据模型，约200行代码 |

## 优先级降级说明

- **REFLECTOR.md 更新**：外围需求 — 仅文本编辑，无代码改动。但其输出格式（错误→规则配对）会通过CHECKER.md驱动下游数据持久化。
- **CHECKER.md 更新**：外围需求 — 仅文本编辑，无代码改动。在C5步骤中新增一个参数提取步骤。

## 未解决技术问题

- ~~`inspect N`应该返回原始markdown还是渲染后的内容？~~ → **已解决**：返回原始markdown。用户处于CLI环境，markdown渲染是调用方的责任。
- ~~`staging_rule_paths`是否应该替换`displayed_rules`？~~ → **已解决**：`staging_rule_paths`完全替换`displayed_rules`。`inspect N`和`revise N`都从`staging_rule_paths`索引 — 用户可见的编号(1..S)仅指代staging规则。Verified/自动提交的规则无编号，在审核上下文中无法修改（它们已经被提交）。这消除了`displayed_rules`按文件系统顺序混合staging和verified规则导致的索引错位问题。
- ~~DRAFT摘要是否应该截断单个发现行？~~ → **已解决**：不截断单行内容。关键发现条目由R生成，设计上应该是简洁的。如果某个发现过长，那是R提示词的问题，不是格式化器的问题。
