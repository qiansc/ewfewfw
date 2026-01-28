## 3. 向量搜索实现

### 3.1 Embedding 生成

使用 [@xenova/transformers](https://github.com/xenova/transformers.js) 在本地生成向量：

```typescript
import { pipeline } from '@xenova/transformers';

// 初始化模型（首次运行会下载 ~80MB）
const embedder = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
);

// 生成向量
async function generateEmbedding(text: string): Promise<Float32Array> {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}
```

**模型特性**：
- 模型：`all-MiniLM-L6-v2`
- 维度：384
- 大小：~80MB
- 语言：多语言支持（中英文）
- 缓存位置：`~/.cache/huggingface/`

### 3.2 向量搜索

**问题**：向量搜索必须实现 Feat 版本隔离（Copy-on-Write），否则会返回重复或错误版本的数据。

**错误示例**（缺少 proposal_id 过滤）：

```typescript
// ❌ 错误：未过滤 proposal_id，会返回重复数据
async function semanticSearch_WRONG(query: string, limit: number = 10) {
  const db = DatabaseConnection.getInstance();
  const embedding = await generateEmbedding(query);

  return db.prepare(`
    SELECT
      e.id,
      e.type,
      e.data,
      vec_distance_cosine(v.embedding, ?) as distance
    FROM entities e
    JOIN vectors v ON e.id = v.entity_id  -- ❌ 缺少 proposal_id 过滤
    ORDER BY distance ASC
    LIMIT ?
  `).all(embedding, limit);
}
```

**问题分析**：

1. **重复数据**：如果实体 `auth-service` 在主分支和 Feat 中都存在，上述查询会返回两条记录
2. **版本混乱**：JOIN 条件只匹配 `entity_id`，没有匹配 `proposal_id`，可能返回错误版本的向量
3. **缺少 Merge View**：没有实现"Feat 优先，主分支兜底"的版本选择逻辑

**正确实现**（带 Feat 版本隔离 + 生命周期过滤）：

```typescript
// ✅ 正确：实现 Feat 版本隔离的向量搜索
async function semanticSearch(
  query: string,
  currentProposalId: string | null,  // 当前 Feat ID（null 表示主分支）
  limit: number = 10
) {
  const db = DatabaseConnection.getInstance();
  const embedding = await generateEmbedding(query);

  // 方案 1：使用 Window Function 实现 Merge View（推荐）
  return db.prepare(`
    WITH ranked_entities AS (
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        m.status,
        v.embedding,
        vec_distance_cosine(v.embedding, ?) as distance,
        -- 版本优先级：当前 Feat > 主分支
        -- 注意：proposal_id 使用空字符串哨兵值代替 NULL
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY
            CASE
              WHEN e.proposal_id = ? THEN 1  -- 当前 Feat 优先
              WHEN e.proposal_id = '' THEN 2  -- 主分支兜底（空字符串）
              ELSE 3  -- 其他 Feat 版本（不应出现）
            END
        ) as rn
      FROM entities e
      JOIN metadata m ON
        e.source_project = m.source_project AND
        e.id = m.entity_id AND
        e.proposal_id = m.proposal_id
      JOIN vectors v ON
        e.source_project = v.source_project AND
        e.id = v.entity_id AND
        e.proposal_id = v.proposal_id  -- 直接比较，无需处理 NULL
      WHERE
        -- 只搜索当前 Feat 和主分支的实体
        (e.proposal_id = ? OR e.proposal_id = '')
        -- ✅ 过滤已归档/已删除的实体
        AND m.status NOT IN ('archived', 'deprecated')
    )
    SELECT
      id,
      source_project,
      proposal_id,
      type,
      data,
      distance
    FROM ranked_entities
    WHERE rn = 1  -- 每个实体只保留优先级最高的版本
    ORDER BY distance ASC
    LIMIT ?
  `).all(
    embedding,
    currentProposalId,  -- 用于 CASE 判断
    currentProposalId,  -- 用于 WHERE 过滤
    limit
  );
}
```

**方案 2：使用 UNION 实现 Merge View（简化版）**：

```typescript
// ✅ 正确：使用 UNION 实现版本选择 + 生命周期过滤
// 注意：proposal_id 使用空字符串哨兵值代替 NULL
async function semanticSearch_Alternative(
  query: string,
  currentProposalId: string | null,
  limit: number = 10
) {
  const db = DatabaseConnection.getInstance();
  const embedding = await generateEmbedding(query);
  const dbProposalId = currentProposalId ?? '';  // null → ''

  return db.prepare(`
    WITH feat_entities AS (
      -- 当前 Feat 中的实体
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        m.status,
        v.embedding,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM entities e
      JOIN metadata m ON
        e.source_project = m.source_project AND
        e.id = m.entity_id AND
        e.proposal_id = m.proposal_id
      JOIN vectors v ON
        e.source_project = v.source_project AND
        e.id = v.entity_id AND
        e.proposal_id = v.proposal_id
      WHERE e.proposal_id = ?
        AND m.status NOT IN ('archived', 'deprecated')
    ),
    main_entities AS (
      -- 主分支中的实体（proposal_id = ''）
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        m.status,
        v.embedding,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM entities e
      JOIN metadata m ON
        e.source_project = m.source_project AND
        e.id = m.entity_id AND
        e.proposal_id = '' AND m.proposal_id = ''
      JOIN vectors v ON
        e.source_project = v.source_project AND
        e.id = v.entity_id AND
        e.proposal_id = v.proposal_id
      WHERE e.proposal_id = ''
        AND m.status NOT IN ('archived', 'deprecated')
    ),
    merged AS (
      -- Feat 优先，主分支兜底
      SELECT * FROM feat_entities
      UNION ALL
      SELECT m.*
      FROM main_entities m
      WHERE NOT EXISTS (
        SELECT 1 FROM feat_entities f
        WHERE f.source_project = m.source_project AND f.id = m.id
      )
    )
    SELECT
      id,
      source_project,
      proposal_id,
      type,
      data,
      distance
    FROM merged
    ORDER BY distance ASC
    LIMIT ?
  `).all(
    embedding,
    currentProposalId,
    embedding,
    limit
  );
}
```

**方案 3：主分支搜索（仅搜索主分支版本）**：

```typescript
// ✅ 正确：仅搜索主分支版本（用于主分支环境）
// 注意：proposal_id = '' 表示主分支
async function semanticSearch_MainBranchOnly(
  query: string,
  limit: number = 10
) {
  const db = DatabaseConnection.getInstance();
  const embedding = await generateEmbedding(query);

  return db.prepare(`
    SELECT
      e.id,
      e.source_project,
      e.proposal_id,
      e.type,
      e.data,
      vec_distance_cosine(v.embedding, ?) as distance
    FROM entities e
    JOIN vectors v ON
      e.source_project = v.source_project AND
      e.id = v.entity_id AND
      e.proposal_id = v.proposal_id  -- 直接比较，无需处理 NULL
    WHERE e.proposal_id = ''  -- 仅搜索主分支（空字符串）
    ORDER BY distance ASC
    LIMIT ?
  `).all(embedding, limit);
}
```

**设计要点**：

1. **复合主键匹配**：JOIN 条件必须同时匹配 `(source_project, entity_id, proposal_id)` 三元组
2. **版本过滤**：WHERE 条件必须限制 `proposal_id` 的范围（当前 Feat + 主分支，或仅主分支）
3. **Merge View**：使用 Window Function 或 UNION 实现"Feat 优先，主分支兜底"的版本选择
4. **去重**：确保每个实体只返回一个版本（优先级最高的版本）

**性能优化**：

```sql
-- 向量表的辅助索引（支持 Feat 版本隔离）
-- 注意：此索引已在 sqlite-schema.md §2.3.1 定义，此处仅作参考
-- CREATE INDEX idx_vectors_lookup ON vectors(source_project, entity_id, proposal_id);

-- 实体表的复合索引（已在 sqlite-schema.md §2.1 定义）
-- CREATE INDEX idx_entities_composite ON entities(source_project, id, proposal_id);
```

> **索引定义**：所有索引的权威定义请参考 [sqlite-schema.md §2](./sqlite-schema.md#21-核心表)

**测试用例**：

```typescript
// 测试场景：auth-service 在主分支和 Feat 中都存在
// 主分支版本：proposal_id = ''（空字符串，数据库存储值），description = "旧版认证服务"
// Feat 版本：proposal_id = "feat-a001", description = "新版认证服务（支持 OAuth）"

// 在 Feat 中搜索
const results = await semanticSearch("认证", "feat-a001", 10);
// 预期：返回 Feat 版本（description = "新版认证服务（支持 OAuth）"）

// 在主分支搜索（应用层传 null，内部转换为 ''）
const results = await semanticSearch("认证", null, 10);
// 预期：返回主分支版本（description = "旧版认证服务"）
```

### 3.3 进程并发模型

**设计原则**：Local 模式需要处理**多进程并发**场景，依赖 SQLite 的 WAL 模式和文件锁机制保证数据一致性。

#### 3.3.1 架构模式

| 组件 | 运行方式 | 数据库访问 |
|------|---------|-----------|
| **MCP Server (IDE)** | 长驻进程（stdio 模式，由 IDE 启动） | 直接访问 SQLite 文件 |
| **CLI 命令** | 独立进程（每次执行启动新进程） | 直接访问 SQLite 文件 |
| **Agent** | 通过 MCP Server 调用 | 通过 MCP 工具间接访问 |

**关键设计**：
- ⚠️ **多进程场景**：CLI 命令和 IDE 的 MCP Server 是独立进程，会同时访问同一个 SQLite 文件
- ✅ **WAL 模式**：启用 WAL 模式支持多进程并发读写
- ✅ **busy_timeout**：设置合理的超时时间（30 秒）处理写锁等待
- ✅ **文件锁**：依赖 SQLite 的文件锁机制保证写操作互斥
- ⚠️ **WriteQueue 局限**：内存级别的 WriteQueue 仅在单进程内有效，跨进程并发依赖 SQLite 自身机制

#### 3.3.2 并发场景处理

**场景 1：CLI 命令与 IDE Agent 同时操作**

```
用户在 IDE 中使用 Agent → MCP Server 进程 A (stdio)
                              ↓
                         SQLite 文件（WAL 模式）
                              ↑
用户在终端执行 CLI 命令 → CLI 进程 B（独立进程）
```

**处理方式**：
- CLI 和 MCP Server 是**独立进程**，各自持有数据库连接
- SQLite WAL 模式支持多个读者和一个写者并发
- 写操作通过 SQLite 文件锁串行化
- 如果写锁被占用，等待 `busy_timeout`（30 秒）后返回错误

**场景 2：多个 CLI 命令并发执行**

```bash
# 终端 1
c4a sync &

# 终端 2
c4a store save --type container --data '...'
```

**处理方式**：
- 每个 CLI 命令是独立进程
- 写操作通过 SQLite 文件锁串行化
- 读操作可以并发执行（WAL 模式支持）
- 内存 WriteQueue 仅在单进程内有效，跨进程依赖 SQLite 锁

**场景 3：MCP Server 重启**

```
MCP Server 崩溃或重启
         ↓
CLI/Agent 自动重连
         ↓
重新建立 stdio 连接
         ↓
恢复数据库连接（单例）
```

**处理方式**：
- MCP Server 重启后，数据库连接自动重建
- WAL 文件保证数据一致性（崩溃恢复）
- 客户端自动重试失败的请求

#### 3.3.3 写操作串行化

**实现方式**：

```typescript
// 写队列管理器（带背压机制）
class WriteQueue {
  private queue: Array<{
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    enqueuedAt: number;
  }> = [];
  private processing = false;

  // 背压配置
  private readonly maxQueueSize = 100;      // 队列最大长度
  private readonly operationTimeout = 30000; // 单个操作超时（30秒）
  private readonly queueTimeout = 60000;     // 队列等待超时（60秒）

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    // 背压检查：队列已满时拒绝新请求
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `C4A-SYS-002: 写队列已满（${this.queue.length}/${this.maxQueueSize}），请稍后重试`
      );
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        operation,
        resolve,
        reject,
        enqueuedAt: Date.now()
      });

      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // 检查队列等待超时
      const waitTime = Date.now() - item.enqueuedAt;
      if (waitTime > this.queueTimeout) {
        item.reject(new Error(
          `C4A-SYS-003: 队列等待超时（${waitTime}ms > ${this.queueTimeout}ms）`
        ));
        continue;
      }

      // 执行操作（带超时）
      try {
        const result = await Promise.race([
          item.operation(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`C4A-SYS-004: 操作执行超时（${this.operationTimeout}ms）`)),
              this.operationTimeout
            )
          )
        ]);
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
    this.processing = false;
  }

  // 获取队列状态（用于监控）
  getStatus(): { queueLength: number; maxSize: number; isProcessing: boolean } {
    return {
      queueLength: this.queue.length,
      maxSize: this.maxQueueSize,
      isProcessing: this.processing
    };
  }
}
```

**背压机制说明**：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `maxQueueSize` | 100 | 队列最大长度，超过时拒绝新请求 |
| `operationTimeout` | 30s | 单个写操作的执行超时 |
| `queueTimeout` | 60s | 请求在队列中的最大等待时间 |

**错误码**：

| 错误码 | 触发条件 | 客户端处理 |
|--------|---------|-----------|
| `C4A-SYS-002` | 队列已满 | 等待 1-5 秒后重试 |
| `C4A-SYS-003` | 队列等待超时 | 检查服务状态，重试 |
| `C4A-SYS-004` | 操作执行超时 | 检查数据库状态，重试 |

```typescript
// 在 MCP Server 中使用
const writeQueue = new WriteQueue();

async function c4a_store_save(params: SaveParams) {
  // 写操作通过队列串行化
  return writeQueue.enqueue(async () => {
    const db = DatabaseConnection.getInstance();
    return db.transaction(() => {
      // 执行保存操作
      db.prepare('INSERT INTO entities ...').run(...);
      db.prepare('INSERT INTO metadata ...').run(...);
    })();
  });
}

async function c4a_store_read(params: ReadParams) {
  // 读操作直接执行（WAL 模式支持并发读）
  const db = DatabaseConnection.getInstance();
  return db.prepare('SELECT * FROM entities ...').all(...);
}
```

**设计要点**：
- **写操作**：通过队列串行化，避免 `SQLITE_BUSY`
- **读操作**：直接执行，WAL 模式支持并发读
- **事务保护**：所有写操作都在事务中执行
- **超时处理**：队列等待超过 30 秒返回错误

#### 3.3.4 错误处理

| 错误类型 | 原因 | 处理方式 |
|---------|------|---------|
| `SQLITE_BUSY` | 写锁竞争（理论上不应出现） | 自动重试 3 次，间隔 100ms |
| `SQLITE_LOCKED` | 数据库被其他进程锁定 | 返回错误，提示关闭其他进程 |
| `SQLITE_CORRUPT` | 数据库文件损坏 | 尝试从备份恢复 |
| 连接超时 | MCP Server 无响应 | 自动重启 MCP Server |

**禁止的操作**：

```bash
# ❌ 错误：CLI 直接操作数据库文件
sqlite3 ~/.c4a/store.db "SELECT * FROM entities"

# ✅ 正确：通过 MCP 工具查询
c4a store read --id auth-service
```

> **重要**：直接操作 SQLite 文件可能导致与 MCP Server 的文件锁竞争。建议通过 CLI 命令（内部调用 MCP 工具）进行操作，或确保 MCP Server 未运行时再直接访问。

### 3.4 向量索引维护

**数据库连接管理**：

使用单例模式管理 SQLite 连接，避免频繁打开/关闭导致的性能问题和锁竞争：

```typescript
// 数据库连接单例
class DatabaseConnection {
  private static instance: Database.Database | null = null;
  private static readonly DB_PATH = '~/.c4a/store.db';

  static getInstance(): Database.Database {
    if (!this.instance) {
      this.instance = new Database(this.DB_PATH);

      // 启用 WAL 模式（提升并发性能）
      this.instance.pragma('journal_mode = WAL');

      // 优化性能配置
      this.instance.pragma('synchronous = NORMAL');
      this.instance.pragma('cache_size = -64000');  // 64MB 缓存
      this.instance.pragma('temp_store = MEMORY');

      // 注册清理钩子
      process.on('exit', () => this.close());
      process.on('SIGINT', () => this.close());
      process.on('SIGTERM', () => this.close());
    }

    return this.instance;
  }

  static close(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }
}
```

**向量索引维护实现**：

```typescript
// 插入实体时同步创建向量
// 注意：better-sqlite3 的 transaction 回调是同步的，不能在回调里使用 await。
async function saveEntity(entity: Entity) {
  // 使用单例连接
  const db = DatabaseConnection.getInstance();

  // 1) 先在事务外生成向量（可能较慢/需要网络下载模型）
  const text = generateSearchText(entity);
  const embedding = await generateEmbedding(text);
  const dbSourceProject = entity.source_project ?? '';
  const dbProposalId = entity.proposal_id ?? '';  // 主分支为 ''（空字符串）

  // 2) 再用同步事务写入两张表，保证一致性
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      dbSourceProject,  // 实体归属项目（'' 表示全局实体）
      dbProposalId,  // 主分支为 ''（空字符串），feat 内为 feat ID
      entity.type,
      entity.kind,
      entity.scope,
      entity.perspective,
      JSON.stringify(entity.data)
    );

    db.prepare(`
      INSERT INTO vectors (vector_key, entity_id, source_project, proposal_id, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      makeVectorKey(entity.source_project, entity.id, entity.proposal_id),
      entity.id,
      dbSourceProject,
      dbProposalId,
      embedding
    );
  });

  transaction();
}

// 生成 vector_key（处理 NULL 值）
function makeVectorKey(sourceProject: string | null, entityId: string, proposalId: string | null): string {
  return `${sourceProject ?? ''}:${entityId}:${proposalId ?? ''}`;
}

// 生成搜索文本（用于向量化）
function generateSearchText(entity: Entity): string {
  const parts = [
    entity.data.name,
    entity.data.description,
    entity.data.tags?.join(' ')
  ].filter(Boolean);

  return parts.join(' ');
}
```

**连接管理最佳实践**：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **单例模式** | 全局共享一个连接 | 单进程应用（推荐） |
| **连接池** | 维护多个连接 | 高并发场景（可选） |
| **WAL 模式** | Write-Ahead Logging | 提升并发读写性能 |
| **优雅关闭** | 进程退出时关闭连接 | 避免数据损坏 |

### 3.4 性能优化

| 优化项 | 配置 | 说明 |
|--------|------|------|
| 向量维度 | 384 | 平衡精度和性能 |
| 批量插入 | 每 100 条提交一次事务 | 减少磁盘 I/O |
| 缓存策略 | LRU 缓存最近 1000 个查询 | 加速重复查询 |
| 索引策略 | 依赖 sqlite-vec 支持（如 IVF/HNSW，或无显式索引） | 以实现与可维护性为准 |

---
