## 5. 跨项目 feat

feat 是产品维度的概念，天然可能横跨多个仓库和项目。C4A 采用中心化数据库架构，跨项目 feat 天然支持。

### 5.1 架构

```
数据库（MongoDB + Neo4j + Milvus）  ← 唯一权威源
         ↑ 保存/查询
         |
    MCP 工具调用
         ↑
   各项目的 AI Agent  ← 连接同一数据库
         |
         ↓ export/sync
    各项目 .context/  ← 本地视图/缓存
```

### 5.2 工作流程

```
1. 创建跨项目 feat
   ↓ feat 存储在中心数据库

2. 在不同项目中建模实体（各项目 Agent 连接同一数据库）
   ↓ 前端项目 Agent: 创建 auth-component (proposal_id: "feat-a001-user-login")
   ↓ 后端项目 Agent: 创建 auth-service (proposal_id: "feat-a001-user-login")
   ↓ 共享库 Agent: 创建 jwt-utils (proposal_id: "feat-a001-user-login")

3. feat 发布
   ↓ 数据库中所有关联实体状态: approved → published
   ↓ 清空所有实体的 proposal_id

4. 各项目同步本地文件
   ↓ 前端项目: sync → .context/ 更新
   ↓ 后端项目: sync → .context/ 更新
   ↓ 共享库: sync → .context/ 更新
```

### 5.3 关键设计点

| 设计点 | 说明 |
|--------|------|
| **数据库是唯一权威源** | 所有实体首先保存到中心数据库，不存在跨仓库同步问题 |
| **实体通过 proposal_id 关联 feat** | 不同项目的实体通过同一个 proposal_id 关联到同一个 feat |
| **本地文件是视图** | `.context/` 目录只是数据库的本地投影，不影响跨项目协作 |
| **Agent 连接同一数据库** | 不同项目的 Agent 连接同一个数据库实例，自然支持协作 |

### 5.4 查询策略

```typescript
// 查询主分支实体（默认）
c4a_store_read({ proposal_id: null })

// 查询 feat 内实体
c4a_store_read({ proposal_id: "feat-a001-user-login" })

// 查询合并视图（主分支 + feat）
c4a_store_read({
  proposal_id: [null, "feat-a001-user-login"],  // null 表示主分支
  merge_strategy: "feat_override"  // feat 覆盖主分支
})
```

---

## 6. 跨库事务与补偿机制

Server 模式使用三库架构（MongoDB + Neo4j + Milvus），跨库操作需要特殊的事务处理和失败补偿机制。

### 6.1 问题背景

**挑战**：三个数据库无法使用传统的分布式事务（2PC），需要设计补偿机制保证数据一致性。

| 数据库 | 存储内容 | 事务支持 |
|--------|---------|---------|
| MongoDB | 实体数据、元数据、Feat 信息 | ✅ 单库 ACID 事务 |
| Neo4j | 实体关系图谱 | ✅ 单库 ACID 事务 |
| Milvus | 向量索引 | ❌ 无事务支持 |

### 6.2 写入顺序与补偿策略

**设计原则**：MongoDB 是权威源，Neo4j 和 Milvus 是派生数据，可通过重建恢复。

**写入顺序**（按重要性排序）：

```
1. MongoDB（权威源）
   ↓ 成功后继续
2. Neo4j（关系图谱）
   ↓ 成功后继续
3. Milvus（向量索引）
```

**失败补偿策略**：

| 失败点 | 状态 | 补偿操作 |
|--------|------|---------|
| MongoDB 写入失败 | 无数据写入 | 直接返回错误，无需补偿 |
| Neo4j 写入失败 | MongoDB 已写入 | 标记 `sync_status.neo4j = "pending"`，后台重试 |
| Milvus 写入失败 | MongoDB + Neo4j 已写入 | 标记 `sync_status.milvus = "pending"`，后台重试 |

### 6.3 同步状态追踪

在 MongoDB 的 metadata 中添加同步状态字段：

```typescript
interface SyncStatus {
  neo4j: "synced" | "pending" | "failed";
  milvus: "synced" | "pending" | "failed";
  last_sync_attempt?: string;  // ISO 时间戳
  retry_count?: number;
  error_message?: string;
}

// metadata 文档示例
{
  entity_id: "auth-service",
  proposal_id: null,
  status: "published",
  sync_status: {
    neo4j: "synced",
    milvus: "pending",
    last_sync_attempt: "2026-01-22T10:00:00Z",
    retry_count: 1,
    error_message: "Milvus connection timeout"
  }
}
```

### 6.4 后台同步任务

**重试机制**：

```typescript
// 后台同步任务（每 30 秒执行）
async function syncPendingEntities() {
  // 1. 查询待同步实体
  const pending = await mongodb.find({
    $or: [
      { "sync_status.neo4j": "pending" },
      { "sync_status.milvus": "pending" }
    ]
  });

  for (const entity of pending) {
    // 2. 重试 Neo4j 同步
    if (entity.sync_status.neo4j === "pending") {
      try {
        await syncToNeo4j(entity);
        await mongodb.updateOne(
          { entity_id: entity.entity_id },
          { $set: { "sync_status.neo4j": "synced" } }
        );
      } catch (err) {
        await handleSyncFailure(entity, "neo4j", err);
      }
    }

    // 3. 重试 Milvus 同步
    if (entity.sync_status.milvus === "pending") {
      try {
        await syncToMilvus(entity);
        await mongodb.updateOne(
          { entity_id: entity.entity_id },
          { $set: { "sync_status.milvus": "synced" } }
        );
      } catch (err) {
        await handleSyncFailure(entity, "milvus", err);
      }
    }
  }
}

// 失败处理
async function handleSyncFailure(
  entity: Entity,
  target: "neo4j" | "milvus",
  error: Error
) {
  const retryCount = (entity.sync_status.retry_count || 0) + 1;
  const maxRetries = 5;

  if (retryCount >= maxRetries) {
    // 超过最大重试次数，标记为 failed
    await mongodb.updateOne(
      { entity_id: entity.entity_id },
      {
        $set: {
          [`sync_status.${target}`]: "failed",
          "sync_status.retry_count": retryCount,
          "sync_status.error_message": error.message
        }
      }
    );
    // 发送告警通知
    await alertAdmin(`Entity ${entity.entity_id} sync to ${target} failed after ${maxRetries} retries`);
  } else {
    // 更新重试计数，等待下次重试
    await mongodb.updateOne(
      { entity_id: entity.entity_id },
      {
        $set: {
          "sync_status.last_sync_attempt": new Date().toISOString(),
          "sync_status.retry_count": retryCount,
          "sync_status.error_message": error.message
        }
      }
    );
  }
}
```

### 6.5 Feat 发布的事务处理

Feat 发布涉及多个实体的批量更新，需要特殊处理：

> **重要设计：Feat 内禁止物理删除已发布实体**
>
> **问题**：如果用户在 Feat 中物理删除了主分支已存在的实体 X，那么 X 不会出现在 Feat 实体列表中，导致发布时主分支中的 X 不会被删除，造成数据不一致。
>
> **解决方案（软删除）**：
> - Feat 中不允许物理删除主分支已存在的实体
> - 所有"删除"操作必须映射为状态流转：`published → deprecated → archived`
> - 这样被"删除"的实体仍然存在于 Feat 中（只是状态变了），发布时会正确地用"已归档版本"替换"旧版本"
>
> **MCP 工具约束**：
> - `c4a_store_delete` 工具在 feat 模式下，如果目标实体在主分支已存在，应自动转换为 `status: "archived"` 而非物理删除
> - 只有 feat 中新建的实体（主分支不存在）才允许物理删除

```typescript
async function publishFeat(featId: string) {
  const session = mongodb.startSession();

  try {
    // 阶段 1：MongoDB 事务（原子操作）
    await session.withTransaction(async () => {
      // 1.1 获取 feat 内所有实体
      const entities = await mongodb.find(
        { proposal_id: featId },
        { session }
      );

      // 1.2 删除主分支旧版本
      for (const entity of entities) {
        await mongodb.deleteOne(
          { id: entity.id, proposal_id: null },
          { session }
        );
      }

      // 1.3 feat 版本移到主分支
      await mongodb.updateMany(
        { proposal_id: featId },
        {
          $set: { proposal_id: null, status: "published" },
          $unset: { "sync_status": "" }  // 重置同步状态
        },
        { session }
      );

      // 1.4 更新 feat 状态
      await mongodb.updateOne(
        { _id: featId },
        { $set: { status: "published", published_at: new Date() } },
        { session }
      );
    });

    // 阶段 2：Neo4j 同步（非事务，允许失败）
    try {
      await syncRelationsToNeo4j(featId);
    } catch (err) {
      console.error("Neo4j sync failed, will retry in background:", err);
      await markEntitiesForSync(featId, "neo4j");
    }

    // 阶段 3：Milvus 同步（非事务，允许失败）
    try {
      await syncVectorsToMilvus(featId);
    } catch (err) {
      console.error("Milvus sync failed, will retry in background:", err);
      await markEntitiesForSync(featId, "milvus");
    }

    return { success: true, featId };

  } catch (err) {
    // MongoDB 事务失败，自动回滚，无需额外处理
    throw new Error(`Feat publish failed: ${err.message}`);
  } finally {
    await session.endSession();
  }
}
```

### 6.6 数据一致性检查

提供手动检查和修复工具：

```bash
# 检查数据一致性
c4a server check-consistency

# 输出示例：
检查数据一致性...
  ✅ MongoDB: 500 个实体
  ⚠️  Neo4j: 498 个节点 (缺少 2 个)
  ⚠️  Milvus: 495 个向量 (缺少 5 个)

待同步实体:
  - auth-service: Neo4j pending (重试 2/5)
  - payment-service: Neo4j pending (重试 1/5)
  - user-db: Milvus pending (重试 3/5)
  - cache-service: Milvus failed (已达最大重试)
  - order-service: Milvus pending (重试 1/5)

# 手动触发同步
c4a server sync-pending

# 强制重建派生数据
c4a server rebuild-neo4j    # 从 MongoDB 重建 Neo4j
c4a server rebuild-milvus   # 从 MongoDB 重建 Milvus
```

### 6.7 降级策略

当 Neo4j 或 Milvus 不可用时，系统自动降级：

| 服务不可用 | 影响功能 | 降级行为 |
|-----------|---------|---------|
| Neo4j | 图查询、依赖分析 | 返回错误提示，建议稍后重试 |
| Milvus | 语义搜索 | 降级到 MongoDB 全文搜索 |
| MongoDB | 所有功能 | 服务不可用，返回错误 |

```typescript
// 语义搜索降级示例
async function semanticSearch(query: string) {
  try {
    // 优先使用 Milvus 向量搜索
    return await milvusSearch(query);
  } catch (err) {
    if (err.code === "MILVUS_UNAVAILABLE") {
      console.warn("Milvus unavailable, falling back to text search");
      // 降级到 MongoDB 全文搜索
      return await mongodbTextSearch(query);
    }
    throw err;
  }
}
```
