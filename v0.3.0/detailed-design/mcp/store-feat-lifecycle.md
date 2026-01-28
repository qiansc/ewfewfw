# Feat 生命周期与合并


### 3.6 `c4a_store_feat_lifecycle`（feat 生命周期管理：创建/流转/删除）

**输入（概念签名）**：

```typescript
c4a_store_feat_lifecycle({
  action: "create" | "transition" | "delete",
  feat_id: "feat-a001-user-login",
  metadata?: { title: string, description: string, created_by: string },  // create 用
  to_status?: "approved" | "published" | "deprecated" | "archived",  // transition 用
  sync_checklist?: boolean,  // create 用，默认 true（启用 checklist 远程同步）
  force_publish?: boolean,   // transition 用，默认 false（跳过冲突检测强制发布）

  // 发布前同步校验（防止本地未同步的修改丢失）
  expected_content_hash?: string  // transition to published 用，Agent 看到的内容哈希
})
```

**返回（概念示例）**：

```typescript
// action=create
{ success: true, feat_id: "feat-a001-user-login", status: "draft" }

// action=transition (to approved)
{ success: true, feat_id: "feat-a001-user-login", from_status: "draft", to_status: "approved" }

// action=transition (to published, 成功)
{
  success: true,
  feat_id: "feat-a001-user-login",
  from_status: "approved",
  to_status: "published",
  merge_result: {
    merged: ["auth-service", "jwt-component"],
    conflicts: []
  }
}

// action=transition (to published, 有冲突)
{
  success: false,
  feat_id: "feat-a001-user-login",
  from_status: "approved",
  error: "merge_conflict",
  message: "发布前需要先解决冲突",
  conflicts: [
    {
      entity_id: "auth-service",
      conflict_type: "content",
      main_branch: {...},
      feat_branch: {...},
      suggested_resolution: "keep_feat"
    }
  ]
}

// action=transition (to published, 本地未同步)
{
  success: false,
  feat_id: "feat-a001-user-login",
  from_status: "approved",
  error: "content_hash_mismatch",
  message: "本地存在未同步的修改，请先执行 c4a sync",
  expected_hash: "abc123",      // Agent 传入的哈希
  actual_hash: "def456",        // 数据库中的哈希
  suggestion: "执行 c4a sync feat-a001-user-login 后重试发布"
}

// action=delete
{ success: true, feat_id: "feat-a001-user-login", deleted: true }
```

**职责说明**：

- **create**：创建新的 feat，初始状态为 `draft`
  - 如果 `sync_checklist=true`（默认），在 MongoDB 中创建空 `checklist` 字段，支持多人协作
  - 如果 `sync_checklist=false`，不创建远程 checklist，仅本地使用
- **transition**：流转 feat 状态（draft → approved → published → deprecated → archived）
  - **流转到 `published` 时，自动触发 merge 操作**（见下方详细说明）
  - 流转到 `published` 或 `archived` 时，**自动删除远程 checklist**，保留本地文件
- **delete**：删除 feat 及其关联的所有实体副本和远程 checklist

**发布时自动合并（to_status="published"）**：

当 `action="transition"` 且 `to_status="published"` 时，工具内部自动执行以下流程：

```typescript
async function transitionToPublished(
  feat_id: string,
  force_publish: boolean,
  expected_content_hash?: string
): Promise<TransitionResult> {
  // 0. 同步校验：检查本地是否有未同步的修改
  if (expected_content_hash) {
    const actualHash = await computeFeatContentHash(feat_id);
    if (actualHash !== expected_content_hash) {
      return {
        success: false,
        feat_id,
        from_status: "approved",
        error: "content_hash_mismatch",
        message: "本地存在未同步的修改，请先执行 c4a sync",
        expected_hash: expected_content_hash,
        actual_hash: actualHash,
        suggestion: `执行 c4a sync ${feat_id} 后重试发布`
      };
    }
  }

  // 0.5 权限检查：跨项目 feat 需要所有涉及项目的批准权限
  const currentUser = getCurrentUser();
  const affectedProjects = await getAffectedProjects(feat_id);

  for (const project of affectedProjects) {
    if (!await hasApprovalPermission(currentUser, project)) {
      return {
        success: false,
        feat_id,
        from_status: "approved",
        error: "C4A-BIZ-006",
        message: `跨项目 feat 需要多方批准，用户 ${currentUser} 缺少项目 ${project} 的批准权限`,
        affected_projects: Array.from(affectedProjects),
        missing_permission: project
      };
    }
  }

  // 1. 先执行 merge（strategy=auto）
  const mergeResult = await c4a_store_feat_merge({
    feat_id,
    strategy: "auto"
  });

  // 2. 如果有冲突且未强制发布，返回冲突信息，不流转状态
  if (!mergeResult.success && mergeResult.conflicts.length > 0 && !force_publish) {
    return {
      success: false,
      feat_id,
      from_status: "approved",
      error: "merge_conflict",
      message: "发布前需要先解决冲突",
      conflicts: mergeResult.conflicts
    };
  }

  // 3. merge 成功（或强制发布）后，在单个事务中完成状态流转和 checklist 清理
  await withTransaction(async (session) => {
    // 3a. 流转状态
    await updateFeatStatus(feat_id, "published", { session });

    // 3b. 清理远程 checklist（必须在同一事务中）
    await clearFeatChecklist(feat_id, { session });
  });

  return {
    success: true,
    feat_id,
    from_status: "approved",
    to_status: "published",
    merge_result: {
      merged: mergeResult.merged,
      conflicts: mergeResult.conflicts
    }
  };
}
```

> **关键设计：发布前同步校验**
>
> 为防止"本地修改未同步就发布"导致的版本历史错乱，发布流程增加了 `expected_content_hash` 校验：
> - **CLI 职责**：在调用发布 Skill 前，CLI 应先执行 `c4a sync`，确保本地修改已上传
> - **Agent 职责**：调用 `c4a_store_feat_lifecycle` 时传入 `expected_content_hash`（从本地文件计算）
> - **Server 职责**：比对传入的哈希与数据库中的哈希，不一致则拒绝发布
>
> 这种设计避免了发布旧版本的风险，同时保持了 Agent 的自主性。

> **关键设计：事务原子性**
>
> 发布流程中的"状态流转"和"Checklist 清理"必须在**同一个数据库事务**中完成：
> - **问题**：如果分开调用，可能导致 Feat 已发布但 Checklist 残留的脏数据状态
> - **实现**：使用 `withTransaction` 包装，确保两个操作要么同时成功，要么同时回滚
> - **适用模式**：Server 模式（MongoDB 多文档事务）；Local 模式（SQLite 事务）

**设计理由**：

1. **用户心智模型一致**：用户执行"发布"操作时，期望的是"变更生效"，而非仅仅"状态变更"
2. **减少 Skills 复杂度**：Skills 层不需要关心底层的 merge 细节
3. **原子性保证**：发布和合并作为一个原子操作，避免中间状态
4. **符合 Git 类比**：类似 `git merge --squash` + `git push`，发布即合并

**冲突处理流程**：

当发布时检测到冲突，用户需要：

1. 查看冲突详情（返回的 `conflicts` 字段）
2. 调用 `c4a_store_feat_merge` 手动解决冲突（提供 `conflict_resolution` 参数）
3. 再次调用 `c4a_store_feat_lifecycle` 发布

或者使用 `force_publish=true` 强制发布（不推荐，可能导致数据丢失）

### 3.7 `c4a_store_feat_merge`（feat 合并与冲突解决）

**输入（概念签名）**：

```typescript
c4a_store_feat_merge({
  feat_id: "feat-a001-user-login",
  strategy: "auto" | "manual",
  conflict_resolution?: {
    entity_id: string,
    resolution: "keep_main" | "keep_feat"
  }[]
})
```

**返回（概念示例）**：

```typescript
// strategy=auto（无冲突）
{
  success: true,
  merged: ["entity-1", "entity-2"],
  conflicts: []
}

// strategy=auto（有冲突）
{
  success: false,
  merged: ["entity-1"],
  conflicts: [
    {
      entity_id: "entity-2",
      conflict_type: "content",
      main_branch: {...},
      feat_branch: {...},
      suggested_resolution: "keep_feat"
    }
  ]
}

// strategy=manual（提供冲突解决方案）
{
  success: true,
  merged: ["entity-1", "entity-2"],
  conflicts: []
}
```

**职责说明**：

- **冲突检测**：检查 feat 中的实体是否与主分支存在冲突
- **自动合并**：strategy=auto 时，自动合并无冲突的实体，返回冲突列表
- **手动解决**：strategy=manual 时，根据 conflict_resolution 参数选择保留哪个版本
- **Copy-on-Write 合并**：将 feat 版本移到主分支，删除旧版本

**冲突解决策略**：

| resolution | 行为 | 适用场景 |
|------------|------|---------|
| `keep_main` | 保留主分支版本，丢弃 feat 版本 | feat 的修改不再需要 |
| `keep_feat` | 保留 feat 版本，覆盖主分支 | feat 的修改是正确的 |

> **设计说明**：不支持 `merge_custom`（自定义合并）。如需合并两个版本的内容，请在发布前手动编辑 DSL 文件，然后选择 `keep_feat`。这样设计是因为：
> 1. 自定义合并的 Schema 难以定义，Agent 构造复杂数据容易出错
> 2. 大多数冲突场景是"选择哪个版本"，而非"合并两个版本"
> 3. 手动编辑 DSL 文件更灵活、更可控

**Copy-on-Write 机制说明**：

Feat 采用 Copy-on-Write（写时复制）机制实现分支隔离：

| 操作 | 行为 | 数据库变化 |
|------|------|-----------|
| **创建 Feat** | 创建 Feat 元数据 | 无实体副本 |
| **在 Feat 中创建新实体** | 直接创建，标记 `proposal_id` | 新增 1 条记录 |
| **在 Feat 中修改已存在实体** | 创建副本，标记 `proposal_id` | 新增 1 条记录（副本） |
| **发布 Feat** | 删除主分支旧版本，Feat 版本移到主分支 | 副本数量回到初始值 |

**示例：Feat 修改已存在实体**

```typescript
// 1. 主分支有 auth-service
// entities 表：
// { id: "auth-service", proposal_id: NULL, data: { name: "v1" } }

// 2. 在 feat-a001 中修改 auth-service
c4a_store_save({
  type: "container",
  data: { id: "auth-service", name: "v2" }
  // 当前 feat 上下文：feat-a001
})

// 内部逻辑：
// - 检查主分支是否有 auth-service (proposal_id=NULL) → 有
// - 创建副本：
//   INSERT INTO entities VALUES
//     ('auth-service', 'feat-a001', 'container', '{"name":"v2"}', '{"status":"draft"}');

// 3. 数据库状态
// entities 表：
// { id: "auth-service", proposal_id: NULL, data: { name: "v1" } }  ← 主分支版本
// { id: "auth-service", proposal_id: "feat-a001", data: { name: "v2" } }  ← feat 版本

// 4. 查询行为
c4a_store_read({ id: "auth-service" })  // 返回 v1（主分支）
c4a_store_read({ id: "auth-service", proposal_id: "feat-a001" })  // 返回 v2（feat 版本）

// 5. 发布 feat-a001
c4a_store_feat_merge({ feat_id: "feat-a001", strategy: "auto" })

// 内部逻辑：
// - 删除主分支旧版本：
//   DELETE FROM entities WHERE id = 'auth-service' AND proposal_id IS NULL;
// - feat 版本移到主分支：
//   UPDATE entities SET proposal_id = NULL WHERE id = 'auth-service' AND proposal_id = 'feat-a001';

// 6. 发布后数据库状态
// entities 表：
// { id: "auth-service", proposal_id: NULL, data: { name: "v2" } }  ← feat 版本已移到主分支
```

**多 Feat 并行修改**：

```typescript
// 初始状态：主分支有 auth-service v1
// feat-a001 修改：创建副本 auth-service v2 (proposal_id="feat-a001")
// feat-a002 修改：创建副本 auth-service v3 (proposal_id="feat-a002")

// 数据库状态：
// { id: "auth-service", proposal_id: NULL, data: { name: "v1" } }
// { id: "auth-service", proposal_id: "feat-a001", data: { name: "v2" } }
// { id: "auth-service", proposal_id: "feat-a002", data: { name: "v3" } }

// 发布顺序：
// 1. feat-a001 先发布 → 主分支变为 v2
// 2. feat-a002 后发布 → 检测到主分支已被修改（v2 != v1）
//    → 触发冲突解决流程（见 data-operations.md 第 3 章）
```

### 3.7.9 Server 模式多存储一致性

> **核心原则**：MongoDB 是单一权威源（Source of Truth），Neo4j 和 Milvus 是派生索引。

Server 模式下，`c4a_store_feat_merge` 涉及三个存储系统的写入：

| 存储 | 角色 | 数据内容 | 一致性要求 |
|------|------|----------|-----------|
| **MongoDB** | 权威源 | 实体、关系、元数据 | **强一致** |
| **Neo4j** | 派生索引 | 图结构（用于依赖查询） | 最终一致 |
| **Milvus** | 派生索引 | 向量索引（用于语义搜索） | 最终一致 |

**写入顺序与故障处理**：

```typescript
async function featMerge(featId: string): Promise<MergeResult> {
  // 1. MongoDB 事务（权威操作）
  const session = await mongoClient.startSession();
  try {
    session.startTransaction();

    // 1.1 删除主分支旧版本
    await entities.deleteMany(
      { id: { $in: mergedEntityIds }, proposal_id: null },
      { session }
    );

    // 1.2 Feat 版本移到主分支
    await entities.updateMany(
      { proposal_id: featId },
      { $set: { proposal_id: null } },
      { session }
    );

    // 1.3 记录待同步的实体 ID（用于故障恢复）
    await pendingSync.insertOne({
      feat_id: featId,
      entity_ids: mergedEntityIds,
      status: "pending",
      created_at: new Date()
    }, { session });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;  // MongoDB 失败 → 整体失败，无副作用
  } finally {
    session.endSession();
  }

  // 2. Neo4j 同步（尽力而为）
  let neo4jSuccess = true;
  try {
    await syncRelationsToNeo4j(mergedEntityIds);
  } catch (error) {
    neo4jSuccess = false;
    console.warn(`Neo4j 同步失败: ${error.message}，将自动修复`);
  }

  // 3. Milvus 同步（尽力而为）
  let milvusSuccess = true;
  try {
    await syncVectorsToMilvus(mergedEntityIds);
  } catch (error) {
    milvusSuccess = false;
    console.warn(`Milvus 同步失败: ${error.message}，将自动修复`);
  }

  // 4. 更新同步状态
  if (neo4jSuccess && milvusSuccess) {
    await pendingSync.deleteOne({ feat_id: featId });
  } else {
    await pendingSync.updateOne(
      { feat_id: featId },
      { $set: {
        status: "partial",
        neo4j_synced: neo4jSuccess,
        milvus_synced: milvusSuccess
      }}
    );
    // 触发异步修复
    await scheduleRepair(mergedEntityIds);
  }

  return {
    success: true,  // MongoDB 成功即视为成功
    merged: mergedEntityIds,
    sync_status: {
      mongodb: true,
      neo4j: neo4jSuccess,
      milvus: milvusSuccess
    },
    repair_scheduled: !neo4jSuccess || !milvusSuccess
  };
}
```

**故障场景与恢复策略**：

| 故障点 | MongoDB 状态 | Neo4j 状态 | Milvus 状态 | 恢复方式 |
|--------|-------------|-----------|-------------|---------|
| MongoDB 失败 | 回滚 | 未变 | 未变 | 无需恢复，事务已回滚 |
| Neo4j 失败 | 已提交 | 过期 | 已同步 | `c4a_store_repair --scope=neo4j` |
| Milvus 失败 | 已提交 | 已同步 | 过期 | `c4a_store_repair --scope=milvus` |
| 全部失败 | 已提交 | 过期 | 过期 | `c4a_store_repair --scope=all` |

**自动修复机制**：

1. **即时修复**：Merge 操作返回时包含 `repair_scheduled: true`，CLI/Agent 应提示用户
2. **定时修复**：后台任务定期扫描 `pendingSync` 集合，自动调用 `c4a_store_repair`
3. **手动修复**：用户可随时执行 `c4a_store_repair` 检查和修复不一致

```typescript
// 返回示例：部分同步失败
{
  success: true,
  merged: ["auth-service", "user-service"],
  sync_status: {
    mongodb: true,
    neo4j: true,
    milvus: false  // Milvus 写入失败
  },
  repair_scheduled: true,
  warnings: [
    {
      code: "PARTIAL_SYNC",
      message: "实体已合并到主分支，但 Milvus 向量索引同步失败",
      severity: "warning",
      details: {
        failed_entities: ["auth-service", "user-service"],
        repair_command: "c4a_store_repair --scope=milvus --entity-ids=auth-service,user-service"
      }
    }
  ]
}
```

**功能降级**：

| 故障类型 | 影响功能 | 降级行为 |
|---------|---------|---------|
| Neo4j 不一致 | 依赖查询、影响分析 | 降级到 MongoDB（**限制 depth ≤ 1**） |
| Milvus 不一致 | 语义搜索 | 降级到全文搜索（精度下降） |

**Neo4j 降级深度限制**：

MongoDB 的 `$graphLookup` 性能远低于 Neo4j，深层图查询可能拖垮主库。降级模式下强制限制：

| 查询类型 | 正常模式 | 降级模式 |
|---------|---------|---------|
| 直接依赖 | depth ≤ 5 | depth = 1 |
| 影响分析 | depth ≤ 5 | **禁止**（返回错误） |
| 全链路追踪 | 支持 | **禁止**（返回错误） |

```typescript
// 降级模式下的查询限制
async function queryDependencies(entityId: string, depth: number) {
  if (neo4jAvailable) {
    return await neo4jQuery(entityId, depth);
  }

  // 降级模式
  if (depth > 1) {
    return {
      success: false,
      error: "DEGRADED_MODE_DEPTH_LIMIT",
      message: "Neo4j 不可用，降级模式仅支持 depth=1 的直接依赖查询",
      allowed_depth: 1
    };
  }

  return await mongodbRelationsQuery(entityId, depth);
}
```

**设计理由**：

1. **为什么不使用分布式事务（2PC/Saga）？**
   - 复杂度过高，三个存储系统的事务协调成本大
   - Neo4j 和 Milvus 是"派生索引"，数据可从 MongoDB 完全重建
   - "最终一致 + 自动修复"对架构知识管理场景足够

2. **为什么 MongoDB 成功即视为 Merge 成功？**
   - MongoDB 是权威源，包含完整的实体数据和关系定义
   - Neo4j/Milvus 仅用于加速查询，不存储唯一数据
   - 用户关心的是"实体是否合并到主分支"，而非"索引是否同步"

3. **Local 模式为什么不需要这些？**
   - SQLite 单库事务保证 ACID
   - 关系存储在 `relations` 表，向量存储在 `vectors` 虚拟表
   - 所有写入在同一个事务中完成

### 3.7.3 `proposal_id` 上下文管理

**问题背景**：

CoW 机制强依赖 `proposal_id` 的正确透传。如果 Agent 在执行复杂任务链时丢失上下文，会导致数据错误写入主分支。

**防护机制**：

| 层级 | 机制 | 说明 |
|------|------|------|
| Prompt 层 | Skill 注入 | 启动 feat 相关 Skill 时注入 `proposal_id` |
| CLI 层 | Session 上下文 | CLI 维护当前 feat，自动填充 |
| Server 层 | 写入校验 | 检测可疑的无 `proposal_id` 写入 |

**1. Skill 层注入**

```typescript
// feat-dev Skill 启动时注入上下文
const skillContext = `
当前正在 feat "${featId}" 中工作。
所有 c4a_store_* 调用必须携带 proposal_id: "${featId}"
`;
```

**2. CLI Session 上下文**

```typescript
// CLI 维护当前 feat 上下文
class FeatSession {
  private currentFeatId: string | null = null;

  enterFeat(featId: string) {
    this.currentFeatId = featId;
  }

  // 自动填充 proposal_id
  wrapMcpCall(toolName: string, params: any) {
    if (this.currentFeatId && this.isStoreWriteTool(toolName)) {
      params.proposal_id ??= this.currentFeatId;
    }
    return params;
  }
}
```

**3. Server 端校验**

```typescript
// 检测可疑写入
if (!proposal_id && entityExists(entity_id)) {
  // 修改已存在的实体但未指定 proposal_id
  return {
    success: false,
    error: "MISSING_PROPOSAL_ID",
    message: "修改已存在的实体需要指定 proposal_id，或使用 force_main_branch=true"
  };
}
```