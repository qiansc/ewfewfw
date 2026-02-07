---
name: "c4a:analyze"
description: |
  一致性检查与影响分析。触发条件：
  - "检查一致性"、"分析影响"、"检查完整性"
  - "验证方案"、"检查 Spec"、"检查契约"
  - "检查 ADR"、"检查引用"、"检查进度"
  用于：(1) Spec 完整性检查，(2) 契约完备度检查，(3) DSL 引用正确性检查，(4) ADR 完备度检查，(5) 实现进度检查
---

# /c4a:analyze - 一致性检查

## 当前工作上下文

{{#if current_feat_uuid}}
**当前 Feature**: `{{current_feat_uuid}}`
**Feature 状态**: `{{current_feat_status}}`

⚠️ 所有 MCP 工具调用必须传递 `requirement_id: "{{current_feat_uuid}}"`。
{{else}}
**当前 Feature**: 无（主分支模式）

⚠️ 当前未选择 Feature，请先执行 `/c4a:feat` 创建或 `/c4a:feat --switch <id>` 切换。
{{/if}}

## 前置检查

1. 检查 `current_feat_uuid` 是否存在
2. 若不存在，提示用户创建或切换 Feature

## 工具调用规则

`c4a_store_validate` 必须传递 `requirement_id: "{{current_feat_uuid}}"`。
## 职责

在 plan 后到 publish 前的实现过程中，随时检查 Spec、契约、实现清单和实际实现的一致性。

## 使用时机

- `/c4a:plan` 完成后，开始实现前
- `/c4a:implement` 实现过程中，随时检查
- `/c4a:feat --status=published` 发布前（强制）

## 工具编排

```
1. 调用 c4a_store_validate 执行服务端检查：
   c4a_store_validate({
     requirement_id: "{{current_feat_uuid}}",
     checks: [
       "functional_spec",
       "technical_spec",
       "contracts",
       "references",
       "adr_completeness",
       "checklist"
     ],
     options: { include_suggestions: true }
   })

2. 展示检查报告：
   - 根据 summary.status 显示整体状态
   - 按 checks 各项展示详细结果
   - 展示 suggestions 修复建议

3. 如有错误或警告，询问用户处理方式
```

## 检查项说明

| 检查项 | 说明 | 级别 |
|--------|------|------|
| functional_spec | 功能规格完整性 | error |
| technical_spec | 技术规格完整性（Container/Component 关联） | error |
| contracts | 契约完备度（OpenAPI/AsyncAPI/Proto） | warning |
| references | DSL 引用正确性（悬空引用检测） | error |
| adr_completeness | ADR 完备度（架构变更需有 ADR） | warning |
| checklist | 实现清单进度 | info |

## 输出格式

```typescript
interface AnalyzeResult {
  passed: boolean;
  summary: { errors: number; warnings: number; tips: number };
  checks: {
    functional_spec: CheckResult;
    technical_spec: CheckResult;
    contracts: CheckResult;
    references: CheckResult;
    adr_completeness: CheckResult;
    checklist: ChecklistProgress;
  };
  suggestions: string[];
}

interface CheckResult {
  status: 'pass' | 'warning' | 'error';
  issues: { level: string; message: string; entity_id?: string; suggestion?: string }[];
}

interface ChecklistProgress {
  total: number;
  completed: number;
  in_progress: number;
  blocked: number;
  pending: number;
  completion_rate: number;
}
```

## 交互示例

**全部通过**:
```
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
✅ 契约完备
✅ DSL 引用正确
✅ ADR 完备度检查通过
📊 实现进度：8/10 (80%)

✅ 检查通过，可以继续实现或发布
```

**有警告**:
```
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
⚠️ 契约完备度：缺少 1 个 OpenAPI 契约
   - Component 'order-processor' 缺少 /api/orders 接口契约
   建议：创建 OpenAPI 契约描述该接口
✅ DSL 引用正确
⚠️ ADR 完备度：检测到架构变更，但未找到关联的 ADR
   - 新增 Container: payment-service
   建议：创建 ADR 记录架构变更的背景和决策原因
📊 实现进度：5/10 (50%)

⚠️ 检查通过，但有 2 个警告

? 如何处理？
  > 忽略警告，继续
    修复警告后继续
    查看详细信息
```

**有错误**:
```
🔍 一致性检查中...

✅ Functional Spec 完整
❌ Technical Spec 完整性：发现 2 个错误
   1. Container 'auth-service' 未关联 System
      建议：设置 data.system_id = 'e-commerce-system'
   2. Component 'jwt-validator' 的 container_id 不存在
      建议：检查 container_id 拼写或创建该 Container
⚠️ 契约完备度：缺少 1 个契约
⚠️ ADR 完备度：检测到架构变更，但未找到关联的 ADR
✅ DSL 引用正确
📊 实现进度：3/10 (30%)

❌ 检查失败，发现 2 个错误

? 如何处理？
  > 修复错误后继续
    查看详细信息
    取消操作
```

## 悬空引用检测

检测 DSL 引用正确性时，必须同时匹配 `to_id` 和 `to_type`，避免不同类型实体 ID 相同导致的误匹配。

**类型推断规则**：

| 来源类型 | 关系类型 | 期望目标类型 |
|---------|---------|-------------|
| Container | DEPENDS_ON | Container |
| Container | CONTAINS | Component |
| Container | IMPLEMENTS | Contract |
| Component | DEPENDS_ON | Component |
| Component | REFERENCES | Container |
| Component | IMPLEMENTS | Contract |

## 与其他 Skill 的关系

- `/c4a:plan` 完成后，建议调用 `/c4a:analyze` 检查方案完整性
- `/c4a:implement` 不再内置一致性检查，用户可随时调用 `/c4a:analyze`
- `/c4a:feat --status=published` 发布前**强制**调用 `/c4a:analyze`，可通过 `--force` 跳过
