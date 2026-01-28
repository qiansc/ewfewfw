/**
 * LiteAdapter 同步操作
 *
 * 设计文档: store-sync.md §3.5, §3.5.1
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  EntityType,
  SyncParams,
  SyncResult,
  SyncDetail,
  PlanSyncParams,
  PlanSyncResult,
  SyncPlan,
  SyncSnapshot,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// Sync 操作（Local 模式）
// ============================================================

/**
 * 文件系统与数据库同步
 * 设计文档: store-sync.md §3.5
 */
export async function sync(ctx: AdapterContext, params: SyncParams): Promise<SyncResult> {
  const db = ctx.store.getDatabase();
  const basePath = params.path || '.context';
  const statusFilter = params.status_filter || 'published';
  const mode = params.mode || 'incremental';
  const format = params.format || 'yaml';

  const stats = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    conflicted: 0,
    failed: 0,
  };

  const details: SyncDetail[] = [];

  if (params.direction === 'import') {
    // 从文件系统导入到数据库
    const files = scanDslFiles(basePath);
    stats.scanned = files.length;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const data = parseYaml(content) as Record<string, unknown>;

        if (!data.id || !data.type) {
          stats.skipped++;
          details.push({ entity_id: String(data.id || 'unknown'), action: 'skipped', path: filePath, error: 'Missing id or type' });
          continue;
        }

        const entityId = data.id as string;
        const entityType = data.type as EntityType;
        const contentHash = computeContentHash(content);
        const sourceProject = ctx.config.defaultProject;

        // 检查是否已存在
        const existing = db.prepare(`
          SELECT content_hash FROM metadata
          WHERE entity_id = ? AND source_project = ? AND proposal_id IS NULL
        `).get(entityId, sourceProject) as { content_hash: string } | undefined;

        if (existing) {
          if (mode === 'incremental' && existing.content_hash === contentHash) {
            stats.skipped++;
            details.push({ entity_id: entityId, action: 'skipped', path: filePath });
            continue;
          }
          // 更新
          updateEntity(db, entityId, sourceProject, entityType, data, contentHash);
          stats.updated++;
          details.push({ entity_id: entityId, action: 'updated', path: filePath });
        } else {
          // 创建
          insertEntity(db, entityId, sourceProject, entityType, data, contentHash);
          stats.created++;
          details.push({ entity_id: entityId, action: 'created', path: filePath });
        }
      } catch (error) {
        stats.failed++;
        details.push({ entity_id: 'unknown', action: 'failed', path: filePath, error: String(error) });
      }
    }
  } else {
    // 从数据库导出到文件系统
    const statusCondition = buildStatusCondition(statusFilter);

    const entities = db.prepare(`
      SELECT e.id, e.type, e.data, m.status, m.content_hash
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.proposal_id IS NULL ${statusCondition}
    `).all() as Array<{
      id: string;
      type: string;
      data: string;
      status: string;
      content_hash: string;
    }>;

    stats.scanned = entities.length;

    for (const entity of entities) {
      try {
        const data = JSON.parse(entity.data) as Record<string, unknown>;
        const filePath = getEntityFilePath(basePath, entity.type, entity.id, format);

        // 确保目录存在
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // 检查文件是否已存在
        if (existsSync(filePath)) {
          const existingContent = readFileSync(filePath, 'utf-8');
          const existingHash = computeContentHash(existingContent);

          if (mode === 'incremental' && existingHash === entity.content_hash) {
            stats.skipped++;
            details.push({ entity_id: entity.id, action: 'skipped', path: filePath });
            continue;
          }

          // 冲突检测
          if (params.conflict_policy === 'skip') {
            stats.skipped++;
            details.push({ entity_id: entity.id, action: 'skipped', path: filePath });
            continue;
          } else if (params.conflict_policy === 'warn') {
            stats.conflicted++;
            details.push({ entity_id: entity.id, action: 'conflict', path: filePath });
            continue;
          }
          // override: 继续写入
        }

        // 写入文件
        const content = format === 'yaml' ? stringifyYaml(data) : JSON.stringify(data, null, 2);
        writeFileSync(filePath, content, 'utf-8');
        stats.created++;
        details.push({ entity_id: entity.id, action: 'exported', path: filePath });
      } catch (error) {
        stats.failed++;
        details.push({ entity_id: entity.id, action: 'failed', error: String(error) });
      }
    }
  }

  return {
    success: stats.failed === 0,
    stats,
    details,
  };
}

// ============================================================
// PlanSync 操作（Server/Remote 模式）
// ============================================================

/**
 * 同步计划
 * 设计文档: store-sync.md §3.5.1
 *
 * 三方对比逻辑：
 * | 本地 | 远程 | 快照 | 判定 | 返回 op |
 * |:----:|:----:|:----:|------|---------|
 * | ✅ | ❌ | ❌ | 本地新增 | upload |
 * | ✅ | ❌ | ✅ | 远程已删除 | conflict (remote_deleted) |
 * | ❌ | ✅ | ❌ | 远程新增 | download |
 * | ❌ | ✅ | ✅ | 本地已删除 | delete_remote |
 * | ✅ | ✅ | - | 比较哈希 | upload/download/conflict/skip |
 * | ❌ | ❌ | ✅ | 双方都删除 | skip（仅清理快照） |
 */
export async function planSync(ctx: AdapterContext, params: PlanSyncParams): Promise<PlanSyncResult> {
  const db = ctx.store.getDatabase();
  const proposalId = params.options?.proposal_id ?? null;
  const statusFilter = params.options?.status_filter || 'published';

  const plan: SyncPlan = {
    to_upload: [],
    to_download: [],
    to_delete_local: [],
    to_delete_remote: [],
    conflicts: [],
    unchanged: [],
  };

  // 构建本地文件映射
  const localFiles = new Map<string, typeof params.local_manifest.files[0]>();
  for (const file of params.local_manifest.files) {
    localFiles.set(file.entity_id, file);
  }

  // 构建快照映射
  const snapshotEntities = new Map<string, { content_hash: string; proposal_id?: string }>();
  if (params.snapshot?.entities) {
    for (const [entityId, info] of Object.entries(params.snapshot.entities)) {
      snapshotEntities.set(entityId, info);
    }
  }

  // 查询远程实体
  const statusCondition = buildStatusCondition(statusFilter);
  const remoteEntities = db.prepare(`
    SELECT e.id, e.type, e.data, m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id IS ? ${statusCondition}
  `).all(proposalId) as Array<{
    id: string;
    type: EntityType;
    data: string;
    content_hash: string;
  }>;

  const remoteMap = new Map<string, typeof remoteEntities[0]>();
  for (const entity of remoteEntities) {
    remoteMap.set(entity.id, entity);
  }

  // 收集所有实体 ID
  const allEntityIds = new Set<string>([
    ...localFiles.keys(),
    ...remoteMap.keys(),
    ...snapshotEntities.keys(),
  ]);

  // 三方对比
  for (const entityId of allEntityIds) {
    const local = localFiles.get(entityId);
    const remote = remoteMap.get(entityId);
    const snapshot = snapshotEntities.get(entityId);

    // 本地有，远程无
    if (local && !remote) {
      if (snapshot) {
        // 远程已删除（快照中有，说明之前同步过）
        // P2-3.3: 返回 delete_local 操作，包含 expected_hash 用于 Double Check
        plan.to_delete_local.push({
          op: 'delete_local',
          entity_id: entityId,
          type: local.type,
          path: local.path,
          expected_hash: local.content_hash,
          reason: '远程已删除此实体',
        });
      } else {
        // 本地新增
        plan.to_upload.push({
          op: 'upload',
          entity_id: entityId,
          type: local.type,
          path: local.path,
          content_hash: local.content_hash,
          expected_hash: local.content_hash,
          reason: '本地新增',
        });
      }
      continue;
    }

    // 本地无，远程有
    if (!local && remote) {
      if (snapshot) {
        // 本地已删除
        plan.to_delete_remote.push({
          op: 'delete_remote',
          entity_id: entityId,
          type: remote.type,
          reason: '本地已删除',
        });
      } else {
        // 远程新增
        plan.to_download.push({
          op: 'download',
          entity_id: entityId,
          type: remote.type,
          content: remote.data,
          content_hash: remote.content_hash,
          reason: '远程新增',
        });
      }
      continue;
    }

    // 本地有，远程有
    if (local && remote) {
      if (local.content_hash === remote.content_hash) {
        // 无变化
        plan.unchanged.push(entityId);
      } else if (snapshot) {
        // 有快照，可以判断谁修改了
        const snapshotHash = snapshot.content_hash;
        const localChanged = local.content_hash !== snapshotHash;
        const remoteChanged = remote.content_hash !== snapshotHash;

        if (localChanged && remoteChanged) {
          // 双方都修改了 → 冲突
          plan.conflicts.push({
            entity_id: entityId,
            conflict_type: 'both_modified',
            local_hash: local.content_hash,
            remote_hash: remote.content_hash,
            remote_content: remote.data,
            reason: '双方都修改了',
          });
        } else if (localChanged) {
          // 仅本地修改 → 上传
          plan.to_upload.push({
            op: 'upload',
            entity_id: entityId,
            type: local.type,
            path: local.path,
            content_hash: local.content_hash,
            expected_hash: snapshot.content_hash,
            reason: '本地修改',
          });
        } else {
          // 仅远程修改 → 下载
          plan.to_download.push({
            op: 'download',
            entity_id: entityId,
            type: remote.type,
            path: local.path,
            content: remote.data,
            content_hash: remote.content_hash,
            expected_hash: local.content_hash,
            reason: '远程修改',
          });
        }
      } else {
        // 无快照，无法判断谁修改了 → 冲突
        plan.conflicts.push({
          entity_id: entityId,
          conflict_type: 'both_modified',
          local_hash: local.content_hash,
          remote_hash: remote.content_hash,
          remote_content: remote.data,
          reason: '无快照，无法判断变更来源',
        });
      }
      continue;
    }

    // 本地无，远程无，快照有 → 双方都删除，跳过
    // 不需要任何操作，只需从新快照中移除
  }

  // 生成新快照
  const newSnapshot: SyncSnapshot = {
    synced_at: new Date().toISOString(),
    entities: {},
  };

  // 合并本地和远程的最新状态到快照
  for (const [entityId, local] of localFiles) {
    newSnapshot.entities[entityId] = {
      content_hash: local.content_hash,
      proposal_id: local.proposal_id,
    };
  }
  for (const [entityId, remote] of remoteMap) {
    if (!newSnapshot.entities[entityId]) {
      newSnapshot.entities[entityId] = {
        content_hash: remote.content_hash,
      };
    }
  }

  return {
    plan,
    executed: false,
    new_snapshot: newSnapshot,
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 扫描 DSL 文件
 */
function scanDslFiles(basePath: string): string[] {
  const files: string[] = [];

  if (!existsSync(basePath)) {
    return files;
  }

  function scanDir(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
          files.push(fullPath);
        }
      }
    }
  }

  scanDir(basePath);
  return files;
}

/**
 * 计算内容哈希
 */
function computeContentHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 构建状态过滤条件
 */
function buildStatusCondition(statusFilter: string): string {
  if (statusFilter === 'published') {
    return "AND m.status = 'published'";
  } else if (statusFilter === 'approved') {
    return "AND m.status IN ('published', 'approved')";
  }
  return ''; // 'all'
}

/**
 * 获取实体文件路径
 *
 * 目录映射规则（参考 architecture.md §2.5）：
 * - system (内部类型) → systems/
 * - container → containers/
 * - component → components/
 * - product → products/
 * - process → processes/
 * - sor → sors/
 * - adr → adrs/
 * - contract → contracts/
 */
function getEntityFilePath(basePath: string, type: string, id: string, format: string): string {
  const ext = format === 'yaml' ? '.yaml' : '.json';
  // 内部类型 'system' 对应目录 'systems/'
  // DSL 类型 'software-system' 也映射到 'systems/'
  const dirType = type === 'software-system' ? 'system' : type;
  return join(basePath, dirType + 's', `${id}${ext}`);
}

/**
 * 插入实体
 */
function insertEntity(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  entityId: string,
  sourceProject: string,
  entityType: EntityType,
  data: Record<string, unknown>,
  contentHash: string
): void {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, data)
    VALUES (?, ?, NULL, ?, ?)
  `).run(entityId, sourceProject, entityType, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at)
    VALUES (?, ?, NULL, 'published', ?, ?, ?)
  `).run(entityId, sourceProject, contentHash, now, now);
}

/**
 * 更新实体
 */
function updateEntity(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  entityId: string,
  sourceProject: string,
  entityType: EntityType,
  data: Record<string, unknown>,
  contentHash: string
): void {
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE entities SET type = ?, data = ?
    WHERE id = ? AND source_project = ? AND proposal_id IS NULL
  `).run(entityType, JSON.stringify(data), entityId, sourceProject);

  db.prepare(`
    UPDATE metadata SET content_hash = ?, updated_at = ?
    WHERE entity_id = ? AND source_project = ? AND proposal_id IS NULL
  `).run(contentHash, now, entityId, sourceProject);
}
