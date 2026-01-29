# C4A v0.3.0 设计文档

本目录包含 C4A v0.3.0 的完整设计文档。

## 顶层文档

| 文档 | 说明 |
|------|------|
| [concepts.md](./concepts.md) | 核心概念定义（实体类型、知识生命周期、feat 机制） |
| [architecture.md](./architecture.md) | 系统架构设计（三模式架构、数据流、技术栈） |
| [product.md](./product.md) | 产品设计（用户角色、功能规划） |
| [user-stories.md](./user-stories.md) | 用户故事（使用场景、交互流程） |

---

## 详细设计目录

### 1. MCP 工具设计

**索引文件**: [mcp-tools.md](./detailed-design/mcp-tools.md) - MCP 工具总览与接口规范

| 文件 | 说明 |
|------|------|
| [mcp/overview.md](./detailed-design/mcp/overview.md) | MCP 工具概述与分类 |
| [mcp/code.md](./detailed-design/mcp/code.md) | 知识采集工具（c4a_extract_*） |
| [mcp/query.md](./detailed-design/mcp/query.md) | 查询工具（c4a_query_*） |
| [mcp/store.md](./detailed-design/mcp/store.md) | 存储工具总览（c4a_store_*） |
| [mcp/store-crud.md](./detailed-design/mcp/store-crud.md) | 存储 CRUD 操作详解 |
| [mcp/store-feat-lifecycle.md](./detailed-design/mcp/store-feat-lifecycle.md) | feat 生命周期管理工具 |
| [mcp/store-feat-checklist.md](./detailed-design/mcp/store-feat-checklist.md) | feat 检查清单工具 |
| [mcp/store-sync.md](./detailed-design/mcp/store-sync.md) | 同步工具（本地 ↔ 数据库） |
| [mcp/store-utils.md](./detailed-design/mcp/store-utils.md) | 存储辅助工具 |
| [mcp/visual.md](./detailed-design/mcp/visual.md) | 可视化工具（c4a_visual_*） |

### 2. CLI 架构设计

**索引文件**: [cli-design.md](./detailed-design/cli-design.md) - CLI 架构总览

| 文件 | 说明 |
|------|------|
| [cli/overview.md](./detailed-design/cli/overview.md) | CLI 架构概述 |
| [cli/user-cli.md](./detailed-design/cli/user-cli.md) | 用户 CLI 命令（c4a feat/sync/query） |
| [cli/dev-cli.md](./detailed-design/cli/dev-cli.md) | 开发者 CLI 命令（c4a dev/debug） |
| [cli/mcp-mapping.md](./detailed-design/cli/mcp-mapping.md) | CLI 命令与 MCP 工具映射 |
| [cli/commands-vs-skills.md](./detailed-design/cli/commands-vs-skills.md) | CLI 命令与 Skills 的区别 |
| [cli/structure-migration.md](./detailed-design/cli/structure-migration.md) | CLI 结构迁移指南 |

### 3. Skills 设计

**索引文件**: [skills-design.md](./detailed-design/skills-design.md) - Skills 设计总览

| 文件 | 说明 |
|------|------|
| [skills/overview.md](./detailed-design/skills/overview.md) | Skills 概述与设计原则 |
| [skills/architecture.md](./detailed-design/skills/architecture.md) | Skills 架构设计 |
| [skills/core-skills.md](./detailed-design/skills/core-skills.md) | 核心 Skills（research/adr/review） |
| [skills/know-skills.md](./detailed-design/skills/know-skills.md) | 知识管理 Skills |
| [skills/modeling-adr.md](./detailed-design/skills/modeling-adr.md) | 建模与 ADR Skills |
| [skills/visualization.md](./detailed-design/skills/visualization.md) | 可视化 Skills |
| [skills/implementation.md](./detailed-design/skills/implementation.md) | Skills 实现细节 |
| [skills/checklist-format.md](./detailed-design/skills/checklist-format.md) | 检查清单格式规范 |
| [skills/scenarios.md](./detailed-design/skills/scenarios.md) | Skills 使用场景 |
| [skills/future-skills.md](./detailed-design/skills/future-skills.md) | 未来规划的 Skills |
| [skills/summary.md](./detailed-design/skills/summary.md) | Skills 设计总结 |

### 4. 数据操作

**索引文件**: [data-operations.md](./detailed-design/data-operations.md) - 数据操作总览

| 文件 | 说明 |
|------|------|
| [data-ops/cross-reference.md](./detailed-design/data-ops/cross-reference.md) | 跨项目引用机制 |
| [data-ops/sync-export.md](./detailed-design/data-ops/sync-export.md) | 同步与导出策略 |
| [data-ops/conflict-rollback.md](./detailed-design/data-ops/conflict-rollback.md) | 冲突解决与回滚机制 |
| [data-ops/cross-project-transaction.md](./detailed-design/data-ops/cross-project-transaction.md) | 跨项目事务处理 |

### 5. Local 模式

**索引文件**: [local-mode.md](./detailed-design/local-mode.md) - Local 模式总览

| 文件 | 说明 |
|------|------|
| [local-mode/sqlite-schema.md](./detailed-design/local-mode/sqlite-schema.md) | SQLite 表结构设计 |
| [local-mode/vector-search.md](./detailed-design/local-mode/vector-search.md) | 向量搜索实现（USearch） |
| [local-mode/graph-query.md](./detailed-design/local-mode/graph-query.md) | 图查询实现（内存图） |
| [local-mode/mode-switch.md](./detailed-design/local-mode/mode-switch.md) | 模式切换机制 |
| [local-mode/appendix.md](./detailed-design/local-mode/appendix.md) | 附录（配置、迁移） |

### 6. 权限与错误处理

**索引文件**: [permissions-and-errors.md](./detailed-design/permissions-and-errors.md) - 权限与错误总览

| 文件 | 说明 |
|------|------|
| [permissions/cross-project-auth.md](./detailed-design/permissions/cross-project-auth.md) | 跨项目权限控制 |
| [permissions/error-recovery.md](./detailed-design/permissions/error-recovery.md) | 错误恢复机制 |
| [permissions/error-codes.md](./detailed-design/permissions/error-codes.md) | 错误码定义 |

---

## 文档依赖关系

```
concepts.md (基础概念)
    ↓
architecture.md (架构设计)
    ↓
detailed-design/
    ├── mcp-tools.md         ← MCP 工具单一真源
    │   └── mcp/*.md
    ├── cli-design.md
    │   └── cli/*.md
    ├── skills-design.md
    │   └── skills/*.md
    ├── data-operations.md
    │   └── data-ops/*.md
    ├── local-mode.md
    │   └── local-mode/*.md
    └── permissions-and-errors.md
        └── permissions/*.md
```

---

## 阅读顺序建议

### 新用户
1. [concepts.md](./concepts.md) - 理解核心概念
2. [user-stories.md](./user-stories.md) - 了解使用场景
3. [skills-design.md](./detailed-design/skills-design.md) → [skills/scenarios.md](./detailed-design/skills/scenarios.md)

### CLI 开发者
1. [architecture.md](./architecture.md) - 整体架构
2. [cli-design.md](./detailed-design/cli-design.md) → [cli/user-cli.md](./detailed-design/cli/user-cli.md)
3. [mcp-tools.md](./detailed-design/mcp-tools.md) → [mcp/store.md](./detailed-design/mcp/store.md)

### MCP 工具开发者
1. [mcp-tools.md](./detailed-design/mcp-tools.md) - 工具总览
2. [mcp/store-crud.md](./detailed-design/mcp/store-crud.md) - CRUD 操作
3. [mcp/store-feat-lifecycle.md](./detailed-design/mcp/store-feat-lifecycle.md) - feat 生命周期

### 架构师
1. [architecture.md](./architecture.md) - 整体架构
2. [data-operations.md](./detailed-design/data-operations.md) → [data-ops/conflict-rollback.md](./detailed-design/data-ops/conflict-rollback.md)
3. [local-mode.md](./detailed-design/local-mode.md) → [local-mode/sqlite-schema.md](./detailed-design/local-mode/sqlite-schema.md)

---

## 文件统计

- 顶层文档：4 个
- 详细设计索引：6 个
- 详细设计子文件：33 个
- **总计：43 个文档**
