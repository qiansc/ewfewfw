# 数据操作详细设计

> **相关文档**：
> - 架构设计：[../architecture.md](../architecture.md)
> - Local 模式实现：[local-mode.md](./local-mode.md)

---

## 1. 跨层级和跨项目引用

### 1.1 设计原则

- DSL 保持简洁，用户编写时只需写实体 ID
- 数据库存储完整信息（source_repo、source_project 等）
- CLI 自动解析和智能提示

### 1.2 实体唯一性

**逻辑唯一性 vs 物理唯一性**：

| 层面 | 唯一键 | 用途 | 说明 |
|------|--------|------|------|
| **逻辑唯一性** | `(source_repo, source_project, id)` | 业务层面识别"同一个实体" | 用于引用解析、跨项目查询 |
| **物理唯一性** | `(source_repo, source_project, id, proposal_id)` | 数据库层面支持多版本 | 支持 Feat 的 Copy-on-Write 机制 |

**说明**：
- 逻辑唯一性用于回答"这是哪个实体"
- 物理唯一性用于回答"这是哪个实体的哪个版本"
- 主分支实体的 `proposal_id` 为 `NULL`
- Feat 内实体的 `proposal_id` 为 feat ID（如 `"feat-a001-user-login"`）

> **详细说明**：物理唯一性的表结构定义请参考 [sqlite-schema.md#2.1](../local-mode/sqlite-schema.md#21-核心表)

### 1.3 实体归属

| 实体类型 | source_repo | source_project | 说明 |
|---------|------------|---------------|------|
| 项目实体 | 有值 | 有值 | 属于某个项目 |
| 基建/SDK | 有值 | NULL | 不属于任何项目，仓库级共享 |
| Domain/Enterprise | NULL | NULL | 全局知识 |

### 1.3 引用表达方式

```yaml
# technical/containers/order-service.yaml
schema: c4a/v1
type: container
container:
  id: order-service
  name: 订单服务
  references:
    - payment-service                          # 简单 ID（自动解析）
    - jwt-utils                                # 基建（同 repo）
    - project:frontend-app/auth-component      # 跨项目（同 repo）
    - repo:company/shared-lib/jwt-utils        # 跨仓库基建
    - repo:other/repo/project:app/service      # 跨仓库跨项目
    - scope:domain/order-state-machine         # 指定 scope
```

### 1.4 引用格式规范

| 格式 | 说明 | 目标实体 | 示例 |
|------|------|---------|------|
| `{id}` | 简单 ID，按优先级自动解析 | 任意 | `payment-service` |
| `project:{project_id}/{id}` | 同 repo 跨项目 | source_project 有值 | `project:frontend-app/auth` |
| `repo:{repo_id}/{id}` | 跨 repo 基建 | source_project = NULL | `repo:company/shared-lib/jwt-utils` |
| `repo:{repo_id}/project:{project_id}/{id}` | 跨 repo 跨项目 | source_project 有值 | `repo:other/repo/project:app/svc` |
| `scope:{scope}/{id}` | 指定层级 | Domain/Enterprise | `scope:domain/order-fsm` |

### 1.5 解析优先级

当只写 `{id}` 时，按以下顺序查找：

1. **本项目**：`source_repo = 当前 repo, source_project = 当前 project`
2. **同 repo 基建**：`source_repo = 当前 repo, source_project = NULL`
3. **同 repo 其他项目**：`source_repo = 当前 repo, source_project != 当前 project`（如有歧义，返回警告）
4. **Enterprise 层**：`scope = enterprise`
5. **Domain 层**：`scope = domain`
6. **未找到**：创建悬空引用

### 1.6 数据库存储

```sql
-- 本项目引用
INSERT INTO relations (from_id, to_id, rel_type, properties) VALUES
  ('order-service', 'payment-service', 'REFERENCES',
   '{"target_repo": "company/backend-api", "target_project": "backend-api"}');

-- 同 repo 基建引用
INSERT INTO relations (from_id, to_id, rel_type, properties) VALUES
  ('order-service', 'jwt-utils', 'REFERENCES',
   '{"target_repo": "company/backend-api", "target_project": null}');

-- 跨 repo 基建引用
INSERT INTO relations (from_id, to_id, rel_type, properties) VALUES
  ('order-service', 'jwt-utils', 'REFERENCES',
   '{"target_repo": "company/shared-lib", "target_project": null}');

-- 跨 repo 跨项目引用
INSERT INTO relations (from_id, to_id, rel_type, properties) VALUES
  ('order-service', 'some-service', 'REFERENCES',
   '{"target_repo": "company/other-repo", "target_project": "some-app"}');

-- Domain/Enterprise 层引用
INSERT INTO relations (from_id, to_id, rel_type, properties) VALUES
  ('order-service', 'order-state-machine', 'REFERENCES',
   '{"target_scope": "domain"}');
```

### 1.7 CLI 导出时的智能注释

```yaml
# technical/containers/order-service.yaml
container:
  id: order-service
  references:
    - payment-service                          # project: backend-api (本项目)
    - jwt-utils                                # infra: backend-api (本 repo 基建)
    - project:frontend-app/auth-component      # project: frontend-app (同 repo)
    - repo:company/shared-lib/jwt-utils        # infra: shared-lib (跨 repo 基建)
    - scope:domain/order-state-machine         # domain
```

### 1.8 歧义处理

当简单 ID 在多个地方都能找到时，返回警告：

```typescript
{
  ambiguous: [
    { id: "auth-utils", source_repo: "company/backend-api", source_project: "backend-api" },
    { id: "auth-utils", source_repo: "company/backend-api", source_project: null }
  ],
  message: "Found multiple matches for 'auth-utils', please use explicit reference:\n" +
           "  - auth-utils (current project)\n" +
           "  - repo:company/backend-api/auth-utils (infra)"
}
```

### 1.9 查询示例

```typescript
// 查询实体的所有引用
c4a_store_read({
  id: "order-service",
  include_relations: true
})

// 返回：
{
  id: "order-service",
  type: "container",
  references: [
    {
      id: "payment-service",
      target_repo: "company/backend-api",
      target_project: "backend-api"
    },
    {
      id: "jwt-utils",
      target_repo: "company/backend-api",
      target_project: null  // 基建
    },
    {
      id: "auth-component",
      target_repo: "company/backend-api",
      target_project: "frontend-app"
    },
    {
      id: "order-state-machine",
      target_scope: "domain"
    }
  ]
}

// 过滤基建引用
c4a_store_read({
  id: "order-service",
  include_relations: true,
  filter_relations: { target_project: null }  // 只返回基建引用
})
```

### 1.10 保存时的自动解析

```typescript
// 用户调用
c4a_store_save({
  type: "container",
  data: {
    id: "order-service",
    references: [
      "payment-service",                          // 简单 ID
      "jwt-utils",                                // 简单 ID
      "project:frontend-app/auth-component",      // 跨项目
      "repo:company/shared-lib/jwt-utils",        // 跨仓库基建
      "scope:domain/order-state-machine"          // 指定 scope
    ]
  }
})

// 内部逻辑：
// 1. 解析 "payment-service"
//    - 按优先级查询：本项目 → 同 repo 基建 → 同 repo 其他项目 → Enterprise → Domain
//    - 找到：source_repo=company/backend-api, source_project=backend-api
//    - 创建 REFERENCES 关系，properties 包含 target_repo 和 target_project
//
// 2. 解析 "jwt-utils"
//    - 按优先级查询
//    - 找到：source_repo=company/backend-api, source_project=null（基建）
//    - 创建 REFERENCES 关系，properties 包含 target_repo 和 target_project=null
//
// 3. 解析 "project:frontend-app/auth-component"
//    - 识别跨项目引用格式
//    - 查询：source_repo=当前 repo, source_project=frontend-app, id=auth-component
//    - 创建 REFERENCES 关系
//
// 4. 解析 "repo:company/shared-lib/jwt-utils"
//    - 识别跨仓库基建格式
//    - 查询：source_repo=company/shared-lib, source_project=null, id=jwt-utils
//    - 创建 REFERENCES 关系
//
// 5. 解析 "scope:domain/order-state-machine"
//    - 识别 scope 引用格式
//    - 查询：scope=domain, id=order-state-machine
//    - 创建 REFERENCES 关系，properties 包含 target_scope
```

### 1.11 悬空引用处理

> **关键设计：逻辑引用完整性检查（非物理外键）**
>
> C4A 采用**逻辑引用**而非物理外键约束。数据库层面不强制引用完整性，而是在应用层进行状态感知的检查：
> - **draft/approved 状态**：允许悬空引用，只报 Warning，不阻塞保存/同步
> - **published 状态**：悬空引用报 Error，必须解决后才能发布
>
> 这避免了"无法保存因为有悬空引用，无法创建被引用实体因为无法保存"的死循环。
>
> 详见 [sqlite-schema.md](../local-mode/sqlite-schema.md) 中 relations 表的设计说明。

**引用实体不存在时的处理**：

| 场景 | 处理策略 | 返回值 |
|------|---------|--------|
| 本项目引用不存在 | 警告 + 创建悬空引用 | `{ warning: "entity 'xxx' not found, created dangling reference" }` |
| 跨项目引用不存在 | 警告 + 创建悬空引用 | `{ warning: "entity 'xxx' in project 'yyy' not found" }` |
| Domain/Enterprise 引用不存在 | 警告 + 创建悬空引用 | `{ warning: "entity 'xxx' not found in domain/enterprise scope" }` |

**悬空引用特性**：
- 关系记录正常创建，但 `properties` 中标记 `resolved: false`
- 查询时可通过 `filter_relations: { resolved: false }` 找出所有悬空引用
- 当目标实体后续创建时，**系统自动解析悬空引用**（内部逻辑，无需手动调用）

**悬空引用解析策略**：

| 维度 | 策略 | 说明 |
|------|------|------|
| **触发时机** | 保存实体时同步检查 | 在 `c4a_store_save` 内部执行 |
| **解析逻辑** | 先检查实体是否存在 | 查询数据库：`db.exists('entities', entityId)` |
| | 实体存在 → 立即解析 | 无论是否跨项目，只要实体存在就解析 |
| | 实体不存在 + 本项目 → 保持悬空 | 记录警告，等待实体创建 |
| | 实体不存在 + 跨项目 → 标记 pending | 等待目标项目同步 |
| **失败处理** | 保留悬空引用 + 记录警告日志 | 不阻塞保存操作 |
| **批量操作** | 事务提交后批量解析 | `c4a_store_sync` / `c4a_store_plan_sync` 导入后自动触发 |

**批量操作的解析策略**：

| 操作类型 | 解析时机 | 实现方式 |
|---------|---------|---------|
| **单个保存** (`c4a_store_save`) | 保存时立即解析 | 应用层钩子，每次保存触发 |
| **批量同步** (`c4a_store_sync`) | 导入完成后批量解析 | 事务提交后，扫描所有悬空引用并解析 |
| **Server/Remote 同步** (`c4a_store_plan_sync`, execute=true) | 事务提交后批量解析 | 单个 MongoDB 事务完成所有上传，然后批量解析 |
| **直接 SQL 导入** | 必须手动调用解析 | 调用 `resolveDanglingReferencesInBatch()` |

> **重要**：批量导入（如 `c4a_store_sync`、`c4a_store_plan_sync` 或直接 SQL INSERT）可能绕过应用层钩子，因此必须在事务提交后显式调用批量解析函数，否则悬空引用将一直保持 `resolved: false` 状态。

```typescript
// 查询悬空引用
c4a_store_read({
  id: "order-service",
  include_relations: true,
  filter_relations: { resolved: false }
})

// 保存目标实体时，自动解析悬空引用
c4a_store_save({
  entity: { id: "payment-service", ... }
})
// 内部自动执行：
// 1. 保存实体
// 2. 查找所有指向 payment-service 的悬空引用
// 3. 将它们标记为 resolved: true

// 跨项目悬空引用解析
async function resolveDanglingReferences(entityId: string, sourceProject: string) {
  // 1. 查找指向该实体的悬空引用
  const danglingRefs = await db.query(`
    SELECT * FROM relations
    WHERE to_id = ? AND properties->>'resolved' = 'false'
  `, [entityId]);

  for (const ref of danglingRefs) {
    const refProject = ref.properties?.target_project;

    // 2. 检查目标实体是否存在于数据库
    const targetExists = await db.exists('entities', entityId);

    if (targetExists) {
      // 目标实体存在：立即解析（无论是否跨项目）
      await db.update('relations', ref.id, {
        properties: { ...ref.properties, resolved: true }
      });
    } else if (refProject === sourceProject) {
      // 本项目引用但实体不存在：保持悬空状态，记录警告
      console.warn(`Dangling reference: entity '${entityId}' not found in project '${sourceProject}'`);
    } else if (refProject) {
      // 跨项目引用且实体不存在：标记为 pending，等待目标项目同步
      await db.update('relations', ref.id, {
        properties: { ...ref.properties, resolve_status: 'pending' }
      });
    }
  }
}
```

**设计理由**：
- 自动解析：保存实体时自动解析悬空引用，确保关系数据完整
- 允许悬空引用：支持先定义引用、后创建实体的工作流（如 feat 内先引用后实现）
- 警告而非报错：不阻塞保存操作，但提醒用户注意
- 简化 Agent 逻辑：Agent 无需关心引用解析的细节

### 1.12 Feat 的 Copy-on-Write 机制

#### 1.12.1 核心原理

Feat 采用 **Copy-on-Write（写时复制）** 机制实现分支隔离：

| 维度 | 说明 |
|------|------|
| **读取时** | Feat 看到主分支 + Feat 的合并视图（Feat 版本优先） |
| **修改时** | 创建实体副本，标记 `proposal_id` |
| **发布时** | Feat 版本覆盖主分支版本，`proposal_id` 清空为 `null` |

**关键特性**：
- ✅ **存储高效**：只有被修改的实体才创建副本
- ✅ **隔离性好**：多个 Feat 可以并行修改同一实体，互不干扰
- ✅ **查询简单**：合并视图逻辑清晰（主分支 + Feat，Feat 优先）

#### 1.12.2 数据库设计

> **说明**：以下为逻辑示意，完整的表结构定义请参考 [sqlite-schema.md#2.1](../local-mode/sqlite-schema.md#21-核心表)（Local 模式）或对应的 Server 模式实现文档。

**复合主键**（逻辑示意）：

```sql
-- 实体数据表（简化示意，实际结构见 sqlite-schema.md）
CREATE TABLE entities (
    id TEXT NOT NULL,
    source_project TEXT NOT NULL,  -- 实体归属项目
    proposal_id TEXT,              -- NULL 表示主分支
    type TEXT NOT NULL,
    kind TEXT,
    scope TEXT,
    perspective TEXT,
    data TEXT NOT NULL,  -- JSON 格式
    PRIMARY KEY (source_project, id, proposal_id)  -- 三元组主键：项目 + ID + 版本
);

-- 实体元数据表（独立表，三元组主键）
CREATE TABLE metadata (
    entity_id TEXT NOT NULL,
    source_project TEXT NOT NULL,  -- 与 entities 表的 source_project 对应
    proposal_id TEXT,              -- 与 entities 表的 proposal_id 对应
    source_repo TEXT,
    external_url TEXT,
    status TEXT NOT NULL,
    content_hash TEXT,             -- SHA-256 哈希，用于冲突检测
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT,
    updated_by TEXT,
    PRIMARY KEY (source_project, entity_id, proposal_id),
    FOREIGN KEY (source_project, entity_id, proposal_id)
        REFERENCES entities(source_project, id, proposal_id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX idx_entities_proposal_id ON entities(proposal_id);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_source_project ON entities(source_project);
```

**关系表设计**（逻辑示意）：

```sql
-- 关系指向"逻辑实体"，而非特定版本
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    proposal_id TEXT,              -- 关系归属的 Feat（NULL=主分支）
    from_project TEXT NOT NULL,    -- 源实体的 source_project
    from_id TEXT NOT NULL,         -- 源实体的逻辑 ID（不绑定版本）
    to_project TEXT NOT NULL,      -- 目标实体的 source_project
    to_id TEXT NOT NULL,           -- 目标实体的逻辑 ID（不绑定版本）
    rel_type TEXT NOT NULL,
    properties TEXT,  -- JSON 格式
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
    -- ❌ 不使用外键约束：关系指向"逻辑实体"，查询时通过 Merge View 解析
);
```

> **设计说明**：关系表不绑定目标实体的 `proposal_id`，而是指向逻辑实体 `(project, id)`。查询时通过 Merge View 逻辑解析到正确的实体版本（Feat 优先 → 主分支兜底）。

#### 1.12.3 工作流程示例

**场景**：主分支有 100 个实体，Feat 修改其中 1 个

```
1. 初始状态
   主分支: 100 个实体 (proposal_id=NULL)

2. 创建 feat-a001
   c4a_store_feat_lifecycle({ action: "create", feat_id: "feat-a001" })

3. 在 feat 中修改 auth-service
   c4a_store_save({
     type: "container",
     data: { id: "auth-service", name: "认证服务 v2" }
   })

   数据库操作：
   - 检查主分支是否有 auth-service (proposal_id=NULL) → 有
   - 创建副本（简化示意）：
     -- 插入实体数据
     INSERT INTO entities (id, proposal_id, type, kind, scope, perspective, data)
     VALUES ('auth-service', 'feat-a001', 'container', NULL, NULL, NULL, '{"name":"认证服务 v2"}');

     -- 插入元数据
     INSERT INTO metadata (entity_id, proposal_id, status, created_at, updated_at)
     VALUES ('auth-service', 'feat-a001', 'draft', datetime('now'), datetime('now'));

4. 数据库状态
   主分支: 100 个实体 (proposal_id=NULL)
   feat-a001: 1 个实体 (proposal_id="feat-a001")
   总计: 101 条记录

5. feat-a001 查询（合并视图）
   c4a_store_read({ proposal_id: "feat-a001" })

   SQL 实现（详见 sqlite-schema.md#3.2）：
   WITH ranked AS (
     SELECT *,
       ROW_NUMBER() OVER (
         PARTITION BY source_project, id  -- 按项目+实体ID分组
         ORDER BY
           CASE
             WHEN proposal_id = 'feat-a001' THEN 1  -- 当前 Feat 优先
             WHEN proposal_id IS NULL THEN 2       -- 主分支兜底
             ELSE 3                                 -- 其他 Feat（不应出现）
           END
       ) AS rn
     FROM entities
     WHERE proposal_id = 'feat-a001' OR proposal_id IS NULL
   )
   SELECT * FROM ranked WHERE rn = 1;

   返回: 100 个实体
   - auth-service: feat 版本 (v2)
   - 其余 99 个: 主分支版本

**性能优化**：

合并视图查询使用窗口函数，在大数据量时可能存在性能问题。以下是优化策略：

| 数据规模 | 查询时间 | 优化策略 |
|---------|---------|---------|
| < 1,000 实体 | < 100ms | 无需优化，直接查询 |
| 1,000 - 10,000 实体 | 100ms - 1s | 使用查询结果缓存 |
| > 10,000 实体 | > 1s | 使用物化视图 + 增量更新 |

**优化方案 1：查询结果缓存**（适用于中等数据量）

```typescript
// 缓存合并视图查询结果
class MergeViewCache {
  private cache: Map<string, { data: any[]; expiresAt: number }> = new Map();
  private ttl = 60000; // 缓存 60 秒

  async query(proposalId: string) {
    const cacheKey = `merge_view:${proposalId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.data; // 命中缓存
    }

    // 执行查询
    const data = await db.query(/* 合并视图 SQL */);

    // 更新缓存
    this.cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.ttl
    });

    return data;
  }

  // 实体变更时失效缓存
  invalidate(proposalId: string) {
    this.cache.delete(`merge_view:${proposalId}`);
  }
}
```

**优化方案 2：物化视图 + 增量更新**（适用于大数据量）

```sql
-- 1. 创建物化视图（feat 创建时）
CREATE TABLE merge_view_feat_a001 AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY source_project, id
      ORDER BY
        CASE
          WHEN proposal_id = 'feat-a001' THEN 1
          WHEN proposal_id IS NULL THEN 2
          ELSE 3
        END
    ) AS rn
  FROM entities
  WHERE proposal_id IS NULL OR proposal_id = 'feat-a001'
)
SELECT * FROM ranked WHERE rn = 1;

-- 2. 创建索引
CREATE INDEX idx_merge_view_feat_a001_id ON merge_view_feat_a001(source_project, id);

-- 3. 增量更新（实体变更时）
-- 3.1 新增/修改 feat 实体
INSERT OR REPLACE INTO merge_view_feat_a001
SELECT * FROM entities WHERE source_project = 'backend-api' AND id = 'auth-service' AND proposal_id = 'feat-a001';

-- 3.2 删除 feat 实体（回退到主分支版本）
DELETE FROM merge_view_feat_a001 WHERE source_project = 'backend-api' AND id = 'auth-service';
INSERT INTO merge_view_feat_a001
SELECT * FROM entities WHERE source_project = 'backend-api' AND id = 'auth-service' AND proposal_id IS NULL;

-- 4. 查询（直接查物化视图，无需窗口函数）
SELECT * FROM merge_view_feat_a001;

-- 5. feat 发布后删除物化视图
DROP TABLE merge_view_feat_a001;
```

**优化方案 3：智能查询路由**（推荐）

```typescript
async function queryMergeView(proposalId: string) {
  // 1. 统计 feat 修改的实体数量
  const featCount = await db.query(
    'SELECT COUNT(*) FROM entities WHERE proposal_id = ?',
    [proposalId]
  );

  // 2. 根据修改数量选择查询策略
  if (featCount < 10) {
    // 少量修改：直接查询主分支 + 单独查询 feat 实体
    const mainBranch = await db.query(
      'SELECT * FROM entities WHERE proposal_id IS NULL'
    );
    const featEntities = await db.query(
      'SELECT * FROM entities WHERE proposal_id = ?',
      [proposalId]
    );

    // 内存合并���O(n) 复杂度）
    const merged = new Map(mainBranch.map(e => [e.id, e]));
    featEntities.forEach(e => merged.set(e.id, e));
    return Array.from(merged.values());
  } else {
    // 大量修改：使用窗口函数查询
    return db.query(/* 合并视图 SQL */);
  }
}
```

**性能对比**：

| 方案 | 查询时间 | 内存占用 | 维护成本 | 适用场景 |
|------|---------|---------|---------|---------|
| 直接查询 | 慢（窗口函数） | 低 | 低 | 小数据量 |
| 查询缓存 | 快（命中时） | 中 | 低 | 中等数据量，读多写少 |
| 物化视图 | 最快 | 高（双倍存储） | 高（增量更新） | 大数据量，频繁查询 |
| 智能路由 | 快 | 低 | 中 | **推荐**，自动适配 |

**实现建议**：

- **Local 模式**：使用智能查询路由（SQLite 窗口函数性能较差）
- **Server 模式**：使用查询缓存（MongoDB 聚合性能较好）
- **大数据量**：考虑物化视图（需权衡存储成本）

6. feat-a001 发布
   c4a_store_feat_merge({ feat_id: "feat-a001", strategy: "auto" })

   数据库操作：
   - 删除主分支旧版本:
     DELETE FROM entities WHERE id = 'auth-service' AND proposal_id IS NULL;
   - feat 版本移到主分支:
     UPDATE entities
     SET proposal_id = NULL,
         metadata = jsonb_set(metadata, '{status}', '"published"')
     WHERE id = 'auth-service' AND proposal_id = 'feat-a001';

7. 发布后状态
   主分支: 100 个实体 (proposal_id=NULL)
   - auth-service 已更新为 v2
   总计: 100 条记录（回到初始数量）
```

#### 1.12.4 多 Feat 并行修改

**场景**：两个 Feat 同时修改同一个实体

```
初始状态:
  主分支: auth-service v1 (proposal_id=NULL)

feat-a001 修改:
  创建副本: auth-service v2 (proposal_id="feat-a001")

feat-a002 修改:
  创建副本: auth-service v3 (proposal_id="feat-a002")

数据库状态:
  { id: "auth-service", proposal_id: NULL, data: { name: "v1" } }
  { id: "auth-service", proposal_id: "feat-a001", data: { name: "v2" } }
  { id: "auth-service", proposal_id: "feat-a002", data: { name: "v3" } }

查询行为:
  - 主分支查询: 返回 v1
  - feat-a001 查询: 返回 v2（feat 版本覆盖主分支）
  - feat-a002 查询: 返回 v3（feat 版本覆盖主分支）

发布顺序:
  1. feat-a001 先发布 → 主分支变为 v2
  2. feat-a002 后发布 → 主分支变为 v3（覆盖 v2，产生冲突）
```

**冲突处理**：
- 后发布的 Feat 会检测到主分支已被修改（v2 != v1）
- 触发冲突解决流程（见第 3 章）
- 模型分析差异，建议合并策略

#### 1.12.5 关系的 Copy-on-Write

**场景**：Feat 修改实体时，关系如何处理？

```
主分支:
  auth-service (proposal_id=NULL)
    → user-db (proposal_id=NULL)

feat-a001 修改 auth-service，新增依赖 redis:
  1. 创建实体副本:
     auth-service (proposal_id="feat-a001")

  2. 创建 feat 版本的关系:
     INSERT INTO relations VALUES
       ('rel-1', 'feat-a001', 'backend-api', 'auth-service', 'backend-api', 'user-db', 'DEPENDS_ON', '{}'),
       ('rel-2', 'feat-a001', 'backend-api', 'auth-service', 'backend-api', 'redis', 'DEPENDS_ON', '{}');

查询 feat-a001 的 auth-service 关系（合并视图，详见 sqlite-schema.md#3.2）:
  WITH ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY from_project, from_id, to_project, to_id, rel_type  -- 按关系唯一键分组
        ORDER BY
          CASE
            WHEN proposal_id = 'feat-a001' THEN 1
            WHEN proposal_id IS NULL THEN 2
            ELSE 3
          END
      ) AS rn
    FROM relations
    WHERE (from_id = 'auth-service')
      AND (proposal_id = 'feat-a001' OR proposal_id IS NULL)
  )
  SELECT * FROM ranked WHERE rn = 1;

  返回:
  - auth-service → user-db (继承自主分支或 feat 版本)
  - auth-service → redis (feat 新增)
```

**关系约束与继承规则**：
- **单关系约束**：同一对实体同类型只允许一条关系，多语义通过 `properties` 字段合并
- **删除遮蔽**：Feat 删除关系时写入 `status: 'deleted'` 的 tombstone 记录，Merge View 过滤
- Feat 修改实体时，自动继承主分支的所有关系；发布时，Feat 的关系覆盖主分支关系

#### 1.12.6 存储效率分析

| 场景 | 主分支实体数 | Feat 修改数 | 数据库总记录数 | 存储冗余 |
|------|------------|-----------|--------------|---------|
| 小改动 | 100 | 1 | 101 | 1% |
| 中等改动 | 100 | 10 | 110 | 10% |
| 大改动 | 100 | 50 | 150 | 50% |
| 全量改动 | 100 | 100 | 200 | 100% |

**结论**：
- 大部分 Feat 只修改少量实体（< 10%）
- 存储冗余可控，不会造成显著的空间浪费

#### 1.12.7 Checklist 的处理

**设计决策**：Checklist 是**纯数据库数据**，本地文件只是渲染的只读视图。

> **关键设计**：Checklist **不参与同步**，数据库是唯一数据源。
> - Agent 通过 `c4a_store_feat_checklist` 直接操作数据库
> - CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 `checklist.md`（只读视图）
> - 本地文件仅供人类查看，不作为数据源，不参与 `c4a sync`

**存储策略**：

| 维度 | 说明 |
|------|------|
| **数据源** | MongoDB `feats` 集合的 `checklist` 字段（唯一权威源） |
| **本地文件** | `.context/feat/{feat-id}/checklist.md`（渲染的只读视图） |
| **同步方向** | 单向：数据库 → 本地文件（仅渲染，不上传） |

**设计理由**：
- **避免双重标准**：checklist 不是普通文件，不需要 CLI 硬编码特殊处理
- **避免状态分裂**：Agent 修改数据库后，不会与本地文件产生冲突
- **简化同步逻辑**：`c4a sync` 只处理 DSL 实体文件，不需要特殊处理 checklist
- **支持多人协作**：数据库作为单一数据源，天然支持多人共享进度

**文件位置**：

```
.context/feat/feat-a001-user-login/
├── feat.yaml              # Feat 元数据（只读视图，由 MCP 工具管理，不参与文件同步）
├── checklist.md           # Checklist 只读视图（渲染生成，不参与同步）
├── technical/
│   ├── containers/
│   │   └── auth-service.yaml
│   └── components/
│       └── jwt-component.yaml
```

**渲染命令**：

```bash
# 从数据库渲染 checklist 到本地文件
c4a feat render feat-a001-user-login

# 输出:
正在渲染 feat-a001-user-login...
  📄 渲染: checklist.md (从数据库)
  ✅ 渲染完成

# 查看 checklist
cat .context/feat/feat-a001-user-login/checklist.md
```

**MCP 工具**：`c4a_store_feat_checklist`（详见 [mcp-tools.md](./mcp-tools.md#37-c4a_store_feat_checklist-checklist-管理)）

**Checklist 生命周期**：

| Feat 状态 | Checklist 数据库字段 | 本地渲染文件 |
|-----------|---------------------|-------------|
| draft | ✅ 存在（Agent 可修改） | ✅ 可渲染查看 |
| approved | ✅ 存在（Agent 可修改） | ✅ 可渲染查看 |
| published | ❌ 自动清理 | ✅ 最终版本保留 |
| deprecated | ❌ 自动清理 | ✅ 最终版本保留 |
| archived | ❌ 自动清理 | ✅ 最终版本保留 |

**终态清理逻辑**：

```typescript
// c4a_store_feat_lifecycle 内部逻辑
async function transitionFeatStatus(feat_id: string, to_status: string) {
  // 1. 状态流转
  await updateFeatStatus(feat_id, to_status);

  // 2. 终态时清理 Checklist（数据库字段）
  // 注：根据 concepts.md 核心状态机，终态只有 published、deprecated、archived
  // "拒绝"是流转动作（draft → archived），不是独立状态
  const terminalStates = ['published', 'deprecated', 'archived'];
  if (terminalStates.includes(to_status)) {
    // 先渲染最终版本到本地（保留历史记录）
    await renderChecklistToLocal(feat_id);
    // 再清理数据库字段
    await clearChecklistFromDB(feat_id);
  }

  // 3. published 时额外执行 merge
  if (to_status === 'published') {
    await c4a_store_feat_merge({ feat_id, strategy: 'auto' });
  }
}
```

**拒绝流转说明**：

> **注意**："拒绝"是一个流转动作，不是独立状态。根据 concepts.md 核心状态机：
> - `draft ──拒绝──► archived`（审核不通过，直接归档）
> - 拒绝后的 Feat 进入 `archived` 状态，Checklist 清理，本地渲染文件保留供复盘
> - 如需重新提交，应基于归档的 Feat 创建新的 draft

#### 1.12.8 实体变更历史追溯

**问题**：实体被多个 Feat 反复修改后，如何追溯历史？

**解决方案**：独立的变更历史表

> **说明**：以下为逻辑示意，完整的表结构定义请参考 [local-mode.md#2.2](./local-mode.md#22-实体变更历史表)（Local 模式）或对应的 Server 模式实现文档。

```sql
-- 实体变更历史（简化示意，实际结构见 local-mode.md）
CREATE TABLE entity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    proposal_id TEXT,  -- 记录是哪个版本的实体（NULL=主分支，feat-xxx=feat 版本）
    entity_type TEXT NOT NULL,
    feat_id TEXT,  -- 哪个 feat 做的修改（NULL 表示主分支直接修改）
    action TEXT NOT NULL,  -- "create" | "update" | "delete"
    changed_fields TEXT,  -- JSON 数组，记录修改了哪些字段
    snapshot_after TEXT,  -- JSON 格式，修改后的快照
    changed_by TEXT,
    changed_at TEXT DEFAULT (datetime('now'))
    -- 注意：不使用外键约束，因为 entities 表的主键是复合主键 (id, proposal_id)
);

CREATE INDEX idx_entity_history_entity_id ON entity_history(entity_id);
CREATE INDEX idx_entity_history_proposal_id ON entity_history(proposal_id);
CREATE INDEX idx_entity_history_feat_id ON entity_history(feat_id);
CREATE INDEX idx_entity_history_changed_at ON entity_history(changed_at);
```

**查询示例**：

```typescript
// 查询 auth-service 的完整变更历史
c4a_store_read_history({ entity_id: "auth-service" })

// 返回:
[
  {
    feat_id: "feat-a001-user-login",
    action: "create",
    changed_by: "alice@example.com",
    changed_at: "2026-01-22T10:00:00Z"
  },
  {
    feat_id: "feat-a002-add-oauth",
    action: "update",
    changed_fields: ["data.auth_methods"],
    changed_by: "bob@example.com",
    changed_at: "2026-01-25T14:30:00Z"
  }
]

// 查询 feat-a002 修改了哪些实体
c4a_store_read_history({ feat_id: "feat-a002-add-oauth" })

// 返回:
[
  { entity_id: "auth-service", action: "update" },
  { entity_id: "oauth-component", action: "create" }
]
```

**自动记录**：
- `c4a_store_save` 在保存时自动写入历史记录
- 记录 feat_id、操作类型、变更字段、操作人、时间戳
- 支持审计和回滚

---

