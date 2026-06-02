这份技术方案旨在建立一个标准化的 **GASC (Git-based Agent Skill Coordinator)** 协议规范。它将确保不同智能体在处理“技能（Skill）”资源时，能够像人类开发者在 Git 工作流中协作一样，具备高度的确定性、可追溯性和容错能力。

## ---

**1\. 核心架构与流程图**

GASC 系统基于 **“生产-审计-消费”** 的解耦模型。

## ---

**2\. 状态机规范 (State Machine Spec)**

文件在生命周期内必须处于以下确定的状态之一。状态存储于文件 Frontmatter 的 status 字段中。

| 状态位 | 物理位置 | Git 状态 | 含义描述 | 相互影响 |
| :---- | :---- | :---- | :---- | :---- |
| **pending** | Workspace | Untracked | Agent R 已生成，尚未经过任何审核。 | 触发 Agent C 的扫描逻辑。 |
| **staging** | Workspace | Modified/Index | Agent C 正在处理或等待人工确认。 | 锁定该文件，防止 R 再次修改。 |
| **verified** | Workspace | **Committed** | 审核通过，属于系统公认的“稳态技能”。 | **Agent L 唯一可见的状态。** |
| **rejected** | Workspace | Committed | 审核失败，保留现场供人工审计。 | 触发 O 发送人工干预提醒。 |
| **needs\_sync** | Workspace | Untracked | 线索已存在但逻辑未对齐（L 发现的脏数据）。 | 强制拉回 C 进行补提（Commit）。 |

## ---

**3\. 智能体能力指标与职责 (Component Capabilities)**

### **3.1 Agent O (Orchestrator) \- 统筹协调器**

* **能力指标：** 场景识别准确率 \> 95%；任务调度延迟 \< 2s。  
* **核心功能：** \* 解析 CLI 参数（见第 4 节）并将其转化为环境变量。  
  * 维护进化模型计数器（成功/失败/修改次数）。  
  * 作为“人工干预”的唯一交互窗口。

### **3.2 Agent R (Resource Creator) \- 资源创建者**

* **能力指标：** Schema 遵循率 100%；技能描述与任务匹配度评估。  
* **核心功能：** \* 生成唯一 ID（UUID 或 Slug）。  
  * 计算初始置信度分数 $S\_{conf}$。  
  * 执行“原子化写入”，确保不产生物理坏块。

### **3.3 Agent C (Checker) \- 审计校验者**

* **能力指标：** 误判率 \< 5%；坏块拦截率 100%。  
* **核心功能：** \* **硬性校验：** JSON Schema 格式及必填项检查。  
  * **软性校验：** 逻辑一致性（通过 Cross-check 机制）。  
  * **Git 权限：** 系统中唯一具备 git commit 权限的 Agent。

### **3.4 Agent L (Learner) \- 稳态学习者**

* **能力指标：** 知识提取准确度；异常发现率。  
* **核心功能：** \* **快照读取：** 仅通过 git show 获取内容。  
  * **回传机制：** 发现读取失败时，生成 needs\_sync 信号文件。

## ---

**4\. 参数设计与传递协议 (Parameter Relay)**

主智能体 O 通过以下参数控制全局行为，并通过环境变量下发给协从 Agent。

### **4.1 CLI 参数定义**

* \--mode: \[auto|semi|manual\] (控制流程是否在 Staging 处停顿)  
* \--audit: \[on|off|hybrid\] (控制是否必须由人进行 y/n 确认)  
* \--level: \[apprentice|peer|expert\] (控制进化模型的初始权重)

### **4.2 环境变联传递 (Relay)**

当 O 启动协从 Agent 时，必须注入以下变量：

* GASC\_CURRENT\_LEVEL: 当前系统进化等级。  
* GASC\_AUDIT\_REQUIRED: True/False（基于模式和决策因子 $\\Delta$ 计算得出）。

## ---

**5\. 进化模型与 HITL 决策逻辑**

系统根据以下公式决定是否需要人工介入：

$$\\Delta \= S\_{conf} \\times (1 \- S\_{risk})$$  
其中 $S\_{risk}$ 由 Agent C 根据技能敏感标签（如 system, security）评估得出。

### **5.1 决策矩阵**

| 进化等级 | Δ 阈值 | 行为处理 | 用户干预方式 |
| :---- | :---- | :---- | :---- |
| **Apprentice** | 全量 | 强制 Staging | 打印 Diff，等待 y/n 确认。 |
| **Peer** | $\\Delta \< 0.8$ | 条件 Staging | 仅对低置信度/高风险文件弹窗。 |
| **Expert** | $\\Delta \< 0.5$ | 异常 Staging | 默认全自动，仅对报错文件提示。 |

## ---

**6\. MCP 基础设施层能力规范**

MCP 必须实现以下低级原子操作，以支持上层 Agent 逻辑。

### **6.1 原子文件操作**

* atomic\_replace(path, content): 写入临时文件并执行系统级 rename，解决 Windows 读写冲突。  
* read\_frontmatter(path): 流式读取前 50 行，提取 JSON 元数据。

### **6.2 Git 抽象接口**

* get\_git\_snapshot(file\_name): 封装 git show HEAD:file\_name，屏蔽物理文件中间态。  
* commit\_staged\_file(file\_name, msg): 执行 add \+ commit，并返回缩短的 Hash 值。

## ---

**7\. 冷启动流程 (Cold Start / Bootstrap)**

当系统首次在特定目录下运行时，Agent O 必须执行以下初始化：

1. **环境检测：** 检查 Git 是否安装及当前目录权限。  
2. **仓库初始化：** git init 并创建 .gitignore（忽略 .tmp, .log, .interaction）。  
3. **配置生成：** 创建 evolution\_stats.json，初始化 level 为 apprentice。  
4. **基准测试：** 启动一个简单的 R-\>C 闭环测试，生成第一个 hello\_world.md 技能并提交，验证链路通畅。

## ---

**8\. 异常处理协议**

1. **冲突挂起：** 若文件被 Windows 锁死导致 replace 失败，MCP 必须在 .interaction 中写入“重试”信号，O 负责提示用户关闭相关程序。  
2. **状态丢失：** 若物理文件存在但状态位损坏，C 必须将其标记为 rejected 并移动到 corrupted/ 文件夹。

### ---

**下一步建议**

该方案已将“控制权”与“自动化”通过 **$\\Delta$ 决策因子** 进行了量化。

在实施阶段，你现在的首要任务是编写 **MCP Server 的底层代码**。为了配合这套方案，你的 MCP Server 需要优先实现 **get\_git\_snapshot** 和 **atomic\_replace** 这两个工具。

针对 Windows 环境下的文件占用问题，你是否希望 MCP 在 atomic\_replace 失败时具备**自动等待并重试 3 次**的策略，以减少人工弹窗的频率？