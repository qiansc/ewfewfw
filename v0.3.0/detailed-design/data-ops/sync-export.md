## 2. 同步导出策略

### 2.1 设计原则

- 数据库是权威源，`.context/` 是导出产物
- 支持用户手动编辑 `.context/` 文件
- 冲突检测必须快速（1000 DSL < 1s）

### 2.2 增量导出流程

```
1. 批量扫描阶段 (< 1s for 1000 files)
   ├─ 读取所有文件的 mtime 和 size
   ├─ 对比数据库 updated_at
   └─ 生成冲突列表

2. 用户决策阶段
   ├─ 展示冲突文件列表
   └─ 用户选择处理策略

3. 批量执行阶段
   ├─ 根据策略处理冲突文件
   ├─ 导出变更的实体
   └─ 清理孤立 DSL 文件（仅限 .context/ 下的 *.c4a.yaml）
```

### 2.3 冲突检测算法

**设计原则**：使用内容哈希（Content Hash）进行冲突检测，而非时间戳。

**为什么不使用时间戳**：
- ❌ 时钟漂移：本地文件系统时间和数据库时间可能不一致
- ❌ 操作干扰：`touch` 或 `git checkout` 会更新 mtime 但内容未变
- ❌ 误报冲突：导致大量假阳性，影响用户体验

**内容哈希方案**：
- ✅ 准确性：只有内容真正变化才检测为冲突
- ✅ 可靠性：不受时间戳、文件操作影响
- ✅ 性能：SHA-256 计算速度快（1000 文件 < 1s）

**实现方式**：

```typescript
async function detectConflicts(dbEntities, contextPath) {
  const conflicts = [];

  // 1. 批量读取文件内容并计算哈希
  const fileHashes = await Promise.all(
    dbEntities.map(async (e) => {
      const filePath = getFilePath(e);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        return { entity_id: e.id, hash, exists: true };
      } catch (err) {
        return { entity_id: e.id, hash: null, exists: false };
      }
    })
  );

  // 2. 内存对比（无额外 I/O）
  for (let i = 0; i < dbEntities.length; i++) {
    const entity = dbEntities[i];
    const fileInfo = fileHashes[i];

    // 文件不存在：跳过（导出时会创建）
    if (!fileInfo.exists) continue;

    // 内容哈希不匹配：检测为冲突
    if (fileInfo.hash !== entity.content_hash) {
      conflicts.push({
        entity_id: entity.id,
        file_path: getFilePath(entity),
        file_hash: fileInfo.hash,
        db_hash: entity.content_hash,
        db_updated_at: entity.updated_at  // 仅用于展示，不用于判断
      });
    }
  }

  return conflicts;
}
```

**content_hash 字段**：

> **说明**：以下为逻辑示意，完整的表结构定义请参考 [sqlite-schema.md#2.1](../local-mode/sqlite-schema.md#21-核心表)。

```sql
-- 实体元数据表（三元组主键，与 entities 表对应）
CREATE TABLE metadata (
    entity_id TEXT NOT NULL,
    source_project TEXT NOT NULL,  -- 实体归属项目
    proposal_id TEXT,              -- NULL 表示主分支
    source_repo TEXT,
    external_url TEXT,
    status TEXT NOT NULL,
    content_hash TEXT,  -- SHA-256 哈希，用于冲突检测
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT,
    updated_by TEXT,
    PRIMARY KEY (source_project, entity_id, proposal_id),
    FOREIGN KEY (source_project, entity_id, proposal_id)
        REFERENCES entities(source_project, id, proposal_id) ON DELETE CASCADE
);

CREATE INDEX idx_metadata_content_hash ON metadata(content_hash);
```

**哈希计算时机**：

| 操作 | 计算时机 | 说明 |
|------|---------|------|
| `c4a_store_save` | 保存时自动计算 | 对规范化对象计算哈希（确保与导出文件一致） |
| `c4a_store_sync` (import) | 导入时计算 | 对文件内容计算哈希并存储 |
| `c4a_store_sync` (export) | 导出前检测 | 对比文件哈希和数据库哈希 |

> **哈希计算口径**：所有场景统一对**解析后的 DSL 对象**计算 SHA-256 哈希。
> - 规范化：对象字段按字母序深度排序后 JSON 序列化
> - 排除字段：`created_at`、`updated_at`、`content_hash`、`proposal_id`、`_id`、`__v`
> - 与 YAML/JSON 文件格式无关，确保 `c4a_store_save` 与 `c4a_store_sync` 一致

**性能优化**：

- 批量计算：使用 `Promise.all` 并行计算多个文件的哈希
- 增量检测：仅对可能冲突的文件计算哈希（通过 mtime 初筛）
- 缓存策略：文件未修改时（mtime 未变）可复用上次的哈希值

**两阶段检测（性能优化）**：

```typescript
async function detectConflictsOptimized(dbEntities, contextPath) {
  // 阶段 1：快速筛选（使用 mtime）
  const candidates = [];
  const fileStats = await Promise.all(
    dbEntities.map(e => fs.stat(getFilePath(e)).catch(() => null))
  );

  for (let i = 0; i < dbEntities.length; i++) {
    const entity = dbEntities[i];
    const stat = fileStats[i];

    // 文件不存在或 mtime 早于 updated_at：跳过
    if (!stat || stat.mtime <= new Date(entity.updated_at)) continue;

    candidates.push({ entity, stat });
  }

  // 阶段 2：精确检测（使用内容哈希）
  const conflicts = [];
  for (const { entity } of candidates) {
    const filePath = getFilePath(entity);
    const content = await fs.readFile(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (hash !== entity.content_hash) {
      conflicts.push({
        entity_id: entity.id,
        file_path: filePath,
        file_hash: hash,
        db_hash: entity.content_hash
      });
    }
  }

  return conflicts;
}
```

**设计要点**：

- **阶段 1（mtime 初筛）**：快速排除明显无冲突的文件（90%+ 的情况）
- **阶段 2（哈希精确检测）**：仅对可能冲突的文件计算哈希
- **性能目标**：1000 文件 < 1s（阶段 1 约 100ms，阶段 2 约 500ms）

### 2.4 conflict_policy 说明

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `skip` (默认) | 跳过冲突文件，保留本地修改 | 保护本地修改，默认安全策略 |
| `warn` | 记录警告但继续执行，使用数据库版本 | CI/CD 自动化，需要知道冲突但不中断 |
| `override` | 强制覆盖，使用数据库版本 | 强制同步，忽略本地修改 |
| `prompt` | 检测到冲突时暂停，询问用户 | 交互式使用 |

### 2.5 MCP 工具接口

```typescript
c4a_store_sync({
  direction: "import" | "export",  // import: 文件→数据库, export: 数据库→文件
  scope: "published",              // published / approved / all
  path: ".context",                // 同步路径（默认 .context/）
  format: "yaml",                  // yaml / json (仅 export 时需要)
  mode: "incremental",             // incremental / full (默认 incremental)
  conflict_policy: "skip"          // skip / warn / override / prompt (仅 export 时，默认 skip)
})
```

### 2.6 返回值示例

```typescript
// direction=import
{
  success: true,
  imported: {
    products: 5,
    systems: 3,
    containers: 12,
    components: 45,
    adr: 8
  }
}

// direction=export (无冲突)
{
  success: true,
  exported: {
    products: 5,
    systems: 3,
    containers: 12,
    components: 45,
    adr: 8
  },
  path: ".context/"
}

// direction=export (有冲突，conflict_policy=prompt)
{
  success: false,
  conflicts: [
    {
      entity_id: "auth-service",
      file_path: "technical/containers/auth-service.yaml",
      file_mtime: "2026-01-21T10:30:00Z",
      db_updated_at: "2026-01-21T09:00:00Z"
    },
    {
      entity_id: "adr-a003-jwt-auth",
      file_path: "technical/adrs/adr-a003-jwt-auth.yaml",
      file_mtime: "2026-01-21T11:00:00Z",
      db_updated_at: "2026-01-21T08:00:00Z"
    }
  ],
  message: "检测到 2 个冲突文件，请选择处理策略"
}
```

### 2.7 CLI 命令

```bash
# 双向同步：自动检测变更方向
c4a sync                    # 同步主分支
c4a sync feat-a001          # 同步指定 feat

# 备份和恢复
c4a server backup           # 备份全量数据为压缩包
c4a server restore <file>   # 从压缩包恢复
c4a local backup            # 备份本地数据为压缩包
c4a local restore <file>    # 从压缩包恢复
```

### 2.8 CLI 交互示例

```bash
$ c4a sync

  同步架构知识 (双向)

检测变更...
  📁 本地: 3 个新增, 2 个修改
  ☁️  服务端: 1 个新增, 1 个修改

同步方向:
  ⬆️  本地 → 服务端: 5 个文件
  ⬇️  服务端 → 本地: 2 个文件

? 发现冲突文件:
    - container/api-gateway.yaml (本地和服务端都有修改)

? 冲突处理:
  > 使用本地版本
    使用服务端版本
    逐个确认
    取消同步

─────────────────────────────────────────
选择: 使用本地版本
─────────────────────────────────────────

正在同步...
  ⬆️  上传: system/my-system.yaml
  ⬆️  上传: container/user-service.yaml
  ⬆️  上传: container/api-gateway.yaml (覆盖服务端)
  ⬇️  下载: adr/adr-005.yaml

更新图谱关系...
  ✅ Neo4j: 8 个关系已更新
  ✅ Milvus: 5 个向量已索引

✓ 同步完成
  ⬆️  已上传: 5 个文件
  ⬇️  已下载: 2 个文件
```

---
