# Part 01 Core Concepts 修复记录

> **更新日期**: 2026-01-27
> **状态**: 已完成

---

## 修复内容

### 1. 反向转换器 (Internal → DSL)

**问题**：`converter.ts` 只有 DSL → Internal 的单向转换，缺少反向转换能力。

**影响**：
- `c4a_store_read` 的 `format: 'yaml'` 输出无法正确转换为 DSL 格式
- Local Mode 的 export 功能无法正确生成 DSL 文件

**修复**：在 `packages/core/src/utils/converter.ts` 中添加以下函数：

| 函数 | 说明 |
|------|------|
| `productToDSL()` | Product → ProductDSL |
| `systemToDSL()` | System → SystemDSL（注意 type 映射：system → software-system） |
| `containerToDSL()` | Container → ContainerDSL |
| `componentToDSL()` | Component → ComponentDSL |
| `processToDSL()` | Process → ProcessDSL |
| `sorToDSL()` | SoR → SoRDSL |
| `adrToDSL()` | ADR → ADRDSL（使用 data.status 保留 superseded） |
| `contractToDSL()` | Contract → ContractDSL（使用 data.status 保留 implemented） |

**关键设计**：
- ADR/Contract 的反向转换使用 `data.status` 而非顶层 `status`，确保特殊状态（superseded/implemented）能正确还原
- System 的反向转换将内部类型 `system` 映射回 DSL 类型 `software-system`

### 2. ADRDSL 类型补充

**问题**：`ADRDSL` 类型定义缺少 `system_id` 字段，但 Schema 中有定义。

**修复**：在 `packages/core/src/types/dsl.ts` 的 `ADRDSL.adr` 中添加 `system_id?: string`。

### 3. c4a-common.schema.json 修复

**问题**：`contractType` 枚举使用 `protobuf`，与其他地方（c4a-contract.schema.json、concepts_fixed.md）不一致。

**修复**：将 `protobuf` 改为 `proto`。

### 4. concepts_fixed.md 示例修正

**问题**：示例中使用 `type: system`，但 DSL Schema 要求 `type: software-system`。

**修复**：
- 将示例中的 `type: system` 改为 `type: software-system`
- 添加修正 8 说明 System type 映射关系

### 5. 数据库路径默认值修复

**问题**：`lite-adapter.ts` 默认数据库路径为 `.context/c4a.db`，与文档要求的 `~/.c4a/store.db` 不一致。

**影响**：与"数据库是全局权威源，.context/ 是视图"的定位冲突。

**修复**：
- `packages/mcp-dsl/src/store/lite-adapter.ts`：默认路径改为 `~/.c4a/store.db`
- `packages/mcp-dsl/src/store/lite-adapter/types.ts`：更新注释

### 6. Contract Schema adr_id pattern 修复

**问题**：`c4a-contract.schema.json` 中 `adr_id` 的 pattern 为 `^ADR-[0-9]{3,4}$`，与文档 ID 规则 `adr-a001-*` 冲突。

**修复**：将 pattern 改为 `^adr-[a-z0-9]+-[a-z0-9-]+$`。

### 7. Feat 状态流转规则修复

**问题**：`feat.ts` 中 `VALID_FEAT_STATUS_TRANSITIONS` 不允许 `published → archived`，但 `architecture.md` 明确允许。

**修复**：
- `packages/core/src/types/feat.ts`：`published` 的目标状态增加 `archived`
- `v0.3.0/concepts_fixed.md`：更新生命周期图，增加快速归档路径

### 8. Part 01 任务描述修正

**问题**：Part 01 任务 1.17 描述为"添加 proposal_id/content_hash/source_project 字段"，与 Part 02 的"DSL Schema 不需要存储层字段"设计决策冲突。

**修复**：修改 `v0.3.0-plan-opus/01-core-concepts.md` 任务 1.17 描述为"更新 DSL Schema（不含存储层字段，由系统生成）"。

**设计原则确认**：
- DSL Schema：只包含业务/架构字段，用于用户编写和 IDE 校验
- 存储层字段（`proposal_id`, `content_hash`, `source_project`）：由系统自动生成，存放在 `StoredEntityMetadata`

---

## 后续模块注意事项

### SQLite 特殊状态查询

**现状**：`list` 函数按 `m.status`（LifecycleStatus）过滤，特殊状态存储在 `data` JSON 字段中。

**影响**：
- 查询 `status: 'superseded'` 的 ADR 会返回空结果（顶层是 `deprecated`）
- 查询 `status: 'implemented'` 的 Contract 会返回空结果（顶层是 `approved`）

**解决方案**：
- 通用状态过滤：使用 `status` 参数
- 特殊状态过滤：使用 `filter: { "data.status": "superseded" }` 参数

**建议**：在 MCP 工具文档中说明此行为。

### c4a_store_save 状态处理

**现状**：Store 层直接存储传入的 `data`，不会二次覆盖 status 字段。

**结论**：当前实现正确。状态映射由 `converter.ts` 处理，Store 层只负责存储。

---

## 相关文件

| 文件 | 修改内容 |
|------|----------|
| `packages/core/src/utils/converter.ts` | 添加 8 个反向转换函数 |
| `packages/core/src/types/dsl.ts` | ADRDSL 添加 system_id 字段 |
| `packages/core/src/schemas/c4a-common.schema.json` | protobuf → proto |
| `v0.3.0/concepts_fixed.md` | 示例修正 + 修正 8 |

---

## 已修复的文档问题

> 以下问题已通过修改 concepts.md 解决（原 concepts_fixed.md 已合并）。

### 问题 1：c4a_store_read 查询示例与实现不一致 ✅

**文档位置**：concepts.md L652-679

**问题描述**：
- 文档示例使用 `c4a_store_read` 传 `filter` 做列表查询和条件检索
- 实际 Local 端 `read` 实现要求必须提供 `id`，否则直接返回 `null`

**修复方案**：修改文档，将查询示例改为使用 `c4a_store_list` + `filter`，并添加说明区分两个工具的用途。

---

### 问题 2：corresponds_to 字段双轨存储文档说明 ✅

**文档位置**：concepts.md L348-362, L903-917

**问题描述**：
- 文档声明"写入时同时更新字段和关系，确保数据一致"
- 实际实现需要用户手动维护 `data.relationships` 数组

**修复方案**：修改文档，明确当前版本需要用户手动维护关系，并添加示例说明如何同时设置字段和关系。

---

### 问题 3：Local 模式归档条件校验文档说明 ✅

**文档位置**：concepts.md L140-143, L929-937

**问题描述**：
- 文档声明 Local 模式应"仅校验人工确认（通过 CLI 交互）"
- 实际 `c4a_local_transition_status` 仅做规则校验和文件移动，无交互确认

**修复方案**：修改文档，明确 Local 模式当前仅校验状态流转规则，不校验归档条件，不提供交互确认。

---

### 问题 4：验收清单基准文档 ✅

**文档位置**：v0.3.0-plan-opus/checklist/01-core-concepts.md

**问题描述**：
- 清单以旧 `concepts.md` 为基准
- 未纳入修正项（修正 1-8）

**处理方式**：已将 `concepts_fixed.md` 合并到 `concepts.md`，验收清单行号已更新。修正项保留在 `concepts.md` 的附录中。

---

### 问题 5：c4a_local_* 工具不应存在 ✅

**问题描述**：
- 实现中存在 `c4a_local_*` 前缀的工具（如 `c4a_local_init_repo`、`c4a_local_list_files`、`c4a_local_read_file`、`c4a_local_write_file`、`c4a_local_transition_status`、`c4a_local_suggest_path`）
- 这些工具从未在 v0.3.0 设计文档中定义
- 违反 `mcp/overview.md` L178 的设计约束："任何实现侧新增的工具名前缀（例如 `*_db_*`、`*_local_*`）都不应写入 v0.3.0 规划文档"

**修复方案**：
- 删除 `packages/mcp-dsl/src/tools/storage/` 整个目录
- 删除 `packages/mcp-dsl/src/schemas/storageSchemas.ts`
- 更新 `packages/mcp-dsl/src/server.ts`，移除所有 `c4a_local_*` 工具注册
- 更新 `v0.3.0/concepts_fixed.md`，将 `c4a_local_transition_status` 引用改为正确的 `c4a_store_save` 和 `c4a_store_feat_lifecycle`

---

### 问题 6：sync-operations.ts software-system 目录映射 ✅

**问题描述**：
- `getEntityFilePath` 函数使用 `type + 's'` 生成目录名
- 对于 DSL 类型 `software-system`，会生成错误的目录 `software-systems/`
- 正确的目录应该是 `systems/`（参考 architecture.md §2.5）

**修复方案**：
- 更新 `packages/mcp-dsl/src/store/lite-adapter/sync-operations.ts` 的 `getEntityFilePath` 函数
- 添加 `software-system` → `system` 的映射逻辑

---

### 问题 7：c4a-sor.schema.json 缺少 acceptance_criteria 字段 ✅

**问题描述**：
- `architecture.md` L807 定义 SoR 应包含 `acceptance_criteria` 字段
- `c4a-sor.schema.json` 中缺少此字段
- TypeScript 类型 `dsl.ts` 中已有定义

**修复方案**：
- 在 `packages/core/src/schemas/c4a-sor.schema.json` 中添加 `acceptance_criteria` 字段定义

---

### 问题 8：c4a_dsl_* 工具不应存在 ✅

**问题描述**：
- 实现中存在 `c4a_dsl_*` 前缀的工具（`c4a_dsl_parse`、`c4a_dsl_validate`、`c4a_dsl_generate`、`c4a_dsl_schema`）
- 这些工具不在 `v0.3.0/detailed-design/mcp-tools.md` 定义的工具列表中
- 文档只定义了四种前缀：`c4a_code_*`、`c4a_store_*`、`c4a_query_*`、`c4a_visual_*`

**修复方案**：
- 删除 `packages/mcp-dsl/src/tools/parse.ts`
- 删除 `packages/mcp-dsl/src/tools/generate.ts`
- 删除 `packages/mcp-dsl/src/tools/schema.ts`
- 删除 `packages/mcp-dsl/src/tools/validate.ts`
- 删除 `packages/mcp-dsl/src/tools/index.ts`
- 删除 `packages/mcp-dsl/src/schemas/inputSchemas.ts`
- 更新 `packages/mcp-dsl/src/server.ts`，移除所有 `c4a_dsl_*` 工具注册

---

### 问题 9：c4a_store_feat_checklist 工具缺失 ✅

**问题描述**：
- `mcp-tools.md` 定义了 `c4a_store_feat_checklist` 工具
- handler 已存在于 `featChecklist.ts`，但未在 server.ts 注册
- Schema 定义缺失

**修复方案**：
- 在 `packages/mcp-dsl/src/schemas/storeSchemas.ts` 添加 `StoreFeatChecklistInputSchema`
- 在 `packages/mcp-dsl/src/server.ts` 注册 `c4a_store_feat_checklist` 工具

---

### 问题 10：BaseEntityMetadata 缺少 kind/perspective 字段 ✅

**问题描述**：
- `architecture.md` §3.3/§3.6 定义了 `kind` 和 `perspective` 字段
- SQLite `EntityRow` 已包含这些字段
- `BaseEntityMetadata` 类型定义缺失，导致核心类型与存储层不一致

**修复方案**：
- 在 `packages/core/src/types/base.ts` 的 `BaseEntityMetadata` 中添加：
  - `kind?: EntityKind`
  - `perspective?: Perspective`

---

### 问题 11：architecture.md 文档不一致 ✅

**问题描述**：
1. System type 示例使用 `type: system` 和旧 Schema URL，应为 `type: software-system` 和 `c4a-*.schema.json`
2. 跨 repo+project 引用格式 `repo:*/project:*` 文档定义但代码未支持
3. ADR 状态未提及 `superseded`
4. Schema 离线回退策略未明确职责分配

**修复方案**：
- 更新 §2.7 Schema 校验示例：`type: system` → `type: software-system`，Schema URL 改为 `c4a-*.schema.json` 格式
- 更新 §3.4.1 引用格式表：添加"支持状态"列，标记 `repo:*/project:*` 为"🔜 未来支持"
- 更新 §2.6 ADR 定位：状态说明添加 `superseded`
- 更新离线支持策略表：添加"实现层"列，明确 IDE/CLI/Core 各层职责

---

### 问题 12：Schema 与 DSL 类型对齐（基于 v0.3.0 设计文档）✅

**问题描述**：
JSON Schema 定义的字段与 TypeScript DSL 类型定义不一致。

**修复内容**：

#### 12.1 Component Schema 添加 v0.3.0 定义的字段

**文件**：`packages/core/src/schemas/c4a-component.schema.json`

**添加字段**（基于 architecture.md §3.8）：
- `container_id`: 所属 Container ID
- `code_path`: 代码路径
- `implements_contract`: 实现的契约 ID

#### 12.2 ADR DSL related_entities 与 Schema affects 对齐

**文件**：`packages/core/src/types/dsl.ts`

**修复**：将 `related_entities?: string[]` 改为与 Schema 一致的 `affects`：
```typescript
affects?: Array<{
  element_type: 'system' | 'container' | 'component';
  element_id: string;
  scope?: string;
}>;
```

#### 12.3 Contract DSL 添加 Schema 中定义的字段

**文件**：`packages/core/src/types/dsl.ts`

**添加字段**：
- `container_id`: 所属容器 ID
- `metadata`: 元数据
- `validation`: 验证信息
- `related`: 关联信息
- `breaking_changes`: 破坏性变更记录

#### 12.4 删除旧版本遗留的 knowledge 字段

**问题**：`knowledge` 字段是 v0.2 遗留设计，不在 v0.3.0 设计文档中。

**修复**：
- 从所有 Schema 文件中删除 `knowledge` 引用
- 从 `c4a-common.schema.json` 中删除 `knowledge` 定义
- 从 DSL 类型中删除 `Knowledge` 类型及相关字段

**影响的文件**：
- `packages/core/src/schemas/c4a-common.schema.json`
- `packages/core/src/schemas/c4a-system.schema.json`
- `packages/core/src/schemas/c4a-container.schema.json`
- `packages/core/src/schemas/c4a-component.schema.json`
- `packages/core/src/schemas/c4a-product.schema.json`
- `packages/core/src/schemas/c4a-process.schema.json`
- `packages/core/src/schemas/c4a-sor.schema.json`
- `packages/core/src/types/dsl.ts`

#### 12.5 删除未在 v0.3.0 定义的 responsibility 字段

**问题**：`responsibility` 字段不在 v0.3.0 设计文档中。

**修复**：
- 从 `c4a-component.schema.json` 中删除 `responsibility` 字段
- 从 `ComponentDSL` 类型中删除 `responsibility` 字段

