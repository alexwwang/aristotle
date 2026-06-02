# Intervention 合并到 Aristotle MCP 方案

**状态**: 方案设计  
**版本**: 1.0  
**日期**: 2025-05-28

---

## 1. 问题陈述

### 1.1 当前架构问题

当前存在三个独立系统：

```
packages/watchdog/     — TypeScript 运行时流程守卫（~3000 行）
aristotle_mcp/         — Python MCP 规则管理（20 工具）
intervention/          — Python 干预系统（11 模块，243 测试）
```

**核心问题**：
1. intervention/ 的 ViolationFilter（19 行）与 Watchdog Interceptor（~1500 行）严重不对等
2. intervention/ 的语义审查功能应复用 TDD Ralph Loop（已有 Reviewer subagent）
3. intervention/ 的确定性操作（回滚、KI、规则生成）与 aristotle_mcp/ 功能重叠
4. 维护三个 Python 包（aristotle_mcp, intervention, test）增加复杂度

### 1.2 合并动机

- **消除重复**：intervention/ 的 Git 操作、规则生成已在 aristotle_mcp/ 中存在
- **统一入口**：所有确定性操作通过 MCP 工具暴露，避免多包调用
- **简化架构**：从 3 个系统降为 2 个（Watchdog + Aristotle MCP）
- **消除困惑**：intervention/ 的角色长期不明确，合并后职责清晰

---

## 2. 目标架构

### 2.1 合并后架构

```
┌─────────────────────────────────────────────────────┐
│  Watchdog（TypeScript）                              │
│  ├── Interceptor（onToolBefore）— 同步拦截            │
│  ├── Observer（onToolAfter）— 结果观察                │
│  ├── Checkpoint — 状态转换验证（60+ 检查）            │
│  └── 触发 Ralph Loop（需要审查时）                    │
└─────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────┐
│  Ralph Loop（TDD 内置 Reviewer subagent）            │
│  ├── 代码质量审查（C/H/M severity）                   │
│  ├── 语义正确性审查（新增）                           │
│  └── 业务逻辑一致性审查（新增）                       │
└─────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────┐
│  Aristotle MCP（Python，扩展后）                      │
│  ├── 规则生命周期（10 工具）                          │
│  ├── 工作流编排（7 工具）                             │
│  ├── Git 操作（扩展：回滚）                           │
│  ├── KI 文档管理（新增）                              │
│  └── 规则生成（扩展：模板化）                         │
└─────────────────────────────────────────────────────┘
```

### 2.2 职责边界

| 系统 | 职责 | 不做的 |
|------|------|--------|
| **Watchdog** | 流程守卫、状态验证、触发审查 | 代码质量审查、语义分析 |
| **Ralph Loop** | 代码审查、语义审查、业务逻辑审查 | 规则管理、Git 操作 |
| **Aristotle MCP** | 规则管理、KI 文档、Git 回滚、工作流 | 代码审查、流程拦截 |

---

## 3. 模块迁移计划

### 3.1 删除的模块

| 模块 | 理由 |
|------|------|
| `intervention/src/watchdog.py` | ViolationFilter（19 行）被 Watchdog Interceptor 完全覆盖 |
| `intervention/src/intervention_coordinator.py` | 协调器无独立存在意义，逻辑分散到 MCP 工具和 Ralph Loop |
| `intervention/src/reflector.py` | MCP 集成 stub，直接实现到 aristotle_mcp |
| `intervention/src/prompt_validator.py` | 提示验证移到 Ralph Loop Reviewer |

### 3.2 合并到 aristotle_mcp/ 的模块

#### 3.2.1 RollbackEngine → `aristotle_mcp/git_ops.py`

**当前状态**：
- `intervention/src/rollback_engine.py`：Git 回滚（分支、stash、reset）
- `aristotle_mcp/git_ops.py`：Git 基础操作（init, add, commit, show）

**合并方案**：
```python
# aristotle_mcp/git_ops.py 新增
class RollbackManager:
    def rollback_to_checkpoint(self, repo_path: str, checkpoint: str) -> RollbackResult:
        """回滚到指定检查点"""
        
    def create_rollback_point(self, repo_path: str) -> str:
        """创建回滚点（stash + tag）"""
```

**MCP 工具暴露**：
- `create_rollback_point` — 在执行风险操作前创建回滚点
- `rollback_to_checkpoint` — 回滚到指定检查点
- `list_rollback_points` — 列出可用的回滚点

#### 3.2.2 KiDocManager → `aristotle_mcp/_tools_ki.py`

**当前状态**：
- `intervention/src/ki_doc_manager.py`：KI（Knowledge Integration）文档 CRUD

**合并方案**：
```python
# aristotle_mcp/_tools_ki.py 新增
@mcp.tool()
def write_ki_doc(project_path: str, content: str, severity: str) -> dict:
    """写入 KI 文档到项目目录"""
    
@mcp.tool()
def read_ki_docs(project_path: str, severity: Optional[str] = None) -> list:
    """读取项目的 KI 文档"""
    
@mcp.tool()
def update_ki_doc(doc_id: str, content: str) -> dict:
    """更新 KI 文档"""
```

**存储位置**：
- 项目级：`.opencode/ki-docs/` 或 `docs/ki/`
- 用户级：`~/.config/opencode/aristotle-ki/`

#### 3.2.3 RuleGenerator → `aristotle_mcp/_tools_rules.py`

**当前状态**：
- `intervention/src/rule_generator.py`：基于违规类型生成规则模板
- `aristotle_mcp/_tools_rules.py`：write_rule 工具（已有）

**合并方案**：
```python
# aristotle_mcp/_tools_rules.py 扩展
@mcp.tool()
def write_rule_from_template(
    violation_type: str,
    context: str,
    failed_skill: str,
    confidence: float = 0.7
) -> dict:
    """基于违规类型自动生成规则（使用 intervention 的模板）"""
    template = RuleTemplateRegistry.get(violation_type)
    content = template.render(context=context)
    return write_rule(
        content=content,
        category=violation_type,
        failed_skill=failed_skill,
        confidence=confidence
    )
```

#### 3.2.4 CommitGuard → `aristotle_mcp/_tools_rules.py`

**当前状态**：
- `intervention/src/commit_guard.py`：提交前验证（阶段、循环轮次）
- `aristotle_mcp/_tools_rules.py`：commit_rule 工具（已有）

**合并方案**：
```python
# aristotle_mcp/_tools_rules.py 扩展
@mcp.tool()
def commit_rule_with_guard(
    file_path: str,
    pipeline_context: Optional[dict] = None
) -> dict:
    """提交规则，附带 TDD 流程验证"""
    if pipeline_context:
        guard = CommitGuard(pipeline_context)
        if not guard.can_commit():
            return {
                "success": False,
                "error": f"提交被阻止: {guard.block_reason}"
            }
    return commit_rule(file_path)
```

#### 3.2.5 Committer → `aristotle_mcp/_tools_rules.py`

**当前状态**：
- `intervention/src/committer.py`：frontmatter schema 验证

**合并方案**：
```python
# aristotle_mcp/_tools_rules.py 扩展
# commit_rule 已包含 schema 验证，只需扩展验证逻辑
```

### 3.3 迁移到 Ralph Loop 的功能

| intervention 功能 | 新归属 | 理由 |
|-------------------|--------|------|
| PromptValidator | Ralph Loop Reviewer | Reviewer 检查提示质量 |
| 业务逻辑审查 | Ralph Loop Reviewer | Reviewer 检查需求→实现一致性 |
| 语义正确性 | Ralph Loop Reviewer | Reviewer 检查 API 使用、逻辑 |
| 上下文适配性 | Ralph Loop Reviewer | Reviewer 评估方案适合度 |

**Ralph Loop 扩展检查项**：
```
Reviewer 审查维度（新增）:
├── 代码质量（现有: C/H/M severity）
├── 测试覆盖（现有: P severity）
├── 实现完整性（现有: L severity）
├── 信息完整性（现有: I severity）
├── 语义正确性（新增: S severity）
│   └── API 使用是否正确、逻辑推理是否正确
├── 业务逻辑一致性（新增: B severity）
│   └── 实现是否匹配需求、是否有误解
└── 上下文适配性（新增: A severity）
    └── 方案是否适合问题域、是否有过度设计
```

---

## 4. 测试迁移计划

### 4.1 测试分类

| 测试文件 | 数量 | 迁移策略 |
|----------|------|----------|
| `test_watchdog.py` | ~20 | ❌ **删除**（ViolationFilter 已删除） |
| `test_intervention_coordinator.py` | ~40 | ❌ **删除**（协调器已删除） |
| `test_commit_guard.py` | ~30 | → `aristotle_mcp/tests/test_commit_guard.py` |
| `test_committer.py` | ~20 | → `aristotle_mcp/tests/test_committer.py` |
| `test_rollback_engine.py` | ~25 | → `aristotle_mcp/tests/test_git_ops_rollback.py` |
| `test_ki_doc_manager.py` | ~30 | → `aristotle_mcp/tests/test_ki_tools.py` |
| `test_prompt_validator.py` | ~25 | ❌ **删除**（移到 Ralph Loop） |
| `test_rule_generator.py` | ~25 | → `aristotle_mcp/tests/test_rule_templates.py` |
| `test_reflector.py` | ~15 | ❌ **删除**（直接实现到 MCP） |
| `test_intervention_integration.py` | ~10 | ❌ **删除**（无独立集成） |

### 4.2 测试保留统计

- **删除**：~85 个测试（watchdog, coordinator, reflector, prompt_validator, integration）
- **迁移**：~130 个测试到 aristotle_mcp/tests/
- **新增**：~50 个测试（MCP 工具接口测试）
- **合并后总测试**：~180 个（aristotle_mcp 原有 10 个 + 迁移 130 + 新增 50）

---

## 5. MCP 工具扩展设计

### 5.1 新增工具列表

| 工具名 | 来源 | 功能 |
|--------|------|------|
| `create_rollback_point` | RollbackEngine | 创建 Git 回滚点 |
| `rollback_to_checkpoint` | RollbackEngine | 回滚到指定检查点 |
| `list_rollback_points` | RollbackEngine | 列出回滚点 |
| `write_ki_doc` | KiDocManager | 写入 KI 文档 |
| `read_ki_docs` | KiDocManager | 读取 KI 文档 |
| `update_ki_doc` | KiDocManager | 更新 KI 文档 |
| `write_rule_from_template` | RuleGenerator | 基于模板生成规则 |
| `commit_rule_with_guard` | CommitGuard | 带 TDD 验证的提交 |

### 5.2 工具总数

- 原有：20 个
- 新增：8 个
- **合并后：28 个**

---

## 6. 实施步骤

### Phase 1: 准备（1 天）
1. 冻结 intervention/ 代码（停止开发）
2. 创建 feature branch：`merge-intervention-to-mcp`
3. 更新 design_plan/ 文档（本方案）

### Phase 2: 核心迁移（3 天）
1. 迁移 RollbackEngine → `git_ops.py`
2. 迁移 KiDocManager → `_tools_ki.py`
3. 迁移 RuleGenerator → `_tools_rules.py`
4. 迁移 CommitGuard → `_tools_rules.py`
5. 实现新增 MCP 工具（8 个）

### Phase 3: 测试迁移（2 天）
1. 迁移 130 个测试到 `aristotle_mcp/tests/`
2. 删除 85 个过时测试
3. 新增 50 个 MCP 接口测试
4. 确保所有测试通过

### Phase 4: 清理（1 天）
1. 删除 `intervention/` 目录
2. 更新 `pyproject.toml`（移除 intervention 包）
3. 更新 README（移除 intervention 引用）
4. 更新 CHANGELOG

### Phase 5: Ralph Loop 扩展（3 天，可并行）
1. 在 Reviewer 中新增 S/B/A severity 检查
2. 实现语义正确性检查
3. 实现业务逻辑一致性检查
4. 实现上下文适配性检查

**总工期：~7 天（不含 Ralph Loop 扩展）**

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 测试迁移遗漏 | 中 | 中 | 逐一核对测试清单，确保功能覆盖 |
| MCP 工具接口不兼容 | 低 | 高 | 新增工具保持与现有工具一致的参数风格 |
| Git 回滚逻辑差异 | 低 | 高 | 保留原有 RollbackEngine 的测试用例 |
| 外部依赖使用 intervention | 低 | 中 | 搜索全仓库引用，提供迁移指南 |
| Ralph Loop 扩展复杂度 | 中 | 中 | 分阶段实施，先 S severity，再 B/A |

---

## 8. 回滚计划

如果合并失败：
1. 保留 `intervention/` 目录的 git 历史（删除前打 tag：`pre-merge-intervention`）
2. 保留 feature branch：`merge-intervention-to-mcp`
3. 回滚策略：`git revert` 合并提交，恢复 intervention/ 目录

---

## 9. 结论

**干预系统（intervention/）没有独立存在的意义**。其功能：
- 检测层 → 被 Watchdog 覆盖
- 审查层 → 复用 Ralph Loop
- 操作层 → 合并到 Aristotle MCP

**合并后架构**：
- **Watchdog**（TypeScript）：流程守卫
- **Ralph Loop**（TDD 内置）：语义审查
- **Aristotle MCP**（Python）：规则 + KI + Git 操作

从 3 个系统降为 2 个，职责清晰，维护简单。

---

## 附录：intervention/ 文件清单

```
intervention/
├── src/
│   ├── __init__.py              → 删除（版本号移到 aristotle_mcp）
│   ├── watchdog.py              → 删除（功能被 Watchdog 覆盖）
│   ├── intervention_coordinator.py → 删除（逻辑分散）
│   ├── intervention_types.py    → 合并到 aristotle_mcp/models.py
│   ├── commit_guard.py          → 合并到 aristotle_mcp/_tools_rules.py
│   ├── committer.py             → 合并到 aristotle_mcp/_tools_rules.py
│   ├── rollback_engine.py       → 合并到 aristotle_mcp/git_ops.py
│   ├── ki_doc_manager.py        → 合并到 aristotle_mcp/_tools_ki.py
│   ├── prompt_validator.py      → 删除（移到 Ralph Loop）
│   ├── rule_generator.py        → 合并到 aristotle_mcp/_tools_rules.py
│   └── reflector.py             → 删除（直接实现到 MCP）
├── tests/
│   ├── test_watchdog.py         → 删除
│   ├── test_intervention_coordinator.py → 删除
│   ├── test_commit_guard.py     → 迁移
│   ├── test_committer.py        → 迁移
│   ├── test_rollback_engine.py  → 迁移
│   ├── test_ki_doc_manager.py   → 迁移
│   ├── test_prompt_validator.py → 删除
│   ├── test_rule_generator.py   → 迁移
│   ├── test_reflector.py        → 删除
│   └── test_intervention_integration.py → 删除
└── docs/                        → 已移到 local-assets
```
