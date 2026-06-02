# 技术方案 M6: Error Feedback 闭环

**日期:** 2026-04-22
**前置文档:** GEAR Phase 2 产品方案_260422.md §三
**范围:** 新增 `_tools_feedback.py` + `models.py` 扩展 + `SKILL.md` 扩展
**不涉及:** M5 检索、M7 Δ log-norm、M9 conflicts_with、测试代码

---

## 一、模块概述

M6 实现 GEAR 协议 §Core Workflow Step 5-6 的 Error Feedback 闭环：当 L 应用了规则但仍出错时，L 调用 `report_feedback` MCP 工具报告反馈，系统更新 feedback signal 并可选触发新的 reflect 流程。

### 变更统计

| 文件 | 行数 | 性质 |
|------|------|------|
| `_tools_feedback.py` | +~80 行 | 新增文件：`report_feedback` MCP 工具 |
| `models.py` | +~8 行 | RuleMetadata 新增 feedback signal 字段 |
| `_orch_prompts.py` | +~2 行 | 导出 `_build_reflector_prompt` 已有 |
| `SKILL.md` | +~8 行 | AUTO-FEEDBACK 触发条件 |

### 新增 MCP 工具

| 工具 | 用途 |
|------|------|
| `report_feedback` | L 报告规则应用后仍出错，记录 feedback signal，可选触发 reflect |

---

## 二、文件变更详情

### 2.1 `models.py` — RuleMetadata 扩展

**变更位置：** `RuleMetadata` dataclass（L52-70），在现有字段之后追加。

```python
@dataclass
class RuleMetadata:
    id: str
    status: str = "pending"
    scope: str = "user"
    project_hash: str | None = None
    category: str = ""
    confidence: float = 0.7
    risk_level: str = "medium"
    source_session: str | None = None
    message_range: str | None = None
    created_at: str = field(default_factory=_now_iso)
    verified_at: str | None = None
    verified_by: str | None = None
    rejected_at: str | None = None
    rejected_reason: str | None = None
    intent_tags: dict | None = None
    failed_skill: str | None = None
    error_summary: str | None = None

    # ── M6/M7: Feedback Signal ──
    success_rate: float | None = None      # 成功率 (0.0–1.0)
    failure_rate: float | None = None      # 失败率 (0.0–1.0)
    sample_size: int = 0                   # 规则应用次数
    feedback_count: int = 0                # feedback→reflect 累计递归深度

    # ── M9: Rule Relations ──
    conflicts_with: list[str] | None = None  # 冲突规则 ID 列表
```

**`to_frontmatter_string` 变更：** 在 `md` dict 中追加新字段：

```python
    md = {
        # ... 现有字段 ...
        "intent_tags": metadata.intent_tags,
        "failed_skill": metadata.failed_skill,
        "error_summary": metadata.error_summary,
        # M6/M7 新增
        "success_rate": metadata.success_rate,
        "failure_rate": metadata.failure_rate,
        "sample_size": metadata.sample_size if metadata.sample_size > 0 else None,
        "feedback_count": metadata.feedback_count if metadata.feedback_count > 0 else None,
        # M9 新增
        "conflicts_with": metadata.conflicts_with,
    }
```

**注意：** `sample_size=0` 和 `feedback_count=0` 是默认值，不写入 frontmatter（通过 `if value is not None` 过滤），避免污染现有规则文件。将 `0` 转为 `None` 后，`to_frontmatter_string` 中已有的 `if value is not None` 检查会自动跳过。

**`from_frontmatter_dict` 变更：** 追加新字段读取：

```python
def from_frontmatter_dict(data: dict) -> RuleMetadata:
    return RuleMetadata(
        # ... 现有字段 ...
        intent_tags=data.get("intent_tags"),
        failed_skill=data.get("failed_skill"),
        error_summary=data.get("error_summary"),
        # M6/M7 新增（含类型强制转换，防止手动编辑 YAML 产生 str 类型）
        success_rate=data.get("success_rate"),
        failure_rate=data.get("failure_rate"),
        sample_size=int(data.get("sample_size", 0) or 0),
        feedback_count=int(data.get("feedback_count", 0) or 0),
        # M9 新增
        conflicts_with=data.get("conflicts_with"),
    )
```

### 2.2 新增 `_tools_feedback.py`

```python
"""Error Feedback tool for GEAR Error Feedback loop (M6)."""

from __future__ import annotations

import json
import uuid

from aristotle_mcp.config import resolve_repo_dir, MAX_FEEDBACK_REFLECT
from aristotle_mcp.frontmatter import (
    read_frontmatter_raw,
    update_frontmatter_field,
)
from aristotle_mcp._orch_state import _save_workflow, _next_sequence
from aristotle_mcp._orch_prompts import _build_reflector_prompt
from aristotle_mcp._tools_rules import list_rules


def report_feedback(
    rule_ids: list[str],
    error_description: str,
    context: str = "",
    session_id: str = "",
    auto_reflect: bool = True,
    project_directory: str = "",
) -> dict:
    """Learner 报告规则应用后仍出错。

    记录 feedback signal，更新 rule 的 failure_rate/sample_size，
    可选触发新的 reflection cycle。

    Args:
        rule_ids: 应用了哪些规则 ID
        error_description: 仍然出现的错误描述
        context: 错误上下文（代码片段、命令输出等）
        session_id: 报告的 session ID
        auto_reflect: 是否自动触发新 reflect
        project_directory: 项目目录（传递给 Checker prompt）

    Returns dict with action, workflow_id, and optional fields.
    """
    if not rule_ids:
        return {"action": "notify", "message": "🦉 No rule_ids provided."}

    if not error_description:
        return {"action": "notify", "message": "🦉 Need error_description."}

    # ── 0. 查找规则并缓存结果（避免重复 list_rules 调用） ──
    rule_cache: dict[str, list[dict]] = {}
    feedback_depth = 0
    for rule_id in rule_ids:
        rules = list_rules(
            status_filter="verified",
            keyword=rule_id,
            limit=1,
        )
        rule_cache[rule_id] = rules.get("rules", [])
        for r in rule_cache[rule_id]:
            meta = r.get("metadata", {})
            depth = meta.get("feedback_count", 0)
            feedback_depth = max(feedback_depth, depth)

    # 验证至少有一条规则匹配
    found_any = any(rule_cache.values())
    if not found_any:
        return {"action": "notify", "message": "🦉 No verified rules found for given rule_ids."}

    # ── 1. 更新 feedback signal（始终执行，不受 depth 限制） ──
    for rule_id in rule_ids:
        for r in rule_cache.get(rule_id, []):
            rule_path = r.get("path", "")
            meta = r.get("metadata", {})

            current_sample = meta.get("sample_size", 0)
            current_failures = meta.get("failure_rate", 0.0) * current_sample

            new_sample = current_sample + 1
            new_failures = current_failures + 1
            new_failure_rate = round(new_failures / new_sample, 3)
            new_success_rate = round(1.0 - new_failure_rate, 3)

            # 写入 frontmatter
            update_frontmatter_field(rule_path, "sample_size", str(new_sample))
            update_frontmatter_field(rule_path, "failure_rate", str(new_failure_rate))
            update_frontmatter_field(rule_path, "success_rate", str(new_success_rate))

    # ── 2. 检查递归深度（仅限制 workflow 创建，不影响 signal 更新） ──
    if auto_reflect and feedback_depth >= MAX_FEEDBACK_REFLECT:
        return {
            "action": "notify",
            "message": f"🦉 Feedback recorded, but max feedback reflect ({MAX_FEEDBACK_REFLECT}) "
                       f"reached for these rules. Manual review needed: /aristotle",
        }

    if not auto_reflect:
        return {
            "action": "notify",
            "message": f"🦉 Feedback recorded for {len(rule_ids)} rule(s). "
                       f"sample_size updated.",
        }

    # ── 3. 更新 feedback_count（在创建 workflow 之前，确保原子性） ──
    for rule_id in rule_ids:
        for r in rule_cache.get(rule_id, []):
            rule_path = r.get("path", "")
            meta = r.get("metadata", {})
            current_count = meta.get("feedback_count", 0)
            update_frontmatter_field(
                rule_path, "feedback_count", str(current_count + 1),
            )

    # ── 4. 创建 reflect workflow ──
    workflow_id = f"wf_{uuid.uuid4().hex[:16]}"
    sequence = _next_sequence()

    r_prompt = _build_reflector_prompt(
        target_session_id=session_id or "feedback",
        focus_hint=f"errors: {error_description[:200]}",
        sequence=sequence,
        project_directory=project_directory,
    )

    _save_workflow(workflow_id, {
        "phase": "reflecting",
        "command": "reflect",
        "source": "feedback",
        "target_session_id": session_id,
        "sequence": sequence,
        "pending_role": "R",
        "record_created": False,
        "feedback_rule_ids": rule_ids,
        "feedback_error": error_description,
        "re_reflect_count": feedback_depth,
        "project_directory": project_directory,
    })

    return {
        "action": "fire_sub",
        "workflow_id": workflow_id,
        "sub_prompt": r_prompt,
        "sub_role": "R",
        "notify_message": "🦉 Feedback recorded. Launching new reflection...",
    }


def register_feedback_tools(mcp) -> None:
    """Register report_feedback with the MCP server."""
    mcp.tool()(report_feedback)
```

### 2.3 `server.py` — 注册新工具

在 `server.py` 中导入并注册 `_tools_feedback`：

```python
from aristotle_mcp._tools_feedback import register_feedback_tools

# 在现有注册函数之后追加
register_feedback_tools(mcp)
```

### 2.4 `config.py` — 新增常量

```python
MAX_FEEDBACK_REFLECT = 3  # feedback→reflect 最大递归深度
```

### 2.5 `SKILL.md` 扩展

在 SKILL.md 末尾追加（≤60 行约束内）：

```markdown
## AUTO-FEEDBACK
When you detect that:
1. You previously ran /aristotle learn <query>
2. You applied the suggested rules
3. The error STILL occurred (same or similar error pattern)

Then call MCP report_feedback(rule_ids=[...], error_description="...", auto_reflect=true)
```

---

## 三、递归深度防护

```
report_feedback(auto_reflect=True)
        │
  检查 feedback_count
        │
  ┌─────┴──────┐
  │            │
  < 3        ≥ 3
  │            │
  │            ▼
  │         notify("Max feedback reflect reached")
  │
  ▼
  更新 feedback signal (sample_size, failure_rate, success_rate)
        │
        ▼
  feedback_count += 1（仅 auto_reflect=True 且实际触发时递增）
        │
        ▼
  创建 workflow state (phase: reflecting)
        │
        ▼
  return fire_sub(R)
```

**关键约束：**

1. `feedback_count` 仅在 `auto_reflect=True` **且实际触发 reflect** 时递增。`auto_reflect=False` 的纯反馈报告不消耗深度配额
2. 递归检查取所有 `rule_ids` 中的最大 `feedback_count`——如果任何一条规则已达上限，整个反馈被拒绝
3. `MAX_FEEDBACK_REFLECT=3` 意味着每条规则最多触发 3 次 feedback→reflect 循环

---

## 四、Feedback Signal 更新逻辑

```
report_feedback(rule_ids=["rec_001", "rec_002"])

  rec_001: sample_size=2, failure_rate=0.5
    → current_failures = 0.5 × 2 = 1
    → new_sample = 3, new_failures = 2
    → failure_rate = 2/3 ≈ 0.667
    → success_rate = 1/3 ≈ 0.333

  rec_002: sample_size=0 (新规则，首次 feedback)
    → current_failures = 0.0 × 0 = 0
    → new_sample = 1, new_failures = 1
    → failure_rate = 1/1 = 1.000
    → success_rate = 0/1 = 0.000
```

**精度：** 所有 `float` 值 round 到 3 位小数。写入 frontmatter 时转为 `str`（YAML scalar）。

---

## 五、workflow state 关键字段

`report_feedback` 创建的 workflow state 包含：

```json
{
    "phase": "reflecting",
    "command": "reflect",
    "source": "feedback",           // 标记来源
    "target_session_id": "ses_xxx",
    "sequence": 5,
    "pending_role": "R",
    "record_created": false,
    "feedback_rule_ids": ["rec_001"],
    "feedback_error": "Connection pool timeout...",
    "re_reflect_count": 1           // 继承自 rule 的 feedback_count
}
```

**`source: "feedback"`** — 区别于手动触发的 `orchestrate_start("reflect")`。R→C 完成后 `orchestrate_on_event` 的 checking handler 不需要区分来源，统一处理。

---

## 六、实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | `models.py` 新增字段 + 序列化/反序列化 | 无 |
| 2 | `config.py` 新增 `MAX_FEEDBACK_REFLECT` | 无 |
| 3 | 新增 `_tools_feedback.py` | 步骤 1, 2 |
| 4 | `server.py` 注册新工具 | 步骤 3 |
| 5 | `frontmatter.py` 确认 `update_frontmatter_field` 支持新字段 | 步骤 1 |
| 6 | `SKILL.md` 新增 AUTO-FEEDBACK | 无 |

**关键路径：** 步骤 1→3→4

---

## 七、验证

| # | 验证项 | 方法 |
|---|--------|------|
| V1 | `report_feedback` 更新 `sample_size` 和 `failure_rate` | pytest: 验证 frontmatter 写入值 |
| V2 | `auto_reflect=False` 只更新 signal，不创建 workflow | pytest: 验证返回 notify |
| V3 | `auto_reflect=True` 创建 workflow + 返回 fire_sub | pytest: 验证 workflow state |
| V4 | `feedback_count >= MAX_FEEDBACK_REFLECT` 时拒绝 reflect | pytest: 设置 feedback_count=3 |
| V5 | `feedback_count` 仅在 auto_reflect=True 时递增 | pytest: 对比 True/False 场景 |
| V6 | RuleMetadata 新字段正确序列化/反序列化 | pytest: write→read roundtrip |
| V7 | 现有 227 pytest + 98 static 全部通过 | 回归测试 |
