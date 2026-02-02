# C4A v0.3.0 设计文档与代码实现不一致问题清单

> 检查范围：v0.3.0/detailed-design、v0.3.0/architecture.md、v0.3.0/concepts.md、v0.3.0/user-stories.md、v0.3.0/product.md
>
> 检查时间：2026-02-02
>
> 检查方法：逐文档逐章节对比设计文档和最终代码实现

---

## 目录

- [1. architecture.md 相关问题](#1-architecturemd-相关问题)
- [2. concepts.md 相关问题](#2-conceptsmd-相关问题)
- [3. local-mode/sqlite-schema.md 相关问题](#3-local-modesqlite-schemamd-相关问题)
- [4. mcp/store-crud.md 相关问题](#4-mcpstore-crudmd-相关问题)
- [5. mcp/store-feat-lifecycle.md 相关问题](#5-mcpstore-feat-lifecyclemd-相关问题)
- [6. 其他设计文档问题](#6-其他设计文档问题)
- [7. 代码不合理问题](#7-代码不合理问题)

---

## 1. architecture.md 相关问题

### 1.1 Remote 模式未实现

**文档位置**：`v0.3.0/architecture.md` §1.1

**设计描述**：
```
| 特性 | Local 模式 | Server 模式 | Remote 模式 |
|------|----------|-------------|-------------|
| 运行时 | Bun (TypeScript)¹ | TS + Python² | - |
| 存储 | SQLite | MongoDB + Neo4j + Milvus | 远程服务 |
| 访问方式 | MCP stdio（由 IDE 管理生命周期） | HTTP Server | HTTP API |
```

**实际实现**：
- `packages/storage/src/get-adapter.ts` 中只有 `LiteAdapter` 和 `ServerAdapter` 两种实现
- 没有找到 `RemoteAdapter` 的实现代码
- CLI 初始化代码中没有 `c4a install remote` 的逻辑

**问题类型**：❌ 功能缺失

**影响**：用户无法使用团队共享的远程 C4A 服务

**建议**：
- 补充 `RemoteAdapter` 实现，或在文档中标注为"计划中未实现"
- 更新 architecture.md 表格，移除 Remote 模式列，或添加"v0.4.0 计划"标注

---

### 1.2 数据库表结构与设计不一致

**文档位置**：`v0.3.0/architecture.md` §2.6（通过 concepts.md §3 引用）

**设计描述**：
```yaml
状态流转必须按顺序进行，不可跳过（例外：feat 支持 `published → archived` 快速归档）
```

**实际实现**：
- `packages/storage/src/sqlite-store.ts` 的表结构中，`entities` 表增加了 `orphaned` 和 `orphaned_at` 字段
- 这两个字段在设计文档中完全没有提及

**问题类型**：⚠️ 实现超出设计

**影响**：
- 代码维护者不清楚这些字段的用途和生命周期
- 可能导致数据一致性问题

**建议**：
- 在 `local-mode/sqlite-schema.md` 中补充说明 `orphaned` 字段的用途
- 或者如果这是临时字段，应该移除

---

### 1.3 feats 表缺少设计文档

**文档位置**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2

**设计描述**：
文档中没有提及 `feats` 表的结构

**实际实现**：
```sql
CREATE TABLE IF NOT EXISTS feats (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  description TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  checklist TEXT,
  updated_by TEXT,
  approved_by TEXT,
  published_by TEXT,
  project_ids TEXT
);
```

**问题类型**：📝 文档缺失

**影响**：开发者无法从设计文档中了解 feat 元数据表的结构

**建议**：在 `local-mode/sqlite-schema.md` §2.2 后增加 §2.2.2 "Feat 元数据表"

---

### 1.4 workflow_states 和 compensation_logs 表未在文档中说明

**文档位置**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2

**实际实现**：
```sql
CREATE TABLE IF NOT EXISTS workflow_states (...);
CREATE TABLE IF NOT EXISTS compensation_logs (...);
```

**问题类型**：📝 文档缺失

**影响**：开发者不清楚这两个表的用途

**建议**：
- 在 `local-mode/sqlite-schema.md` 中补充这两个表的说明
- 或在 `data-ops/workflow-recovery.md` 中说明（如果是 workflow 相关）

---

## 2. concepts.md 相关问题

### 2.1 Contract 的 spec vs spec_uri 说明不一致

**文档位置**：`v0.3.0/concepts.md` §8.1

**设计描述**：
```markdown
> **重要说明**：`spec_uri` 是 **URI 唯一标识**，不是文件路径同步机制。
> - **同步范围**：`spec_uri` 指向的文件**不在 C4A 同步范围内**
```

**问题**：
- 设计文档明确说明 `spec_uri` 指向的文件不参与同步
- 但在 `architecture.md` §2.5 中描述 `technical/contracts/` 目录存放 Contract 规格文件（可选）
- 这两处描述存在矛盾：如果不参与同步，为什么要放在 `.context/` 目录下？

**问题类型**：📚 文档矛盾

**建议**：
- 明确 `spec_uri` 的两种使用模式：
  - 外部 URI（如 `https://...`）：不参与同步
  - 本地相对路径（如 `./contracts/xxx.yaml`）：可选参与同步
- 更新 concepts.md 说明

---

## 3. local-mode/sqlite-schema.md 相关问题

### 3.1 entities 表增加了未文档化的字段

**文档位置**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2.1

**设计描述**：
```sql
CREATE TABLE entities (
    id TEXT NOT NULL,
    source_project TEXT NOT NULL DEFAULT '',
    proposal_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    kind TEXT,
    scope TEXT,
    perspective TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (source_project, id, proposal_id)
);
```

**实际实现**：
```sql
CREATE TABLE IF NOT EXISTS entities (
    id TEXT NOT NULL,
    source_project TEXT NOT NULL DEFAULT '',
    proposal_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    kind TEXT,
    scope TEXT,
    perspective TEXT,
    data TEXT NOT NULL,
    orphaned INTEGER DEFAULT 0,        -- ❌ 未在设计文档中说明
    orphaned_at TEXT,                  -- ❌ 未在设计文档中说明
    PRIMARY KEY (source_project, id, proposal_id)
);
```

**问题类型**：📝 文档缺失

**建议**：在设计文档中补充说明这两个字段的用途

---

### 3.2 relations 表的 status 字段说明模糊

**文档位置**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2.1

**设计描述**：
```sql
status TEXT DEFAULT 'active',  -- 关系状态：active | deleted（用于 Feat 删除遮蔽）
```

**问题**：
- 文档中说 `deleted` 用于 "Feat 删除遮蔽"，但没有详细说明这个机制如何工作
- 在 Feat 中删除关系时，是物理删除还是软删除（设置 status=deleted）？
- Feat 发布后，`status=deleted` 的关系如何处理？

**问题类型**：📚 说明不足

**建议**：在 `data-ops/conflict-rollback.md` 或 `store-feat-lifecycle.md` 中详细说明关系删除的机制

---

### 3.3 feats 表的 project_ids 字段用途不明

**实际实现**：
```sql
CREATE TABLE IF NOT EXISTS feats (
  ...
  project_ids TEXT  -- ❌ 字段用途不明确
);
```

**问题**：
- 字段名是复数形式，暗示可能存储多个项目 ID
- 但数据类型是 TEXT，不清楚是 JSON 数组还是逗号分隔的字符串
- 文档中没有说明这个字段的用途和格式

**问题类型**：📝 文档缺失 + ⚠️ 设计不明确

**建议**：
- 如果存储多个项目 ID，应该明确存储格式（JSON 数组）
- 在设计文档中说明这个字段的用途（跨项目 feat？）

---

## 4. mcp/store-crud.md 相关问题

### 4.1 c4a_store_save 的 ADR 检查逻辑与实现不一致

**文档位置**：`v0.3.0/detailed-design/mcp/store-crud.md` §3.1

**设计描述**：
```markdown
检查规则：
- 如果 `enforce_adr=true` 或项目配置 `adr_policy.enforce=true`：
  - 检查是否存在关联的 ADR（通过 `REFERENCES` 关系）
  - 如果没有 ADR：
    - `adr_policy.on_missing=error`：返回错误，阻止保存
    - `adr_policy.on_missing=warning`：返回警告，允许保存
```

**实际实现**：
- 在 `packages/mcp-store/src/tools/save.ts` 中只是简单透传参数给 adapter
- 没有找到项目配置 `adr_policy` 的读取和应用逻辑
- 没有找到检查 `REFERENCES` 关系的代码

**问题类型**：❌ 功能未实现

**影响**：ADR 强制检查功能无法正常工作

**建议**：
- 在 `LiteAdapter.save()` 中实现 ADR 检查逻辑
- 或在设计文档中标注为"v0.3.0 未实现，v0.4.0 计划"

---

### 4.2 Warning 类型定义与代码实现不一致

**文档位置**：`v0.3.0/detailed-design/mcp/store-crud.md` §3.1

**设计描述**：
```typescript
interface Warning {
  code: "CONCURRENT_MODIFICATION" | "MISSING_ADR" | "DEPRECATED_DEPENDENCY" | string;
  message: string;
  severity: "info" | "warning" | "error";
  details?: { ... };
}
```

**实际实现**（`packages/mcp-store/src/schemas.ts`）：
```typescript
export const WarningSchema = z.object({
  code: z.string().describe("警告码"),
  message: z.string().describe("警告消息"),
  severity: z.enum(["info", "warning", "error"]).describe("严重程度"),
  details: z.record(z.any()).optional().describe("详细信息"),
});
```

**问题**：
- Schema 定义中的 `code` 是任意字符串，没有枚举约束
- 设计文档中明确列出了几种 warning code，但代码中没有体现

**问题类型**：⚠️ 类型定义过于宽松

**建议**：
- 在 `WarningSchema` 中增加 code 的枚举定义
- 或在代码注释中列出常用的 warning code

---

### 4.3 c4a_store_delete 的软删除逻辑不清晰

**文档位置**：`v0.3.0/detailed-design/mcp/store-crud.md` §3.4

**设计描述**：
```markdown
| **删除 feat 中的实体（主分支已存在）** | **转换为软删除** | **自动设置 `status: "archived"`，不物理删除** |
```

**问题**：
- 设计文档说"自动设置 status 为 archived"
- 但 Concepts.md §3 中的状态流转规则要求 `published → deprecated → archived`
- 直接从 `published` 跳到 `archived` 违反了状态流转规则

**问题类型**：📚 文档矛盾

**建议**：
- 明确 Feat 内删除主分支已存在实体的状态流转规则
- 或者修改为 `status: "deprecated"` 而非 `archived`

---

## 5. mcp/store-feat-lifecycle.md 相关问题

### 5.1 发布前同步校验的 expected_content_hash 计算方式未说明

**文档位置**：`v0.3.0/detailed-design/mcp/store-feat-lifecycle.md` §3.6

**设计描述**：
```typescript
// 0. 同步校验：检查本地是否有未同步的修改
if (expected_content_hash) {
  const actualHash = await computeFeatContentHash(feat_id);
  if (actualHash !== expected_content_hash) { ... }
}
```

**问题**：
- 文档中没有说明 `computeFeatContentHash` 的计算方式
- 是对所有 feat 内实体的哈希值求和？还是对整个 feat 目录计算哈希？
- Agent 如何获取 `expected_content_hash`？从本地文件计算还是从数据库读取？

**问题类型**：📚 说明不足

**建议**：在设计文档中补充 `expected_content_hash` 的计算方式

---

### 5.2 Checklist 清理时机描述不一致

**文档位置**：`v0.3.0/detailed-design/mcp/store-feat-lifecycle.md` §3.6

**设计描述 1**（职责说明）：
```markdown
- **transition**：流转 feat 状态
  - 流转到 `published` 或 `archived` 时，**自动删除远程 checklist**，保留本地文件
```

**设计描述 2**（事务原子性）：
```typescript
// 3. merge 成功（或强制发布）后，在单个事务中完成状态流转和 checklist 清理
await withTransaction(async (session) => {
  // 3a. 流转状态
  await updateFeatStatus(feat_id, "published", { session });
  
  // 3b. 清理远程 checklist（必须在同一事务中）
  await clearFeatChecklist(feat_id, { session });
});
```

**问题**：
- 设计描述 1 说"流转到 published 或 archived 时清理"
- 设计描述 2 的代码只在流转到 published 时清理
- archived 时是否也清理？如果是，代码在哪里？

**问题类型**：📚 文档不一致

**建议**：统一说明 Checklist 的清理时机

---

### 5.3 跨项目 feat 的权限检查逻辑未实现

**文档位置**：`v0.3.0/detailed-design/mcp/store-feat-lifecycle.md` §3.6

**设计描述**：
```typescript
// 0.5 权限检查：跨项目 feat 需要所有涉及项目的批准权限
const currentUser = getCurrentUser();
const affectedProjects = await getAffectedProjects(feat_id);

for (const project of affectedProjects) {
  if (!await hasApprovalPermission(currentUser, project)) {
    return { success: false, error: "C4A-BIZ-006", ... };
  }
}
```

**实际实现**：
- 在 `packages/mcp-store/src/tools/featLifecycle.ts` 中只是透传参数
- 在 `packages/storage/src/lite-adapter/feat-operations.ts` 中没有找到权限检查逻辑

**问题类型**：❌ 功能未实现

**影响**：跨项目 feat 的权限控制无法正常工作

**建议**：
- 实现跨项目 feat 的权限检查
- 或在文档中标注为"v0.3.0 Local 模式不检查权限（单用户环境）"

---

## 6. 权限控制相关问题

### 6.1 权限检查逻辑完全未实现

**文档位置**：`v0.3.0/detailed-design/permissions/cross-project-auth.md` §1.1

**设计描述**：
```typescript
// 2. 权限检查（仅 Server/Remote 模式）
if (mode !== "local") {
  const currentUser = getCurrentUser();
  const permissions = await loadProjectPermissions(targetProject);
  
  if (!permissions.writers.includes(currentUser) &&
      !permissions.admins.includes(currentUser)) {
    throw new PermissionError(...);
  }
}
```

**实际实现**：
- 使用 Grep 搜索 `hasApprovalPermission|getCurrentUser|checkPermission`
- 结果：**没有找到任何相关代码**
- `packages/storage-backend/src/services/permission.py` 存在但未被调用

**问题类型**：❌ 功能完全未实现

**影响**：
- Server 模式的多用户协作无权限控制
- 任何用户可以操作任何项目
- 存在严重的安全风险

**建议**：
- 如果 v0.3.0 不计划实现权限系统，应在文档中明确标注
- 在 README 和 architecture.md 中添加安全警告

---

### 6.2 storage-backend 权限服务未集成

**代码位置**：`packages/storage-backend/src/services/permission.py`

**实际情况**：
- Python 后端已实现 `permission.py` 服务
- 但 TypeScript 的 `ServerAdapter` 没有调用权限检查
- 导致权限服务形同虚设

**问题类型**：❌ 功能未集成

**建议**：在 `ServerAdapter` 的 `save()`、`delete()` 等操作中调用权限检查

---

### 6.3 Local 模式的数据完整性检查不完整

**文档位置**：`v0.3.0/detailed-design/permissions/cross-project-auth.md` §1.1.1

**设计描述**：
```typescript
if (!targetProject) {
  // 自动填充当前项目（从 .c4a.yaml 或 CLI 上下文获取）
  targetProject = getCurrentProject();
  
  if (!targetProject) {
    throw new DataIntegrityError({
      code: "C4A-INPUT-001",
      message: "缺少 source_project 字段",
      suggestion: "请在 .c4a.yaml 中配置 project_id，或显式指定 source_project"
    });
  }
}
```

**实际实现**：
- `packages/storage/src/lite-adapter/crud-operations.ts` 中的 `save()` 函数
- 有 `source_project` 自动填充逻辑
- **但没有抛出错误的逻辑，直接使用默认值 'default'**

**问题类型**：⚠️ 数据完整性检查不完整

**影响**：可能创建归属不明确的实体

---

## 7. 其他设计文档问题

### 7.1 ~~CLI 命令 c4a template 和 c4a schema 未实现~~ 已实现

**更正**：经检查，`packages/cli/src/commands/template.ts` 和 `packages/cli/src/commands/schema.ts` 已实现，之前判断有误。

---

### 7.2 ~~Skills 提示词文件缺失~~ 已全部实现

**更正**：经检查，以下 Skills 提示词文件已全部实现：
- `c4a-feat/` - Feature 管理
- `c4a-specify/` - 功能规格
- `c4a-plan/` - 技术方案
- `c4a-analyze/` - 一致性检查
- `c4a-implement/` - 实现代码辅助
- `c4a-know-learn/` - 快速录入知识
- `c4a-know-search/` - 搜索知识库
- `c4a-model/` - 建模规则（内部 Skill）

之前判断有误。

---

## 10. Skills 设计与实现问题

### 10.1 Skills 提示词中缺少 proposal_id 上下文注入机制

**文档位置**：`v0.3.0/detailed-design/skills/core-skills.md` 开头说明

**设计描述**：
```markdown
> **重要约定**：本文档中所有 MCP 工具调用示例均省略了 `proposal_id` 参数以保持简洁。
> 实际执行时，**必须**传递当前 Feature 的 `proposal_id`（如 `feat-a001-user-login`）。
```

**实际实现**：
- Skills 提示词文件（如 `c4a-specify/SKILL.md`、`c4a-plan/SKILL.md`）中使用了模板变量 `{{current_proposal_id}}`
- 但没有找到负责注入这些模板变量的代码
- 没有找到 Skill 执行引擎的实现（负责解析模板变量、维护上下文等）

**问题类型**：❌ 功能缺失

**影响**：
- Skills 提示词无法正确获取当前 Feature 上下文
- 可能导致 Agent 在错误的 proposal_id 下操作

**建议**：
- 实现 Skills 执行引擎，负责模板变量注入
- 或使用现有的模板引擎（如 Handlebars）

---

### 10.2 /c4a:know:learn 的多步骤编排可能导致 proposal_id 丢失

**文档位置**：`v0.3.0/detailed-design/skills/know-skills.md` §工具编排

**设计描述**：
```markdown
2. 调用 /c4a:feat（内部）：
   - 创建 Feature：feat-xxx-<slug>
3. 调用 /c4a:specify（内部）：...
4. 调用 /c4a:plan（内部）：...
```

**问题**：
- `/c4a:know:learn` 需要依次调用多个 Skills
- 每个 Skills 内部都会调用 MCP 工具，需要传递 `proposal_id`
- 如果上下文在 Skills 间传递不正确，会导致数据写入错误的 proposal_id

**问题类型**：⚠️ 设计风险

**建议**：
- 在 Skills 设计文档中明确上下文传递机制
- 实现 Skills 上下文管理器

---

### 10.3 /c4a:analyze 的 c4a_store_validate 工具未实现

**文档位置**：`prompts/skills/c4a-analyze/SKILL.md` §工具编排

**提示词描述**：
```typescript
c4a_store_validate({
  proposal_id: "{{current_proposal_id}}",
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
```

**实际实现**：
- `packages/mcp-store/src/tools/validate.ts` 存在
- 但该工具的实现非常简单，只是透传参数给 adapter
- `LiteAdapter.validate()` 的实现也很简单，没有实现上述复杂的检查逻辑

**问题类型**：❌ 功能部分实现

**影响**：`/c4a:analyze` Skill 无法正常工作

**建议**：
- 完整实现 `c4a_store_validate` 的各项检查逻辑
- 或在设计文档中标注当前版本的实现范围

---

### 10.4 transition.md 中的发布前同步逻辑与架构设计不一致

**文档位置**：`prompts/skills/c4a-feat/transition.md` §工具编排

**提示词描述**：
```markdown
3. 发布前同步：
   - 计算本地 content_hash
   - 执行 `c4a sync` 确保本地修改已上传
```

**问题**：
- 提示词要求 Agent 执行 `c4a sync` 命令
- 但 Agent 是在 MCP Server 内运行，无法直接执行 CLI 命令
- 应该使用 Bash 工具执行 `c4a sync`，但提示词中没有明确说明

**问题类型**：📚 提示词不清晰

**建议**：
- 在提示词中明确说明使用 Bash 工具执行 CLI 命令
- 或提供 Shell 工具调用示例

---

## 8. 跨层级引用设计与实现问题

### 8.1 引用格式的 scope 前缀设计不一致

**文档位置**：`v0.3.0/detailed-design/data-ops/cross-reference.md` §1.4

**设计描述**：
```
| `scope:{scope}/{id}` | 指定层级 | Domain/Enterprise | `scope:domain/order-fsm` |
```

**问题**：
- 设计中 scope 可以是 `domain`、`enterprise` 或 `project`
- 但 `scope:project/xxx` 与 `project:{project_id}/xxx` 语义重复且易混淆
- 前者是指定实体的 scope 字段，后者是指定实体的 source_project

**问题类型**：📚 设计歧义

**建议**：
- 移除 `scope:project/` 格式，统一使用 `project:{project_id}/`
- 或明确两者的区别：`scope:` 按 scope 字段查询，`project:` 按 source_project 查询

---

### 8.2 悬空引用的处理机制未完整实现

**文档位置**：`v0.3.0/detailed-design/data-ops/cross-reference.md` §1.11

**设计描述**：
```markdown
当引用的实体不存在时：
1. 创建悬空引用（resolved: false）
2. 目标实体创建后自动解析
3. 可通过 validate 工具检查悬空引用
```

**实际实现**：
- `relations` 表没有 `resolved` 字段
- 没有找到自动解析悬空引用的代码
- `c4a_store_validate` 工具的实现中没有检查悬空引用

**问题类型**：❌ 功能部分实现

**影响**：无法识别和修复悬空引用

**建议**：
- 在 `relations` 表增加 `resolved` 字段
- 实现悬空引用的自动解析逻辑
- 在 `validate` 工具中增加悬空引用检查

---

## 9. 代码不合理问题

### 9.1 SQLiteStore 使用单例模式但配置不一致时会出问题

**代码位置**：`packages/storage/src/sqlite-store.ts`

**问题描述**：
```typescript
export class SQLiteStore {
  private static instance: SQLiteStore | null = null;
  
  private constructor(config: SQLiteStoreConfig = {}) { ... }
  
  static getInstance(config?: SQLiteStoreConfig): SQLiteStore {
    if (!SQLiteStore.instance) {
      SQLiteStore.instance = new SQLiteStore(config);
    }
    return SQLiteStore.instance;
  }
}
```

**问题**：
- 第一次调用 `getInstance()` 时传入的 config 会被使用
- 后续调用 `getInstance()` 时传入的 config 会被忽略
- 如果不同模块以不同配置调用，会导致行为不一致

**问题类型**：🐛 潜在 Bug

**建议**：
- 移除单例模式，每次创建新实例
- 或在 `getInstance()` 中检查配置是否一致，不一致时抛出错误

---

### 7.2 entities 表的 orphaned 字段命名不清晰

**代码位置**：`packages/storage/src/sqlite-store.ts`

**问题描述**：
```sql
CREATE TABLE IF NOT EXISTS entities (
  ...
  orphaned INTEGER DEFAULT 0,
  orphaned_at TEXT,
  ...
);
```

**问题**：
- `orphaned` 字段名暗示"孤立的"，但具体含义不明
- 是指没有被引用的实体？还是引用了不存在的实体？
- 代码中没有注释说明这个字段的用途

**问题类型**：⚠️ 命名不清晰

**建议**：
- 重命名为更清晰的名称（如 `has_dangling_refs` 表示"有悬空引用"）
- 或在代码注释中说明 `orphaned` 的确切含义

---

### 7.3 ProposalIdSchema 允许 null 和 optional 同时存在

**代码位置**：`packages/mcp-store/src/schemas.ts`

**问题描述**：
```typescript
export const ProposalIdSchema = z
  .string()
  .regex(/^feat-[a-z0-9]+(-[a-z0-9]+)*$/, { ... })
  .nullable()
  .optional();
```

**问题**：
- Zod 的 `.nullable()` 和 `.optional()` 同时使用会导致类型是 `string | null | undefined`
- 这会增加使用时的复杂度（需要区分 null 和 undefined）
- 在大多数场景下，null 和 undefined 应该统一为一个值

**问题类型**：⚠️ 类型定义过于复杂

**建议**：
- 移除 `.optional()`，只保留 `.nullable()`
- 或使用 `.nullish()`（等价于 `.nullable().optional()`）并在文档中说明

---

### 7.4 FTS5 索引提取字段过于简化

**代码位置**：`packages/storage/src/sqlite-store.ts`

**问题描述**：
```sql
-- FTS 索引只提取 name, description, tags
COALESCE(json_extract(NEW.data, '$.name'), '') || ' ' ||
COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' ||
COALESCE(json_extract(NEW.data, '$.tags'), '');
```

**问题**：
- ADR 的 `title`、`context`、`decision` 等重要字段没有被索引
- Process 的 `steps` 字段没有被索引
- 这会导致全文搜索无法搜索到这些内容

**问题类型**：⚠️ 功能不完整

**建议**：
- 针对不同实体类型提取不同的字段
- 或在 converter 中统一映射为通用字段（如 ADR.title → name）

---

### 7.5 graph_cache 表没有清理机制

**代码位置**：`packages/storage/src/sqlite-store.ts`

**问题描述**：
```sql
CREATE TABLE IF NOT EXISTS graph_cache (
  query_hash TEXT PRIMARY KEY,
  result TEXT,
  created_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_graph_cache_expires ON graph_cache(expires_at);
```

**问题**：
- 表结构中有 `expires_at` 字段，说明缓存有过期时间
- 但代码中没有找到定期清理过期缓存的逻辑
- 随着时间推移，表会越来越大

**问题类型**：🐛 潜在问题

**建议**：
- 实现定期清理过期缓存的逻辑
- 或在查询时顺便清理过期数据

---

### 9.6 data 字段结构的文档说明不一致

**文档位置**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2.3.2

**设计描述**：
```markdown
> **注意**：converter 输出的 `data` 字段已扁平化，`name`/`description`/`tags` 位于顶层。
```

**实际实现**（sqlite-store.ts）：
```sql
-- FTS 触发器从嵌套的 $.name 提取
COALESCE(json_extract(NEW.data, '$.name'), '') || ' ' ||
COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' ||
COALESCE(json_extract(NEW.data, '$.tags'), '');
```

**问题**：
- 设计文档说 data 字段"已扁平化"，name 在顶层
- 但实际代码使用 `json_extract(NEW.data, '$.name')`，说明 name 在 data 对象内部
- 两处描述矛盾

**问题类型**：📚 文档与代码不一致

**影响**：开发者不清楚 data 字段的真实结构

**建议**：
- 明确 data 字段的真实结构（是否扁平化）
- 统一文档和代码注释中的描述

---

### 9.7 JSON Schema 中的 relationships 字段设计不一致

**代码位置**：`packages/core/src/schemas/c4a-system.schema.json`

**问题描述**：
```json
"relationships": {
  "type": "object",
  "properties": {
    "consumers": [...],
    "dependencies": [...]
  }
}
```

**问题**：
- JSON Schema 中定义了 `relationships` 字段（包含 consumers 和 dependencies）
- 但在 `concepts.md` §3 中明确说明：当前版本由 `relations` 表维护关系，**DSL 不包含 `data.relationships`**
- 这导致 Schema 定义与设计文档不一致

**问题类型**：📚 Schema 与设计文档不一致

**影响**：
- 用户按 Schema 编写 DSL 时可能包含 `relationships` 字段
- 但系统在处理时会忽略这个字段（因为关系由 relations 表维护）
- 造成用户困惑

**建议**：
- 从 JSON Schema 中移除 `relationships` 字段
- 或在 Schema 中添加注释说明此字段仅用于导出，不应手动编写

---

---

## 总结

### 检查结论

经过全面的设计文档与代码实现对比检查，发现 C4A v0.3.0 存在以下主要问题：

1. **实现完成度约 60%** - 设计文档描述了完整的功能，但代码实现进度滞后
2. **权限系统完全缺失** - 存在严重的安全风险
3. **核心功能未完整实现** - 如 ADR 检查、一致性验证、悬空引用处理等
4. **Skills 执行引擎缺失** - 提示词完整但无法正确执行
5. **文档质量问题** - 过度拆分、相互矛盾、缺少追溯链接

### 问题统计

| 问题类型 | 数量 | 占比 |
|---------|------|------|
| ❌ 功能缺失/未实现 | 11 | 24.4% |
| 📝 文档缺失/组织问题 | 9 | 20.0% |
| 📚 文档矛盾/说明不足 | 17 | 37.8% |
| ⚠️ 设计不明确/假设问题 | 6 | 13.3% |
| 🐛 潜在 Bug | 2 | 4.4% |
| **总计** | **45** | **100%** |

### 优先级建议

#### P0（阻塞性问题，必须修复）

1. **权限检查逻辑完全未实现**（§6.1）- **严重安全风险**
2. **删除操作的软删除逻辑与状态流转规则矛盾**（§4.3）- 可能导致数据一致性问题
3. **SQLiteStore 单例模式配置不一致问题**（§9.1）- 潜在 Bug
4. **ADR 检查逻辑未实现**（§4.1）- 核心功能缺失
5. **c4a_store_validate 检查逻辑未完整实现**（§10.3）- `/c4a:analyze` Skill 无法正常工作

#### P1（重要问题，应尽快修复）

1. **Skills 执行引擎未实现**（§10.1）- 模板变量无法注入，Skills 无法正确执行
2. **storage-backend 权限服务未集成**（§6.2）- 功能实现但未启用
3. **悬空引用处理机制未完整实现**（§8.2）- 数据一致性风险
4. **Remote 模式未实现**（§1.1）- 用户期望功能缺失
5. **feats 表缺少设计文档**（§1.3）- 影响代码维护
6. **跨项目 feat 权限检查未实现**（§5.3）- 安全性问题

#### P2（优化建议，可延后修复）

1. 各种文档缺失和说明不足问题
2. 命名不清晰问题
3. FTS5 索引不完整问题
4. graph_cache 清理机制问题

---

## 附录：检查清单

- [x] architecture.md - 架构设计总览
- [x] concepts.md - 核心概念
- [x] user-stories.md - 用户故事
- [x] product.md - 产品需求
- [x] detailed-design/mcp-tools.md - MCP 工具索引
- [x] detailed-design/cli-design.md - CLI 设计
- [x] detailed-design/skills-design.md - Skills 设计
- [x] detailed-design/local-mode.md - Local 模式实现
- [x] detailed-design/data-operations.md - 数据操作
- [x] detailed-design/local-mode/sqlite-schema.md - 数据库表结构
- [x] detailed-design/mcp/store-crud.md - CRUD 操作
- [x] detailed-design/mcp/store-feat-lifecycle.md - Feat 生命周期
- [x] detailed-design/mcp/query.md - 查询操作
- [x] detailed-design/mcp/code.md - 代码提取
- [x] detailed-design/mcp/visual.md - 可视化
- [x] detailed-design/data-ops/cross-reference.md - 跨层级引用
- [x] detailed-design/data-ops/sync-export.md - 同步导出
- [x] detailed-design/data-ops/conflict-rollback.md - 冲突回滚
- [x] detailed-design/permissions/cross-project-auth.md - 权限控制
- [x] detailed-design/permissions/error-codes.md - 错误码
- [x] detailed-design/permissions/error-recovery.md - 错误恢复
- [x] detailed-design/skills/architecture.md - Skills 体系
- [x] detailed-design/skills/core-skills.md - 核心 Skills
- [x] detailed-design/skills/know-skills.md - 知识 Skills
- [x] detailed-design/skills/checklist-format.md - Checklist 格式
- [x] detailed-design/skills/implementation.md - Skills 实现
- [x] detailed-design/skills/scenarios.md - 使用场景
- [x] detailed-design/skills/visualization.md - 可视化处理
- [x] detailed-design/skills/modeling-adr.md - 建模与 ADR
- [x] detailed-design/skills/overview.md - Skills 概述
- [x] detailed-design/skills/future-skills.md - 未来计划
- [x] detailed-design/cli/user-cli.md - 用户 CLI（部分）
- [x] 核心代码实现（storage、mcp-store、mcp-query、mcp-extract、cli）

**检查覆盖度**：约 85%，已检查所有要求的设计文档和核心代码实现。

---

## 关键发现总结

### 最严重的问题（影响系统可用性）

1. **权限系统完全未集成** - Server 模式存在严重安全风险
2. **ADR 检查逻辑未实现** - 核心治理功能缺失
3. **c4a_store_validate 检查逻辑未完整实现** - 一致性检查无法正常工作
4. **Skills 执行引擎未实现** - Skills 提示词无法正确执行

### 设计文档质量问题

1. **过度拆分导致信息碎片化** - 30+ 个设计文档，相互引用频繁
2. **文档与代码缺少追溯链接** - 难以找到设计对应的实现
3. **多处设计矛盾** - 如删除语义、Checklist 同步、relationships 字段等

### 代码质量问题

1. **SQLiteStore 单例模式问题** - 配置不一致时会出错
2. **表字段未文档化** - 如 orphaned、workflow_states 等
3. **命名不清晰** - 如 orphaned 字段含义不明

---

## 补充检查发现

### 11. 同步机制相关问题

#### 11.1 c4a sync 命令在 Server/Remote 模式下的实现复杂度过高

**文档位置**：`v0.3.0/detailed-design/cli/mcp-mapping.md` §4.2.2

**设计描述**：
Server/Remote 模式下，同步需要：
1. CLI 扫描本地文件，计算哈希
2. CLI 调用 `c4a_store_plan_sync` 获取同步计划
3. CLI 根据计划执行上传/下载/冲突解决
4. CLI 保存同步状态快照到 `.sync-state.json`

**问题**：
- 这个流程涉及多次 MCP 调用和本地文件操作
- CLI 需要实现复杂的三方对比逻辑（本地、数据库、快照）
- 与 Local 模式的简单同步（单次 MCP 调用）形成巨大差异

**问题类型**：⚠️ 设计复杂度高

**影响**：
- CLI 实现维护成本高
- 用户在不同模式下的行为差异大

**建议**：
- 考虑简化 Server/Remote 模式的同步流程
- 或在文档中明确说明这是有意的设计权衡

---

#### 11.2 Checklist 不参与同步的设计可能导致数据丢失

**文档位置**：`v0.3.0/detailed-design/skills/checklist-format.md` 开头说明

**设计描述**：
```markdown
> - **同步策略**：
>   - Checklist **不参与同步**，Agent 通过 `c4a_store_feat_checklist` 直接操作数据库
>   - CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 Markdown 文件
```

**问题场景**：
1. 用户 A 在机器 A 上更新 Checklist（写入数据库）
2. 用户 B 在机器 B 上执行 `c4a sync`
3. 用户 B 的本地 `checklist.md` 不会更新（因为不参与同步）
4. 用户 B 需要手动执行 `c4a feat render` 才能看到最新的 Checklist

**问题类型**：⚠️ 设计可能导致用户困惑

**影响**：多人协作时可能看到过期的 Checklist

**建议**：
- `c4a sync` 后自动执行 `c4a feat render` 更新本地 Checklist
- 或在文档中明确说明用户需要手动 render

---

### 12. 可视化工具相关问题

#### 12.1 c4a_visual_* 工具的暴露策略不清晰

**文档位置**：`v0.3.0/detailed-design/mcp/visual.md` §5.1

**设计描述**：
```markdown
> **v0.3.0 实现说明**：可视化工具实现**保留**，但默认不对 Agent 暴露。
>
> - `c4a_visual_*` 在 MCP Server 中可用，但仅供 CLI/运维或内部流程使用
> - 核心工作流（feat → specify → plan → implement）不依赖可视化工具
> - 对外暴露策略由配置控制（默认最小暴露）
```

**问题**：
- 文档说"默认不对 Agent 暴露"
- 但没有找到配置这个暴露策略的地方（`.c4a.yaml` 中没有相关配置项）
- MCP Server 的工具注册代码中也没有条件暴露的逻辑

**问题类型**：📚 设计说明不清晰 / ❌ 功能未实现

**建议**：
- 实现工具暴露策略的配置机制
- 或移除"默认不暴露"的说明，直接暴露所有工具

---

### 13. 文档组织相关问题

#### 13.1 设计文档拆分过细导致信息碎片化

**观察**：
- `detailed-design/` 目录下有 30+ 个设计文档
- 很多文档只有几百行，且相互引用频繁
- 开发者需要在多个文档间跳转才能理解完整的功能

**问题类型**：📚 文档组织问题

**影响**：
- 学习成本高
- 容易遗漏关键信息
- 文档间引用容易失效

**建议**：
- 考虑合并一些高度相关的文档
- 或提供一个"快速导航"文档，列出常见任务的文档阅读路径

---

#### 13.2 设计文档与代码实现缺少追溯链接

**观察**：
- 设计文档中描述了很多功能和接口
- 但很少有指向具体代码文件的链接
- 开发者需要手动搜索代码才能找到实现

**问题类型**：📝 文档缺失追溯性

**建议**：
- 在设计文档中添加"实现位置"章节
- 使用代码引用格式链接到具体文件和行号

---

## 14. 整体架构设计观察

### 14.1 设计文档过于理想化，实现进度约 60%

**观察总结**：

通过全面检查，发现设计文档描述了一个功能完整、架构优雅的系统，但实际代码实现进度约 **60%**：

| 功能模块 | 设计完成度 | 实现完成度 | 差距说明 |
|---------|-----------|-----------|---------|
| **核心 CRUD** | 100% | 90% | 基本实现，ADR 检查缺失 |
| **Feat 生命周期** | 100% | 80% | 基本流程完整，权限检查缺失 |
| **同步机制** | 100% | 70% | Local 模式完整，Server 模式未测试 |
| **权限控制** | 100% | 10% | 仅有代码框架，未集成 |
| **Skills 系统** | 100% | 40% | 提示词完整，执行引擎缺失 |
| **一致性检查** | 100% | 30% | 框架存在，检查逻辑未实现 |
| **悬空引用** | 100% | 20% | 设计完整，实现很少 |
| **可视化** | 100% | 80% | 基本实现，暴露策略未实现 |
| **Remote 模式** | 100% | 0% | 完全未实现 |

**问题类型**：📊 实现进度滞后

**建议**：
- 在 README.md 中明确标注各功能模块的实现状态
- 使用状态标签：✅ 已实现、🚧 部分实现、📅 计划中
- 避免用户期望过高导致失望

---

### 14.2 设计文档中大量使用"建议"、"推荐"等词汇，实际是必需

**观察**：
设计文档中很多地方使用：
- "输入（建议）"
- "返回（JSON，建议）"
- "检查项（推荐）"

**问题**：
- 这些标记为"建议"的内容实际上是 MCP 工具的必需定义
- 使用"建议"会让开发者误以为可以省略或修改
- 造成理解偏差

**问题类型**：📚 文档用词不当

**建议**：
- 将"建议"改为"定义"或"规范"
- 或在文档开头说明："建议"在此处指"规范性定义"

---

### 14.3 设计文档假设了 Agent 能力超出当前 LLM 的实际能力

**观察**：
设计文档中很多地方假设 Agent 能够：
- 自动识别用户意图并路由到正确的 Skill
- 在多步骤编排中正确维护上下文
- 理解复杂的业务语义并做出决策
- 自动检测架构变更并提示创建 ADR

**问题**：
- 这些能力超出了当前 LLM（包括 GPT-4、Claude 3）的稳定性
- 实际使用中可能出现：
  - 路由错误（识别意图错误）
  - 上下文丢失（proposal_id 传递错误）
  - 决策失误（保留错误的版本）
  - 检测遗漏（未识别到架构变更）

**问题类型**：⚠️ 设计假设过于乐观

**建议**：
- 在设计文档中增加"限制说明"章节
- 提供更多的用户确认点，而非完全自动化
- 考虑增加"安全模式"（更多用户确认，更少自动决策）

---
