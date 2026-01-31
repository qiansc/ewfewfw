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
- `packages/storage/src/lite-adapter/helpers.ts`
  - 导入 `yaml` 库
  - 实现 YAML 解析和格式化

---

## 已修复（2026-01-31）

### 9. c4a_store_save 已接入 DSL → 内部结构转换 (High)

**修复说明**：保存流程在写入前调用 `toInternalEntity`，并用转换结果填充 `kind/scope/perspective`，避免 DSL 结构下字段为空的问题。

**位置**：
- `packages/storage/src/lite-adapter/crud-save.ts`

---

### 10. 关系解析与跨项目引用集成 (High)

**修复说明**：
- `parseRelations` 接入 `data-ops/reference/resolver.ts` 的优先级解析
- 支持 `project:`/`repo:`/`scope:` 格式解析
- 新增 `references` 字段解析（`references → REFERENCES` 关系）
- 保留并兼容 System/Container/Component 的 `relationships` 结构

**位置**：
- `packages/storage/src/lite-adapter/relations.ts`
- `packages/storage/src/data-ops/reference/resolver.ts`
- `packages/core/src/types/dsl.ts`
- `packages/core/src/schemas/c4a-*.schema.json`

---

### 11. 悬空引用 resolved 标记 (Medium)

**修复说明**：保存关系时检查目标实体是否存在，写入 `properties.resolved=false`，跨项目未解析的引用写入 `resolve_status=pending`。

**位置**：
- `packages/storage/src/lite-adapter/relations.ts`

---

### 12. Copy-on-Write 支持 source_project (Medium)

**修复说明**：`copyOnWrite` 增加可选 `sourceProject` 参数，避免多项目同 ID 报歧义错误。

**位置**：
- `packages/storage/src/data-ops/reference/resolver.ts`

---

## 验证

```bash
cd packages/core && bun run test
# 122 pass, 0 fail
```
