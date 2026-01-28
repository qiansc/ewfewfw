# MCP 工具概述

> 本文档是 `docs/v0.3.0/*` 中所有 MCP 工具名称、参数与返回结构的**唯一权威来源**。
>
> 目标：避免 `concepts.md` / `product.md` / `architecture.md` / `detailed-design/*` 各写一套名字导致漂移。

## 1. 工具命名与返回格式约定

### 1.1 工具分组（按设计层能力域）

> 说明：这里是 **v0.3.0 规划/设计层** 的工具面（不绑定任何具体实现形态、存储选型或部署方式）。

| 分组 | 前缀 | 能力 |
|------|------|------|
| **Code** | `c4a_code_*` | 代码分析/提取/AST/契约 |
| **Store** | `c4a_store_*` | 写入/读取/列表/同步/feat 管理 |
| **Query** | `c4a_query_*` | 语义搜索、依赖/影响分析 |
| **Visual** | `c4a_visual_*` | AI 图片生成、C4 架构图渲染 |

### 1.2 工具可见性分层

MCP 工具按使用场景分为三层，帮助 Agent 和开发者理解工具定位：

#### 核心工具（Agent 日常使用）

Agent 完成知识管理任务的必需工具：

| 工具 | 用途 |
|------|------|
| `c4a_code_extract` | 从代码提取接口/类型 |
| `c4a_code_analyze` | 分析代码结构与依赖 |
| `c4a_code_contract` | 生成 API 契约 |
| `c4a_store_save` | 保存/更新实体 |
| `c4a_store_read` | 读取实体 |
| `c4a_store_list` | 列出实体概要 |
| `c4a_store_delete` | 删除实体 |
| `c4a_store_sync` | 文件系统同步（Local 模式） |
| `c4a_store_plan_sync` | 同步计划（Server/Remote 模式） |
| `c4a_store_feat_lifecycle` | Feat 生命周期管理 |
| `c4a_store_feat_merge` | Feat 合并与冲突解决 |
| `c4a_store_feat_checklist` | Checklist 管理 |
| `c4a_query_search` | 语义搜索 |
| `c4a_query_deps` | 依赖查询 |
| `c4a_query_impact` | 影响分析 |
| `c4a_visual_generate` | AI 生成图片 |
| `c4a_visual_render_c4` | C4 架构图生成 |

#### 辅助工具（Agent 按需使用）

特定场景下使用的工具：

| 工具 | 用途 | 典型场景 |
|------|------|---------|
| `c4a_code_ast` | 获取 AST | 深度代码分析 |
| `c4a_store_validate` | 架构一致性检查 | 发布前检查 |
| `c4a_store_read_history` | 查询变更历史 | 追溯实体演进 |
| `c4a_store_update_workflow_step` | 原子更新 workflow 步骤 | Skills 错误恢复 |

#### 运维工具（CLI 命令封装）

这些工具主要供运维人员通过 CLI 命令使用，Agent 通常不直接调用：

| 工具 | CLI 命令 | 用途 |
|------|---------|------|
| `c4a_store_backup` | `c4a local/server backup` | 备份数据 |
| `c4a_store_restore` | `c4a local/server restore` | 恢复数据 |
| `c4a_store_repair` | `c4a local/server repair` | 修复数据一致性 |

> **说明**：运维工具仍然是 MCP 工具，CLI 命令是其封装。Agent 在特殊场景下（如用户明确要求）也可以直接调用。

#### CLI 内部实现（不暴露为 MCP）

以下功能由 CLI 内部实现，不作为独立 MCP 工具暴露：

| 功能 | CLI 命令/实现方式 | 说明 |
|------|------------------|------|
| DSL 模板生成 | `c4a template <type>` | 读取本地模板文件 |
| JSON Schema 查询 | `c4a schema <type>` 或内部读取 | 读取本地 Schema 文件 |

> **设计理由**：这些功能是静态资源查询，不需要通过 MCP 动态获取。Agent 的 prompt 中已包含 DSL 规范，验证逻辑在 `c4a_store_save` 内部执行。

### 1.3 参数命名约定

为帮助 Agent 理解不同工具间的参数关系，说明以下命名约定：

#### proposal_id 与 feat_id

| 参数名 | 使用场景 | 说明 |
|--------|---------|------|
| `proposal_id` | Store 基础工具 (`c4a_store_save/read/list/delete`) | 数据库底层的通用隔离概念，支持未来扩展其他提案类型 |
| `feat_id` | Feat 业务工具 (`c4a_store_feat_*`) | 具体的业务对象标识 |

**在 Feat 上下文中，`proposal_id` 等同于 `feat_id`**，值相同（如 `feat-a001-user-login`）。

#### source_project 与 project_id

| 参数名 | 使用场景 | 说明 |
|--------|---------|------|
| `source_project` | `c4a_store_save` 写入参数 | 指定实体的归属项目，存储到 `metadata.source_project` |
| `project_id` | `c4a_store_list` 过滤参数、配置文件 | 作为查询过滤条件，简化参数名 |

**两者指向同一概念**：实体所属的项目标识。写入时用 `source_project` 强调"归属"，查询时用 `project_id` 简化使用。

### 1.4 返回格式（MCP Envelope）

大多数 MCP Server 会把"业务返回值"序列化成 JSON（或字符串），放到 MCP 的 `content[].text` 中返回；文档中展示的"返回结构"指的是该 `text` 内部对应的业务 JSON/字符串。

**错误响应标准格式**：

当 MCP 工具执行失败时，返回标准化的错误结构：

```typescript
interface ErrorResponse {
  code: string;           // 错误码，如 "C4A-DATA-001"
  message: string;        // 错误消息（用户友好）
  details?: {             // 详细信息（可选）
    field?: string;       // 出错字段
    expected?: string;    // 期望值
    actual?: string;      // 实际值
    suggestion?: string;  // 修复建议
  };
  timestamp: string;      // 错误发生时间（ISO 8601）
  request_id?: string;    // 请求 ID（用于追踪）

  // 可恢复操作（供 CLI/Agent 决定如何呈现）
  recoverable_actions?: RecoverableAction[];
}

interface RecoverableAction {
  action: string;         // 操作标识，如 "retry", "force", "skip"
  label: string;          // 操作描述
  params?: object;        // 重试时需要的参数
}
```

> **分层职责**：MCP 工具返回结构化错误和 `recoverable_actions`，由 CLI/Agent 层决定如何呈现交互选项。详见 [error-recovery.md#2.2.1](../permissions/error-recovery.md#221-错误处理的分层职责)。
>
> 错误码规范和完整映射表请参考 [permissions-and-errors.md](../permissions-and-errors.md#3-错误码规范)

### 1.5 版本策略

**v0.3.0 是全新设计**，不考虑与之前版本的兼容性：

| 维度 | 策略 | 说明 |
|------|------|------|
| **DSL Schema** | 全新设计 | `schema: c4a/v1` 是 v0.3.0 的唯一 Schema 版本，不支持旧版本 DSL |
| **MCP 工具接口** | 全新定义 | 本文档定义的工具接口为 v0.3.0 的唯一标准 |
| **数据格式** | 不向后兼容 | v0.3.0 的数据库和备份格式与之前版本不兼容 |
| **CLI 版本** | 匹配要求 | CLI 版本必须与 Server/数据库版本匹配 |

**版本号规范**：

```
v{major}.{minor}.{patch}
  │       │       └─ 补丁版本：bug 修复，完全兼容
  │       └─ 次版本：新功能，向后兼容
  └─ 主版本：重大变更，不保证兼容
```

**v0.3.0 版本兼容性规则**：

1. **备份/恢复**：仅支持 v0.3.x 版本之间的备份恢复
2. **CLI 与 Server**：CLI v0.3.x 仅支持 Server v0.3.x
3. **DSL 文件**：`schema: c4a/v1` 是 v0.3.x 的标准格式
4. **跨版本迁移**：v0.2.x → v0.3.0 需要重新建模（无自动迁移）

**设计理由**：

- v0.3.0 对数据模型、工具接口、存储结构进行了根本性重构
- 维护向后兼容会增加复杂度，影响代码质量
- 作为早期版本，优先保证设计的简洁性和正确性

---

## 设计约束（避免实现绑架设计）

- 本文档只定义**工具语义与接口形态**，不绑定具体存储选型（SQLite/Mongo/Neo4j/Milvus 等）与部署方式（stdio/HTTP）。
- 任何实现侧新增的工具名前缀（例如 `*_db_*`、`*_local_*`）都不应写入 v0.3.0 规划文档；如需要实现细节，应另起"实现说明/实现文档"。
