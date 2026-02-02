# Local 模式实现细节

> **相关文档**：
> - 架构设计：[../architecture.md](../architecture.md)
> - Skills 设计：[skills-design.md](../skills-design.md)

---

## 1. 概述

Local 模式使用 SQLite 单文件数据库替代 Server 模式的三库架构（MongoDB + Neo4j + Milvus），适用于个人开发者和小团队。

### 1.1 模式对比

| 特性 | Local 模式 | Server 模式 |
|------|----------|------------|
| 数据库 | SQLite 单文件 | MongoDB + Neo4j + Milvus |
| 图存储 | SQLite relations 表 + 内存图 | Neo4j 原生图数据库 |
| 向量存储 | USearch (WASM) 独立索引 | Milvus |
| 事务性 | 单库事务，ACID 保证 | 跨库事务需协调 |
| 部署复杂度 | 低（单文件） | 高（三个服务） |
| 性能 | 适合小规模（< 10K 实体） | 适合大规模（> 10K 实体） |
| 适用场景 | 个人开发、小团队 | 企业级、多团队协作 |

### 1.2 并发访问配置

Local 模式需要处理**多进程并发**场景：IDE 启动的 MCP Server 和用户在终端执行的 CLI 命令是独立进程，可能同时访问同一个 SQLite 文件。为保证数据一致性，依赖 SQLite 的 WAL 模式和文件锁机制。

为提升并发性能并避免 `SQLITE_BUSY` 错误，必须在初始化时配置以下 PRAGMA：

```sql
-- 启用 WAL 模式（Write-Ahead Logging）
-- 允许读写并发，显著提升并发性能
PRAGMA journal_mode=WAL;

-- 设置忙等待超时（毫秒）
-- 当数据库被锁定时，等待最多 5 秒而非立即失败
PRAGMA busy_timeout=5000;

-- 可选：同步模式设置为 NORMAL（平衡性能和安全性）
PRAGMA synchronous=NORMAL;
```

**配置说明**：

| PRAGMA | 值 | 说明 |
|--------|---|------|
| `journal_mode` | `WAL` | 启用 Write-Ahead Logging，允许读写并发 |
| `busy_timeout` | `5000` | 锁等待超时 5 秒，避免立即失败 |
| `synchronous` | `NORMAL` | 平衡性能和数据安全（可选） |

**实现位置**：这些 PRAGMA 应在 `c4a install local` 初始化数据库时执行，并在每次打开数据库连接时重新设置（WAL 模式是持久的，但 busy_timeout 需要每次设置）。

---

## 2. SQLite 表结构

Local 模式使用 SQLite 单文件数据库，表结构设计与 Server 模式保持一致（概念层面），但实现方式不同：

| 差异点 | Server 模式 | Local 模式 |
|--------|------------|----------|
| 数据库 | MongoDB + Neo4j + Milvus | SQLite 单文件 |
| 图存储 | Neo4j 原生图数据库 | SQLite relations 表 + 内存图 |
| 向量存储 | Milvus | USearch (WASM) 独立索引 |
| 事务性 | 跨库事务需协调 | 单库事务，ACID 保证 |
| **用户表** | ✅ 有 | ❌ 无 |
| **权限表** | ✅ 有 | ❌ 无 |
| **权限检查** | ✅ 严格检查 | ❌ 跳过（隐式 Admin） |

**Local 模式的权限处理**：
- Local 模式是单用户环境（个人开发者）
- 用户隐式拥有所有本地项目的 Admin 权限
- 不需要用户表、权限表、登录鉴权
- 所有权限检查自动通过

> **详细说明**：权限检查的模式差异请参考 [cross-project-auth.md#1.1](../permissions/cross-project-auth.md#11-权限检查的模式差异)

### 2.1 核心表

以下表结构是 Local 模式的权威定义：

```sql
-- 项目配置（存储当前数据库管理的项目信息）
-- 用途：
--   1. 单项目环境：存储当前项目的配置，用于自动填充 source_project
--   2. 多项目环境：存储所有管理的项目，支持跨项目查询
-- 与 .context/.c4a.yaml 的关系：
--   - .c4a.yaml 是文件系统配置（用户编辑）
--   - configs 表是数据库配置（CLI 同步维护）
--   - CLI 启动时会将 .c4a.yaml 同步到 configs 表
CREATE TABLE configs (
    id TEXT PRIMARY KEY,           -- 项目 ID (project_id)
    repo_id TEXT,                  -- 关联的代码仓库 ID
    created_at TEXT,
    updated_at TEXT
);

-- 实体数据（复合主键：支持多项目 + Feat 的 Copy-on-Write）
-- 实体唯一性基于 (source_project, id, proposal_id) 三元组
-- 注意：source_project 和 proposal_id 使用空字符串 '' 代替 NULL（SQLite 主键不支持 NULL）
--       应用层约定：存储时 null → ''，读取时 '' → null
CREATE TABLE entities (
    id TEXT NOT NULL,              -- 实体 ID（在项目内唯一，Domain/Enterprise 层全局唯一）
    source_project TEXT NOT NULL DEFAULT '',  -- 实体归属项目（'' 表示 Domain/Enterprise 层全局实体）
    proposal_id TEXT NOT NULL DEFAULT '',     -- '' 表示主分支，feat-xxx 表示 feat 版本
    type TEXT NOT NULL,
    kind TEXT,
    scope TEXT,
    perspective TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (source_project, id, proposal_id)  -- 复合主键
);

CREATE INDEX idx_entities_proposal_id ON entities(proposal_id);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_source_project ON entities(source_project);
CREATE INDEX idx_entities_id ON entities(id);
-- 复合索引：用于 Merge View 查询优化（按三元组快速定位）
CREATE INDEX idx_entities_composite ON entities(source_project, id, proposal_id);

-- 实体元数据（复合主键，与 entities 表对应）
CREATE TABLE metadata (
    entity_id TEXT NOT NULL,
    source_project TEXT NOT NULL DEFAULT '',  -- 与 entities 表的 source_project 对应（'' 表示全局实体）
    proposal_id TEXT NOT NULL DEFAULT '',     -- 与 entities 表的 proposal_id 对应
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

CREATE INDEX idx_metadata_content_hash ON metadata(content_hash);

-- 实体关系（关系本身有版本，但指向逻辑实体而非特定版本）
-- 约束：同一对实体同类型只允许一条关系，多语义通过 properties 合并
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL DEFAULT '',     -- 关系归属的 Feat（''=主分支，feat-xxx=Feat 版本）
    from_project TEXT NOT NULL DEFAULT '',    -- 源实体的 source_project（'' 表示全局实体）
    from_id TEXT NOT NULL,         -- 源实体的逻辑 ID（不绑定版本）
    to_project TEXT NOT NULL DEFAULT '',      -- 目标实体的 source_project（'' 表示全局实体）
    to_id TEXT NOT NULL,           -- 目标实体的逻辑 ID（不绑定版本）
    rel_type TEXT NOT NULL,
    status TEXT DEFAULT 'active',  -- 关系状态：active | deleted（用于 Feat 删除遮蔽）
    properties TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 唯一约束
CREATE UNIQUE INDEX idx_relations_unique ON relations(
    proposal_id, from_project, from_id, to_project, to_id, rel_type
);

CREATE INDEX idx_relations_proposal_id ON relations(proposal_id);
CREATE INDEX idx_relations_from ON relations(from_project, from_id);
CREATE INDEX idx_relations_to ON relations(to_project, to_id);
CREATE INDEX idx_relations_type ON relations(rel_type);
```

**空字符串哨兵值约定**：

SQLite 主键不支持 NULL 值，因此使用空字符串 `''` 作为哨兵值：

| 语义 | 应用层值 | 数据库存储值 |
|------|---------|-------------|
| 全局实体（Domain/Enterprise/External） | `null` | `''` |
| 项目实体 | `"project-a"` | `"project-a"` |
| 主分支 | `null` | `''` |
| Feat 版本 | `"feat-xxx"` | `"feat-xxx"` |

**应用层转换**：

```typescript
// 存储时：null → ''
function toDbValue(value: string | null): string {
  return value ?? '';
}

// 读取时：'' → null
function fromDbValue(value: string): string | null {
  return value === '' ? null : value;
}
```

**设计说明**：

- **多项目支持**：`source_project` 字段纳入主键，允许不同项目拥有相同 ID 的实体
  - 例如：Project A 和 Project B 都可以有 `auth-service` 容器
  - 实体唯一性基于 `(source_project, id, proposal_id)` 三元组
- **Copy-on-Write 支持**：`proposal_id` 字段支持 feat 的分支隔离
  - `''`（空字符串）：主分支版本
  - `"feat-xxx"`：feat 版本
- **跨项目引用**：`relations` 表支持跨项目的实体引用
  - `from_project` 和 `to_project` 分别记录源和目标实体的项目
  - 支持 Project A 的实体引用 Project B 的实体

### 2.2 实体变更历史表

用于追溯实体被哪些 Feat 修改过：

```sql
-- 实体变更历史
CREATE TABLE entity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    source_project TEXT NOT NULL DEFAULT '',  -- 实体归属项目（'' 表示全局实体）
    proposal_id TEXT NOT NULL DEFAULT '',     -- 记录是哪个版本的实体（''=主分支，feat-xxx=feat 版本）
    entity_type TEXT NOT NULL,
    feat_id TEXT NOT NULL DEFAULT '',         -- 哪个 feat 做的修改（'' 表示主分支直接修改）
    action TEXT NOT NULL,          -- "create" | "update" | "delete"
    changed_fields TEXT,           -- JSON 数组，记录修改了哪些字段
    snapshot_after TEXT,           -- JSON，修改后的快照
    changed_by TEXT,
    changed_at TEXT DEFAULT (datetime('now'))
    -- 注意：不使用外键约束，因为历史记录指向"抽象实体概念"，而非特定版本
);

CREATE INDEX idx_entity_history_entity_id ON entity_history(entity_id);
CREATE INDEX idx_entity_history_source_project ON entity_history(source_project);
CREATE INDEX idx_entity_history_proposal_id ON entity_history(proposal_id);
CREATE INDEX idx_entity_history_feat_id ON entity_history(feat_id);
CREATE INDEX idx_entity_history_changed_at ON entity_history(changed_at);
```

**设计说明**：

- **不使用外键约束**：历史记录指向"抽象实体概念"，而非特定版本
- **source_project 字段**：记录实体归属的项目，支持多项目历史查询
- **proposal_id 字段**：记录历史条目对应的实体版本
  - `''`：主分支版本的变更（空字符串哨兵值）
  - `"feat-xxx"`：feat 版本的变更
- **feat_id 字段**：记录是哪个 feat 触发的变更
  - 与 `proposal_id` 通常相同，但在合并时可能不同
  - 例如：feat-a001 发布后，实体从 `proposal_id="feat-a001"` 变为 `proposal_id=''`，但 `feat_id` 仍记录为 `"feat-a001"`
- **查询示例**：
  ```sql
  -- 查询某个项目中某个实体的所有历史
  SELECT * FROM entity_history
  WHERE source_project = 'backend-api' AND entity_id = 'auth-service'
  ORDER BY changed_at DESC;

  -- 查询某个 feat 的所有变更
  SELECT * FROM entity_history WHERE feat_id = 'feat-a001' ORDER BY changed_at DESC;

  -- 查询主分支的变更历史（proposal_id = '' 表示主分支）
  SELECT * FROM entity_history WHERE proposal_id = '' ORDER BY changed_at DESC;
  ```

### 2.2.1 Feat 发布历史表

用于支持回滚机制（详见 [conflict-rollback.md#4.3](../data-ops/conflict-rollback.md#43-历史记录存储)）：

```sql
-- Feat 发布历史（用于回滚）
CREATE TABLE feat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feat_id TEXT NOT NULL,             -- Feat ID
    published_at TEXT NOT NULL,        -- 发布时间
    entities_snapshot TEXT NOT NULL,   -- JSON 格式，发布���的实体快照
    published_by TEXT,                 -- 发布人
    UNIQUE (feat_id, published_at)     -- 同一 Feat 的每次发布唯一
);

CREATE INDEX idx_feat_history_feat_id ON feat_history(feat_id);
CREATE INDEX idx_feat_history_published_at ON feat_history(published_at);
```

**设计说明**：

- **用途**：记录每次 Feat 发布时的实体快照，支持回滚到发布前状态
- **entities_snapshot 格式**：
  ```json
  [
    { "id": "auth-service", "source_project": "backend-api", "type": "container", "version": 2, "data": {...} },
    { "id": "user-db", "source_project": "backend-api", "type": "container", "version": 1, "data": {...} }
  ]
  ```
- **存储策略**：仅保留最近 N 个版本（默认 10），超出后自动清理最旧版本
- **与 entity_history 的区别**：
  - `entity_history`：记录单个实体的变更历史（审计追踪）
  - `feat_history`：记录 Feat 发布时的完整快照（回滚支持）

### 2.3 Local 模式特有表

#### 2.3.1 向量索引（USearch）

使用 [USearch](https://github.com/unum-cloud/usearch) (WASM) 实现向量存储，独立于 SQLite：

**存储结构**：
- `c4a.db` - SQLite 数据库（实体、关系、元数据）
- `c4a.usearch` - USearch 向量索引文件
- `c4a.keymap.json` - entity_id ↔ USearch key 映射

```typescript
// USearch 向量存储封装（详见 vector-search.md）
import { Index } from 'usearch';

const index = new Index({
  metric: 'cos',        // 余弦距离
  connectivity: 16,     // HNSW 连接数
  dimensions: 384,      // all-MiniLM-L6-v2 模型维度
});

// 添加向量
index.add(key, embedding);

// KNN 搜索
const { keys, distances } = index.search(queryVector, limit);

// 持久化
index.save('c4a.usearch');
```

**设计说明**：
- 使用 `source_project:entity_id:proposal_id` 作为复合 ID，映射到 USearch 的 bigint key
- 映射关系存储在 `c4a.keymap.json` 文件中
- 主分支实体的 `proposal_id` 为 `''`（空字符串）
- feat 内实体的 `proposal_id` 为 feat ID（如 `"feat-a001-user-login"`）
- 查询时需要在应用层过滤版本（Feat 优先，主分支兜底）

> **详细实现**：向量搜索的完整实现请参考 [vector-search.md](./vector-search.md#32-向量搜索)

#### 2.3.2 全文搜索索引表（USearch 降级方案）

当 USearch 不可用时，使用 FTS5 全文搜索作为降级方案：

```sql
-- 全文搜索索引表（USearch 不可用时的降级方案）
CREATE VIRTUAL TABLE entities_fts USING fts5(
    entity_id UNINDEXED,           -- 实体 ID（不参与搜索，仅用于关联）
    source_project UNINDEXED,      -- 项目 ID（不参与搜索）
    proposal_id UNINDEXED,         -- Feat ID（不参与搜索）
    search_text,                   -- 搜索文本：通用字段 + ADR/Process 关键字段
    tokenize = 'unicode61'         -- Unicode 分词器，支持多语言
);
```

**Tokenizer 选择说明**：

| Tokenizer | 特点 | 适用场景 |
|-----------|------|---------|
| `unicode61` | Unicode 标准分词，按空格/标点分割 | 多语言混合文本（推荐） |
| `porter` | 英文词干提取（running→run） | 纯英文场景 |
| `trigram` | 三字符滑动窗口，支持子串匹配 | 需要模糊匹配时 |

**中文分词策略**：
- FTS5 内置 tokenizer 不支持中文分词（会按字符切分）
- 对于中文场景，建议：
  1. 使用 `trigram` tokenizer 支持子串匹配
  2. 或在应用层预处理（如 jieba 分词后空格连接）
  3. 或使用向量搜索（语义匹配，无需分词）

```sql
-- 触发器：实体插入时自动更新 FTS 索引
-- 注意：search_text 以通用字段为主，并补充 ADR/Process 的关键字段
CREATE TRIGGER entities_fts_insert AFTER INSERT ON entities
BEGIN
    INSERT INTO entities_fts(entity_id, source_project, proposal_id, search_text)
    SELECT
        NEW.id,
        NEW.source_project,
        NEW.proposal_id,
        COALESCE(json_extract(NEW.data, '$.name'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.tags'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.adr.title'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.context'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.decision'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.consequences.positive'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.consequences.negative'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.consequences.neutral'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.alternatives'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.process.name'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.process.description'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.process.tags'), '');
END;

-- 触发器：实体更新时同步更新 FTS 索引
-- 注意：source_project 和 proposal_id 使用空字符串哨兵值，可直接用 = 比较
CREATE TRIGGER entities_fts_update AFTER UPDATE ON entities
BEGIN
    DELETE FROM entities_fts
    WHERE entity_id = OLD.id
      AND source_project = OLD.source_project
      AND proposal_id = OLD.proposal_id;
    INSERT INTO entities_fts(entity_id, source_project, proposal_id, search_text)
    SELECT
        NEW.id,
        NEW.source_project,
        NEW.proposal_id,
        COALESCE(json_extract(NEW.data, '$.name'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.tags'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.adr.title'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.context'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.decision'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.consequences.positive'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.consequences.negative'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.consequences.neutral'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.alternatives'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.process.name'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.process.description'), '') || ' ' ||
        COALESCE(json_extract(NEW.data, '$.process.tags'), '');
END;

-- 触发器：实体删除时同步删除 FTS 索引
CREATE TRIGGER entities_fts_delete AFTER DELETE ON entities
BEGIN
    DELETE FROM entities_fts
    WHERE entity_id = OLD.id
      AND source_project = OLD.source_project
      AND proposal_id = OLD.proposal_id;
END;
```

> **重建策略**：启动时可执行一次 `DELETE FROM entities_fts` + `INSERT ... SELECT`，确保索引字段变更后生效。

**索引字段映射规则**：

| 实体类型 | data 结构 | 提取字段 |
|---------|----------|---------|
| 通用 | `{ name, description, tags, ... }` | `$.name`, `$.description`, `$.tags` |
| ADR | `{ adr, context, decision, consequences, alternatives }` | `$.adr.title`, `$.context`, `$.decision`, `$.consequences.*`, `$.alternatives` |
| Process | `{ process }` | `$.process.name`, `$.process.description`, `$.process.tags` |

> **注意**：通用字段来自顶层；ADR/Process 字段来自对应嵌套结构。

**字段映射说明**：

FTS 索引只提取通用字段（`name`、`description`、`tags`），这是有意为之的简化设计：

| 实体类型 | 原始字段 | converter 映射 | FTS 索引 |
|---------|---------|---------------|---------|
| System/Container/Component | `name`, `description` | 直接保留 | ✅ 索引 |
| ADR | `title`, `context`, `decision` | `title` → `name`, `context` → `description` | ✅ 索引 |
| Process | `name`, `description`, `steps` | 直接保留，`steps` 不映射 | `name`/`description` 索引，`steps` 不索引 |
| Contract | `name`, `description`, `spec` | 直接保留，`spec` 不映射 | `name`/`description` 索引，`spec` 不索引 |

> **设计考量**：复杂字段（如 `steps`、`spec`）结构化程度高，不适合全文搜索。如需搜索这些字段，建议使用向量搜索（语义匹配）。

**FTS5 查询示例**（带 Merge View + BM25 排序 + 状态过滤）：

```sql
-- 全文搜索（支持 Feat 版本隔离 + 状态过滤）
-- 注意：source_project 和 proposal_id 使用空字符串哨兵值，可直接用 = 比较
WITH ranked AS (
  SELECT
    e.id,
    e.source_project,
    e.proposal_id,
    e.type,
    e.data,
    bm25(fts) AS fts_rank,  -- BM25 相关性评分
    ROW_NUMBER() OVER (
      PARTITION BY e.source_project, e.id
      ORDER BY
        CASE
          WHEN e.proposal_id = :current_feat THEN 1
          WHEN e.proposal_id = '' THEN 2  -- 主分支（空字符串）
          ELSE 3
        END
    ) AS rn
  FROM entities e
  JOIN metadata m ON
    e.source_project = m.source_project AND
    e.id = m.entity_id AND
    e.proposal_id = m.proposal_id
  JOIN entities_fts fts ON
    e.id = fts.entity_id AND
    e.source_project = fts.source_project AND
    e.proposal_id = fts.proposal_id
  WHERE
    (e.proposal_id = :current_feat OR e.proposal_id = '')
    AND m.status NOT IN ('archived', 'deprecated')  -- 过滤已归档/已废弃实体
    AND fts MATCH :query
)
SELECT id, source_project, proposal_id, type, data, fts_rank
FROM ranked WHERE rn = 1
ORDER BY fts_rank  -- BM25 值越小越相关
LIMIT :limit;
```

**性能对比**：

| 搜索方式 | 1K 实体 | 10K 实体 | 说明 |
|---------|--------|---------|------|
| USearch 向量搜索 | ~10ms | ~50ms | 语义相似度，召回质量高 |
| FTS5 全文搜索 | ~5ms | ~20ms | 关键词匹配，速度更快 |
| LIKE 模糊匹配 | ~50ms | ~500ms | 最终降级方案，性能差 |

#### 2.3.3 图查询缓存表（可选）

用于加速常见图查询：

```sql
-- 图查询缓存表（可选，用于加速常见查询）
CREATE TABLE graph_cache (
    query_hash TEXT PRIMARY KEY,
    result TEXT,
    created_at TEXT,
    expires_at TEXT
);

CREATE INDEX idx_graph_cache_expires ON graph_cache(expires_at);
```

**清理策略**：
- 启动时清理过期缓存：`expires_at <= now`
- 过期时间使用 ISO 8601 字符串，便于字典序比较

> **与内存缓存的关系**：
> - **内存缓存**（见 [graph-query.md](graph-query.md#42-图查询缓存)）：进程内缓存，访问速度快，进程重启后失效
> - **DB 缓存表**：持久化缓存，跨进程共享，适用于计算成本高的复杂查询
> - **使用策略**：优先查内存缓存 → 未命中则查 DB 缓存 → 仍未命中则执行查询并回填两级缓存

---

## 3. Merge View 模式

Feat 隔离机制要求在查询时合并主分支和当前 Feat 的数据。为确保图查询和向量搜索行为一致，统一使用以下 Merge View 模式。

### 3.1 核心原则

| 原则 | 说明 |
|------|------|
| **Feat 优先** | 当前 Feat 中的版本覆盖主分支版本 |
| **主分支兜底** | Feat 中不存在的实体/关系从主分支获取 |
| **其他 Feat 不可见** | 只能看到当前 Feat 和主分支，其他 Feat 的数据不可见 |

### 3.2 统一的 SQL 模式

**实体查询（用于向量搜索、实体列表等）**：

```sql
-- 注意：proposal_id 使用空字符串哨兵值，'' 表示主分支
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY source_project, id  -- 按项目+实体ID分组
      ORDER BY
        CASE
          WHEN proposal_id = :current_feat THEN 1  -- 当前 Feat 优先
          WHEN proposal_id = '' THEN 2             -- 主分支兜底
          ELSE 3                                    -- 其他 Feat（不应出现）
        END
    ) AS rn
  FROM entities
  WHERE proposal_id = :current_feat OR proposal_id = ''
)
SELECT * FROM ranked WHERE rn = 1
```

**关系查询（用于图遍历）**：

```sql
-- 注意：proposal_id 使用空字符串哨兵值，'' 表示主分支
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY from_project, from_id, to_project, to_id, rel_type  -- 按关系唯一键分组（含项目）
      ORDER BY
        CASE
          WHEN proposal_id = :current_feat THEN 1
          WHEN proposal_id = '' THEN 2
          ELSE 3
        END
    ) AS rn
  FROM relations
  WHERE proposal_id = :current_feat OR proposal_id = ''
)
SELECT * FROM ranked WHERE rn = 1
```

### 3.3 使用位置

| 功能 | 文档 | PARTITION BY |
|------|------|-------------|
| 向量搜索 | [vector-search.md](vector-search.md) | `source_project, id` |
| 图查询 | [graph-query.md](graph-query.md) | `from_project, from_id, to_project, to_id, rel_type` |
| 实体列表 | MCP 工具 `c4a_store_list` | `source_project, id` |

### 3.4 注意事项

1. **WHERE 过滤必须在 WITH 内部**：先过滤再排序，避免扫描全表
2. **PARTITION BY 字段必须是唯一键**：实体用 `(source_project, id)`，关系用 `(from_project, from_id, to_project, to_id, rel_type)`
3. **ORDER BY 顺序固定**：Feat 优先 (1) → 主分支 (2) → 其他 (3)
4. **rn = 1 过滤**：只保留每组优先级最高的记录

---
