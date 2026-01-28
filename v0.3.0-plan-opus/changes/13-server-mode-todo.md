# Part 13 Server Mode 待办任务

> **创建日期**: 2026-01-27
> **状态**: 待实现
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
| 13.1.1 | ServerAdapter 基础框架 | `architecture.md` §1.1 | ⏳ |
| 13.1.2 | MongoDB 连接与 CRUD | `architecture.md` §4 | ⏳ |
| 13.1.3 | Neo4j 关系图存储 | `architecture.md` §4 | ⏳ |
| 13.1.4 | Milvus 向量存储 | `architecture.md` §4 | ⏳ |

### 13.2 多库一致性

| 子任务 | 功能 | 设计文档 | 状态 |
|--------|------|----------|:----:|
| 13.2.1 | MongoDB 作为权威源 | `store-sync.md` | ⏳ |
| 13.2.2 | Neo4j/Milvus 派生同步 | `store-sync.md` | ⏳ |
| 13.2.3 | 降级模式处理 | `multi-store-sync.ts` | ⏳ |
| 13.2.4 | 定时修复任务 | - | ⏳ |

### 13.3 HTTP API 集成

| 子任务 | 功能 | 设计文档 | 状态 |
|--------|------|----------|:----:|
| 13.3.1 | mcp-data HTTP 客户端 | - | ⏳ |
| 13.3.2 | 认证与授权 | - | ⏳ |
| 13.3.3 | 错误处理与重试 | - | ⏳ |

---

## 已有基础设施

Part 03 已创建以下可复用的基础设施：

1. **`store/adapter.ts`** - `StorageAdapter` 接口定义，ServerAdapter 需实现此接口
2. **`store/multi-store-sync.ts`** - 多库同步工具函数（同步状态、降级模式、警告生成）
3. **`store/get-adapter.ts`** - 适配器工厂函数，需扩展支持 Server 模式

---

## 实现顺序建议

```
1. 实现 ServerAdapter 基础框架
   └── 实现 StorageAdapter 接口的所有方法（先返回 NotImplemented）

2. 实现 MongoDB CRUD
   └── save/read/list/delete 基础操作

3. 实现 Neo4j 关系同步
   └── 使用 multi-store-sync.ts 中的工具函数

4. 实现 Milvus 向量同步
   └── 向量嵌入生成与存储

5. 实现 feat 相关功能
   └── featLifecycle/featMerge/featChecklist

6. 实现 sync/planSync
   └── 远程同步逻辑
```

---

## 依赖关系

- **依赖 Part 03**：StorageAdapter 接口、LiteAdapter 参考实现
- **依赖 Part 04**：mcp-data Python 服务（如果采用 HTTP API 方式）
- **被 Part 14+ 依赖**：Remote 模式可能基于 Server 模式扩展
