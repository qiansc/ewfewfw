## 4. 图查询实现

### 4.1 内存图构建

Local 模式在启动时将 relations 表加载到内存，构建邻接表：

> **注意**：以下代码为参考实现/伪代码。`RWLock` 在 JavaScript/TypeScript 标准库中不存在，实际开发可使用第三方库（如 `async-rwlock`）或自行实现读写锁。

```typescript
// 节点唯一键：project + id
// 注意：数据库使用空字符串哨兵值，但内存图使用 'null' 字符串表示全局实体
type NodeKey = string;  // 格式: `${project}:${id}` 或 `null:${id}`（全局实体）

// 从数据库值转换为 NodeKey（'' → 'null'）
function makeNodeKey(project: string | null, id: string): NodeKey {
  // 数据库中 '' 表示全局实体，内存图中用 'null' 字符串
  const normalizedProject = (project === '' || project === null) ? 'null' : project;
  return `${normalizedProject}:${id}`;
}

function normalizeProject(project: string | null): string | null {
  return (project === '' || project === null) ? null : project;
}

interface GraphNode {
  project: string | null;  // 应用层语义：null 表示全局实体
  id: string;
  outgoing: Map<string, Set<NodeKey>>;  // rel_type -> target_node_keys
  incoming: Map<string, Set<NodeKey>>;  // rel_type -> source_node_keys
}

class InMemoryGraph {
  private nodes: Map<NodeKey, GraphNode> = new Map();
  private queryCache: Map<string, { result: any; expiresAt: number }> = new Map();
  private proposalId: string | null = null;  // 当前加载的 proposal_id

  // 从数据库加载（支持 feat 隔离）
  load(db: Database, proposalId: string | null = null) {
    this.proposalId = proposalId;
    this.nodes.clear();
    this.queryCache.clear();

    // 转换为数据库哨兵值：null → ''
    const dbProposalId = proposalId ?? '';

    // 加载合并视图：主分支 + feat 的关系，过滤 deleted 状态和非活跃实体
    // 注意：proposal_id 使用空字符串哨兵值代替 NULL
    const query = proposalId
      ? `
        WITH all_relations AS (
          SELECT r.* FROM relations r
          WHERE (r.proposal_id = '' OR r.proposal_id = ?)
        ),
        ranked_relations AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY from_project, from_id, to_project, to_id, rel_type
              ORDER BY CASE WHEN proposal_id = ? THEN 0 ELSE 1 END
            ) AS rn
          FROM all_relations
        ),
        valid_relations AS (
          SELECT * FROM ranked_relations WHERE rn = 1 AND status != 'deleted'
        )
        -- 过滤源实体和目标实体状态（使用 Merge View 选择实体版本）
        SELECT r.* FROM valid_relations r
        WHERE EXISTS (
          -- 源实体存在且状态有效（Feat 优先，主分支兜底）
          SELECT 1 FROM (
            SELECT m.status,
              ROW_NUMBER() OVER (
                PARTITION BY m.source_project, m.entity_id
                ORDER BY CASE WHEN m.proposal_id = ? THEN 0 ELSE 1 END
              ) AS rn
            FROM metadata m
            WHERE m.source_project = r.from_project
              AND m.entity_id = r.from_id
              AND (m.proposal_id = '' OR m.proposal_id = ?)
          ) src WHERE src.rn = 1 AND src.status NOT IN ('archived', 'deprecated')
        )
        AND EXISTS (
          -- 目标实体存在且状态有效（Feat 优先，主分支兜底）
          SELECT 1 FROM (
            SELECT m.status,
              ROW_NUMBER() OVER (
                PARTITION BY m.source_project, m.entity_id
                ORDER BY CASE WHEN m.proposal_id = ? THEN 0 ELSE 1 END
              ) AS rn
            FROM metadata m
            WHERE m.source_project = r.to_project
              AND m.entity_id = r.to_id
              AND (m.proposal_id = '' OR m.proposal_id = ?)
          ) tgt WHERE tgt.rn = 1 AND tgt.status NOT IN ('archived', 'deprecated')
        )
      `
      : `
        SELECT r.* FROM relations r
        WHERE r.proposal_id = '' AND r.status != 'deleted'
          AND EXISTS (
            SELECT 1 FROM metadata m
            WHERE m.source_project = r.from_project
              AND m.entity_id = r.from_id
              AND m.proposal_id = ''
              AND m.status NOT IN ('archived', 'deprecated')
          )
          AND EXISTS (
            SELECT 1 FROM metadata m
            WHERE m.source_project = r.to_project
              AND m.entity_id = r.to_id
              AND m.proposal_id = ''
              AND m.status NOT IN ('archived', 'deprecated')
          )
      `;

    const relations = proposalId
      ? db.prepare(query).all(dbProposalId, dbProposalId, dbProposalId, dbProposalId, dbProposalId, dbProposalId)
      : db.prepare(query).all();

    for (const rel of relations) {
      this.addRelation(rel.from_project, rel.from_id, rel.to_project, rel.to_id, rel.rel_type);
    }
  }

  // 添加关系
  addRelation(fromProject: string | null, fromId: string, toProject: string | null, toId: string, relType: string) {
    const normalizedFromProject = normalizeProject(fromProject);
    const normalizedToProject = normalizeProject(toProject);
    const fromKey = makeNodeKey(normalizedFromProject, fromId);
    const toKey = makeNodeKey(normalizedToProject, toId);

    // 确保节点存在
    if (!this.nodes.has(fromKey)) {
      this.nodes.set(fromKey, { project: normalizedFromProject, id: fromId, outgoing: new Map(), incoming: new Map() });
    }
    if (!this.nodes.has(toKey)) {
      this.nodes.set(toKey, { project: normalizedToProject, id: toId, outgoing: new Map(), incoming: new Map() });
    }

    // 添加出边
    const fromNode = this.nodes.get(fromKey)!;
    if (!fromNode.outgoing.has(relType)) {
      fromNode.outgoing.set(relType, new Set());
    }
    fromNode.outgoing.get(relType)!.add(toKey);

    // 添加入边
    const toNode = this.nodes.get(toKey)!;
    if (!toNode.incoming.has(relType)) {
      toNode.incoming.set(relType, new Set());
    }
    toNode.incoming.get(relType)!.add(fromKey);

    // 失效相关缓存
    this.invalidateCache(fromKey, toKey);
  }

  // 删除关系（增量更新）
  removeRelation(fromProject: string | null, fromId: string, toProject: string | null, toId: string, relType: string) {
    const fromKey = makeNodeKey(fromProject, fromId);
    const toKey = makeNodeKey(toProject, toId);
    const fromNode = this.nodes.get(fromKey);
    const toNode = this.nodes.get(toKey);

    if (fromNode?.outgoing.has(relType)) {
      fromNode.outgoing.get(relType)!.delete(toKey);
    }
    if (toNode?.incoming.has(relType)) {
      toNode.incoming.get(relType)!.delete(fromKey);
    }

    // 失效相关缓存
    this.invalidateCache(fromKey, toKey);
  }

  // 更新关系（增量更新，无需重启）
  updateRelation(
    fromProject: string | null, fromId: string,
    toProject: string | null, toId: string,
    relType: string, newRelType?: string
  ) {
    if (newRelType && newRelType !== relType) {
      this.removeRelation(fromProject, fromId, toProject, toId, relType);
      this.addRelation(fromProject, fromId, toProject, toId, newRelType);
    }
  }

  // 失效缓存（简单实现，存在误匹配风险）
  private invalidateCache(fromKey: NodeKey, toKey: NodeKey) {
    // 删除涉及这两个节点的所有缓存
    // ⚠️ 注意：key.includes() 可能导致误删
    // 例如：修改 "project:auth" 会错误匹配 "project:auth-service"
    // 生产环境建议使用 §4.2 的 GraphQueryCache（基于反向索引）
    for (const key of this.queryCache.keys()) {
      if (key.includes(fromKey) || key.includes(toKey)) {
        this.queryCache.delete(key);
      }
    }
  }

  // 查询依赖（上游/下游）
  queryDeps(
    project: string | null,
    entityId: string,
    direction: 'upstream' | 'downstream' | 'both',
    depth: number = 1,
    relTypes?: string[]  // 可选：按关系类型过滤
  ) {
    const startKey = makeNodeKey(project, entityId);
    const visited = new Set<NodeKey>();
    const result: Array<{ project: string | null; id: string; distance: number }> = [];

    const traverse = (nodeKey: NodeKey, currentDepth: number) => {
      if (currentDepth > depth || visited.has(nodeKey)) return;

      visited.add(nodeKey);
      if (nodeKey !== startKey) {
        const node = this.nodes.get(nodeKey);
        if (node) {
          result.push({ project: node.project, id: node.id, distance: currentDepth });
        }
      }

      const node = this.nodes.get(nodeKey);
      if (!node) return;

      // 遍历出边（下游）
      if (direction === 'downstream' || direction === 'both') {
        for (const [relType, targets] of node.outgoing.entries()) {
          // 如果指定了 relTypes，则只遍历匹配的关系类型
          if (relTypes && relTypes.length > 0 && !relTypes.includes(relType)) {
            continue;
          }
          for (const targetKey of targets) {
            traverse(targetKey, currentDepth + 1);
          }
        }
      }

      // 遍历入边（上游）
      if (direction === 'upstream' || direction === 'both') {
        for (const [relType, sources] of node.incoming.entries()) {
          // 如果指定了 relTypes，则只遍历匹配的关系类型
          if (relTypes && relTypes.length > 0 && !relTypes.includes(relType)) {
            continue;
          }
          for (const sourceKey of sources) {
            traverse(sourceKey, currentDepth + 1);
          }
        }
      }
    };

    traverse(startKey, 0);
    return result;
  }
}
```

**内存图更新机制**：

| 操作 | 更新方式 | 是否需要重启 |
|------|---------|-------------|
| 添加关系 | `addRelation()` 增量更新 | 否 |
| 删除关系 | `removeRelation()` 增量更新 | 否 |
| 修改关系类型 | `updateRelation()` 增量更新 | 否 |
| 批量导入 | `load()` 全量重建 | 否（自动触发） |

**并发修改处理**：

```typescript
// 使用读写锁保护并发访问（优化：读多写少场景）
class InMemoryGraph {
  private rwLock = new RWLock();

  // 写操作：独占锁
  async addRelationSafe(fromId: string, toId: string, relType: string) {
    await this.rwLock.acquireWrite();
    try {
      this.addRelation(fromId, toId, relType);
    } finally {
      this.rwLock.releaseWrite();
    }
  }

  // 读操作：共享锁（允许并发读）
  async queryDependenciesSafe(entityId: string): Promise<string[]> {
    await this.rwLock.acquireRead();
    try {
      return this.queryDependencies(entityId);
    } finally {
      this.rwLock.releaseRead();
    }
  }
}
```

> **设计说明**：图查询是读多写少场景，使用 RWLock 替代 Mutex 可显著提升并发读性能。

### 4.2 图查询缓存

> **设计说明**：图查询使用两层缓存机制：
> - **InMemoryGraph.queryCache**：内嵌在图实例中的简单缓存，随图实例生命周期管理，在 `load()` 时清空
> - **GraphQueryCache**：独立的缓存服务，支持反向索引实现精确失效，适用于跨图实例的查询结果复用
>
> 两者可根据实际需求选择使用，简单场景用前者，复杂场景（如多 proposal 切换）用后者。

对于常见查询（如依赖分析），使用缓存加速：

```typescript
class GraphQueryCache {
  private cache: Map<string, { result: any; expiresAt: number; relatedEntities: Set<string> }> = new Map();
  private ttl: number = 5 * 60 * 1000; // 5 分钟
  private entityToCacheKeys: Map<string, Set<string>> = new Map(); // 反向索引

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.result;
  }

  set(key: string, result: any, relatedEntities: string[]) {
    // 清理旧条目的反向索引
    this.delete(key);

    // 存储缓存条目
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.ttl,
      relatedEntities: new Set(relatedEntities)
    });

    // 建立反向索引：entity → cache keys
    for (const entityId of relatedEntities) {
      if (!this.entityToCacheKeys.has(entityId)) {
        this.entityToCacheKeys.set(entityId, new Set());
      }
      this.entityToCacheKeys.get(entityId)!.add(key);
    }
  }

  private delete(key: string) {
    const entry = this.cache.get(key);
    if (entry) {
      // 清理反向索引
      for (const entityId of entry.relatedEntities) {
        this.entityToCacheKeys.get(entityId)?.delete(key);
      }
      this.cache.delete(key);
    }
  }

  // 实体变更时精确清除相关缓存（使用反向索引）
  invalidate(entityId: string) {
    const keysToDelete = this.entityToCacheKeys.get(entityId);
    if (keysToDelete) {
      for (const key of keysToDelete) {
        this.delete(key);
      }
      this.entityToCacheKeys.delete(entityId);
    }
  }
}
```

> **设计说明**：使用反向索引（entity → cache keys）实现精确的缓存失效，避免字符串匹配导致的误删或漏删。

---
