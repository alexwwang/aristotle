# Undo-Triggered Reflection — 方案定稿决策过程

> 日期：2026-04-20
> 会话：从 Demo 验证到技术方案 v3 的完整决策历程

---

## 1. 初始验证阶段

### 1.1 Demo 验证（已完成）

**问题**：OpenCode 的 `/undo` 没有提供任何可用的回调事件。需要找到一个间接检测方法。

**决策过程**：通过 8 轮 live testing 排除了 7 个直觉上可行的方案，最终找到 `session.idle` + `session.diff` flag 状态机。

**关键教训**：
- 系统的事件文档不可靠——必须实测。`message.removed`、`command.executed`、`message.updated(completed=true)` 等看似可用的方案全部失败
- 最可靠的信号往往是最不直觉的——通过"缺失的事件"（session.idle 没有触发）而非"出现的事件"来检测
- Live testing 不可省略——tmux 驱动真实 OpenCode 实例是唯一可靠的验证方式

### 1.2 Plugin → O 通知机制探索

**问题**：Plugin 检测到 undo 后，如何通知 O（Skill）启动反思？

**调研结果**：
- Skill 无法订阅事件（Skill = Markdown 内容注入，不是可执行代码）
- Plugin 的 `output.inject` 和 `session.stopping` hook 都在 PR 阶段，未合并
- 唯一可行：Plugin 通过 `chat.message` hook 修改用户的下一条消息

**决策**：采用 `chat.message` hook 注入方案。

### 1.3 注入内容的三轮迭代

| 版本 | 注入内容 | synthetic | AI 行为 | 结果 |
|------|---------|-----------|---------|------|
| A | `<aristotle-signal>/aristotle undo</aristotle-signal>` | true | 看到但当作元数据忽略 | ❌ |
| B | `/aristotle undo` | 无 | 尝试加载 skill 但拒绝 undo 子命令 | ❌ |
| C | `[system] The user just performed /undo...` | 无 | **立即执行 /aristotle** | ✅ |

**关键教训**：
- `synthetic: true` 会从 AI 视角降级注入内容的可操作性——AI 看得到但选择忽略
- XML 标签包裹的指令被 AI 当作元数据而非可执行命令
- `[system]` 前缀 + 明确的自然语言指令是最有效的注入格式
- 用户能看到注入文本不是 bug，是 feature——未来在 README 说明即可

### 1.4 Part 类型字段的踩坑

**问题**：注入的 Part 缺少 `id`、`sessionID`、`messageID` 必填字段，导致运行时崩溃。

**错误信息**：`SyncEvent.run: "sessionID" required but not found`

**教训**：OpenCode SDK 的 TypeScript 类型允许 `as Part` 强制转换通过编译，但运行时会校验。必须参考 `TextPart` 完整类型定义，不能偷懒用 `as` 类型断言。

### 1.5 /undo 输入方式的验证

**问题**：之前一次测试中 `/undo` 文本输入"打开了 agent selector"，是否真的不能用？

**实测结果**：`/undo` 和 `ctrl+x u` **完全等价**，都触发 `session.diff`。之前是 tmux 时序问题导致的误判。

**教训**：不要基于单次异常结果下结论。不确定就要重新测试，不要想当然。

---

## 2. 架构设计阶段

### 2.1 触发→调度→执行的三层分工

**决策**：Plugin(传感器) → O(调度) → R(执行)

**关键约束**：
- Plugin 是 event handler，没有 LLM，不能做分析
- O 在主 session 中运行，context 是宝贵的
- R 在 `task()` 子进程中运行，context 隔离且用完即销毁

### 2.2 解耦原则的确立

**用户原话**：
> "undo任务和关键词触发任务的区分，在reflect层做解耦应该更合适"
> "reflector的任务没有本质变化"

**决策**：新建 `UNDO_REFLECT.md` 而非修改 `REFLECTOR.md`。Reflector 不感知触发来源。

**推理**：
- 以后新触发类型（redo、错误模式检测等）各自一个 `XXX_REFLECT.md`
- Reflector 是共享执行层，不应该因为触发类型增多而膨胀
- 这符合 Progressive Disclosure 原则——只有 undo 触发时才加载 undo 专用协议

---

## 3. 技术方案迭代（三个版本）

### 3.1 v1 → 否决：Reflector 加 R0

**方案**：UNDO_REFLECT.md 传 queue 路径给 Reflector，Reflector 新增 R0 阶段自己读 queue + session。

**否决原因**：Reflector 耦合了 undo 概念。R0 知道 queue 格式、prev_msg_index，违反解耦原则。

### 3.2 v2 → 否决：UNDO_REFLECT.md 内联材料

**方案**：UNDO_REFLECT.md 读 queue + session，拼接材料内联在 prompt 中传给 Reflector。

**否决原因**：

**用户提出关键问题**：
> "O拉起reflect，reflect拼接对话产生的内容为什么要留在对话中？它把内容写入文档，让reflector去文档中读是不是会更好？"

这暴露了一个被忽视的问题：Reflect 在主 session 中执行，`session_read()` 的结果和拼接的材料都留在对话历史中，context 膨胀 ~26KB。

### 3.3 v3 → 定稿：Plugin 写 material 文件

**关键洞察**（用户提出）：
> "既然可行，就要考虑技术方案，兜住边界情况"
> "material文件里定义一个状态标，如果reflector消费过了，就打上已消费/处理的状态"

**方案**：Plugin 在检测 undo 时直接读 queue + session → 构建 material 文件。UNDO_REFLECT.md 极简化（~30 行：检查文件 → 传路径 → 启动 Reflector）。主 session context 零膨胀。

**五维度验证**：

| 维度 | 结论 |
|------|------|
| 1. SKILL 文档总增加量 | ~79 行（Plugin 改造占大头） |
| 2. 平均每个文档大小 | ~149 行（持平） |
| 3. 高披露期望文档体积 | Reflector **+0 行**（核心优势） |
| 4. 解耦程度 | Reflector 不感知 undo |
| 5. 主 session context 压力 | **零膨胀**（Plugin 进程做数据准备） |

---

## 4. 重试机制的设计决策

### 4.1 发现盲点

**用户提出**：
> "如果reflector 这个 subagent任务执行失败，比如遇到api不可用，重试超时，之后的重新拉起机制设计了吗？怎么将任务prompt提取出来重新执行？"

当前架构中**没有重试机制**。Reflector 失败就失败了，没有恢复路径。

### 4.2 范围控制

**决策**：先在 undo scope 内实现最小化重试（A），全局重试后续单独设计（B）。

Material 文件天然是 prompt 持久化的载体——重试时 Reflector 重新读同一个文件即可。

### 4.3 状态标设计

**用户提出**：
> "material文件里定义一个状态标，如果reflector消费过了，就打上已消费/处理的状态，下次plugin读取material后，发现有标就直接覆盖原内容"

**最终状态机**：

```
pending → consumed（R 成功）
pending → retry_pending（R 失败，未超限）
retry_pending → consumed（重试成功）
retry_pending → failed（超过 max_retries）
```

**写入者分工**：
- Plugin：写 material（status=pending），追加 undo 条目，覆盖 consumed
- UNDO_REFLECT：标记 consumed / retry_pending / failed
- Reflector：**不写**（保持只读架构约束）

### 4.4 手动重试

**用户提出**：
> "如果重试失败，过程文件是否保留？有没有给用户新建session手动发起重试的机会？"

**决策**：`/aristotle retry` 作为通用重试命令（V1.1e），不区分 undo 与否。本次 scope 内：保留 failed 的 material 文件 + 通知用户路径 + 在技术方案中记录 retry 命令的规划。V1.1e 实现 `/aristotle retry` 时，逻辑为：将 material 的 `status` 改回 `retry_pending`，`retry_count` 归零，重新走 UNDO_REFLECT 流程拉起 Reflector。

---

## 5. 关键决策原则总结

### 5.1 从本次讨论中提炼的原则

1. **不确定就实测，不要想当然** — `/undo` 是否能文本输入、`synthetic` 对 AI 的影响、`chat.message` 是否能注入，全部通过 live test 验证
2. **解耦优先** — 触发类型区分在 Reflect 层，不污染执行层（Reflector）
3. **主 session context 是稀缺资源** — 数据准备尽量在 Plugin（独立进程）或 Reflector（子进程）中完成
4. **文件即接口** — material 文件既是数据载体、又是状态管理器、还是 prompt 持久化方案
5. **先 scope 内最小化，再全局通用化** — 重试机制先覆盖 undo，通用化留给后续

### 5.2 对未来设计的启示

- **事件检测**：OpenCode 的事件系统文档不可靠，实测是唯一验证方式。任何新事件的使用都应先 live test
- **Plugin → AI 通信**：`chat.message` hook + 无 `synthetic` + `[system]` 前缀是目前唯一可靠方案。如果未来 `session.stopping` 或 `output.inject` PR 合并，应重新评估
- **渐进式披露**：新功能应尽量放在新文件中（如 `UNDO_REFLECT.md`），不膨胀高频加载的文件（如 `REFLECTOR.md`）
- **通用命令设计**：`/aristotle retry` 不区分触发类型，是比 `/aristotle undo-retry` 更好的设计
- **状态标模式**：通过文件内嵌 `status` 字段实现多组件协作（Plugin 写 → Reflect 读/改 → Reflector 读），避免引入额外状态管理
