# Bridge Plugin Deploy Fix — 2026-04-25

## 问题链

### Error #3: Zod 双实例冲突
- **现象**: `aristotle_fire_o` 被调用时报 `undefined is not an object (evaluating 'A.split')`
- **根因**: `bun build` 默认把整个 Zod v4 打包进 dist/index.js（421KB，528处 Zod 内部引用）。opencode `fromPlugin()` 用自己的 Zod 实例做 `z.object(def.args)` 和 `z.toJSONSchema()`，但 `def.args` 里的 schema 对象来自 bundled Zod，两套实例内部结构不兼容

### Error #4: externalize 后模块找不到
- **现象**: 加 `--external zod --external effect` 后，opencode 启动卡住黑屏
- **根因**: bundle 顶部出现 `import { z } from "zod"`，但部署目录 `~/.claude/skills/aristotle/plugins/aristotle-bridge/dist/` 没有自己的 `node_modules`。虽然上级目录有，但那个 zod 和 opencode 编译二进制内嵌的 zod 仍然是不同实例——即使 externalize 成功也会回到 Error #3

### Error #5: externalize @opencode-ai/plugin 后仍然卡住
- **现象**: 加 `--external @opencode-ai/plugin` 后重启 opencode 再次卡住
- **根因**: 同 Error #4，部署位置的 `node_modules/@opencode-ai/plugin` 是独立安装的副本，和 opencode 运行时的不是同一个实例

## 核心矛盾

opencode 是**编译后的 Bun 二进制**（`/usr/local/Cellar/opencode/1.4.11/bin/opencode`），所有依赖（包括 zod@4.1.8）都 baked-in。`file://` plugin 通过标准 ESM `import()` 加载，bare specifier 按文件路径向上查找 `node_modules`。

**无论怎么 externalize 或 bundle，plugin 解析到的 zod 实例和 opencode 内嵌的都不是同一个。**

## 修复方案

### 发现

opencode 自己在 `~/.config/opencode/node_modules/` 安装了 `@opencode-ai/plugin@1.3.15` + `zod@4.1.8`（通过 `Config.waitForDependencies()` 机制）。这是 opencode 用于 `.opencode/plugin/` 自动发现插件的依赖。

### 方案: 将 bundle 部署到 `~/.config/opencode/` 下

1. **构建**: 保持 `--external zod --external effect --external @opencode-ai/plugin`，bundle 约 14.6KB
2. **部署位置**: `~/.config/opencode/aristotle-bridge/index.js`（非 `~/.claude/skills/...` 下）
3. **opencode.json 配置**: `"file://$HOME/.config/opencode/aristotle-bridge/index.js"`
4. **模块解析路径**: `aristotle-bridge/` → 向上到 `~/.config/opencode/node_modules/` → 找到 opencode 自己安装的 `@opencode-ai/plugin` + `zod`

### 为什么这次能工作

- opencode 的 plugin loader 用 `import("file:///...")` 加载 plugin
- plugin 的 `import { tool } from "@opencode-ai/plugin"` 解析到 `~/.config/opencode/node_modules/@opencode-ai/plugin`
- 这个 `@opencode-ai/plugin` 依赖的 `zod` 也从同目录解析
- opencode 的 `fromPlugin()` 虽然用自己的 z，但 `tool()` 只是恒等函数，`def.args` 里的 zod schema 对象来自 `~/.config/opencode/node_modules/zod`
- **关键问题**: opencode 编译二进制内嵌的 zod 和 `~/.config/opencode/node_modules/zod` 是否是**同一个实例**？

### 风险点

如果 opencode 的 `fromPlugin()` 使用的 zod 是**编译内嵌的**（不在 `node_modules` 里），那即使 plugin 从 `~/.config/opencode/node_modules/zod` 解析，仍然是两个不同实例，Error #3 会重现。

**但是**：
- opencode v1.4.11 可能用 Bun 的模块解析（编译二进制运行时也查 node_modules）
- `~/.config/opencode/node_modules/zod@4.1.8` 是 opencode 自己安装的，可能是为了确保 plugin 和 host 共享
- 从日志看 plugin 加载没有报错，只是之前 bundled zod 的内部对象不兼容

### 验证命令

```bash
# 从部署位置验证模块解析
node -e "
import('file://$HOME/.config/opencode/aristotle-bridge/index.js').then(async m => {
  const ctx = { client: { session: { promptAsync: () => {}, messages: () => Promise.resolve({data:[]}), create: () => Promise.resolve({data:{id:'test'}}), abort: () => Promise.resolve() } }, project: {}, directory: '.', worktree: '.', serverUrl: new URL('http://localhost'), \$: {} };
  const hooks = await m.default(ctx);
  const toolCtx = { sessionID: 'test', messageID: 'm1', agent: 'general', directory: '.', worktree: '.', abort: new AbortController().signal, metadata: () => {}, ask: () => {} };
  const result = await hooks.tool.aristotle_fire_o.execute({ workflow_id: 'wf_test', o_prompt: 'p', target_session_id: '' }, toolCtx);
  console.log('OK:', result.status);
}).catch(e => console.error('ERROR:', e.message));
"
# 输出: OK: running ✅（已验证通过）
```

### 如果方案失败的后备方案

如果 `~/.config/opencode/node_modules/zod` 和 opencode 内嵌 zod 仍不兼容：
1. **方案 B**: 完全不依赖 `@opencode-ai/plugin` 的 `tool()` helper，手动构建 opencode 期望的 tool definition 结构（但需要逆向工程确认结构）
2. **方案 C**: 将 plugin 注册为 MCP server 而非 opencode plugin，完全绕开 Zod 问题
3. **方案 D**: 将 bridge 功能合并到现有 Aristotle MCP server 中，作为额外的 MCP tool

## 实施步骤

1. 将 `dist/index.js` 复制到 `~/.config/opencode/aristotle-bridge/index.js`
2. 更新 `opencode.json` plugin 路径
3. 更新 skill 安装脚本和项目文档中的部署路径
4. 重启 opencode 测试
