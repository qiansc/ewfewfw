# Part 02 架构修复记录

> 基于 Codex 研究报告的代码审查修复

---

## 修复列表

### 1. Contract DSL `component_id` 字段移除 (High)

**问题**：Contract DSL 中残留了 `component_id` 字段，但设计文档已明确关系方向为 `Component.implements_contracts → Contract`。

**修复文件**：
- `packages/core/src/types/dsl.ts` - 移除 ContractDSL 中的 `component_id`
- `packages/core/src/utils/converter.ts` - 移除 `dslToContract` 和 `contractToDSL` 中的 `component_id` 处理

---

### 2. ADR 转换器 `title`/`name` 不一致 (High)

**问题**：ADR 使用 `title` 而非 `name`（不继承 BaseEntityMetadata），但 converter.ts 错误地读取 `name` 和不存在的 `description`/`tags` 字段。

**修复文件**：
- `packages/core/src/utils/converter.ts`
  - `dslToADR`: 使用 `dsl.adr.title`，移除对 `description`/`tags` 的读取
  - `adrToDSL`: 使用 `adr.title`，移除对 `description`/`tags` 的输出

---

### 3. ID 验证正则表达式缺少结束锚点 (Low)

**问题**：通用 ID 验证正则缺少 `$` 锚点，导致 `prc-b-a001-foo` 等无效 ID 可能通过验证。

**修复文件**：
- `packages/core/src/utils/id.ts` L81-88
  - 区分 `feat/adr`（允许后缀）和 `prc/sor`（不允许后缀）
  - 添加 `$` 结束锚点

```typescript
return (
  isValidKebabCase(id) ||
  /^(feat|adr)-[a-z]\d{3}(-[a-z0-9]+)*$/.test(id) ||
  /^(prc|sor)-[bt]-[a-z]\d{3}$/.test(id)
);
```

---

### 4. C4AConfig 缺少 `skills`/`adr_policy` 字段 (Medium)

**问题**：设计文档 `user-cli.md §2.5` 定义了 `skills` 和 `adr_policy` 配置，但 config.ts 中缺少对应类型。

**修复文件**：
- `packages/core/src/utils/config.ts`
  - 添加 `ADROnMissing` 类型
  - 添加 `SkillsConfig` 接口
  - 添加 `ADRPolicyConfig` 接口
  - 更新 `C4AConfig` 接口
  - 更新 `mergeConfig` 函数

---

### 5. path.ts process/sor 默认回落问题 (Medium)

**问题**：当 `process`/`sor` 无法从 ID 判断视角时，默认回落到 `technical`，可能导致业务流程被写入错误目录。

**修复文件**：
- `packages/core/src/utils/path.ts` L86-97
  - `process`/`sor` 无法判断视角时抛出错误，而非默认 `technical`

```typescript
if (!perspective && (type === 'process' || type === 'sor')) {
  throw new Error(`Cannot determine perspective for ${type} "${id}": ID must start with prc-b-/prc-t- or sor-b-/sor-t-, or provide perspective option`);
}
```

---

### 6. converter.ts 缺少 kind/perspective 推导 (High)

**问题**：`dslTo*` 转换函数未设置 `kind` 和 `perspective` 字段，导致存储层这些字段为 NULL。

**修复文件**：
- `packages/core/src/utils/converter.ts`
  - 添加 `inferPerspective()` 和 `inferKind()` 辅助函数
  - 更新所有 `dslTo*` 函数添加 `perspective` 和 `kind` 字段

| 实体类型 | perspective | kind |
|---------|-------------|------|
| Product | `business` | `concept` |
| System | `technical` | `inferKind(external)` |
| Container | `technical` | `inferKind(external)` |
| Component | `technical` | `implementation` |
| Process | `inferPerspective(id)` | `concept` |
| SoR | `inferPerspective(id)` | `concept` |

---

### 7. architecture.md 文档漂移 (Doc)

**问题**：`architecture.md §2.3` 配置示例未包含 `skills`/`adr_policy` 字段。

**修复文件**：
- `v0.3.0/architecture.md` L336-351
  - 添加 `skills` 和 `adr_policy` 配置示例
  - 保持行号不变（压缩格式）

---

### 8. YAML 读写未实现 (Critical)

**问题**：`lite-adapter/helpers.ts` 的 `parseContent` 和 `formatContent` 在 YAML 模式下直接抛错。

**修复文件**：
- `packages/core/src/store/lite-adapter/helpers.ts`
  - 导入 `yaml` 库
  - 实现 YAML 解析和格式化

---

## 未修复（属于后续 Part）

### High: c4a_store_save 未调用 DSL → 内部结构转换

**问题**：当前保存逻辑直接把 `data`/`content` 解析后的对象写入 `entities.data`，并且 `kind`/`scope`/`perspective` 仍从 `data.*` 取值。若传入的是 DSL（`type: software-system` + `system:{...}` 结构），这些字段都不会被提升/推导，导致数据库字段长期为空。

**位置**：`packages/core/src/store/lite-adapter/crud-operations.ts` L93-171

```typescript
// 当前逻辑：直接从 data 取值，未调用 converter
db.prepare(`...`).run(
  ...
  (data.kind as string) || null,      // DSL 中没有这个字段
  (data.scope as string) || null,     // DSL 中在 system.scope 里
  (data.perspective as string) || null, // DSL 中没有这个字段
  JSON.stringify(data)
);
```

**影响**：虽然 `converter.ts` 已补充 `kind`/`perspective` 推导，但当前保存流程并未调用它，所以优化未生效。

**归属**：Part 03 (MCP Store) + Part 06 (Local 模式)

---

### High: 关系解析不符合 DSL Schema + 跨项目引用设计

**问题**：`parseRelations` 只识别 `data.relationships` 的字符串数组或 `{target, type}`，与 DSL 结构不匹配：

| DSL 类型 | 实际结构 | 当前解析 |
|---------|---------|---------|
| System | `relationships.consumers[].id`, `relationships.dependencies[].id` | ❌ 不识别 |
| Container | `relationships[].to` | ❌ 使用 `target` 字段 |
| System/SoR | `system.corresponds_to` / `sor.corresponds_to` | ❌ 在嵌套字段里 |

**位置**：`packages/core/src/store/lite-adapter/crud-operations.ts` L815-875

**其他问题**：
- 跨项目引用格式（`project:`/`repo:`/`scope:`）未解析
- 悬空引用 `resolved=false` 设计未实现
- `saveRelations` 固定 `toProject = sourceProject`，无法表达跨项目目标

**归属**：Part 03 (MCP Store) + Part 07 (数据操作)

---

### 汇总表

| 问题 | 严重度 | 归属 Part | 说明 |
|------|--------|-----------|------|
| 保存流程未调用 converter | High | Part 03 + 06 | DSL → 内部结构转换未集成到保存流程 |
| 关系解析不符合 DSL Schema | High | Part 03 + 07 | System/Container 的 relationships 结构不匹配 |
| 跨项目引用格式未解析 | High | Part 07 | `project:`/`repo:`/`scope:` 格式 |
| 悬空引用处理 | Medium | Part 07 | `resolved=false` 状态感知 |
| corresponds_to 解析 | Medium | Part 03 | 需要从嵌套字段提取 |

---

## 验证

```bash
cd packages/core && bun run test
# 122 pass, 0 fail
```
