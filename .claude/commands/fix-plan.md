# /fix-plan - PRD 与 Plan 问题修复

根据 `/review-plan` 的审查结果，修复 PRD 和 Plan 中的问题。

## 修复原则

### 文档定位（必须遵守）

| 文档 | 定位 | 应该包含 | 不应该包含 |
|------|------|---------|-----------|
| **PRD** | 产品需求 + 契约定义 | What、边界、契约、行为规则 | 详细设计、实现细节、伪代码 |
| **Plan** | 执行计划 + 任务分解 | How、任务、依赖、风险、验收标准 | 大量代码、Schema 定义、详细设计 |

### PRD 修复原则

**PRD 是契约文档，不是详细设计文档**

✅ PRD 应该包含：
- 数据模型定义（interface/type，简洁）
- API 契约（输入/输出 Schema、错误码）
- 行为规则（业务逻辑的边界和约束）
- 场景示例（说明行为，不是实现）

❌ PRD 不应该包含：
- 完整的实现代码（超过 20 行的代码块）
- 详细的算法实现
- 数据库表结构、索引设计
- 性能优化细节
- 部署配置

**修复时的判断标准**：
- 如果一段内容回答的是"做什么"→ 属于 PRD
- 如果一段内容回答的是"怎么做"→ 移到 Plan 或删除

### Plan 修复原则

**Plan 是执行计划，不是代码仓库**

✅ Plan 应该包含：
- 任务分解（Task 列表）
- 任务依赖关系
- 修改文件清单（路径 + 简要说明）
- 验收标准（可验证的条件）
- 风险识别

❌ Plan 不应该包含：
- 大段代码（超过 10 行的代码块）
- Schema 定义（这是 PRD 的内容）
- 详细的实现逻辑（这是代码的内容）
- 重复 PRD 的契约定义

**修复时的判断标准**：
- 如果一段代码是为了说明"改哪里"→ 保留（但精简到关键行）
- 如果一段代码是为了说明"怎么实现"→ 删除或移到 PRD

---

## 修复流程

### 1. 分类问题

将 `/review-plan` 发现的问题分为：

| 类型 | 修复位置 | 示例 |
|------|---------|------|
| PRD 内部矛盾 | 仅修改 PRD | 接口返回值与示例不一致 |
| Plan 内部矛盾 | 仅修改 Plan | 任务依赖有环 |
| PRD-Plan 矛盾 | 以 PRD 为准修改 Plan | PRD 说删除，Plan 说重命名 |
| PRD 契约缺失 | 补充 PRD | 缺少错误码定义 |
| Plan 任务遗漏 | 补充 Plan | PRD 功能无对应任务 |

### 2. 确定修复策略

**PRD 内部矛盾**：
```
1. 确定哪个是正确的契约（通常是 Schema 定义）
2. 修改示例代码以符合契约
3. 如果示例代码过长，考虑精简或删除
```

**Plan 内部矛盾**：
```
1. 检查任务依赖图，消除环
2. 合并重复任务
3. 确保每个任务有明确的验收标准
```

**PRD-Plan 矛盾**：
```
1. PRD 是权威，Plan 必须与 PRD 一致
2. 如果 Plan 的描述更合理，先修改 PRD，再同步 Plan
3. 不要在 Plan 中"修正" PRD 的定义
```

### 3. 执行修复

**修复 PRD 时**：
- 保持契约简洁，删除冗余的实现细节
- 示例代码只保留关键路径，不超过 20 行
- 错误码清单要完整

**修复 Plan 时**：
- 删除大段代码，只保留文件路径和关键修改点
- 任务描述用自然语言，不用伪代码
- 验收标准要可验证（能写成测试用例）

---

## 修复模板

### PRD 契约修复模板

```markdown
### 修复：[问题标题]

**问题位置**：L100-110

**原内容**：
> [引用原文]

**修复后**：
> [修复后的内容]

**修复原因**：
[说明为什么这样修复]
```

### Plan 任务修复模板

```markdown
### 修复：[问题标题]

**问题位置**：Task X.Y

**原内容**：
> [引用原文]

**修复后**：
> [修复后的内容]

**修复原因**：
[说明为什么这样修复]
```

---

## 常见修复场景

### 场景 1：PRD 示例代码与 Schema 不一致

**问题**：
```typescript
// Schema 定义（L100）
interface Output { a: string; b: number; c?: string[]; }

// 示例代码（L200）
return { a, b };  // 缺少 c
```

**修复策略**：修改示例代码，补全字段

**修复后**：
```typescript
return { a, b, c: warnings.length > 0 ? warnings : undefined };
```

### 场景 2：PRD 接口返回值与使用不一致

**问题**：
```typescript
// 接口定义（L100）
addVersion(uuid: string, version: string): Promise<void>;

// 使用（L200）
const updated = await adapter.addVersion(uuid, version);
return { versions: updated.versions };  // void 没有返回值
```

**修复策略**：修改接口定义（因为使用场景需要返回值）

**修复后**：
```typescript
addVersion(uuid: string, version: string): Promise<Entity>;
```

### 场景 3：Plan 包含大量实现代码

**问题**：
```markdown
Task 3.2: 实现 addVersion

```typescript
async function addVersion(input: AddVersionInput) {
  const { uuid, version } = input;
  // ... 50 行代码 ...
}
`` `
```

**修复策略**：删除代码，只保留任务描述

**修复后**：
```markdown
Task 3.2: 实现 addVersion

**修改文件**：`packages/mcp-store/src/tools/version.ts`

**实现要点**：
- 调用 `IStorageAdapter.addVersion()`
- 检查 0.0.0 保护（返回 C4A-VERSION-005）
- 返回更新后的 versions 数组

**验收标准**：
- [ ] 单元测试覆盖正常路径和错误路径
- [ ] 0.0.0 保护生效
```

### 场景 4：Plan 重复定义 Schema

**问题**：
```markdown
Task 3.2: 实现 addVersion

**输入 Schema**：
```typescript
interface AddVersionInput {
  uuid: string;
  version: string;
}
`` `

**输出 Schema**：
```typescript
interface AddVersionOutput {
  // ... 重复 PRD 的定义
}
`` `
```

**修复策略**：删除 Schema 定义，引用 PRD

**修复后**：
```markdown
Task 3.2: 实现 addVersion

**契约定义**：见 PRD §3.2.1

**修改文件**：`packages/mcp-store/src/tools/version.ts`

**验收标准**：
- [ ] 输入/输出符合 PRD 定义的 Schema
```

### 场景 5：PRD-Plan 逻辑矛盾

**问题**：
- PRD L100：`requirement_id` 字段直接删除
- Plan Task 2.6：字段重命名 `requirement_id` → `requirement_id`

**修复策略**：以 PRD 为准，修改 Plan

**修复后**：
```markdown
Task 2.6: 清理废弃字段

**修改内容**：
- 删除 `requirement_id` 字段（不做重命名）
- 删除相关的查询逻辑
```

---

## 修复检查清单

修复完成后，检查以下项目：

### PRD 检查
- [ ] 所有 Schema 定义完整（输入/输出/错误码）
- [ ] 示例代码与 Schema 一致
- [ ] 没有超过 20 行的代码块
- [ ] 没有详细设计内容（数据库设计、算法实现）

### Plan 检查
- [ ] 所有任务有明确的验收标准
- [ ] 没有超过 10 行的代码块
- [ ] 没有重复 PRD 的 Schema 定义
- [ ] 任务依赖关系无环
- [ ] 每个 PRD 关键契约都有对应任务

---

## 使用方式

```bash
# 根据审查结果修复
/fix-plan <review_result_path>

# 修复特定问题
/fix-plan --issue "PRD 接口返回值与示例不一致"

# 批量修复
/fix-plan <prd_path> <plan_path> --auto
```

或在对话中：

```
请根据以下审查结果修复 PRD 和 Plan：
[粘贴 /review-plan 的输出]
```
