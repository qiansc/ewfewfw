# Part 13 Server Mode 待办任务

> **创建日期**: 2026-01-27
> **状态**: ✅ 已完成 (2026-02-02)
> **来源**: Part 03 MCP Store 修复计划中的 P4-4.1

---

## 背景

在 Part 03 MCP Store 修复计划 (`checklist/mcp-store-repair-plan.md`) 中，P4-4.1 被标记为 "Future" 优先级：

> **P4-4.1: Server 模式适配器（MongoDB + Neo4j + Milvus）**
> - 当前 LiteAdapter 仅支持 SQLite
> - Server 模式需要实现 ServerAdapter

此任务属于 Part 13 Server Mode，不在 Part 03 范围内。

---

## 待实现任务

### 13.1 ServerAdapter 实现

| 子任务 | 功能 | 设计文档 | 状态 |
|--------|------|----------|:----:|
| 13.1.1 | ServerAdapter 基础框架 | `architecture.md` §1.1 | ✅ |
| 13.1.2 | MongoDB 连接与 CRUD | `architecture.md` §4 | ✅ |
| 13.1.3 | Neo4j 关系图存储 | `architecture.md` §4 | ✅ |
| 13.1.4 | Milvus 向量存储 | `architecture.md` §4 | ✅ |

### 13.2 多库一致性

| 子任务 | 功能 | 设计文档 | 状态 |
|--------|------|----------|:----:|
| 13.2.1 | MongoDB 作为权威源 | `store-sync.md` | ✅ |
| 13.2.2 | Neo4j/Milvus 派生同步 | `store-sync.md` | ✅ |
| 13.2.3 | 降级模式处理 | `multi-store-sync.ts` | ✅ |
| 13.2.4 | 定时修复任务 | - | ✅ |

### 13.3 HTTP API 集成

| 子任务 | 功能 | 设计文档 | 状态 |
|--------|------|----------|:----:|
| 13.3.1 | storage-backend HTTP API | - | ✅ |
| 13.3.2 | 认证与授权 | - | ✅ |
| 13.3.3 | 错误处理与重试 | - | ✅ |

---

## 已有基础设施

Part 03 已创建以下可复用的基础设施：

1. **`storage/adapter.ts`** - `StorageAdapter` 接口定义，ServerAdapter 已实现此接口
2. **`storage/server-adapter.ts`** - ServerAdapter 完整实现（241 行）
3. **`storage/get-adapter.ts`** - 适配器工厂函数，支持 Local/Server 模式切换
4. **`storage-backend/`** - Python FastAPI 后端，提供 MongoDB + Neo4j + Milvus 集成

---

## 实现记录

### ServerAdapter (packages/storage/src/server-adapter.ts)

已实现所有 StorageAdapter 接口方法：
- `initialize()` - 初始化连接
- `save()` / `read()` / `list()` / `delete()` - CRUD 操作
- `sync()` / `planSync()` - 同步操作
- `featLifecycle()` / `featMerge()` / `featChecklist()` - Feat 生命周期
- `updateWorkflowStep()` - 工作流步骤更新
- `readHistory()` / `backup()` / `restore()` / `repair()` / `validate()` - 工具方法
- `search()` / `queryDeps()` / `queryImpact()` - 查询方法

### storage-backend (packages/storage-backend/)

Python FastAPI 服务，提供：
- MongoDB 适配器 (`adapters/mongodb.py`)
- Neo4j 适配器 (`adapters/neo4j.py`)
- Milvus 适配器 (`adapters/milvus.py`)
- 权限服务 (`services/permission.py`)
- 完整的 REST API 路由
