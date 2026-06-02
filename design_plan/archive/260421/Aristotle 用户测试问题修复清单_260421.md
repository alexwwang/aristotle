# Aristotle 用户测试问题修复清单

> 来源：Aristotle的用户测试问题反馈_260421.md + 代码审查
> 日期：2026-04-21
> 状态：待实施

---

## 问题总览

| # | 问题 | 优先级 | 类型 | 影响范围 |
|---|------|--------|------|----------|
| 1 | SKILL.md 内容注入主 session 上下文 | P3 | 体验优化 | SKILL.md, ROADMAP.md |
| 2 | 模型输出协议执行思考过程 | P2 | Prompt 遗漏 | SKILL.md, REFLECT.md |
| 3 | Shell 语法 `$(date +%s)` 注入主 session | P1 | Protocol Bug | REFLECT.md, REFLECTOR.md |
| 4 | State file JSON 内容泄露到主 session | P2 | Prompt 遗漏 | REFLECT.md, SKILL.md |
| 5 | Reflector session 消失导致 DRAFT 无法 review | P0 | 关键架构缺陷 | REFLECTOR.md, REFLECT.md, REVIEW.md |
| 6 | Review 只能在发起反思的主 session 中进行 | P1 | 设计缺陷 | 依赖 #5 解决 |
| 7 | Checker 流程顺序错误 | P0 | 关键设计缺陷 | REFLECT.md, REVIEW.md, CHECKER.md |
| 8 | 首次安装未初始化 repo | P0 | 功能 Bug | install.sh, install.ps1, server.py |
| A | GEAR.md Δ 公式与实现不一致 | P3 | 协议-实现对齐 | evolution.py (以协议为准) |
| B | GEAR.md frontmatter 字段在 MCP 中缺失 | P3 | 功能完整度 | models.py, server.py |

---

## 详细问题记录

### 问题 1：SKILL.md 内容注入主 session 上下文
- **现象**：omo 模式下触发 `/aristotle`，SKILL.md 全文（90行）被加载到主 session
- **设计现状**：OpenCode skill 机制决定，description 匹配后自动注入 SKILL.md
- **影响**：浪费 context 预算，在 omo 模式下触发思考泄露（与 #2 联动）
- **ROADMAP.md V1.3b** 已识别但未实施

### 问题 2：模型输出协议执行思考过程
- **现象**：模型输出 "根据协议，对当前会话执行 REFLECT 操作" 等内部推理
- **根因**：SKILL.md 缺少 "不输出协议推理" 的约束
- **设计原则**：O 的非必要输出不应进入主 session 上下文

### 问题 3：Shell 语法注入
- **现象**：主 session 出现 `$ date +%s` 和时间戳数值
- **根因**：REFLECT.md STEP F4 使用 `"id": "rec_$(date +%s)"` shell 语法
- **正确做法**：rule_id 应由 MCP write_rule() 生成，Reflector 不应负责 ID 分配
- **用户反馈**：时间戳获取交给 MCP 更合理

### 问题 4：State file 内容泄露
- **现象**：aristotle-state.json 的 JSON 内容被 dump 到主 session
- **根因**：缺少 "不展示 state file 内容" 的约束
- **设计原则**：state file 是内部基础设施，用户不应看到原始 JSON

### 问题 5：Reflector session 消失导致 DRAFT 无法 review
- **现象**：`/aristotle review N` 报 "Reflector session no longer exists"
- **根因**：DRAFT 只存在于易失性 session messages 中，无磁盘持久化
- **约束**：O 不能调用 background_output 获取 DRAFT（上下文污染风险），应由 Reflector 自行持久化
- **需要原型验证**：Reflector subagent 是否能写文件到 `~/.config/opencode/aristotle-drafts/`

### 问题 6：Review 只能在主 session 中进行
- **现象**：`/aristotle review N` 必须在触发反思的同一 session 执行
- **根因**：REVIEW.md 依赖 session_read 获取 DRAFT，且 REVIEW.md 在主 session 上下文中加载
- **与 #5 联动**：DRAFT 持久化后，review 可基于磁盘文件，不依赖原始 session

### 问题 7：Checker 流程顺序错误
- **现状**：Reflector → 用户 review → 用户 confirm → Checker
- **应改为**：Reflector → Checker schema 校验（自动）→ 用户 review → 确认 → 写入规则
- **理由**：DRAFT 应在呈现给用户前就符合 schema，避免用户看到残缺内容
- **需要拆分 CHECKER.md**：SCHEMA_CHECK（自动，前置）+ CONTENT_CHECK（用户确认时）

### 问题 8：首次安装未初始化 repo
- **现象**：新安装后 write_rule 报 repo 未初始化
- **根因**：install.sh 和 install.ps1 没有调用 init_repo_tool()
- **server.py write_rule()** 不检查 git repo 是否存在

### 问题 A：GEAR.md Δ 公式与实现不一致
- **GEAR.md**：Δ = confidence × (1 − risk_weight) × normalize(log(sample_size + 1))
- **evolution.py**：Δ = confidence × (1 − risk_weight)
- **决策**：以协议（GEAR.md）为准，代码实现落后，后续补齐

### 问题 B：GEAR.md frontmatter 字段缺失
- **GEAR.md** 定义了 success_rate, failure_rate, sample_size, conflicts_with 等字段
- **models.py / server.py** 未实现这些字段的写入和更新
- **决策**：P3 优先级，按 ROADMAP V1.2 进化等级计划推进

---

## 设计原则（来自用户反馈）

> **O 的任何输出会进入主 session 上下文。设计原则：如无必要（需要通知用户的必要信息），不要将中间内容注入到主 session 的上下文中。**

具体应用：

| 场景 | O 应该输出的 | O 不应该输出的 |
|------|-------------|---------------|
| Reflect 触发 | 一行通知：task_id + session_id + review 命令 | 协议推理、执行计划、state file 内容 |
| Reflector 完成 | 一行通知："done, review N" | DRAFT 内容、分析过程 |
| Review 加载 | DRAFT 报告（用户主动请求） | MCP 调用细节、frontmatter 原始数据 |
| Checker 校验 | 校验结果摘要 | schema 验证的中间步骤 |
| Learn 检索 | 压缩后的教训摘要 | 原始规则内容、查询参数、评分过程 |
