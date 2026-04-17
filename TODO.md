# Aristotle Skill — Development TODO

> **已归档。** 内容已合并到 `ROADMAP.md`，本文件不再更新。

## Architecture Improvements

### TODO 1: 启动时禁止加载完整 skill 内容到父上下文
- **Priority**: HIGH
- **Problem**: `/aristotle` 命令触发时，skill tool 将整个 SKILL.md 注入到当前会话上下文，浪费大量 token
- **Solution**: Aristotle 启动时，父进程上下文中最多插入一行简短的状态提示（如 "🦉 Aristotle Reflector launched"），完整的 skill 指令只应传递给子代理。skill 的 SKILL.md 应重构为 coordinator-only 的精简版，详细协议仅在子代理 prompt 中内联。

### TODO 2: 子进程完成后父进程只提示完成，不取回详细内容
- **Priority**: HIGH
- **Problem**: 当前流程在子进程完成后调用 `background_output(full_session=true)` 将全部分析报告取回到父会话，再次污染父上下文
- **Solution**: 子进程完成后，父进程只需输出一行完成提示（含 session_id），用户应切换到子进程 session 查看详细报告。`background_output` 仅用于检查状态，不应将子进程的完整输出注入父上下文。

### TODO 3: 子进程 session 应支持从父进程直接切入
- **Priority**: MEDIUM
- **Problem**: 当前 `task()` 创建的子代理 session 不会注册到 `opencode session list`，用户无法通过 `opencode -s <session_id>` 切入。用户不得不新开终端窗口手动操作。
- **Solution**: 子进程 session 应注册为可恢复的交互式 session，使 `opencode -s <session_id>` 能从父进程直接切入子进程会话进行确认/反馈。需调研 OpenCode 的 session 注册机制。

### TODO 4: 模型选择不应使用交互式对话污染父进程
- **Priority**: MEDIUM
- **Problem**: 当前 Aristotle 启动前用 `question` 工具询问模型选择，消耗一轮对话并产生系统提示噪音
- **Solution**: 默认使用当前会话模型，不在父进程中弹出模型选择对话框。仅当用户在命令行中显式指定模型时（如 `/aristotle --model sonnet`）才覆盖默认行为。
