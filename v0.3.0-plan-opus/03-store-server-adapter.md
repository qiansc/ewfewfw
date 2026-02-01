# Part 03 Store (ServerAdapter) - Agent 提示词

> 执行顺序：Agent-0（前置验证）→ Agent-1~2 并行 → Agent-3（集成收尾）

---

## 概述

Part 13 Server Mode 已完成，现在需要完善 Part 03 Store 中与 ServerAdapter 相关的挂起任务。

**当前状态**：
- ✅ ServerAdapter 核心实现已完成（CRUD/关系/搜索/Feat/工具类）
- ✅ storage-backend Python 服务已完成
- ✅ 模式切换 Local↔Server 已完成
- ✅ 权限系统已完成
- ✅ 健康检查端点已实现（/health 返回 MongoDB/Neo4j/Milvus 状态）
- ✅ 搜索降级已实现（Milvus 失败时回退到 LIKE 搜索 + degraded: true）
- ✅ 修复命令已实现（/utils/repair 支持 scope: all|neo4j|milvus）
- ✅ 基础测试覆盖已完成（server-adapter.test.ts、server-integration.test.ts、test_api.py）

**待完成任务**：

| 子模块 | 设计文档 | 核心能力 | 任务编号 |
|--------|---------|---------|---------|
| 图查询降级 + 类型修正 | [query.md](../v0.3.0/detailed-design/mcp/query.md) §4.4-4.5 | Neo4j 不可用时优雅降级 + 返回类型统一 | 03S.1-03S.2 |
| 同步状态追踪 | [store-feat-lifecycle.md](../v0.3.0/detailed-design/mcp/store-feat-lifecycle.md) §3.7.9 | sync_status 字段 + 一致性检查 | 03S.3-03S.5 |
| 文档与验证 | - | README/summary 更新 | 03S.6-03S.7 |

**关键问题**：
- ⚠️ **类型不一致**：当前 `queryDeps/queryImpact` 返回 `DepsNode[]`/`ImpactNode[]`，但降级时需要返回 `{ nodes, degraded }`，需要修改接口签名和所有实现

**依赖关系**：
- 依赖 Part 13 Server Mode（已完成）
- 被 Part 04 Query 依赖（降级行为）

---

## Agent-0：前置验证（必须先完成）

```
你作为 v0.3.0-plan-opus/03-store-server-adapter.md 里的 Agent-0 负责前置验证任务。

请执行 Part 03 Store (ServerAdapter) 的前置验证任务：

1. 验证已完成的功能：
   - 健康检查：curl http://localhost:8055/health
   - 搜索降级：检查 packages/storage-backend/src/routes/search.py 中的 degraded 处理
   - 修复命令：检查 packages/storage-backend/src/routes/utils.py 中的 /repair 端点

2. 运行现有测试确认基线：
   ```bash
   # TypeScript 测试
   bun run --filter @c4a/storage test

   # Python 测试
   cd packages/storage-backend && python -m pytest
   ```

3. 确认待完成任务：
   - 图查询降级：packages/storage-backend/src/routes/graph.py 中 Neo4j 失败时抛出 HTTPException，应改为返回 degraded: true
   - 同步状态追踪：没有 sync_status 字段和 /check-consistency 端点

4. 产物：
   - 确认所有前置条件满足
   - 记录当前测试覆盖率
   - 列出需要修复的问题

完成后告诉我，我会启动 Agent-1~2 并行执行。
```

### 前置验证结果（2026-02-01）

- 健康检查：`curl http://localhost:8055/health` 返回 `{"status":"ok","mongodb":true,"neo4j":true,"milvus":true}`。
- 搜索降级：Milvus 失败回退 LIKE，返回 `degraded: true`（`packages/storage-backend/src/routes/search.py:111`）。
- 修复命令：`/utils/repair` 端点已实现（`packages/storage-backend/src/routes/utils.py:318`）。
- TypeScript 测试：`bun run --filter @c4a/storage test` → 129 pass / 5 skip / 0 fail。
- Python 测试：`.venv` 运行 `pytest` → 29 passed, 1 warning（ChecklistRequest 字段名覆盖警告，`packages/storage-backend/src/routes/feat.py:40`）。
- 覆盖率：测试未输出 coverage 报告（pytest/bun test 未启用 coverage）。
- 待修复：`graph.py` Neo4j 失败仍抛 HTTPException（需改为 degraded 返回）；未发现 `sync_status` 字段与 `/check-consistency` 端点。

---

## Agent-1：图查询降级实现（03S.1-03S.2）

```
你作为 v0.3.0-plan-opus/03-store-server-adapter.md 里的 Agent-1 负责实现图查询降级。

请实现 Server 模式下图查询的降级行为。

**背景**：搜索降级已实现（search.py），但图查询（graph.py）在 Neo4j 失败时抛出 HTTPException，需要改为优雅降级。

1. 阅读现有实现：
   - packages/storage-backend/src/routes/graph.py（当前实现）
   - packages/storage-backend/src/routes/search.py（降级参考）
   - packages/storage-backend/src/services/database.py（check_neo4j 函数）

2. 任务 03S.1 - deps 查询降级：
   - 修改 /graph/deps 端点
   - Neo4j 不可用或查询失败时返回 degraded: true
   - 不抛出 HTTPException，返回空结果 + 降级信息

   ```python
   # packages/storage-backend/src/routes/graph.py
   @router.post("/deps")
   async def query_deps(params: DepsRequest, ...):
       # ... 权限检查 ...

       neo4j = await get_neo4j_adapter()
       mongodb = await get_mongodb_adapter()

       try:
           records = await neo4j.query_deps(params.id, project_id, direction, depth)
       except Exception as exc:
           # 降级处理：返回空结果 + 降级标记
           return {
               "nodes": [],
               "degraded": True,
               "degraded_reason": "NEO4J_QUERY_FAILED",
               "degraded_message": str(exc),
           }

       # 正常处理...
       return {"nodes": nodes, "degraded": False}
   ```

3. 任务 03S.2 - impact 查询降级：
   - 修改 /graph/impact 端点
   - 同样的降级处理逻辑

   ```python
   @router.post("/impact")
   async def query_impact(params: ImpactRequest, ...):
       # ... 权限检查 ...

       try:
           records = await neo4j.query_impact(params.id, project_id, depth)
       except Exception as exc:
           return {
               "nodes": [],
               "degraded": True,
               "degraded_reason": "NEO4J_QUERY_FAILED",
               "degraded_message": str(exc),
           }

       # 正常处理...
       return {"nodes": nodes, "degraded": False}
   ```

4. 更新类型定义（必须）：
   - **关键问题**：当前 `queryDeps/queryImpact` 返回 `DepsNode[]`/`ImpactNode[]`，但降级时需要返回 `{ nodes, degraded }`
   - 需要修改 packages/storage/src/adapterSearchTypes.ts 添加结果包装类型
   - 需要修改 packages/storage/src/adapter.ts 接口签名

   ```typescript
   // packages/storage/src/adapterSearchTypes.ts

   /**
    * 依赖查询结果（包含降级状态）
    */
   export interface DepsResult {
     nodes: DepsNode[];
     degraded: boolean;
     degraded_reason?: 'NEO4J_QUERY_FAILED' | 'NEO4J_UNAVAILABLE';
     degraded_message?: string;
   }

   /**
    * 影响分析结果（包含降级状态）
    */
   export interface ImpactResult {
     nodes: ImpactNode[];
     degraded: boolean;
     degraded_reason?: 'NEO4J_QUERY_FAILED' | 'NEO4J_UNAVAILABLE';
     degraded_message?: string;
   }
   ```

   ```typescript
   // packages/storage/src/adapter.ts
   export interface StorageAdapter {
     // ...
     queryDeps(params: DepsParams): Promise<DepsResult>;  // 改为返回 DepsResult
     queryImpact(params: ImpactParams): Promise<ImpactResult>;  // 改为返回 ImpactResult
   }
   ```

   - 同步修改 LiteAdapter 实现（packages/storage/src/lite-adapter/search-operations.ts）
   - 同步修改 MCP Query 工具（packages/mcp-query/src/tools/deps.ts, impact.ts）

5. 联动修改（类型变更影响范围）：
   - packages/storage/src/lite-adapter/search-operations.ts - LiteAdapter 实现
   - packages/storage/src/server-adapter.ts - ServerAdapter 实现
   - packages/mcp-query/src/tools/deps.ts - MCP 工具
   - packages/mcp-query/src/tools/impact.ts - MCP 工具
   - packages/mcp-query/src/handlerContext.ts - 如有类型引用

6. 测试用例：
   - packages/storage-backend/tests/test_graph_degraded.py
   - 模拟 Neo4j 查询失败场景
   - 验证返回 degraded: true 而非抛出异常

7. 验证：
   ```bash
   # 类型检查（确保接口变更无遗漏）
   bun run typecheck

   # Python 测试
   cd packages/storage-backend && python -m pytest tests/test_graph_degraded.py -v

   # TypeScript 测试
   bun run --filter @c4a/storage test
   bun run --filter @c4a/mcp-query test
   ```
```

---

## Agent-2：同步状态追踪（03S.3-03S.5）

```
你作为 v0.3.0-plan-opus/03-store-server-adapter.md 里的 Agent-2 负责实现同步状态追踪。

请实现 Server 模式下的多库同步状态追踪。

**背景**：修复命令（/utils/repair）已实现，但缺少同步状态追踪和一致性检查端点。

1. 阅读现有实现：
   - packages/storage-backend/src/routes/utils.py（repair 端点）
   - packages/storage-backend/src/routes/entities.py（实体保存）
   - packages/storage/src/multi-store-sync.ts（Local 模式参考）

2. 任务 03S.3 - 同步状态字段：
   - 在实体保存时记录 Neo4j/Milvus 同步状态
   - 修改 entities.py 的 save 逻辑

   ```python
   # packages/storage-backend/src/routes/entities.py
   @router.post("/save")
   async def save_entity(params: SaveRequest, ...):
       # ... 保存到 MongoDB ...

       sync_status = {"neo4j": "synced", "milvus": "synced"}

       # 同步到 Neo4j（如果有关系）
       if relations:
           try:
               for relation in relations:
                   await neo4j.save_relation(relation)
           except Exception as e:
               sync_status["neo4j"] = "pending"
               sync_status["neo4j_error"] = str(e)

       # 同步到 Milvus
       try:
           vector_key = generate_vector_key(...)
           vector = await embedder.embed(search_text)
           await milvus.upsert_vector(vector_key, vector)
       except Exception as e:
           sync_status["milvus"] = "pending"
           sync_status["milvus_error"] = str(e)

       # 更新同步状态到 MongoDB
       await adapter.entities.update_one(
           {"id": entity_id, "source_project": source_project},
           {"$set": {"sync_status": sync_status}}
       )

       return {"id": entity_id, "sync_status": sync_status, ...}
   ```

3. 任务 03S.4 - 一致性检查端点：
   - 添加 /utils/check-consistency 端点
   - 统计 synced/pending/failed 实体数量

   ```python
   # packages/storage-backend/src/routes/utils.py
   class CheckConsistencyRequest(BaseModel):
       project_id: str | None = None

   @router.post("/check-consistency")
   async def check_consistency(
       params: CheckConsistencyRequest,
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
   ) -> dict[str, Any]:
       adapter = await get_mongodb_adapter()

       query: dict[str, Any] = {}
       if params.project_id:
           query["source_project"] = params.project_id

       entities = await adapter.entities.find(query, {"id": 1, "sync_status": 1}).to_list(length=None)

       result = {
           "total": len(entities),
           "synced": 0,
           "pending": 0,
           "no_status": 0,
           "details": [],
       }

       for entity in entities:
           status = entity.get("sync_status")
           if not status:
               result["no_status"] += 1
               continue

           neo4j_ok = status.get("neo4j") == "synced"
           milvus_ok = status.get("milvus") == "synced"

           if neo4j_ok and milvus_ok:
               result["synced"] += 1
           else:
               result["pending"] += 1
               result["details"].append({
                   "id": entity["id"],
                   "neo4j": status.get("neo4j", "unknown"),
                   "milvus": status.get("milvus", "unknown"),
               })

       return result
   ```

4. 任务 03S.5 - 更新 ServerAdapter：
   - packages/storage/src/server-adapter.ts
   - 添加 checkConsistency 方法

   ```typescript
   async checkConsistency(params?: { project_id?: string }): Promise<ConsistencyResult> {
     return this.httpClient.post<ConsistencyResult>('/utils/check-consistency', {
       body: params || {},
     });
   }
   ```

5. 测试用例：
   - packages/storage-backend/tests/test_consistency.py
   - 验证同步状态正确记录
   - 验证一致性检查端点正常工作

6. 验证：
   ```bash
   cd packages/storage-backend && python -m pytest tests/test_consistency.py -v
   ```
```

---

## Agent-3：集成收尾（等待 Agent-1~2 全部完成）

```
你作为 v0.3.0-plan-opus/03-store-server-adapter.md 里的 Agent-3 负责集成收尾任务。

请执行 Part 03 Store (ServerAdapter) 的集成收尾任务。

1. 验证所有任务完成：
   - Agent-1：图查询降级
   - Agent-2：同步状态追踪

2. 运行全量测试：
   ```bash
   # TypeScript 测试
   bun run --filter @c4a/storage test

   # Python 测试
   cd packages/storage-backend && python -m pytest

   # 类型检查
   bun run typecheck
   ```

3. 任务 03S.6 - 更新文档：
   - 更新 packages/storage/README.md
   - 添加降级行为说明
   - 添加同步状态说明

   ```markdown
   ## Server 模式降级行为

   当 Neo4j 或 Milvus 服务不可用时，查询操作会优雅降级：

   | 服务 | 影响的操作 | 降级行为 |
   |------|-----------|---------|
   | Milvus | search | 回退到 LIKE 搜索 + degraded: true |
   | Neo4j | queryDeps, queryImpact | 返回空结果 + degraded: true |

   ## 同步状态追踪

   实体保存时会记录 Neo4j/Milvus 同步状态：
   - synced: 同步成功
   - pending: 同步失败，待重试

   使用 `/utils/check-consistency` 检查一致性状态。
   使用 `/utils/repair` 修复不一致的数据。
   ```

4. 任务 03S.7 - 更新 summary.md：
   - 更新 Part 04 Query 的 4.5 降级行为为 [x]
   - 更新阻塞清单中 checkSyncStatus 状态
   - 添加补充说明

5. 验证清单：
   - [x] 图查询降级正常工作（deps/impact 返回 degraded: true）
   - [x] 同步状态追踪正常（实体保存后有 sync_status 字段）
   - [x] 一致性检查端点正常（/utils/check-consistency）
   - [x] 全量测试通过
   - [x] 文档已更新
   - [x] summary.md 已更新

6. 产物：
   - packages/storage-backend/src/routes/graph.py 更新
   - packages/storage-backend/src/routes/entities.py 更新
   - packages/storage-backend/src/routes/utils.py 更新
   - packages/storage/src/server-adapter.ts 更新
   - packages/storage/README.md 更新
   - v0.3.0-plan-opus/summary.md 更新
```

---

## 执行检查清单

| 步骤 | Agent | 任务编号 | 状态 | 完成时间 |
|------|-------|---------|:----:|---------|
| 0 | Agent-0 | 前置验证 | [ ] | - |
| 1 | Agent-1 | 03S.1-03S.2 (图查询降级) | [x] | 2026-02-01 |
| 1 | Agent-2 | 03S.3-03S.5 (同步状态追踪) | [x] | 2026-02-01 |
| 2 | Agent-3 | 03S.6-03S.7 (集成收尾) | [x] | 2026-02-01 |

---

## 任务编号索引

| 编号 | 任务 | Agent | 状态 |
|------|------|-------|:----:|
| 03S.1 | deps 查询降级 + 类型修正 | Agent-1 | [x] |
| 03S.2 | impact 查询降级 + 类型修正 | Agent-1 | [x] |
| 03S.3 | 同步状态字段 | Agent-2 | [x] |
| 03S.4 | 一致性检查端点 | Agent-2 | [x] |
| 03S.5 | ServerAdapter checkConsistency | Agent-2 | [x] |
| 03S.6 | README 文档更新 | Agent-3 | [x] |
| 03S.7 | summary.md 更新 | Agent-3 | [x] |

---

## 已完成任务（无需再做）

以下任务在 Part 13 Server Mode 中已完成：

| 任务 | 实现位置 | 说明 |
|------|---------|------|
| 健康状态检测 | main.py `/health` | 返回 MongoDB/Neo4j/Milvus 状态 |
| 搜索降级 | search.py | Milvus 失败时回退到 LIKE + degraded: true |
| 修复命令 | utils.py `/repair` | 支持 scope: all\|neo4j\|milvus |
| 基础测试 | server-*.test.ts, test_api.py | CRUD/Feat/搜索测试覆盖 |

---

## 关键设计决策

### 1. 降级行为策略

| 服务 | 不可用时行为 | 返回格式 |
|------|-------------|---------|
| MongoDB | 抛出错误（权威源不可用） | 500 错误 |
| Neo4j | 返回空结果 + degraded: true | 200 + 降级标记 |
| Milvus | 回退到 LIKE 搜索 + degraded: true | 200 + 降级标记 |

### 2. 类型变更影响范围

**接口签名变更**：
```typescript
// 变更前
queryDeps(params: DepsParams): Promise<DepsNode[]>;
queryImpact(params: ImpactParams): Promise<ImpactNode[]>;

// 变更后
queryDeps(params: DepsParams): Promise<DepsResult>;
queryImpact(params: ImpactParams): Promise<ImpactResult>;
```

**影响文件清单**：
| 文件 | 修改内容 |
|------|---------|
| `adapterSearchTypes.ts` | 新增 DepsResult/ImpactResult 类型 |
| `adapter.ts` | 修改接口签名 |
| `lite-adapter/search-operations.ts` | 修改返回值包装 |
| `server-adapter.ts` | 修改返回值处理 |
| `mcp-query/src/tools/deps.ts` | 修改结果解构 |
| `mcp-query/src/tools/impact.ts` | 修改结果解构 |
| `graph.py` | 修改返回格式 |

### 3. 同步状态字段

```json
{
  "sync_status": {
    "neo4j": "synced" | "pending",
    "milvus": "synced" | "pending",
    "neo4j_error": "Connection refused",
    "milvus_error": "Timeout"
  }
}
```

---

## 与 summary.md 的关联

完成本规划后需要更新 summary.md：

| summary 位置 | 更新内容 |
|-------------|---------|
| Part 04 Query 4.5 | 降级行为 `[ ]` → `[x]` |
| Part 04 阻塞清单 | checkSyncStatus 状态更新 |
| Part 03 补充说明 | 添加 03S.1-03S.7 完成记录 |

---

## 挂起任务（v0.4.0）

| 任务 | 挂起原因 |
|------|----------|
| 异步同步队列 | v0.3.0 简化设计 |
| 自动修复调度 | v0.3.0 简化设计 |
| 分布式事务 | 复杂度高 |
