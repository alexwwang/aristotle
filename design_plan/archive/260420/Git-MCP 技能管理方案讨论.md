这份技术方案汇总了我们关于 **“基于 Git-MCP 的跨智能体技能管理与协作系统”** 的所有讨论。该系统通过文件接力和版本控制，实现了一个高可靠、异步的生产与消费闭环。

## ---

**1\. 系统架构概览 (System Architecture)**

本系统采用 **OpenCode** 作为运行平台，核心逻辑通过一个自定义的 **轻量化 Git-MCP Server** 进行解耦。所有的智能体（Agent）不直接进行进程间通信，而是通过读写共享目录下的 **Skill 协议文件**（Markdown \+ JSON Frontmatter）并利用 Git 维护状态的一致性。

## ---

**2\. 核心角色与职责 (Roles & Responsibilities)**

| 角色 | 名称 | 职责描述 | 当前状态 |
| :---- | :---- | :---- | :---- |
| **O** | **Orchestrator** | 统筹协调。识别场景，按序拉起 R、C 或 L。 | **已实现** |
| **R** | **Resource Creator** | 技能生产。根据任务创建符合 Skill 协议的物理文件，初始状态为 pending。 | **已实现** |
| **C** | **Checker** | 质量把关与固化。审核 R 的产出，修改状态位，并执行 Git Commit 将其推入稳定版。 | **待实现** |
| **L** | **Learner** | 稳态消费。通过 Git Snapshot Read 读取 verified 状态的技能进行学习。 | **待实现** |

## ---

**3\. 关键机制设计 (Key Mechanisms)**

### **3.1 预审机制 (Staging Mechanism)**

为了防止“脏读”和逻辑错误，系统引入了 Staging 流程：

* **Logical Staging:** 在 Frontmatter 中使用 status 字段标记（pending \-\> staging \-\> verified/rejected）。  
* **Physical Staging:** 利用 Git 的索引区。只有被 C 审计通过并 commit 的内容，才被视为“进入生产环境”。

### **3.2 冲突与并发控制 (Concurrency Control)**

* **写入端：** 采用“写入临时文件 (.tmp) \-\> 原子重命名 (replace)”的方案，规避 Windows 下的文件锁冲突及“写一半”风险。  
* **读取端：** 采用 **Git Snapshot Read**（git show HEAD:file）。消费端 L 永远只读取已提交的快照，与 R/C 在磁盘上的物理操作完全隔离。

### **3.3 异步自愈逻辑 (Self-healing Loop)**

* 如果 L 在读取时发现文件物理存在但 Git 中无记录（未就绪），L 将跳过该文件并记录 needs\_sync 信号。  
* O 捕获该信号后重新调度 C 进行补提（Commit），实现系统的最终一致性。

## ---

**4\. 技术栈实现方案 (Implementation Stack)**

* **基础协议：** OpenCode MCP (Model Context Protocol)  
* **传输模式：** Stdio (常驻后台进程)  
* **后端支撑：** \* **文件系统：** pathlib (对象化路径操作)  
  * **版本控制：** 原生 git (通过 subprocess 调用，不依赖重型库)  
* **检索引擎：** 早期实现基于“流式读取 Frontmatter \+ 正则匹配”。

## ---

**5\. 功能点检查清单 (Functional Checklist)**

### **A. 基础设施 (MCP 层)**

* \[ \] **路径授权：** 配置 external\_directory 允许访问用户 Home 目录。 (**待实现**)  
* \[ \] **轻量化 Git 封装：** 基于 subprocess 实现原子提交与回退逻辑。 (**待实现**)  
* \[ \] **流式 Frontmatter 读取：** 仅读取文件头部的 JSON 块以提升检索效率。 (**待实现**)

### **B. 智能体逻辑 (Agent 层)**

* \[x\] **Agent R：** 自动生成 ID，按 Schema 写入文件。 (**已实现**)  
* \[ \] **Agent C：** 实现 Schema 合规性校验逻辑。 (**待实现**)  
* \[ \] **Agent C：** 实现审核失败后的 rejected 标记与存证。 (**待实现**)  
* \[ \] **Agent L：** 实现基于 git show 的快照读取逻辑。 (**待实现**)  
* \[ \] **Agent L：** 实现异常信号反馈（通知 O 补提）。 (**待实现**)

### ---

**6\. 后续迭代方向**

随着 Skill 库规模的扩大，系统将考虑：

1. **索引升级：** 引入 SQLite 存储元数据以支持复杂查询。  
2. **语义检索：** 引入向量数据库处理模糊的需求匹配。  
3. **人工控制台：** 建立一个可视化看板，方便人工处理 rejected 状态的技能。

---

目前这份方案涵盖了从底层原子操作到高层角色协作的全部逻辑。

既然 O 和 R 已经跑通，接下来的第一个硬骨头是 **Agent C 的审核与 Commit 逻辑**。你打算在 C 审核时，是先只做“JSON 格式与必填项”的硬性校验，还是尝试加入一些基于业务逻辑的“内容一致性”检查？