# MCP Store 实现修复计划

> 基于设计文档逐行对照检查，汇总 Opus、Gemini、Codex 三方审查结果

## 检查范围

| 设计文档 | 对应实现 |
|---------|---------|
| store-crud.md | crud-operations.ts |
| store-sync.md | sync-operations.ts, planSync.ts |
| store-feat-lifecycle.md | feat-operations.ts |
| store-feat-checklist.md | feat-operations.ts |
| store-utils.md | utils-operations.ts |

---

## 一、Critical 级别问题（阻塞发布）

### 1.1 `c4a_store_sync` 完全未实现

**位置**: `sync-operations.ts` L22-44

**设计要求** (store-sync.md §3.5):
- 支持 `direction: "import" | "export"`
- 支持 `status_filter`, `path`, `format`, `mode`, `conflict_policy`
- 返回 `stats: { scanned; created; updated; skipped; conflicted; failed }`

**当前状态**:
```typescript
export async function sync(ctx: AdapterContext, params: SyncParams): Promise<SyncResult> {
  // TODO: 实现同步逻辑
  return {
    success: false,
    error: 'sync not implemented yet',
  };
}
```

**修复方案**:
1. 实现 `import` 方向：扫描 `.context/` 目录，解析 YAML 文件，调用 `save` 保存
2. 实现 `export` 方向：查询数据库实体，生成 YAML 文件写入 `.context/`
3. 实现增量模式：基于 `content_hash` 比对
4. 实现冲突检测：比较本地文件 hash 与数据库 hash

**工作量**: 高（约 300-400 行代码）

---

### 1.2 `c4a_store_plan_sync` 缺少 download/conflict/delete 检测

**位置**: `sync-operations.ts` L46-150

**设计要求** (store-sync.md §3.5.1):
- 返回 `actions` 数组，包含 `upload`, `download`, `conflict`, `delete_local`, `delete_remote`
- 三方对比逻辑：本地 vs 远程 vs 快照

**当前状态**: 只实现了 `upload` 检测

```typescript
// 当前只检测本地新增/修改
for (const file of localManifest.files) {
  const remoteEntity = remoteEntities.get(file.entity_id);
  if (!remoteEntity) {
    actions.push({ op: 'upload', ... });
  } else if (file.content_hash !== remoteEntity.content_hash) {
    actions.push({ op: 'upload', ... });
  }
}
```

**缺失逻辑**:
```typescript
// 需要添加：检测远程新增（download）
for (const [entityId, remote] of remoteEntities) {
  const localFile = localManifest.files.find(f => f.entity_id === entityId);
  if (!localFile) {
    actions.push({ op: 'download', entity_id: entityId, content: remote.content, ... });
  }
}

// 需要添加：检测删除
// 本地有、远程无、快照有 → remote_deleted (conflict)
// 本地无、远程有、快照有 → local_deleted (conflict)
// 本地有、远程有、快照有、双方都改 → both_modified (conflict)
```

**修复方案**:
1. 添加远程新增检测（download）
2. 添加三方对比逻辑（使用 snapshot）
3. 添加删除检测（delete_local, delete_remote）
4. 添加冲突类型判断（both_modified, local_deleted, remote_deleted）

**工作量**: 中（约 150-200 行代码）

---

### 1.3 `mergeFeatToMain` 未删除 feat 副本

**位置**: `feat-operations.ts` L280-350

**设计要求** (store-feat-lifecycle.md §3.7):
> Copy-on-Write 合并：将 feat 版本移到主分支，删除旧版本

```sql
-- 设计文档要求的 SQL
DELETE FROM entities WHERE id = 'auth-service' AND proposal_id IS NULL;
UPDATE entities SET proposal_id = NULL WHERE id = 'auth-service' AND proposal_id = 'feat-a001';
```

**当前状态**: 只复制数据，未删除 feat 副本

```typescript
// 当前实现：复制到主分支
db.prepare(`
  INSERT INTO entities (id, source_project, proposal_id, type, data)
  SELECT id, source_project, NULL, type, data
  FROM entities WHERE proposal_id = ?
`).run(featId);
// ❌ 缺少：DELETE FROM entities WHERE proposal_id = ?
```

**修复方案**:
```typescript
// 1. 删除主分支旧版本
db.prepare(`
  DELETE FROM entities
  WHERE proposal_id IS NULL
    AND id IN (SELECT id FROM entities WHERE proposal_id = ?)
`).run(featId);

// 2. feat 版本移到主分支
db.prepare(`
  UPDATE entities SET proposal_id = NULL WHERE proposal_id = ?
`).run(featId);

// 3. 同步更新 metadata 和 relations 表
```

**工作量**: 低（约 50 行代码）

---

### 1.4 `c4a_store_delete` 未实现 feat 内软删除

**位置**: `crud-operations.ts` L200-280

**设计要求** (store-crud.md §3.4):
> 删除 feat 中的实体（主分支已存在）→ **转换为软删除**，自动设置 `status: "archived"`

**当前状态**: 直接物理删除

```typescript
// 当前实现
db.prepare(`DELETE FROM entities WHERE id = ? AND proposal_id IS ?`).run(id, proposalId);
```

**修复方案**:
```typescript
if (proposalId) {
  // 检查主分支是否存在该实体
  const mainExists = db.prepare(`
    SELECT 1 FROM entities WHERE id = ? AND proposal_id IS NULL
  `).get(id);

  if (mainExists) {
    // 主分支存在 → 软删除（标记为 archived）
    db.prepare(`
      UPDATE metadata SET status = 'archived'
      WHERE entity_id = ? AND proposal_id = ?
    `).run(id, proposalId);
    return { success: true, id, soft_deleted: true };
  }
}
// 主分支不存在或非 feat → 物理删除
db.prepare(`DELETE FROM entities WHERE id = ? AND proposal_id IS ?`).run(id, proposalId);
```

**工作量**: 低（约 30 行代码）

---

## 二、High 级别问题（影响核心功能）

### 2.1 ADR 检查逻辑未实现

**位置**: `crud-operations.ts` save 函数

**设计要求** (store-crud.md §3.1):
- 支持 `enforce_adr` 和 `skip_adr_check` 参数
- 保存 system/container/component 且 status=published 时检查 ADR 关联
- 返回 `adr_check` 字段

**当前状态**: 参数被忽略，无检查逻辑

**修复方案**:
```typescript
// 在 save 函数中添加
if (!params.skip_adr_check &&
    ['system', 'container', 'component'].includes(params.type) &&
    status === 'published') {
  const hasAdr = db.prepare(`
    SELECT 1 FROM relations
    WHERE from_id = ? AND rel_type = 'REFERENCES'
      AND to_id IN (SELECT id FROM entities WHERE type = 'adr')
  `).get(entityId);

  if (!hasAdr && params.enforce_adr) {
    return { success: false, error: { code: 'C4A-STORE-ADR-001', ... } };
  }
  result.adr_check = { required: true, passed: !!hasAdr, missing_adr: !hasAdr };
}
```

**工作量**: 中（约 80 行代码）

---

### 2.2 `expected_content_hash` 验证未实现

**位置**: `feat-operations.ts` transitionFeat 函数

**设计要求** (store-feat-lifecycle.md §3.6):
> 发布前同步校验：比对传入的哈希与数据库中的哈希，不一致则拒绝发布

**当前状态**: 参数被忽略

**修复方案**:
```typescript
if (params.to_status === 'published' && params.expected_content_hash) {
  const actualHash = await computeFeatContentHash(db, featId);
  if (actualHash !== params.expected_content_hash) {
    return {
      success: false,
      error: 'content_hash_mismatch',
      message: '本地存在未同步的修改，请先执行 c4a sync',
      expected_hash: params.expected_content_hash,
      actual_hash: actualHash,
    };
  }
}
```

**工作量**: 低（约 40 行代码）

---

### 2.3 `c4a_store_read` 不支持多 feat 数组

**位置**: `crud-operations.ts` read 函数

**设计要求** (store-crud.md §3.2):
> `proposal_id?: string | string[] | null`：支持多 Feat 合并视图

**当前状态**: 只支持单个 string

**修复方案**:
```typescript
if (Array.isArray(params.proposal_id)) {
  // 多 feat 合并视图：主分支 + 多个 feat，后面的优先
  const placeholders = params.proposal_id.map(() => '?').join(', ');
  const sql = `
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY id
        ORDER BY CASE
          ${params.proposal_id.map((_, i) => `WHEN proposal_id = ? THEN ${i}`).join(' ')}
          ELSE ${params.proposal_id.length}
        END
      ) AS rn
      FROM entities
      WHERE proposal_id IS NULL OR proposal_id IN (${placeholders})
    )
    SELECT * FROM ranked WHERE rn = 1
  `;
}
```

**工作量**: 中（约 60 行代码）

---

### 2.4 `updateWorkflowStep` 非原子操作

**位置**: `feat-operations.ts` updateWorkflowStep 函数

**设计要求** (store-feat-checklist.md §3.9):
> 使用数据库的原子操作（如 MongoDB 的 `$set`）更新特定步骤的字段

**当前状态**: 读取-修改-写入模式，存在并发风险

```typescript
// 当前实现
const feat = db.prepare(`SELECT workflow_steps FROM feats WHERE id = ?`).get(featId);
const steps = JSON.parse(feat.workflow_steps);
steps[index].status = newStatus;  // 内存修改
db.prepare(`UPDATE feats SET workflow_steps = ? WHERE id = ?`).run(JSON.stringify(steps), featId);
```

**修复方案**:
SQLite 不支持 JSON 字段的原子更新，需要使用事务 + 乐观锁：

```typescript
db.transaction(() => {
  const feat = db.prepare(`SELECT workflow_steps, version FROM feats WHERE id = ?`).get(featId);
  // ... 修改 ...
  const result = db.prepare(`
    UPDATE feats SET workflow_steps = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(newSteps, featId, feat.version);

  if (result.changes === 0) {
    throw new Error('CONCURRENT_MODIFICATION');
  }
})();
```

**工作量**: 中（约 50 行代码）

---

### 2.5 `delete` 未返回 `deleted_relations`

**位置**: `crud-operations.ts` deleteEntity 函数

**设计要求** (store-crud.md §3.4):
> 返回 `deleted_relations?: number`：级联删除的关系数量

**当前状态**: 未返回此字段

**修复方案**:
```typescript
const relationsDeleted = db.prepare(`
  DELETE FROM relations WHERE from_id = ? OR to_id = ?
`).run(id, id);

return {
  success: true,
  id,
  deleted_relations: relationsDeleted.changes,
};
```

**工作量**: 低（约 10 行代码）

---

## 三、Medium 级别问题（功能不完整）

### 3.1 `backup` 只支持 JSON，不支持 tar.gz

**位置**: `utils-operations.ts` backup 函数

**设计要求** (store-utils.md §3.13):
> `format?: "tar.gz" | "json" = "tar.gz"`

**当前状态**: 只实现 JSON 格式

**修复方案**:
```typescript
if (params.format === 'tar.gz' || !params.format) {
  // 使用 archiver 或 tar 库创建压缩包
  const tar = require('tar');
  await tar.create({ gzip: true, file: params.output }, [tempJsonFile]);
}
```

**工作量**: 低（约 30 行代码，需要添加依赖）

---

### 3.2 `checklist` 的 `validate` 参数未实现

**位置**: `feat-operations.ts` featChecklist 函数

**设计要求** (store-feat-checklist.md §3.8):
> `validate?: boolean  // 默认 true`：是否验证 checklist 结构

**当前状态**: 参数被忽略

**修复方案**:
```typescript
if (params.validate !== false) {
  const errors = validateChecklistStructure(checklist);
  if (errors.length > 0) {
    return { success: false, error: 'validation_failed', errors };
  }
}
```

**工作量**: 低（约 40 行代码）

---

### 3.3 Double Check 机制未集成到 CLI

**位置**: `doubleCheck.ts` 已实现，但未在 planSync 流程中使用

**设计要求** (store-sync.md §3.5.1 CLI 本地文件写入保护):
> CLI 在执行任何本地文件写入/删除操作前，必须进行二次 Hash 校验

**当前状态**: 工具函数已实现，但 planSync 返回的 actions 未包含 `expected_hash`

**修复方案**:
在 planSync 返回的 download/delete_local actions 中添加 `expected_hash` 字段

**工作量**: 低（约 20 行代码）

---

## 四、Low 级别问题（边缘场景）

### 4.1 Server 模式适配器未实现

**设计要求**: 多处文档提到 Server 模式使用 MongoDB + Neo4j + Milvus

**当前状态**: 只有 LiteAdapter (SQLite)

**修复方案**: v0.3.0 暂不实现，标记为 v0.4.0 计划

---

### 4.2 `repair` 的 Neo4j 修复逻辑

**位置**: `utils-operations.ts` repair 函数

**设计要求** (store-utils.md §3.15):
> 仅 Server 模式（Local 模式使用 SQLite 事务保证一致性）

**当前状态**: 正确返回 "Local 模式不使用 Neo4j"

**结论**: 无需修复，设计符合预期

---

## 五、修复优先级排序

| 优先级 | 问题 | 工作量 | 影响范围 |
|-------|------|-------|---------|
| P0 | 1.1 sync 未实现 | 高 | 阻塞 Local 模式同步 |
| P0 | 1.2 planSync 缺失检测 | 中 | 阻塞 Server/Remote 模式同步 |
| P0 | 1.3 merge 未删除副本 | 低 | 数据残留，feat 发布后污染 |
| P0 | 1.4 delete 软删除 | 低 | feat 内删除语义错误 |
| P1 | 2.1 ADR 检查 | 中 | 架构治理功能缺失 |
| P1 | 2.2 content_hash 验证 | 低 | 发布安全检查缺失 |
| P1 | 2.3 多 feat 数组 | 中 | 高级查询功能缺失 |
| P1 | 2.4 原子更新 | 中 | 并发安全风险 |
| P1 | 2.5 deleted_relations | 低 | 返回值不完整 |
| P2 | 3.1 tar.gz 格式 | 低 | 备份格式不完整 |
| P2 | 3.2 checklist validate | 低 | 验证功能缺失 |
| P2 | 3.3 Double Check 集成 | 低 | CLI 保护机制未生效 |

---

## 六、修复计划时间线

### Phase 1: Critical 修复（阻塞发布）

1. **1.3 merge 删除副本** - 0.5h
2. **1.4 delete 软删除** - 0.5h
3. **1.2 planSync 完善** - 2h
4. **1.1 sync 实现** - 4h

### Phase 2: High 修复（核心功能）

5. **2.5 deleted_relations** - 0.5h
6. **2.2 content_hash 验证** - 0.5h
7. **2.1 ADR 检查** - 1h
8. **2.4 原子更新** - 1h
9. **2.3 多 feat 数组** - 1h

### Phase 3: Medium 修复（功能完善）

10. **3.2 checklist validate** - 0.5h
11. **3.3 Double Check 集成** - 0.5h
12. **3.1 tar.gz 格式** - 0.5h

---

## 七、验证清单

修复完成后需验证：

- [ ] `c4a_store_sync` import/export 正常工作
- [ ] `c4a_store_plan_sync` 返回完整的 actions（upload/download/conflict/delete）
- [ ] feat 发布后数据库无残留副本
- [ ] feat 内删除主分支实体转为软删除
- [ ] ADR 检查在 enforce_adr=true 时生效
- [ ] 发布时 content_hash 不匹配返回错误
- [ ] 多 feat 数组查询返回正确的合并视图
- [ ] workflow_step 更新在并发场景下安全
- [ ] delete 返回 deleted_relations 数量
- [ ] backup 支持 tar.gz 格式
- [ ] checklist generate 时 validate=true 生效
