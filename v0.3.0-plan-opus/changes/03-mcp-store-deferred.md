# Part 03 MCP Store 实现记录

> **更新日期**: 2026-02-01
> **状态**: 已完成（v0.3.0）

---

## 已完成任务

### 核心 CRUD 工具 (3.3-3.8)

所有核心工具已修改为通过 `StorageAdapter` 接口访问存储：

| 任务 | 功能 | 实现文件 | 状态 |
|------|------|----------|:----:|
| 3.3 | c4a_store_save | `tools/store/save.ts` | ✅ |
| 3.4 | c4a_store_read | `tools/store/read.ts` | ✅ |
| 3.5 | c4a_store_list | `tools/store/list.ts` | ✅ |
| 3.6 | c4a_store_delete | `tools/store/delete.ts` | ✅ |
| 3.7 | c4a_store_sync | `tools/store/sync.ts` | ✅ |
| 3.8 | c4a_store_plan_sync | `tools/store/planSync.ts` | ✅ |

### CLI 辅助功能 (3.9-3.10)

| 任务 | 功能 | 实现文件 | 状态 |
|------|------|----------|:----:|
| 3.9 | Double Check 机制 | `tools/store/doubleCheck.ts` | ✅ |
| 3.10 | 大批量同步优化 | `tools/store/batchSync.ts` | ✅ |

**说明**：
- `doubleCheck.ts` - CLI 本地文件写入保护，在写入前进行 hash 比对
- `batchSync.ts` - 大文件分批上传逻辑，会话管理，断点续传

### Feat 生命周期 (3.11-3.12)

| 任务 | 功能 | 实现文件 | 状态 |
|------|------|----------|:----:|
| 3.11 | c4a_store_feat_lifecycle | `tools/store/featLifecycle.ts` | ✅ |
| 3.12 | c4a_store_feat_merge | `tools/store/featMerge.ts` | ✅ |

**相关修改**：
- `store/adapter.ts` - 添加 `featLifecycle()` 和 `featMerge()` 方法及类型
- `store/lite-adapter.ts` - LiteAdapter 实现 feat 相关方法
- `store/sqlite-store.ts` - 添加 `feats` 表

### 多库一致性 (3.13)

| 任务 | 功能 | 实现文件 | 状态 |
|------|------|----------|:----:|
| 3.13 | Server 多库一致性 | `store/multi-store-sync.ts` | ✅ |

**处理方式**：

3.13 是 Server 模式特有的功能，核心原则是 **MongoDB 是单一权威源**，Neo4j 和 Milvus 是派生索引。

**已创建**：`multi-store-sync.ts` 提供以下功能：
- 同步状态类型定义 (`SyncStatus`, `PendingSyncRecord`)
- 降级模式常量和检查函数
- 部分同步警告生成
- 合并结果构建辅助函数

**Local 模式不需要此功能**：SQLite 单库事务保证 ACID，所有数据在同一个事务中写入。

**Server 模式（未来实现）需要**：
1. 在 `ServerAdapter.featMerge()` 中使用这些工具函数
2. 实现 `pendingSync` 集合管理
3. 实现 Neo4j/Milvus 同步逻辑
4. 实现定时修复任务

---

## 待完成任务（已于 2026-02-01 完成）

### 3.14 proposal_id 上下文管理

- **设计文档**：`store-feat-lifecycle.md` L536-593
- **功能**：CoW 防护机制，确保 Agent 在执行任务链时正确透传 `proposal_id`
- **实现位置**：可能需要在 CLI/Skills 层实现上下文管理

✅ 已完成（v0.3.0）

### 3.15-3.19 Checklist 相关

| 任务 | 功能 | 设计文档 |
|------|------|----------|
| 3.15 | feat_checklist CRUD | `store-feat-checklist.md` §3.8 |
| 3.16 | 本地文件保护 | `store-feat-checklist.md` §3.8.1 |
| 3.17 | workflow_step 更新 | `store-feat-checklist.md` §3.9 |
| 3.18 | 并发修改预警 | `store-feat-checklist.md` §3.10 |
| 3.19 | 引用完整性预警 | `store-feat-checklist.md` §3.11 |

✅ 已完成（v0.3.0）

**实现要求**：
- 需要在 `StorageAdapter` 中添加 checklist 相关方法
- 需要在 `LiteAdapter` 中实现
- 需要在 `sqlite-store.ts` 中添加 checklist 表

### 3.20-3.23 工具类

| 任务 | 功能 | 设计文档 |
|------|------|----------|
| 3.20 | read_history | `store-utils.md` §3.11 |
| 3.21 | backup/restore | `store-utils.md` §3.13-3.14 |
| 3.22 | repair | `store-utils.md` §3.15 |
| 3.23 | validate | `store-utils.md` §3.16 |

✅ 已完成（v0.3.0）

---

## 架构说明

### 正确的调用链

```
MCP Tools (c4a_store_*)
         │
         ▼
   getAdapter()  ←─── 根据配置返回 LiteAdapter 或 ServerAdapter
         │
         ▼
┌────────┴────────┐
▼                 ▼
LiteAdapter      ServerAdapter (未来实现)
│                │
▼                ▼
SQLiteStore      mcp-data HTTP API
```

### 文件结构

```
packages/mcp-dsl/src/
├── tools/store/
│   ├── save.ts          # 调用 adapter.save()
│   ├── read.ts          # 调用 adapter.read()
│   ├── list.ts          # 调用 adapter.list()
│   ├── delete.ts        # 调用 adapter.delete()
│   ├── sync.ts          # 调用 adapter.sync()
│   ├── planSync.ts      # 调用 adapter.planSync()
│   ├── featLifecycle.ts # 调用 adapter.featLifecycle()
│   ├── featMerge.ts     # 调用 adapter.featMerge()
│   ├── doubleCheck.ts   # CLI 辅助：文件写入保护
│   ├── batchSync.ts     # CLI 辅助：分批上传
│   └── index.ts         # 导出
└── store/
    ├── adapter.ts       # StorageAdapter 接口定义
    ├── lite-adapter.ts  # Local 模式实现
    ├── get-adapter.ts   # 工厂函数
    ├── sqlite-store.ts  # SQLite 存储
    ├── multi-store-sync.ts # Server 模式多库同步工具
    └── ...
```

---

## 注意事项

1. **所有 MCP 工具必须通过 StorageAdapter**：不要直接调用 Python mcp-data
2. **Local 模式已可用**：LiteAdapter + SQLiteStore 提供完整的本地存储能力
3. **Server 模式已实现**：ServerAdapter 通过 storage-backend HTTP API
4. **lite-adapter.ts 需要重构**：文件已超过 1500 行，需要按功能拆分
