# 需求文档：Review 阶段 UX 增强

## 问题描述

当 Aristotle 完成一个反思周期并提交规则供用户审查时，用户被要求接受或拒绝他们看不到的规则。当前通知显示规则分类和一行摘要，但隐藏了规则正文、confidence 分数、risk level 和冲突信息。这迫使用户做出反射性确认或进行繁琐的手动调查——一种损害系统信任的惩罚性用户体验。

## 用户故事

| # | 优先级 | 用户故事 |
|---|--------|---------|
| US-1 | Core | 作为开发者，我希望按需查看特定规则的完整内容，以便在接受之前判断预防规则是否正确。 |
| US-2 | Core | 作为开发者，我希望在审查列表中看到每条规则的 confidence 分数和 risk level，以便确定关注优先级和审查力度。 |
| US-3 | Core | 作为开发者，我希望看到每条规则的冲突警告（当提议规则与已有 verified 规则矛盾时），以免意外引入矛盾的知识。 |
| US-4 | Core | 作为开发者，我希望在审查通知头部看到 Δ 值和 audit level，以便了解系统认为这些规则是否确定，还是需要例行审查。 |
| US-5 | Core | 作为开发者，我希望 DRAFT 报告以可扫描的摘要形式呈现（而非 2000 字符截断），以便快速掌握关键发现而无需滚动原始分析。 |
| US-6 | Core | 作为开发者，我希望按需查看完整的 DRAFT 报告，以便在摘要不够时阅读完整分析。 |
| US-7 | Secondary | 作为开发者，我希望看到哪些规则已 auto-committed、哪些需要我操作，以便只关注我能控制的部分。 |

## 数据流需求

审查展示需要当前未传递给 formatter 的数据。以下数据必须在格式化之前计算和/或获取：

| 数据 | 来源 | 计算时机 | 存储 |
|------|------|---------|------|
| 每条规则的 confidence、risk_level | Rule frontmatter | 审查展示时 | 通过 `list_rules` metadata 从磁盘读取 |
| 每条规则的 conflicts_with | Rule frontmatter（`conflicts_with` 字段） | 审查展示时 | 通过 `list_rules` metadata 从磁盘读取 |
| 每条规则的 Δ 和 audit_level | `get_audit_decision()` | 审查展示时 | 实时计算（文件读取，无 LLM） |
| DRAFT 摘要 | DRAFT 文件内容 | 审查展示时 | 解析 DRAFT 文件 |
| 规则正文 | 磁盘上的规则文件 | `inspect N` 操作时 | 从磁盘读取 |

**注意**：`list_rules()` 已返回包含 frontmatter 中 `confidence`、`risk_level` 和 `conflicts_with` 的 `metadata` 字典。当前 formatter 仅读取 `error_summary`、`category` 和 `status`。数据已存在，formatter 需要使用它。

## 验收标准

| # | 用户故事 | 优先级 | 验收标准 | 边界情况 |
|---|---------|--------|---------|---------|
| AC-1 | US-1 | Core | Given 展示中的审查包含 rule #2，When 用户回复 `inspect 2`，Then 系统返回完整规则正文（Context/Rule/Why/Example 各节）。索引 N 仅指编号的 staging 规则（参见 AC-7，verified 规则不编号）。 | 无效索引（0、-1、>S，其中 S = staging 规则数量）→ 返回 "Invalid rule index" 错误；规则文件已删除 → 返回 "Rule file not found"；规则正文为空 → 返回 "(empty rule body)" |
| AC-2 | US-2 | Core | Given 一条 staging 规则的 metadata confidence=0.55、risk_level=HIGH，When 该规则在审查通知中被列出，Then 输出行包含字符串 "conf 0.55" 和字符串 "HIGH"（或与 HIGH/MEDIUM/LOW 一一对应的风险指示符）。若 frontmatter 缺少 confidence，显示默认值 0.7。若缺少 risk_level，省略指示符。若 confidence 存在但非数字（如 "high"），视为缺失并显示默认 0.7。 | confidence 为 0.0 或 1.0；risk_level 缺失；confidence 和 risk_level 均缺失；confidence 非数字 → 视为缺失，显示 0.7 |
| AC-3 | US-3 | Core | Given 一条 staging 规则的 frontmatter `conflicts_with=["rule_a3x7k", "rule_b2m9p"]`，When 该规则被列出，Then 输出在规则摘要下方显示一行 "Conflicts with: rule_a3x7k, rule_b2m9p"。若冲突 ID 超过 3 个，显示前 3 个 + "+N more"。 | conflicts_with 为空 → 不显示冲突行；conflicts_with 引用已删除的规则 → 原样显示 ID（用户可自行调查）；conflicts_with 不是有效的 list/array → 跳过冲突行 |
| AC-4 | US-4 | Core | Given 审查中有 2 条 staging 规则，`get_audit_decision()` 返回 Δ=0.55 和 Δ=0.35，When 通知头部被展示，Then 显示 "Δ 0.35"（最小值）和以下精确标签之一："automatic"（对应 auto）、"review suggested"（对应 semi）或 "manual review required"（对应 manual）。若无 staging 规则，完全省略 Δ 行。 | 所有规则已 auto-committed（无 staging）→ 省略 Δ 行；`get_audit_decision()` 抛出异常 → 优雅地省略 Δ 行；单条 staging 规则 |
| AC-5 | US-5 | Core | Given DRAFT 报告包含 `## Key Findings` 节，其中有 3 个 markdown 列表项（以 `- ` 开头的行），每项遵循格式 `- [error_summary]: [proposed_rule_summary]`（错误→规则配对），When 审查通知被展示，Then DRAFT 节显示这些列表项，后跟一行 "(N chars — use 'show draft' for full report)"，其中 N 为完整 DRAFT 内容的字符数。若不存在 `## Key Findings` 节，显示 DRAFT 的前 3 个非空行。 | DRAFT 为空 → 显示 "DRAFT report is empty"；DRAFT 无 Key Findings 节 → 回退到前 3 行；DRAFT 仅有 1 个发现 → 显示那 1 个发现 |
| AC-6 | US-6 | Core | Given 审查中存在 DRAFT 报告，When 用户回复 `show draft`，Then 系统返回完整 DRAFT 内容。 | DRAFT 文件已删除 → 返回 "DRAFT file not found"；DRAFT 文件为空 → 返回 "(empty DRAFT)" |
| AC-7 | US-7 | Secondary | Given 审查中有 2 条 staging 规则（status=staging）和 1 条 verified 规则（status=verified），When 通知被展示，Then staging 规则出现在编号的 "Rules for Review" 节中，verified 规则出现在单独的 "Auto-committed" 节中，以不编号的单行条目显示。 | 0 条 staging 规则 → 显示 "No rules require review" + auto-committed 节；0 条 verified 规则 → 省略 auto-committed 节；所有规则均为 staging → 省略 auto-committed 节 |

## 约束与假设

- **风险指示符映射**：⚠ = HIGH，● = MEDIUM，○ = LOW。Unicode 符号在最小化终端上可能无法渲染；这是已接受的限制。测试可以使用文本标签（HIGH/MEDIUM/LOW）作为替代断言目标。
- **向后兼容**：现有操作（confirm/reject/revise/re-reflect）必须继续正常工作
- **新操作是追加**：`inspect N` 和 `show draft` 追加到操作列表末尾，不改变原有顺序
- **规则数量显示上限**：当前在 `_format_review_output` 第 56 行硬编码为 10 条规则（`rules[:10]`）。新设计应展示所有返回的规则（上限为 `list_rules` 的 20 条限制）。
- **性能**：`get_audit_decision` 是文件读取操作（无 LLM），每条规则调用一次是可接受的
- **优雅降级**：若 audit_decisions 或规则 metadata 不可用，formatter 必须优雅降级（展示可用部分，跳过不可用部分）
- **不新增 MCP 工具函数**：`inspect` 和 `show draft` 是在现有 `orchestrate_review_action` 函数中处理的新操作字符串，不是新的 MCP 端点
- **不修改 confirm/reject/re_reflect/revise 逻辑**：仅修改展示层和新增两个操作
- **DRAFT 格式耦合**：AC-5 依赖 R 子代理生成 `## Key Findings` 节。REFLECTOR.md prompt 模板应在 Phase 2 中更新以保证此标题。回退方案（前 3 行）处理不含此节的旧版 DRAFT。
- **默认 confidence**：若规则的 frontmatter 缺少 `confidence`，显示系统默认值 0.7。这与 `_tools_rules.py` 中 `write_rule` 的默认值一致。

## 待解决问题（全部已解决）

- ~~规则正文应该内联展示还是仅通过 inspect 查看？~~ → **已解决**：通过 `inspect N` 按需查看。内联展示在 3+ 条规则时会信息过载。渐进式披露。
- ~~DRAFT 摘要应由 R 提取还是由 formatter 提取？~~ → **已解决**：由 formatter 提取（无 LLM 成本）。解析 `## Key Findings` 节，回退到前 3 行。
- ~~如何可视化 Δ？~~ → **已解决**：头部单行显示 `Δ 0.35 → manual review required`。无需图表。
- ~~冲突信息应逐条规则展示还是汇总在头部？~~ → **已解决**：逐条规则内联展示。冲突是特定于某条规则的属性，不是全局属性。
