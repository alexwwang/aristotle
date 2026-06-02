# 技术方案 M7: Feedback Signal 追踪 + Δ log-normalization

**日期:** 2026-04-22
**前置文档:** GEAR Phase 2 产品方案_260422.md §四
**范围:** `evolution.py` + `config.py` + `frontmatter.py`（models.py 已在 M6 技术方案中覆盖）
**不涉及:** M6 feedback 闭环、M5 检索、测试代码

---

## 一、模块概述

M7 包含两个紧密相关的功能：

1. **Feedback Signal 写入机制：** M6 的 `report_feedback` 负责更新 `sample_size`/`failure_rate`/`success_rate`。M7 补充初始值设置——`write_rule` 创建规则时初始化 feedback signal 字段。
2. **Δ log-normalization：** `evolution.py` 的 `compute_delta` 新增 `sample_size` 参数，启用基于证据量的归一化因子。

### 变更统计

| 文件 | 行数 | 性质 |
|------|------|------|
| `evolution.py` | +~22 行 | `compute_delta` 扩展 sample_size 参数 + 负值校验 |
| `config.py` | +~2 行 | `MAX_SAMPLES` 常量 |
| `_tools_rules.py` | +~5 行 | `get_audit_decision` 传入 sample_size + 类型防御 |
| `models.py` | 0 行 | M6 技术方案已覆盖（含 `to_frontmatter_string` 的 `sample_size→None` 转换） |

---

## 二、`evolution.py` 变更

### 2.1 `compute_delta` 签名变更

**现有签名（L15）：**

```python
def compute_delta(confidence: float, risk_level: str) -> float:
```

**新签名：**

```python
def compute_delta(
    confidence: float,
    risk_level: str,
    sample_size: int | None = None,
) -> float:
```

### 2.2 完整实现

```python
"""Delta decision engine for GEAR audit-level routing.

Computes Δ = confidence × (1 − risk_weight) and maps the result to
an audit level (auto / semi / manual).

M7 extension: optional log-normalization based on sample_size.
"""

from __future__ import annotations

import math

from aristotle_mcp.config import AUDIT_THRESHOLDS, RISK_WEIGHTS


def compute_delta(
    confidence: float,
    risk_level: str,
    sample_size: int | None = None,
) -> float:
    """Compute the Δ decision factor with optional log-normalization.

    Args:
        confidence: R's confidence score for the rule (0.0 – 1.0).
        risk_level: One of "high", "medium", "low" (from RISK_MAP).
        sample_size: Rule's application count.
            None → use legacy formula (Δ_raw only), preserves backward compat.
            0    → log-normalization active, factor = 0, Δ = 0 (manual).
            N>0  → log-normalization active, factor scales with evidence.

    Returns:
        Δ value clamped to [0.0, 1.0].

    Raises:
        ValueError: If risk_level is not recognised or confidence out of range.
    """
    if risk_level not in RISK_WEIGHTS:
        raise ValueError(
            f"Unknown risk_level '{risk_level}'. Must be one of {list(RISK_WEIGHTS)}"
        )
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence must be between 0.0 and 1.0, got {confidence}")
    if sample_size is not None and sample_size < 0:
        raise ValueError(f"sample_size must be >= 0, got {sample_size}")

    risk_weight = RISK_WEIGHTS[risk_level]
    delta_raw = confidence * (1.0 - risk_weight)

    # Legacy mode: no normalization (backward compatible)
    if sample_size is None:
        return max(0.0, min(1.0, delta_raw))

    # GEAR v1.1 mode: log-normalization
    # math.log is natural log (ln). Base is irrelevant since both
    # numerator and denominator use the same base.
    from aristotle_mcp.config import MAX_SAMPLES
    norm_factor = math.log(sample_size + 1) / math.log(MAX_SAMPLES + 1)
    delta = delta_raw * norm_factor
    return max(0.0, min(1.0, delta))
```

### 2.3 向后兼容性保证

```python
# 现有调用（Phase 1，无 sample_size）：
compute_delta(confidence=0.9, risk_level="low")
# sample_size=None → 旧公式 → 返回 0.72 (auto)
# 行为完全不变 ✓

# M6 feedback 更新后（显式传入 sample_size）：
compute_delta(confidence=0.9, risk_level="low", sample_size=15)
# log-norm 生效 → 0.72 × 0.937 ≈ 0.675 (semi)
# 渐进式启用 ✓

# 新规则（sample_size=0）：
compute_delta(confidence=0.9, risk_level="low", sample_size=0)
# norm_factor = 0 → Δ = 0 (manual)
# 强制首次人工审核 ✓
```

### 2.4 `get_audit_decision` 变更

现有 `get_audit_decision`（在 `_tools_rules.py` 中）需要检查是否传入 `sample_size`：

**当前代码（`_tools_rules.py` 中）：**

```python
def get_audit_decision(file_path: str) -> dict:
    # ... 读取 frontmatter ...
    delta = compute_delta(confidence=confidence, risk_level=risk_level)
    # ...
```

**需变更为：**

```python
def get_audit_decision(file_path: str) -> dict:
    # ... 读取 frontmatter ...
    raw_ss = metadata.get("sample_size", None)  # None=未启用
    sample_size = int(raw_ss) if raw_ss is not None else None  # 类型防御
    delta = compute_delta(
        confidence=confidence,
        risk_level=risk_level,
        sample_size=sample_size,
    )
    # ...
```

**注意：** `sample_size=0` 在 frontmatter 中不存在（M6 models.py 设计：`sample_size=0` 时在 `to_frontmatter_string` 的 md dict 中转为 `None`，`if value is not None` 检查会跳过）。`metadata.get("sample_size", None)` 对新规则返回 `None`（旧公式），对 M6 更新过的规则返回 `int`（log-norm 生效）。这正是期望的渐进式启用行为。

**⚠ `to_frontmatter_string` 需显式处理：** M6 技术方案中已将 `sample_size=0` 和 `feedback_count=0` 在 md dict 中转为 `None`（`"sample_size": metadata.sample_size if metadata.sample_size > 0 else None`）。这是正确的。如果此转换遗漏，`0` 是 `not None` 的 int，会被写入 frontmatter，导致 `get_audit_decision` 读取到 `0`，传入 `compute_delta(sample_size=0)`，强制所有新规则为 manual。

**⚠ `sample_size=0` "强制 manual" 是 API 理论能力，不是默认行为：** 由于 `write_rule` 不写入 `sample_size: 0`（转为 None 跳过），`get_audit_decision` 对新规则永远读到 `None` → 旧公式。`sample_size=0` 仅在显式写入时生效（如测试场景或 Phase 3 手动标注）。产品方案 §四 4.3 的 "强制首次人工审核" 描述是 API 能力而非默认行为。

### 2.5 Sample Size 效果表（验证参考）

| sample_size | log(N+1) | normalize | Δ_raw=0.15 (high) | Δ_raw=0.50 (med) | Δ_raw=0.80 (low) |
|-------------|----------|-----------|-------------------|------------------|------------------|
| 0 | 0.00 | 0.000 | 0.000 (manual) | 0.000 (manual) | 0.000 (manual) |
| 1 | 0.69 | 0.227 | 0.034 (manual) | 0.114 (manual) | 0.182 (manual) |
| 3 | 1.39 | 0.455 | 0.068 (manual) | 0.228 (manual) | 0.364 (manual) |
| 5 | 1.79 | 0.588 | 0.088 (manual) | 0.294 (manual) | 0.471 (semi) |
| 10 | 2.40 | 0.789 | 0.118 (manual) | 0.395 (manual) | 0.631 (semi) |
| 20 | 3.04 | 1.000 | 0.150 (manual) | 0.500 (semi) | 0.800 (auto) |

MAX_SAMPLES=20, log = natural log.

**关键洞察：** high-risk 规则即使在 sample_size=20 时也仅为 0.150 (manual)，永远无法 auto。这符合 GEAR 设计意图。

---

## 三、`config.py` 变更

```python
# M7: Δ log-normalization
MAX_SAMPLES = 20  # log-normalization 的样本上限
```

---

## 四、`_tools_rules.py` 变更

### 4.1 `write_rule` 初始化 feedback signal

在 `write_rule` 函数中，创建规则时 `sample_size` 默认为 `0`（dataclass 默认值），`success_rate` 和 `failure_rate` 默认为 `None`。

**无需额外代码**——`RuleMetadata` dataclass 的默认值已正确设置：
- `sample_size: int = 0`
- `success_rate: float | None = None`
- `failure_rate: float | None = None`

`to_frontmatter_string` 中 `sample_size=0` 和 `success_rate=None`/`failure_rate=None` 不会写入 frontmatter（`if value is not None` 检查，且 `sample_size=0` 在 md dict 中被转为 `None`）。

**结论：** `write_rule` 不需修改，dataclass 默认值 + 序列化逻辑已覆盖。

### 4.2 `get_audit_decision` 传递 sample_size

见 §2.4。需在调用 `compute_delta` 时从 frontmatter 读取并传入 `sample_size`。

---

## 五、frontmatter.py 确认

**已验证无需变更：** `update_frontmatter_field` 是通用函数，接受任意 key-value 写入 frontmatter。M6 的 `report_feedback` 通过以下调用写入新字段：

```python
update_frontmatter_field(rule_path, "sample_size", str(new_sample))
update_frontmatter_field(rule_path, "failure_rate", str(new_failure_rate))
update_frontmatter_field(rule_path, "success_rate", str(new_success_rate))
update_frontmatter_field(rule_path, "feedback_count", str(current_count + 1))
```

这些字段名在 YAML frontmatter 中是合法的字符串 key，`update_frontmatter_field` 的正则替换逻辑无需修改。

---

## 六、实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | `config.py` 新增 `MAX_SAMPLES` | 无 |
| 2 | `evolution.py` `compute_delta` 扩展 | 步骤 1 |
| 3 | `_tools_rules.py` `get_audit_decision` 传入 sample_size | 步骤 2 |
| 4 | 验证 models.py 默认值正确（M6 已覆盖） | 无 |
| 5 | 验证 frontmatter.py 无需变更 | 无 |

**关键路径：** 步骤 1→2→3

---

## 七、验证

| # | 验证项 | 方法 |
|---|--------|------|
| V1 | `compute_delta(confidence=0.9, risk_level="low")` 无 sample_size 返回旧值 0.72 | pytest |
| V2 | `compute_delta(confidence=0.9, risk_level="low", sample_size=0)` 返回 0.0 | pytest |
| V3 | `compute_delta(confidence=0.9, risk_level="low", sample_size=20)` 返回 0.8 | pytest |
| V4 | `compute_delta(confidence=0.9, risk_level="high", sample_size=20)` 返回 0.15 (manual) | pytest |
| V5 | `get_audit_decision` 从 frontmatter 读取 sample_size 并传入 | pytest: 模拟 frontmatter |
| V6 | 新规则（无 sample_size frontmatter）使用旧公式 | pytest: 空文件 |
| V7 | 现有 227 pytest + 98 static 全部通过 | 回归测试 |
