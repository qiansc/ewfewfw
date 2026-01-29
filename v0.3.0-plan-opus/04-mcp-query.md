# Part 04: MCP Query 工具

> 详细执行计划 - 基于 `v0.3.0/detailed-design/mcp/query.md`

---

## 任务清单

| # | 功能 | [ ] | 描述 |
|---|------|:---:|------|
| 4.1 | c4a_query_search 输入参数 | [ ] | query/scope/proposal_id/limit 参数定义（复用 SearchParams） |
| 4.2 | c4a_query_search 返回结果 | [ ] | items/degraded/degraded_reason/search_mode 返回结构 |
| 4.3 | SearchHit 类型 | [ ] | id/type/score/summary/highlights 搜索结果项 |
| 4.4 | c4a_query_deps 输入参数 | [ ] | id/source_project/direction/depth/proposal_id 参数定义（复用 DepsParams） |
| 4.5 | c4a_query_deps 返回结果 | [ ] | items/degraded/degraded_reason/degraded_message 返回结构 |
| 4.6 | DepsNode 类型 | [ ] | id/type/distance/relation_type/path 依赖节点 |
| 4.7 | c4a_query_impact 输入参数 | [ ] | id/source_project/change_type(upgrade\|deprecate\|remove)/depth/proposal_id 参数定义（复用 ImpactParams） |
| 4.8 | c4a_query_impact 返回结果 | [ ] | items/degraded/degraded_reason/suggestion 返回结构 |
| 4.9 | ImpactNode 类型 | [ ] | id/type/distance/impact_level/reason 影响节点 |
| 4.10 | 查询一致性检测 | [ ] | checkSyncStatus 检查 pendingSync 状态（Server 模式，Local 跳过） |
| 4.11 | QueryContext 类型 | [ ] | degraded/degraded_reason/degraded_message/affected_entities |
| 4.12 | 降级行为 - deps | [ ] | Neo4j 不可用时降级到 MongoDB $graphLookup |
| 4.13 | 降级行为 - impact | [ ] | 降级模式下返回 degraded: true + suggestion |
| 4.14 | 降级行为 - search | [ ] | Milvus 不可用时降级到全文搜索，search_mode: 'fulltext' |
| 4.15 | Local Mode search | [ ] | 调用 Part 06 的 USearch 向量搜索 |
| 4.16 | Local Mode deps | [ ] | 调用 Part 06 的 InMemoryGraph 遍历 |
| 4.17 | Local Mode impact | [ ] | 简化版影响分析（仅下游依赖，返回 degraded: true + suggestion） |
| 4.18 | StorageAdapter 接口 | [x] | search/queryDeps/queryImpact 方法签名（已在 adapterSearchTypes.ts 定义） |
| 4.19 | LiteAdapter 实现 | [ ] | Local 模式 Query 方法实现（调用 Part 06 基础设施） |
| 4.20 | MCP Handler 层 | [ ] | packages/cli/src/mcp/query/*.ts 工具处理器 |
| 4.21 | MCP Server 注册 | [ ] | 3 个工具注册到 c4a-data-mcp Server |
| 4.22 | 单元测试 | [ ] | 各工具基本功能测试 |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 4.1-4.3 | c4a_query_search | `mcp/query.md` | §4.1 search | L3-16 | [ ] | [ ] |
| 4.4-4.6 | c4a_query_deps | `mcp/query.md` | §4.2 deps | L18-21 | [ ] | [ ] |
| 4.7-4.9 | c4a_query_impact | `mcp/query.md` | §4.3 impact | L23-26 | [ ] | [ ] |
| 4.10-4.11 | 一致性检测 | `mcp/query.md` | §4.4.1 不一致状态检测 | L34-69 | [ ] | [ ] |
| 4.12-4.14 | 降级行为 | `mcp/query.md` | §4.4.2 降级行为 | L72-78 | [ ] | [ ] |
| 4.12-4.14 | 返回格式扩展 | `mcp/query.md` | §4.4.3 返回格式扩展 | L80-101 | [ ] | [ ] |
| 4.12-4.14 | 实现要点 | `mcp/query.md` | §4.4.4 实现要点 | L103-111 | [ ] | [ ] |
| 4.15-4.17 | Local Mode 能力对比 | `mcp/query.md` | §4.5.1 能力对比 | L117-123 | [ ] | [ ] |
| 4.17 | Local Mode impact | `mcp/query.md` | §4.5.2 impact 实现 | L125-155 | [ ] | [ ] |
| - | Skill 降级处理 | `mcp/query.md` | §4.5.3 Skill 降级处理 | L157-179 | [ ] | [ ] |
| - | 工具分组 | `mcp/overview.md` | §1.1 工具分组 | L9-18 | [ ] | [ ] |
| - | 核心工具 | `mcp/overview.md` | §1.2 核心工具 | L24-46 | [ ] | [ ] |
| - | 知识生命周期 Query | `architecture.md` | §1.3 知识生命周期 | L92-113 | [ ] | [ ] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| 适配器类型 | `packages/storage/src/adapterSearchTypes.ts` | SearchParams/DepsParams/ImpactParams 类型 | ✅ |
| 适配器接口 | `packages/storage/src/adapter.ts` | search/queryDeps/queryImpact 方法签名 | [ ] |
| LiteAdapter | `packages/storage/src/lite-adapter/query-operations.ts` | Local 模式 Query 实现（调用 Part 06） | [ ] |
| MCP Handler | `packages/cli/src/mcp/query/search.ts` | c4a_query_search 处理器 | [ ] |
| MCP Handler | `packages/cli/src/mcp/query/deps.ts` | c4a_query_deps 处理器 | [ ] |
| MCP Handler | `packages/cli/src/mcp/query/impact.ts` | c4a_query_impact 处理器 | [ ] |
| MCP Handler | `packages/cli/src/mcp/query/index.ts` | Query 工具统一导出 | [ ] |
| Schema 定义 | `packages/cli/src/mcp/querySchemas.ts` | Zod Schema 定义 | [ ] |
| Server 注册 | `packages/cli/src/mcp/server.ts` | 注册 3 个 Query 工具 | [ ] |
| 单元测试 | `packages/storage/src/__tests__/query-operations.test.ts` | Query 操作测试 | [ ] |

> **注意**：Part 06 已完成的基础设施（vector-search.ts, in-memory-graph.ts, graph-query-cache.ts）由 Part 04 调用，不在此列表重复。

---

## 依赖关系

- 依赖 Part 06 的 Local 模式基础设施（已完成 ✅）：
  - `vector-search.ts` - 向量搜索
  - `in-memory-graph.ts` - 图查询
  - `graph-query-cache.ts` - 图查询缓存
- 依赖 Part 03 的 StorageAdapter 接口（已完成 ✅）
- 复用 Part 03 的 adapterSearchTypes.ts 类型定义（已完成 ✅）
- 被 Part 10 Skills 依赖（/c4a:plan 调用 c4a_query_deps）

---

## 设计说明

### 降级模式返回格式

Query 工具的降级状态通过业务返回结构中的字段表示，**不使用 ErrorResponse**：

```typescript
interface QueryResult<T> {
  items: T[];
  // 分页（search 必需，deps/impact 可选）
  pagination?: {
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
  };
  // 降级状态字段
  degraded?: boolean;           // 是否处于降级模式
  degraded_reason?: string;     // 降级原因（机器可读）
  degraded_message?: string;    // 降级消息（人类可读）
  search_mode?: 'vector' | 'fulltext';  // search 专用
  suggestion?: string;          // impact 专用建议
}
```

**设计理由**：降级是正常的运行时状态，不是错误。Agent 应能继续工作，只是功能受限。

### proposal_id 支持

所有 Query 工具支持 `proposal_id` 参数：
- **不传（null）**：只查主分支数据
- **传入 feat_id**：Merge View 查询（feat 分支优先，主分支兜底）

类型已在 `adapterSearchTypes.ts` 定义。

### 一致性检测

- **Local 模式**：SQLite 强一致，跳过 `checkSyncStatus`
- **Server 模式**：检查 MongoDB `sync_status` 字段，如有 pending 则在返回中标记

### Local Mode 限制

| 工具 | Local 模式能力 | 限制说明 |
|------|---------------|----------|
| search | ✅ USearch 向量搜索 | 无 |
| deps | ✅ InMemoryGraph 遍历 | 无 |
| impact | ⚠️ 简化版 | 仅分析下游依赖，不支持跨项目影响传播 |

**impact 降级提示**：Local 模式下返回 `degraded: true` + `suggestion: "切换到 Server 模式获取完整影响分析"`

---

## 验收标准

- [ ] 3 个 MCP 工具注册到 Server
- [ ] 输入参数与设计文档一致
- [ ] 返回结果与设计文档一致
- [ ] Local 模式 search 使用 USearch
- [ ] Local 模式 deps 使用 InMemoryGraph
- [ ] Local 模式 impact 返回简化版结果
- [ ] 降级模式返回 degraded: true
- [ ] 单元测试通过

---

## 最终验证（提交前必须执行）

**参考设计文档：**
- `v0.3.0/detailed-design/mcp/query.md` (全文)
- `v0.3.0/detailed-design/mcp/overview.md` §1.1-1.2
- `v0.3.0/architecture.md` §1.3

**Review 流程：**
1. 运行 `bun run typecheck` 验证类型
2. 运行 `bun test` 验证测试
3. 打开 `v0.3.0/detailed-design/mcp/query.md` 逐行对照检查
4. 确认每个工具的输入参数和返回结果与设计文档完全一致
5. 验证 Local 模式和降级模式行为正确
