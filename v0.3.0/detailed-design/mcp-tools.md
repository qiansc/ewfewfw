# MCP 工具设计文档

> 本文档是 v0.3.0 MCP 工具的**索引页**。各工具的详细定义（参数、返回结构、使用示例）请参阅 `mcp/` 目录下的对应文档，它们是各领域工具的**唯一权威来源**。

## 文档结构

详细设计文档已按功能模块拆分到 `mcp/` 目录：

| 文件 | 内容 | 工具前缀 |
|------|------|----------|
| [mcp/overview.md](mcp/overview.md) | 工具命名约定、返回格式、版本策略 | - |
| [mcp/code.md](mcp/code.md) | 知识采集与提取 | `c4a_extract_*` |
| [mcp/store.md](mcp/store.md) | 存储与同步（索引） | `c4a_store_*` |
| [mcp/query.md](mcp/query.md) | 查询与分析 | `c4a_query_*` |
| [mcp/visual.md](mcp/visual.md) | 可视化渲染 | `c4a_visual_*` |

## Store 工具子模块

Store 工具因内容较多，进一步拆分为：

| 文件 | 内容 | 工具 |
|------|------|------|
| [mcp/store-crud.md](mcp/store-crud.md) | CRUD 基础操作 | `save`, `read`, `list`, `delete` |
| [mcp/store-sync.md](mcp/store-sync.md) | 同步操作 | `sync`, `plan_sync` |
| [mcp/store-feat-lifecycle.md](mcp/store-feat-lifecycle.md) | Feat 生命周期与合并 | `feat_lifecycle`, `feat_merge` |
| [mcp/store-feat-checklist.md](mcp/store-feat-checklist.md) | Checklist 与工作流 | `feat_checklist`, `update_workflow_step` |
| [mcp/store-utils.md](mcp/store-utils.md) | 工具类操作 | `read_history`, `backup`, `restore`, `repair`, `validate` |

## 工具速查表

### Extract 工具 (`c4a_extract_*`)

| 工具 | 用途 | 详细文档 |
|------|------|---------|
| `c4a_extract_interfaces` | 从代码中提取接口/类型/类 | [code.md](mcp/code.md) |
| `c4a_extract_analyze` | 分析代码结构与依赖 | [code.md](mcp/code.md) |
| `c4a_extract_ast` | 获取 AST | [code.md](mcp/code.md) |
| `c4a_extract_contract` | 生成契约 | [code.md](mcp/code.md) |

### Store 工具 (`c4a_store_*`)

| 工具 | 用途 | 详细文档 |
|------|------|---------|
| `c4a_store_save` | 保存/更新实体 | [store-crud.md](mcp/store-crud.md) |
| `c4a_store_read` | 读取实体/列表 | [store-crud.md](mcp/store-crud.md) |
| `c4a_store_list` | 列出实体概要 | [store-crud.md](mcp/store-crud.md) |
| `c4a_store_delete` | 删除实体 | [store-crud.md](mcp/store-crud.md) |
| `c4a_store_sync` | 文件系统 ↔ 数据库 | [store-sync.md](mcp/store-sync.md) |
| `c4a_store_plan_sync` | 同步计划 | [store-sync.md](mcp/store-sync.md) |
| `c4a_store_feat_lifecycle` | Feat 生命周期管理 | [store-feat-lifecycle.md](mcp/store-feat-lifecycle.md) |
| `c4a_store_feat_merge` | Feat 合并与冲突解决 | [store-feat-lifecycle.md](mcp/store-feat-lifecycle.md) |
| `c4a_store_feat_checklist` | Checklist 管理 | [store-feat-checklist.md](mcp/store-feat-checklist.md) |
| `c4a_store_update_workflow_step` | 原子更新 workflow 步骤 | [store-feat-checklist.md](mcp/store-feat-checklist.md) |
| `c4a_store_read_history` | 查询实体变更历史 | [store-utils.md](mcp/store-utils.md) |
| `c4a_store_backup` | 备份数据 ⚠️ | [store-utils.md](mcp/store-utils.md) |
| `c4a_store_restore` | 恢复数据 ⚠️ | [store-utils.md](mcp/store-utils.md) |
| `c4a_store_repair` | 修复数据一致性 | [store-utils.md](mcp/store-utils.md) |
| `c4a_store_validate` | 架构一致性检查 | [store-utils.md](mcp/store-utils.md) |

> ⚠️ **运维工具说明**：`c4a_store_backup` 和 `c4a_store_restore` 是运维工具，**仅供 CLI 内部调用，不对 Agent 暴露**。用户通过 `c4a local/server backup` 和 `c4a local/server restore` 命令使用，CLI 负责用户交互和决策点处理（如覆盖确认、冲突策略选择）。详见 [architecture.md §5.2](../architecture.md#52-同步与备份)。

> `c4a_store_generate_template` 和 `c4a_store_get_schema` 已移至 CLI 内部实现，详见 [store-utils.md](mcp/store-utils.md#312-已移除的工具)。

### Query 工具 (`c4a_query_*`)

| 工具 | 用途 | 详细文档 |
|------|------|---------|
| `c4a_query_search` | 语义搜索 | [query.md](mcp/query.md) |
| `c4a_query_deps` | 依赖查询 | [query.md](mcp/query.md) |
| `c4a_query_impact` | 影响分析 | [query.md](mcp/query.md) |

### Visual 工具 (`c4a_visual_*`)

| 工具 | 用途 | 详细文档 |
|------|------|---------|
| `c4a_visual_generate` | AI 生成图片 | [visual.md](mcp/visual.md) |
| `c4a_visual_render_c4` | C4 架构图生成 | [visual.md](mcp/visual.md) |

> 其他可视化辅助功能（模板管理、存储统计、缓存清理）由 CLI 内部实现，不作为独立 MCP 工具暴露。详见 [visual.md](mcp/visual.md#53-已移除的工具)。

