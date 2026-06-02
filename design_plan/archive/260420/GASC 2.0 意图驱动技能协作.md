以下是汇总了我们所有讨论成果的 **GASC 2.0 (Git-based Agent Skill Coordinator) 技术方案全文**。

# ---

**GASC 2.0 技术方案：意图驱动的智能体技能协作架构**

## **1\. 系统愿景**

GASC 2.0 是一个基于 Git-MCP 协议的、服务导向型的知识系统。它将“技能生产”与“任务执行”解耦，通过 **O (Orchestrator)** 提供的“意图检索服务”，让 **L (Learner)** 能够针对性地学习历史错误教训，从而在复杂任务中实现自愈与进化。

## ---

**2\. 角色职责与核心能力 (Role Specs)**

### **2.1 Agent O (Orchestrator \- 知识服务提供者)**

* **核心功能：** 维护“意图索引库”与“反思数据库”；响应 L 的检索请求，以及根据主session中遇到的错误反馈信息（来自用户或L）拉起R进行反思任务。  
* **决策能力：** 基于 evolution\_stats.json 决定审核级别（Apprentice/Peer/Expert）。  
* **服务逻辑：** 接收 L 提交的意图标签、失败技能及错误总结或它们的组合，生成检索规则，并返回关联的 Skill 快照及对应的“错误反思摘要”。注意：这里的意图分析、检索规则生成和检索任务需要再抽象出一个Agent S，即档案管理员的角色，由O决定合适拉起S并获得结果。

### **2.2 Agent R (Resource Creator \- 资源生产者)**

* **核心功能：** 编写 Skill 文档。  
* **关键任务：** **撰写意图标签 (Intent Tags)**。R 必须在 Frontmatter 中精准定义该技能适用的场景（KV 对）。  
* **物理操作：** 通过 MCP 执行原子化写入（.tmp \-\> replace）。

### **2.3 Agent C (Checker \- 审计与固化者)**

* **核心功能：** 审核 Skill 内容及 **意图标签的准确性**。  
* **关键任务：** 纠正 R 的意图描述，执行 git commit 将其推入稳态。  
* **状态管理：** 负责将文件从 pending 推进到 verified 或标记为 rejected。

### **2.4 Agent L (Learner \- 任务执行者)**

* **核心功能：** 完成具体的业务任务。  
* **关键逻辑：**  
  * **增量学习评估：** 在执行每项具体任务前，评估是否有必要向 O 学习新教训。  
  * **意图生成：** 基于当前任务理解生成 intent\_tags 提交给 O。  
  * **反馈机制：** 不负责反思，仅反馈应用“反思结果”过程中遇到的错误（反馈给 O/C 进行后续处理）。

### **2.5 Agent S （Searcher \- 档案检索远）**

* **核心功能：** 从O处接收检索需求，并转换为mcp可通过正则匹配的查询条件。  
* **关键任务：**获取mcp的检索内容，交给O评估哪些需要新增入L的上下文，并将结果反馈给L。  
* **关键逻辑：将O转发自L的错误总结转换为mcp可查询的条件组合**

## ---

**3\. 数据协议规范 (Data Protocol)**

### **3.1 技能 Frontmatter (Skill Metadata)**

反思文档的 Frontmatter 应当包含以下结构：

YAML  
\---  
id: "refl\_20260415\_001"  
status: "verified"  
\# 1\. 意图标签：描述任务背景与目标（由 L 生成并提交给 O 检索）  
intent\_tags:  
  domain: "text\_analysis"  
  task\_goal: "extract\_entity\_from\_pdf"  
\# 2\. 关联技能：锁定故障工具（记录错误发生时的具体技能）  
failed\_skill\_id: "pdf\_parser\_v2.1"  
\# 3\. 错误摘要：描述失败表现（对错误现场的精简总结）  
error\_summary: "Unable to identify tables in multi-column layout, resulting in fragmented text output."  
\# 其他元数据  
task\_session\_id: "session\_9982"  
timestamp: "2026-04-15T07:08:00Z"  
\---

### **维度间的协同作用**

* **精准诊断：** 当 Agent L 看到一条反思时，如果 `intent_tags` 匹配但 `failed_skill` 不同，它会学习避开该路径；如果 `failed_skill` 相同，它会直接针对 `error_summary` 提到的缺陷进行代码重构。  
* **闭环验证：** Agent C 在审核新生成的技能时，会对比 `error_summary`，检查新的实现是否解决了之前记录的特定症状。  
* **分发决策：** Agent O 能够聚合这些数据，识别出某些技能在特定意图下的“高危属性”，从而在未来 L 请求该意图的技能时，提供更强力的风险预警。

这样的设计确保了“反思”不仅是一份记录，而是一份具备**可追溯性**和**可执行性**的诊断报告，能够直接驱动系统的自我进化。

### **3.2 反思摘要服务 (Reflection Summary Service)**

O 通过S为 L 提供脱水后的摘要，结构如下：

* **关联意图：** 该反思对应的原始任务目标。  
* **历史教训：** 该场景下曾发生的具体错误（如“正则贪婪模式导致内存溢出”）。  
* **改进方案：** 当前 Skill 针对该教训做的具体增强。

## ---

**4\. 核心工作流：意图驱动的自愈闭环**

1. **任务启动：** 用户给 L 下达任务。  
2. **增量检索 (L $\\rightarrow$ O)：** L 评估当前子任务，生成 intent\_tags 并询问 O：“是否有针对此意图的、我尚未加载的错误教训？”  
3. **知识注入 (O $\\rightarrow$ L)：** O 匹配历史库，返回 verified 状态的 Skill 快照及反思摘要。  
4. **学习执行：** L 加载技能，避开已知陷阱，执行任务。  
5. **异常反馈：** 若学习后依然出错，L 生成“错误现场报告”交给 O。  
6. **异步进化：** O 记录该反馈，标记相关文件为 needs\_sync，并在合适时机调度 C/R 进行修复。

## ---

**5\. 分阶段实施计划**

### **阶段 1：MCP 原子能力层 (Infrastructure)**

* 实现 atomic\_replace (Pathlib \+ subprocess)。  
* 实现 git\_snapshot\_read (git show)。  
* **交付物：** 能够处理 Git 原子操作的 MCP Server。

### **阶段 2：意图协议与生产链路 (Production)**

* Agent R 接入 intent\_tags 、failed\_skill、error\_summary等维度的编写逻辑。  
* Agent O 实现 Cold Start 初始配置。  
* **交付物：** 产生带标签 pending 文件的 R 与启动参数可控的 O。

### **3\. 阶段 3：服务化审计与 Staging (Audit)**

* Agent C 实现对 intent\_tags  、failed\_skill、error\_summary等内容的合规性审计，并给出反馈信息：通过/按具体要求重新修改/拒绝等。  
* 实现 **Staging 决策机制**（三色灯模型：自动/半自动/人工）。  
* **交付物：** 具备审计与 Git Commit 权限的 C。

### **阶段 4：增量学习与反馈链路 (Incremental Learning)**

* Agent L 实现“意图生成”与“O 检索服务对接”。  
* 实现 L 对 O 返回摘要的加载与增量评估逻辑。  
* **交付物：** 具备“预见性”的 L 及其反馈通道。

### **阶段 5：进化模型与反思自动化 (Evolution)**

* 在 O 中集成 $\\Delta$ 决策因子公式。  
* 实现“反思记录”与“原始任务意图”的自动关联存储。  
* **交付物：** 具备长期记忆与自动进化的完整 GASC 2.0 系统。

## ---

**6\. 系统自愈设计亮点**

* **读写分离：** L 通过 git show 永远只看稳定版，避免物理层面的读写冲突。  
* **意图锚定：** 反思不针对代码，而是针对“任务-结果”的因果链条。  
* **可控演进：** 通过 \--mode 参数将进化权和审核权牢牢掌握在用户手中。