# 查询与分析：`c4a_query_*`（设计层）

## 4.1 `c4a_query_search`（语义搜索）

- **输入（建议）**
  - `query: string`：搜索关键词
  - `type_filter?: string`：按实体类型筛选（`"system"`, `"container"`, `"component"`, `"adr"`, `"contract"`, `"product"`, `"process"`, `"sor"`, `"all"`）
  - `limit?: number = 20`：返回结果数量上限
  - `offset?: number = 0`：分页偏移量
- **返回（JSON，建议）**：
  ```typescript
  {
    items: { score?: number; id; type; summary?; ... }[];
    pagination: { total: number; offset: number; limit: number; has_more: boolean };
  }
  ```

## 4.2 `c4a_query_deps`（依赖查询）

- **输入（建议）**：`id: string`, `direction?: "upstream" | "downstream" | "both"`, `depth?: number`
- **返回（JSON，建议）**：依赖节点列表

## 4.3 `c4a_query_impact`（影响分析）

- **输入（建议）**：`id: string`, `change_type?: string`, `depth?: number`
- **返回（JSON，建议）**：影响节点列表

---

## 4.4 查询一致性与降级感知（Server 模式）

> **背景**：Server 模式下，Neo4j/Milvus 采用最终一致性（详见 [store-feat-lifecycle.md](store-feat-lifecycle.md#379-server-模式多存储一致性)）。Merge 操作后可能存在短暂的"不一致窗口期"，Query 工具必须感知并正确处理。

### 4.4.1 不一致状态检测

Query 工具在执行前需检查相关实体的同步状态：

```typescript
interface QueryContext {
  degraded: boolean;           // 是否处于降级模式
  degraded_reason?: string;    // 降级原因
  affected_entities?: string[]; // 受影响的实体 ID
}

async function checkSyncStatus(entityIds: string[]): Promise<QueryContext> {
  // 1. 检查 pendingSync 集合中是否有未完成的同步
  const pendingRecords = await db.pendingSync.find({
    entity_ids: { $in: entityIds },
    status: { $in: ["pending", "partial"] }
  }).toArray();

  if (pendingRecords.length > 0) {
    return {
      degraded: true,
      degraded_reason: "PENDING_SYNC",
      affected_entities: pendingRecords.flatMap(r => r.entity_ids)
    };
  }

  // 2. 检查 Neo4j 连接状态
  if (!await neo4jHealthCheck()) {
    return {
      degraded: true,
      degraded_reason: "NEO4J_UNAVAILABLE"
    };
  }

  return { degraded: false };
}
```

### 4.4.2 降级行为

| 工具 | 正常模式 | 降级模式 | 返回标识 |
|------|---------|---------|---------|
| `c4a_query_deps` | Neo4j 查询，depth ≤ 5 | MongoDB `$graphLookup`，**depth = 1** | `degraded: true` |
| `c4a_query_impact` | Neo4j 图遍历 | **禁止**，返回错误 | `error: "DEGRADED_MODE_UNSUPPORTED"` |
| `c4a_query_search` | Milvus 向量搜索 | MongoDB 全文搜索（精度下降） | `degraded: true, search_mode: "fulltext"` |

### 4.4.3 返回格式扩展

降级模式下，返回结果需包含状态标识：

```typescript
// c4a_query_deps 降级模式返回示例
{
  success: true,
  degraded: true,
  degraded_reason: "PENDING_SYNC",
  degraded_message: "部分实体尚未同步到 Neo4j，结果可能不完整",
  max_depth_allowed: 1,  // 降级模式下的深度限制
  items: [...]
}

// c4a_query_impact 降级模式返回示例
{
  success: false,
  error: "DEGRADED_MODE_UNSUPPORTED",
  message: "影响分析需要完整的图数据，当前处于降级模式",
  suggestion: "请等待同步完成或执行 `c4a_store_repair` 修复数据一致性"
}
```

### 4.4.4 实现要点

1. **查询前检查**：每次查询前调用 `checkSyncStatus()`，传入查询涉及的实体 ID
2. **透明降级**：`c4a_query_deps` 自动降级，但在返回中标识 `degraded: true`
3. **明确拒绝**：`c4a_query_impact` 在降级模式下直接返回错误，避免返回误导性结果
4. **用户提示**：返回 `suggestion` 字段，引导用户执行修复操作

> **设计原则**：宁可返回"不完整但正确"的结果，也不返回"完整但错误"的结果。降级模式下限制查询深度，确保返回的数据来自权威源（MongoDB）。

## 4.5 Local Mode 查询策略

Local Mode 使用 SQLite + InMemoryGraph 替代 Server Mode 的 Neo4j + Milvus，查询能力有所差异：

### 4.5.1 能力对比

| 工具 | Server Mode | Local Mode | 差异说明 |
|------|-------------|------------|----------|
| `c4a_query_search` | Milvus 向量搜索 | sqlite-vec 向量搜索（可降级到全文搜索） | 降级时召回质量下降 |
| `c4a_query_deps` | Neo4j Cypher，depth ≤ 5 | InMemoryGraph 遍历，depth ≤ 5 | 功能一致 |
| `c4a_query_impact` | Neo4j 图遍历 | InMemoryGraph 简化版 | 返回直接下游 + 警告 |

### 4.5.2 `c4a_query_impact` Local Mode 实现

Local Mode 不直接返回错误，而是提供简化版影响分析：

```typescript
// Local Mode 简化版影响分析
async function queryImpactLocal(
  entityId: string,
  project: string | null,
  changeType: string = 'modify',
  depth: number = 3
): Promise<ImpactResult> {
  const graph = InMemoryGraph.getInstance();

  // 使用 queryDeps 获取下游依赖
  const downstream = graph.queryDeps(project, entityId, 'downstream', depth);

  return {
    success: true,
    degraded: true,
    degraded_reason: "LOCAL_MODE_SIMPLIFIED",
    degraded_message: "Local 模式使用简化版影响分析，仅基于依赖关系遍历",
    items: downstream.map(node => ({
      id: node.id,
      project: node.project,
      distance: node.distance,
      impact_type: changeType === 'remove' ? 'breaking' : 'potential'
    })),
    suggestion: "如需完整的影响分析（含变更类型推断），请使用 Server 模式"
  };
}
```

### 4.5.3 Skill 降级处理

当 `c4a_query_impact` 返回 `degraded: true` 或 `success: false` 时，Skill 应：

1. **不中断流程**：继续执行后续步骤
2. **提示用户**：告知影响分析结果可能不完整
3. **建议手动审查**：对于高风险变更，建议用户手动确认影响范围

```typescript
// /c4a:plan Skill 中的降级处理示例
const impactResult = await c4a_query_impact({ id: entityId, change_type: 'modify' });

if (impactResult.degraded || !impactResult.success) {
  // 不中断，继续流程
  console.log(`⚠️ 影响分析受限：${impactResult.degraded_message || impactResult.message}`);
  console.log(`建议：手动确认以下潜在受影响组件：`);

  // 使用 c4a_query_deps 作为兜底
  const deps = await c4a_query_deps({ id: entityId, direction: 'downstream', depth: 1 });
  deps.items.forEach(item => console.log(`  - ${item.id}`));
}
```
