# 质量保障方案审查修改（Dual Pass Review）

**审查轮次**: Pass 1 (概念审查) + Pass 2 (技术可行性审查)  
**审查日期**: 2025-05-28  
**状态**: 修改方案已制定，待实施

---

## 审查结论

**原方案状态**: 概念合理，但存在 2 个 Critical 和 3 个 High 问题，需修改后重新审查。

**修改策略**: 对确认问题给出整体修改方案，确保与整体架构相容，无冲突后实施。

---

## Pass 1: 概念审查 Findings（已确认）

### [C-1] 缺乏定量退出标准 → **确认，必须修复**

### [C-2] 规则配置化缺失 → **确认，必须修复**

### [H-1] 测试时间估算乐观 → **确认，需调整**

### [H-2] Phase 3 缺少实现细节 → **确认，需补充**

### [H-3] 与反思流程冲突 → **确认，需明确分工**

### [M-1] 错误分类缺失 → **确认，建议修复**

### [M-2] 用户文档缺失 → **确认，建议修复**

### [M-3] 技术债务风险 → **确认，建议监控**

---

## 整体修改方案

### 修改 1: 增加定量里程碑指标（修复 C-1）

**位置**: 第 5 节"关键里程碑"

**修改内容**:

```markdown
| 里程碑 | 时间 | 验收标准（定量）|
|--------|------|----------------|
| M1: 机械验证上线 | Phase 1 结束 | ① 语法/命令错误拦截率 ≥ 95%<br>② 误报率 ≤ 5%（用户覆盖 < 5%）<br>③ 平均拦截延迟 < 10ms |
| M2: 测试门控上线 | Phase 2 结束 | ① Phase 5 测试自动触发率 100%<br>② 测试失败阻止阶段推进率 100%<br>③ 单元测试运行时间 < 30s（超时率 < 1%）|
| M3: 语义审查上线 | Phase 3 结束 | ① Reviewer 报告 S/B/A findings 占比 10-25%<br>② S severity 准确率 ≥ 80%<br>③ 用户接受 Reviewer 建议率 ≥ 60% |
| M4: intervention 合并完成 | Phase 4 结束 | ① intervention/ 目录删除<br>② 原有 243 测试中 130 个迁移通过<br>③ MCP 工具从 20 增至 28，无回归错误 |
| M5: 文档完善 | Phase 5 结束 | ① 6 份核心文档完成<br>② 文档与代码版本一致性 100%<br>③ README 示例可运行 |
```

**相容性检查**: ✅ 与整体架构无冲突，仅增加度量指标，不影响实施路径。

---

### 修改 2: 增加规则配置化设计（修复 C-2）

**位置**: 第 3.1.1 节"Watchdog 机械验证增强"

**新增内容**:

```markdown
#### 3.1.3 规则配置系统

**配置文件**: `.opencode/watchdog-rules.jsonc`

```jsonc
{
  "version": 1,
  "global": {
    "mode": "block",  // "block" | "warn" | "off"
    "degradation": "warn"  // 降级时行为
  },
  "rules": {
    "NO_BUSINESS_CODE_BEFORE_PHASE5": {
      "enabled": true,
      "mode": "block",
      "severity": "error"
    },
    "NO_PHASE_ADVANCE_WITHOUT_GATE": {
      "enabled": true,
      "mode": "block", 
      "severity": "error"
    },
    "SYNTAX_CHECK_BEFORE_WRITE": {
      "enabled": true,
      "mode": "block",
      "severity": "error",
      "config": {
        "check_json": true,
        "check_typescript": true,
        "check_python": false  // 按项目类型配置
      }
    },
    "TESTS_MUST_PASS_IN_GREEN_PHASE": {
      "enabled": true,
      "mode": "block",
      "severity": "error",
      "config": {
        "timeout_ms": 30000,
        "test_types": ["unit"],  // "unit" | "integration" | "e2e"
        "blocking": true  // true=阻塞, false=仅记录
      }
    }
  },
  "project_types": {
    "nodejs": {
      "syntax_checks": ["json", "typescript", "javascript"],
      "test_command": "npm test"
    },
    "python": {
      "syntax_checks": ["json", "python"],
      "test_command": "pytest"
    }
  }
}
```

**灰度发布策略**:
- **Week 1-2**: 新规则默认 `mode: "warn"`（仅记录，不阻止）
- **Week 3-4**: 误报率 < 5% 后升级为 `mode: "block"`
- **可随时覆盖**: 用户可通过 `.opencode/watchdog-rules.jsonc` 关闭特定规则
```

**相容性检查**: ✅ 与现有架构相容，不破坏现有 2 个规则，仅增加配置层。

---

### 修改 3: 调整测试门控设计（修复 H-1）

**位置**: 第 3.2.1 节"自动测试门控"

**修改内容**:

```markdown
#### 3.2.1 自动测试门控（修订版）

**测试分层策略**:

```typescript
{
  id: 'TESTS_MUST_PASS_IN_GREEN_PHASE',
  evaluate(tool, path, classification, state) {
    if (state.currentPhase === 5 && classification.category === 'business_code') {
      // Layer 1: 快速单元测试（阻塞，< 30s）
      const unitResult = runTests({ 
        type: 'unit', 
        timeout: 30000,
        incremental: true  // 只运行与变更相关的测试
      });
      
      if (!unitResult.pass) {
        return {
          blocked: true,
          reason: `单元测试失败（${unitResult.failed} 个）：\n${unitResult.failures.join('\n')}`,
          guidance: '修复单元测试后再继续。运行 `npm test -- --watch` 持续观察。'
        };
      }
      
      // Layer 2: 集成测试（非阻塞，后台运行）
      runTestsAsync({ 
        type: 'integration', 
        timeout: 300000  // 5 分钟
      }).then(result => {
        if (!result.pass) {
          storeWarning({
            event: 'INTEGRATION_TEST_FAILED',
            message: `集成测试失败，建议检查：${result.failures.join('\n')}`
          });
        }
      });
      
      // Layer 3: E2E 测试（非阻塞，仅记录）
      runTestsAsync({ 
        type: 'e2e', 
        timeout: 600000  // 10 分钟
      });
    }
    return { blocked: false };
  }
}
```

**关键调整**:
- 单元测试：阻塞，30s 超时
- 集成测试：非阻塞，5min 超时，失败仅警告
- E2E 测试：非阻塞，10min 超时，仅记录
```

**相容性检查**: ✅ 与现有 Interceptor 架构相容，只是规则内部逻辑调整。

---

### 修改 4: 补充 Phase 3 实现细节（修复 H-2）

**位置**: 第 3.3 节"Ralph Loop 语义审查扩展"

**新增内容**:

```markdown
#### 3.3.4 Phase 3 实施路线图（MVP 策略）

**S severity（语义正确性）— 优先实现**: 
- **依赖**: TypeScript compiler API / Python AST
- **实现**: 
  - 收集项目中的类型定义和导出 API
  - Reviewer 对比代码中使用的 API 与项目实际导出的 API
  - 发现未定义的方法/属性即标记 S severity
- **工作量**: 1 周
- **验收**: 能发现 80% 的 API 误用

**B severity（业务逻辑一致性）— 第二阶段**:
- **依赖**: 需求文档索引（需要用户维护 `docs/requirements/`）
- **实现**:
  - 使用 embedding 索引需求文档
  - Reviewer 对比实现与需求描述的相似度
  - 低相似度或关键需求遗漏时标记 B severity
- **工作量**: 1 周（+ 需求文档整理时间）
- **验收**: 能发现明显的需求偏离

**A severity（上下文适配性）— 第三阶段**:
- **依赖**: 领域知识库（需要积累）
- **实现**:
  - 基于历史审查数据训练简单分类器
  - 识别"过度设计"模式（如小项目用微服务）
- **工作量**: 1 周
- **验收**: 能识别明显的过度设计

**Schema 兼容性**:
- 现有 schema.ts 的 `FindingSubmission` 已支持自定义 severity
- 无需修改 SCHEMA_VERSION（向后兼容）
- Reviewer prompt 中增加 S/B/A 检查项即可
```

**相容性检查**: ✅ 与现有 schema 相容，FindingSubmission 的 severity 字段已支持扩展。

---

### 修改 5: 明确与反思流程的分工（修复 H-3）

**位置**: 新增第 4.4 节

**新增内容**:

```markdown
### 4.4 与 Aristotle 反思流程的分工

**Watchdog/Ralph Loop（实时） vs Aristotle 反思（事后）**:

| 维度 | Watchdog/Ralph Loop | Aristotle 反思 |
|------|---------------------|----------------|
| **触发时机** | 执行时（实时） | 会话结束后（事后） |
| **目标** | 阻止错误、保证当前产出质量 | 学习错误模式、生成预防规则 |
| **输出** | findings / 拦截提示 | DRAFT 规则 / 学习记录 |
| **用户交互** | 自动（无需用户触发） | 手动（`/aristotle` 命令） |

**协作流程**:
```
LLM 执行 → Watchdog 实时拦截（阻止错误）
    ↓
Ralph Loop 审查（发现质量问题）
    ↓
用户修改代码（修复问题）
    ↓
会话结束 → Aristotle 反思（总结错误模式）
    ↓
生成规则 → 写入 aristotle_mcp（预防未来）
```

**避免冲突**:
- Watchdog 已拦截的错误 → Aristotle 不重复反思（无价值）
- Ralph Loop 的 findings → Aristotle 可纳入反思（有价值的模式）
- Aristotle 生成的规则 → Watchdog 可加载为配置（形成闭环）
```

**相容性检查**: ✅ 明确分工，避免重复工作，与现有架构一致。

---

### 修改 6: 增加错误分类（修复 M-1）

**位置**: 第 3.1.1 节 Observer 增强

**修改内容**:

```typescript
// 错误分类和分级响应
enum ErrorClass {
  RECOVERABLE = 'recoverable',      // 可自动修复（如 lint 错误）
  WARNING = 'warning',              // 警告但不阻止（如代码风格）
  BLOCKING = 'blocking',            // 阻止（如语法错误）
  FATAL = 'fatal'                   // 致命（如数据丢失命令）
}

const errorClassifier = {
  classifyBashError(exitCode: number, command: string): ErrorClass {
    if (command.includes('rm -rf') || command.includes('DROP TABLE')) {
      return ErrorClass.FATAL;
    }
    if (exitCode === 1) return ErrorClass.RECOVERABLE;  // 一般错误
    if (exitCode === 2) return ErrorClass.BLOCKING;     // 误用
    if (exitCode >= 128) return ErrorClass.FATAL;       // 信号终止
    return ErrorClass.WARNING;
  }
};
```

---

### 修改 7: 增加用户文档（修复 M-2）

**位置**: 第 3.5.1 节文档清单

**新增**:

```markdown
| 用户指南 | `docs/user-guide.md` | 如何配置规则、处理误拦截、查看审查报告 |
| 故障排查 | `docs/troubleshooting.md` | 常见问题：误拦截怎么办、测试超时怎么处理 |
```

---

### 修改 8: 增加技术债务监控（修复 M-3）

**位置**: 第 6 节风险评估

**新增**:

```markdown
| 技术债务积累 | 中 | 中 | ① 每周统计代码复杂度（cyclomatic complexity）<br>② 测试运行时间监控（> 60s 报警）<br>③ 工具数量上限：32 个（当前 28） |
```

---

## 修改相容性总检查

| 修改 | 与架构冲突 | 与现有代码冲突 | 与 TDD 流程冲突 | 结论 |
|------|-----------|--------------|---------------|------|
| 修改 1: 定量指标 | ❌ 无 | ❌ 无 | ❌ 无 | ✅ 可实施 |
| 修改 2: 规则配置 | ❌ 无 | ⚠️ 需新增配置读取逻辑 | ❌ 无 | ✅ 可实施 |
| 修改 3: 测试分层 | ❌ 无 | ⚠️ 需调整 Interceptor 内部逻辑 | ❌ 无 | ✅ 可实施 |
| 修改 4: Phase 3 MVP | ❌ 无 | ❌ 无 | ⚠️ 需更新 Reviewer prompt | ✅ 可实施 |
| 修改 5: 反思分工 | ❌ 无 | ❌ 无 | ❌ 无 | ✅ 可实施 |
| 修改 6: 错误分类 | ❌ 无 | ⚠️ 需新增分类器模块 | ❌ 无 | ✅ 可实施 |
| 修改 7: 用户文档 | ❌ 无 | ❌ 无 | ❌ 无 | ✅ 可实施 |
| 修改 8: 债务监控 | ❌ 无 | ❌ 无 | ❌ 无 | ✅ 可实施 |

**总体结论**: 所有修改与整体架构相容，无冲突。仅修改 2、3、4、6 需要代码变更，但均为增量变更，不破坏现有功能。

---

## 实施顺序

**第一阶段（立即）**:
1. 修改 5: 明确反思分工（文档，无代码风险）
2. 修改 1: 增加定量指标（文档，无代码风险）

**第二阶段（Phase 1 前）**:
3. 修改 2: 规则配置化（影响 Phase 1 实现）
4. 修改 6: 错误分类（与 Phase 1 一起实现）

**第三阶段（Phase 2 前）**:
5. 修改 3: 测试分层（影响 Phase 2 实现）

**第四阶段（Phase 3 前）**:
6. 修改 4: Phase 3 MVP 细节（影响 Phase 3 实现）

**第五阶段（贯穿）**:
7. 修改 7: 用户文档
8. 修改 8: 债务监控

---

## 下一步行动

1. **确认修改方案**: 用户确认上述修改是否完整
2. **实施文档修改**: 先修改设计文档（修改 1、5、7、8）
3. **重新审查**: 修改后重新运行 Dual Pass Review
4. **进入开发**: 审查通过后进入 Phase 1 开发

**是否确认修改方案并实施？**
