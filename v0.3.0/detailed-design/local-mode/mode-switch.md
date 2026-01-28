## 5. 模式切换机制

### 5.1 配置方式

通过 `.context/.c4a.yaml` 配置（详见 [cli-design.md 2.5 节](./cli-design.md#25-项目配置)）：

```yaml
# Local 模式（默认）
mode: local

# Server 模式
mode: server
server:
  url: http://localhost:8050
```

### 5.2 切换流程

#### 5.2.1 Local → Server

```bash
# 1. 备份 Local 数据
c4a local backup --output ./backup.tar.gz

# 2. 修改配置
# 编辑 .context/.c4a.yaml，设置 mode: server

# 3. 恢复到 Server（支持冲突处理）
c4a server restore ./backup.tar.gz --conflict-policy=merge
```

**冲突处理策略**：

当 Server 已有数据时，`restore` 命令支持以下冲突策略（通过 `--conflict-policy` 参数指定）：

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| `skip` | 跳过冲突实体，保留 Server 现有数据 | 默认，安全模式 |
| `override` | 用备份数据覆盖 Server 数据 | 强制恢复 |
| `merge` | 智能合并（保留较新的版本，比较 `updated_at`） | 数据迁移（推荐） |
| `error` | 遇到冲突立即报错并回滚 | 严格模式 |

**示例：使用 merge 策略**

```bash
$ c4a server restore ./backup.tar.gz --conflict-policy=merge

  恢复服务器数据 (压缩包 → MongoDB/Neo4j/Milvus)

⚠️  检测到 Server 已有数据

正在恢复...(使用 merge 策略)
  ✅ 解压数据...
  ✅ 导入 MongoDB: 50 个实体
     - 新增: 30 个
     - 更新: 15 个 (备份数据较新)
     - 跳过: 5 个 (Server 数据较新)
  ✅ 重建 Neo4j 关系: 120 个关系
  ✅ 重建 Milvus 向量: 50 个向量 (预计 5-10 秒)

✅ 恢复完成
  - 实体: 50 个 (新增 30, 更新 15, 跳过 5)
  - 关系: 120 个
  - 向量: 50 个
```

**向量索引重建**：

| 数据规模 | 重建时间 | 说明 |
|---------|---------|------|
| 1,000 实体 | 1-2 秒 | 使用 Milvus 批量插入 |
| 10,000 实体 | 10-20 秒 | 分批处理，每批 1000 条 |
| 100,000 实体 | 2-5 分钟 | 建议使用后台任务 |

**重建期间查询可用性**：

| 操作类型 | 可用性 | 说明 |
|---------|--------|------|
| 写操作 | ✅ 正常 | 不受影响 |
| 读操作 | ✅ 正常 | 查询已有数据 |
| 语义搜索 | ⚠️ 降级 | 降级到全文搜索（若 FTS5 不可用则降级到 LIKE），重建完成后自动恢复 |
| 图查询 | ✅ 正常 | Neo4j 关系已同步 |

#### 5.2.2 Server → Local

```bash
# 1. 从 Server 备份
c4a server backup --output ./backup.tar.gz

# 2. 修改配置
# 编辑 .context/.c4a.yaml，设置 mode: local

# 3. 恢复到 Local（支持冲突处理）
c4a local restore ./backup.tar.gz --conflict-policy=merge
```

**冲突处理策略**：

与 Local → Server 相同，支持 `skip`、`override`、`merge`、`error` 四种策略。

**向量索引重建**：

Local 模式使用 sqlite-vec 扩展。重建分为两个阶段：

**阶段 1：SQLite 批量插入**（仅数据写入，不含 Embedding 生成）

| 数据规模 | 重建时间 | 说明 |
|---------|---------|------|
| 1,000 实体 | 2-3 秒 | 使用事务批量插入 |
| 10,000 实体 | 20-30 秒 | SQLite 单线程写入 |
| 100,000 实体 | 5-10 分钟 | 建议分批导入 |

**阶段 2：向量重建**（含 Embedding 生成，见 §5.4）

| 数据规模 | 重建时间 | 说明 |
|---------|---------|------|
| 1K 实体 | ~30 秒 | 小型项目 |
| 10K 实体 | ~5 分钟 | 中型项目 |
| 50K 实体 | ~25 分钟 | 大型项目（建议使用 Server 模式） |

> **注意**：阶段 2 的时间主要消耗在 Embedding 模型推理上，与阶段 1 的纯数据库写入时间差异显著。

**重建期间查询可用性**：

| 操作类型 | 可用性 | 说明 |
|---------|--------|------|
| 写操作 | ⚠️ 阻塞 | SQLite 写锁，等待重建完成（超时 30 秒后返回错误） |
| 读操作 | ✅ 正常 | 可查询已导入数据 |
| 语义搜索 | ⚠️ 降级 | 降级到全文搜索（若 FTS5 不可用则降级到 LIKE，如 sqlite-vec 可用则逐步恢复） |
| 图查询 | ✅ 正常 | 内存图已加载 |

**写操作阻塞处理**：

| 数据规模 | 重建时间 | 写操作超时 | 处理策略 |
|---------|---------|-----------|---------|
| < 10,000 实体 | < 30 秒 | 不超时 | 同步重建，用户等待 |
| 10,000 - 50,000 实体 | 30 秒 - 3 分钟 | 可能超时 | 建议使用后台任务 |
| > 50,000 实体 | > 3 分钟 | 必定超时 | **强制使用后台任务** |

**后台重建机制**（推荐用于大数据量）：

```bash
# 1. 启用后台重建（写操作不阻塞）
c4a local restore ./backup.tar.gz --background

# 2. 重建期间的行为
# - 写操作：✅ 正常（写入临时表）
# - 读操作：✅ 正常（查询已导入数据）
# - 语义搜索：⚠️ 降级（降级到全文搜索，若 FTS5 不可用则降级到 LIKE）

# 3. 查看重建进度
c4a local restore --status
# 输出：
# 向量索引重建中: 45,000 / 100,000 (45%)
# 预计剩余时间: 3 分钟

# 4. 重建完成后自动切换
# - 原子性切换：临时表 → 主表
# - 语义搜索自动恢复
# - 无需重启服务

# 5. 验证数据完整性
c4a local status
```

**后台重建的实现原理**：

```typescript
// 1. 创建临时向量虚拟表
// 注意：sqlite-vec 虚拟表不支持复合主键，使用组合字符串作为主键
CREATE VIRTUAL TABLE vectors_temp USING vec0(
    vector_key TEXT PRIMARY KEY,   -- 组合键："{source_project}:{entity_id}:{proposal_id}"
    entity_id TEXT,
    source_project TEXT,
    proposal_id TEXT,
    embedding FLOAT[384]
);

// 2. 后台线程重建向量索引
async function rebuildVectorsInBackground() {
  const entities = await db.query('SELECT * FROM entities');

  for (const batch of chunk(entities, 1000)) {
    // 批量生成 embedding
    const embeddings = await generateEmbeddings(batch);

    // 写入临时表（不阻塞主表）
    await db.query('INSERT INTO vectors_temp VALUES ...', embeddings);

    // 更新进度
    updateProgress(batch.length);
  }

  // 3. 原子性切换（使用事务）
  await db.transaction(async (tx) => {
    await tx.query('DROP TABLE vectors');
    await tx.query('ALTER TABLE vectors_temp RENAME TO vectors');
  });

  console.log('向量索引重建完成，语义搜索已恢复');
}

// 4. 写操作路由策略（双写模式）
class VectorWriteRouter {
  private isRebuilding: boolean = false;
  private tempTableReady: boolean = false;

  // 开始重建时启用双写
  startRebuild() {
    this.isRebuilding = true;
    this.tempTableReady = true;
  }

  // 重建完成后关闭双写
  finishRebuild() {
    this.isRebuilding = false;
    this.tempTableReady = false;
  }

  // 写入向量（双写模式）
  async writeVector(entity: Entity, embedding: Float32Array) {
    // 始终写入主表
    await db.query('INSERT OR REPLACE INTO vectors VALUES ...', entity, embedding);

    // 重建期间同时写入临时表
    if (this.isRebuilding && this.tempTableReady) {
      await db.query('INSERT OR REPLACE INTO vectors_temp VALUES ...', entity, embedding);
    }
  }
}

// 5. 切换点一致性保证
async function atomicSwitch() {
  await db.transaction(async (tx) => {
    // 1. 暂停写入（短暂阻塞，< 100ms）
    writeRouter.pause();

    // 2. 将暂停期间的写入同步到临时表
    await syncPendingWrites(tx);

    // 3. 原子切换表名
    await tx.query('DROP TABLE vectors');
    await tx.query('ALTER TABLE vectors_temp RENAME TO vectors');

    // 4. 恢复写入
    writeRouter.resume();
    writeRouter.finishRebuild();
  });
}

// 6. 失败回滚策略
async function rebuildWithRollback() {
  try {
    await rebuildVectorsInBackground();
    await atomicSwitch();
  } catch (error) {
    // 回滚：删除临时表，保留原表
    await db.query('DROP TABLE IF EXISTS vectors_temp');
    writeRouter.finishRebuild();
    throw new Error(`向量重建失败: ${error.message}，已回滚到原状态`);
  }
}
```

**性能优化建议**：

```bash
# 小数据量（< 10,000 实体）：同步重建
c4a local restore ./backup.tar.gz

# 中等数据量（10,000 - 50,000 实体）：后台重建（推荐）
c4a local restore ./backup.tar.gz --background

# 大数据量（> 50,000 实体）：后台重建 + 分批导入
c4a local restore ./backup.tar.gz --background --batch-size=5000

# 查看恢复进度
c4a local restore --status

# 恢复完成后验证数据完整性
c4a local status
```

### 5.3 数据兼容性

| 特性 | 说明 |
|------|------|
| 数据模型 | 两种模式使用相同的数据模型 |
| 导出格式 | 统一使用 JSON 格式 |
| 关系保留 | 所有关系完整保留 |
| 向量重建 | 切换后自动重建向量索引 |
| 数据丢失 | 无数据丢失 |

### 5.4 导出/导入格式

```json
{
  "version": "0.3.0",
  "exported_at": "2026-01-22T10:00:00Z",
  "entities": [
    {
      "id": "e-commerce-system",
      "type": "system",
      "kind": "implementation",
      "scope": "project",
      "perspective": "technical",
      "data": {
        "name": "电商系统",
        "description": "在线购物平台"
      },
      "metadata": {
        "source_project": "my-project",
        "source_repo": "company/my-repo",
        "status": "published",
        "created_at": "2026-01-20T10:00:00Z",
        "updated_at": "2026-01-20T10:00:00Z"
      }
    }
  ],
  "relations": [
    {
      "id": "rel-001",
      "proposal_id": null,
      "from_project": "my-project",
      "from_id": "e-commerce-system",
      "to_project": "my-project",
      "to_id": "e-commerce-product",
      "rel_type": "CORRESPONDS",
      "status": "active",
      "properties": null
    }
  ]
}
```

**格式说明**：

| 字段 | 是否导出 | 说明 |
|------|---------|------|
| `entities` | ✅ 导出 | 实体数据，包含完整的 data 和 metadata |
| `relations` | ✅ 导出 | 关系数据，包含完整字段用于重建图结构 |
| `feats` | ✅ 导出 | Feat 数据，包含 checklist 等元数据 |
| `vectors` | ❌ 不导出 | 向量数据不导出，导入时从实体内容自动重建 |

**Checklist 数据处理**：

> **重要**：Checklist 数据存储在 `feats` 表/集合中，**包含在 backup/restore 中**，但**不参与 `c4a sync`**。

| 操作 | Checklist 行为 | 说明 |
|------|---------------|------|
| `c4a sync` | ❌ 不同步 | Checklist 不是 DSL 文件，无法通过文件同步 |
| `c4a local backup` | ✅ 导出 | 包含在备份中 |
| `c4a server restore` | ✅ 导入 | 从备份恢复 |
| 模式切换 | ✅ 迁移 | 通过 backup/restore 完整迁移 |

**协作场景注意事项**：
- 如果团队成员在 Local 模式下创建了 Checklist，需要通过 `backup/restore` 迁移到 Server
- 单纯使用 `c4a sync` 无法同步 Checklist 数据
- 建议团队协作场景直接使用 Server 模式，避免 Checklist 数据孤岛

**关系字段说明**：

| 字段 | 必需 | 说明 |
|------|:----:|------|
| `id` | ✅ | 关系唯一标识 |
| `proposal_id` | ✅ | feat ID，主分支为 `null` |
| `from_project` | ✅ | 源实体所属项目（全局实体为 `null`） |
| `from_id` | ✅ | 源实体 ID |
| `to_project` | ✅ | 目标实体所属项目（全局实体为 `null`） |
| `to_id` | ✅ | 目标实体 ID |
| `rel_type` | ✅ | 关系类型 |
| `status` | ✅ | 关系状态：`active` / `deleted`（注：与实体的 metadata.status 不同，关系只有这两种状态） |
| `properties` | ❌ | 关系属性（可选） |

**为什么不导出向量**：

1. **体积问题**：向量数据体积大（每个实体约 1.5KB），10K 实体的向量约 15MB，而实体+关系数据仅约 2MB
2. **可重建性**：向量由 embedding 模型从实体内容生成，可以完全重建
3. **模型一致性**：不同环境可能使用不同的 embedding 模型，导入旧向量可能导致搜索质量下降

**向量重建性能预期**：

| 数据规模 | 重建时间 | 说明 |
|---------|---------|------|
| 1K 实体 | ~30 秒 | 小型项目 |
| 10K 实体 | ~5 分钟 | 中型项目 |
| 50K 实体 | ~25 分钟 | 大型项目（建议使用 Server 模式） |

**向量重建默认行为**：

| 数据规模 | 默认行为 | CLI 参数 |
|---------|---------|---------|
| < 10,000 实体 | **同步阻塞** | 无需参数，等待完成 |
| ≥ 10,000 实体 | **提示使用后台** | CLI 自动提示添加 `--background` |

> **注意**：默认情况下向量重建是**同步阻塞**的，会等待完成后再返回。对于大数据量（≥10K 实体），CLI 会提示使用 `--background` 参数启用后台异步重建，此时导入完成后可立即使用，但语义搜索功能需等待向量重建完成。

---

## 6. 性能基准

### 6.1 测试环境

- CPU: Apple M1 Pro
- RAM: 16GB
- 存储: SSD
- 数据规模: 10,000 实体 + 50,000 关系

### 6.2 性能指标

| 操作 | Local 模式 | Server 模式 | 说明 |
|------|----------|------------|------|
| 插入实体 | ~5ms | ~10ms | Local 单库事务更快 |
| 查询实体 | ~1ms | ~3ms | SQLite 本地查询 |
| 语义搜索 | ~50ms | ~20ms | Milvus 向量搜索更快 |
| 图遍历（深度 3） | ~10ms | ~5ms | Neo4j 图查询更快 |
| 启动时间 | ~100ms | ~2s | Local 无需连接外部服务 |

### 6.3 适用规模

| 规模 | 实体数 | 关系数 | 推荐模式 |
|------|--------|--------|---------|
| 小型 | < 1K | < 5K | Local |
| 中型 | 1K - 10K | 5K - 50K | Local 或 Server |
| 大型 | > 10K | > 50K | Server |

---

## 7. 实现建议

### 7.1 依赖库

```json
{
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "@xenova/transformers": "^2.10.0"
  },
  "optionalDependencies": {
    "sqlite-vec": "^0.1.0"
  }
}
```

**运行时兼容性说明**：

| 运行时 | better-sqlite3 | sqlite-vec | 说明 |
|--------|:-------------:|:----------:|------|
| **Bun** | ⚠️ 需验证 | ⚠️ 需验证 | 原生扩展兼容性存在不确定性 |
| **Node.js** | ✅ 完全支持 | ✅ 完全支持 | 推荐的回退方案 |

> **注意**：Local 模式默认使用 Bun 运行时。若 Bun 与原生扩展（better-sqlite3、sqlite-vec）存在兼容性问题，可回退到 Node.js 运行时。代码使用标准 Node.js API，无需修改即可在两种运行时间切换。

### 7.2 初始化流程

```typescript
import Database from 'better-sqlite3';
import { pipeline } from '@xenova/transformers';

class LiteStore {
  private graph: InMemoryGraph;
  private embedder: any;

  async init(dbPath: string) {
    // 1. 初始化数据库连接（使用单例）
    // 注意：DatabaseConnection 单例会自动处理连接管理
    const db = DatabaseConnection.getInstance();

    // 2. 加载 sqlite-vec 扩展
    try {
      db.loadExtension('vec0');
    } catch (err) {
      console.warn('sqlite-vec 扩展未安装，向量搜索不可用');
    }

    // 3. 创建表结构
    this.createTables();

    // 4. 加载内存图
    this.graph = new InMemoryGraph();
    this.graph.load(db);

    // 5. 初始化 Embedding 模型
    this.embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }

  private createTables() {
    const db = DatabaseConnection.getInstance();
    // 创建核心表（见 2.1 节）
    // 创建向量表（见 2.2.1 节）
    // 创建缓存表（见 2.2.2 节）
  }
}
```

### 7.3 错误处理

```typescript
class LiteStore {
  async saveEntity(entity: Entity) {
    // 1. 先生成向量（异步操作，在事务外）
    const embedding = await this.generateEmbedding(entity);

    // 2. 同步事务写入数据库
    const transaction = this.db.transaction(() => {
      try {
        // 插入实体
        this.insertEntity(entity);

        // 插入向量
        this.insertVector(entity.id, embedding);

        // 更新内存图
        this.graph.addNode(entity.id);
      } catch (err) {
        // 事务自动回滚
        throw new Error(`保存实体失败: ${err.message}`);
      }
    });

    // 3. 执行事务
    transaction();
  }
}
```

---

## 8. 限制和注意事项

### 8.1 已知限制

| 限制 | 说明 | 解决方案 |
|------|------|---------|
| 并发写入 | SQLite 不支持高并发写入 | 使用写队列串行化 |
| 向量搜索性能 | 大规模数据下性能下降 | 切换到 Server 模式 |
| 内存占用 | 图数据全部加载到内存 | 定期清理缓存 |
| 跨平台扩展 | sqlite-vec 需要编译 | 提供预编译二进制 |

### 8.2 最佳实践

1. **定期备份**：使用 `c4a local backup` 定期备份数据
2. **监控规模**：实体数超过 10K 时考虑切换到 Server 模式
3. **缓存清理**：定期清理过期的图查询缓存
4. **索引维护**：定期执行 `VACUUM` 和 `ANALYZE` 优化数据库

---

## 9. 未来优化方向

### 9.1 短期（v0.3.x）

- [ ] 支持增量向量索引更新
- [ ] 优化图查询缓存策略
- [ ] 添加数据库压缩功能

### 9.2 长期（v0.4.0+）

- [ ] 支持分布式 SQLite（如 rqlite）
- [ ] 实现混合模式（本地 + 远程）
- [ ] 支持更多向量模型（如 BGE-M3）

---
