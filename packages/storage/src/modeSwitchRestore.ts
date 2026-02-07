/**
 * Local 模式恢复
 */

import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { SQLiteStore } from './sqlite-store.js';
import type { LiteAdapter } from './lite-adapter.js';
import type { ServerAdapter } from './server-adapter.js';
import type { ConflictPolicy } from './modeSwitchTypes.js';
import type {
  RestoreOptions,
  RestoreResult,
  RestoreProgress,
  ExportData,
  ExportEntity,
  ExportRelation,
  ExportFeat,
  MigrateOptions,
  MigrateResult,
  MigrateProgress,
} from './modeSwitchTypes.js';
import { EXPORT_VERSION } from './modeSwitchTypes.js';
import { MigrationError } from './modeSwitchErrors.js';
import { restoreFromStream } from './modeSwitchRestoreStream.js';
import {
  normalizeExportData,
  normalizeExportEntity,
  normalizeExportRelation,
  validateExportData,
  validateEntity,
  validateRelation,
  validateFeat,
} from './modeSwitchRestoreNormalize.js';
import { readBackupData } from './modeSwitchReadBackup.js';

const STREAMING_THRESHOLD_BYTES = 50 * 1024 * 1024;
type ConflictEntry = NonNullable<RestoreResult['conflicts']>[number];

/**
 * 恢复数据到 Local 模式
 *
 * 设计文档: mode-switch.md §5.2.2
 */
export class LocalRestore {
  private store: SQLiteStore;

  constructor(store?: SQLiteStore) {
    this.store = store || SQLiteStore.getInstance();
  }

  /**
   * 从备份恢复
   */
  async restore(options: RestoreOptions): Promise<RestoreResult> {
    const policy = options.conflictPolicy || 'skip';
    const reportProgress = (
      phase: RestoreProgress['phase'],
      current: number,
      total: number,
      message?: string
    ): void => {
      if (!options.onProgress) return;
      options.onProgress({ phase, current, total, message });
    };

    const db = this.store.getDatabase();
    const stats = {
      entities: { created: 0, updated: 0, skipped: 0 },
      relations: 0,
      feats: { created: 0, updated: 0, skipped: 0 },
      vectors: 0,
    };
    const conflicts: RestoreResult['conflicts'] = [];

    if (await this.shouldStreamRestore(options.input)) {
      await restoreFromStream(options.input, policy, db, reportProgress, stats, conflicts, {
        validateEntity,
        normalizeEntity: normalizeExportEntity,
        restoreEntity: this.restoreEntity.bind(this),
        validateRelation,
        normalizeRelation: normalizeExportRelation,
        restoreRelation: this.restoreRelation.bind(this),
        validateFeat,
        restoreFeat: this.restoreFeat.bind(this),
        isCompatibleVersion: this.isCompatibleVersion.bind(this),
      });
    } else {
      // 读取备份文件
      const exportData = normalizeExportData(await this.readBackup(options.input));

      // 从第一个实体获取默认项目
      const defaultProject = exportData.entities[0]?.metadata.root_id || 'default';

      // 恢复 Feats
      let index = 0;
      for (const feat of exportData.feats) {
        const result = this.restoreFeat(db, feat, policy);
        if (result.action === 'created') stats.feats.created++;
        else if (result.action === 'updated') stats.feats.updated++;
        else if (result.action === 'skipped') stats.feats.skipped++;

        if (result.conflict) {
          conflicts.push(result.conflict);
        }
        index += 1;
        reportProgress('feats', index, exportData.feats.length);
      }

      // 恢复实体
      index = 0;
      for (const entity of exportData.entities) {
        const result = await this.restoreEntity(db, entity, policy);
        if (result.action === 'created') stats.entities.created++;
        else if (result.action === 'updated') stats.entities.updated++;
        else if (result.action === 'skipped') stats.entities.skipped++;

        if (result.conflict) {
          conflicts.push(result.conflict);
        }
        index += 1;
        reportProgress('entities', index, exportData.entities.length);
      }

      // 恢复关系
      index = 0;
      for (const relation of exportData.relations) {
        this.restoreRelation(db, relation, defaultProject);
        stats.relations++;
        index += 1;
        reportProgress('relations', index, exportData.relations.length);
      }
    }

    if (options.rebuildVectors !== false && this.store.isVectorSearchEnabled()) {
      try {
        const rebuild = await this.store.rebuildVectorIndex();
        stats.vectors = rebuild.indexed;
        reportProgress('vectors', rebuild.indexed, rebuild.indexed);
      } catch {
        // 向量重建失败不阻断主流程
      }
    }

    reportProgress('done', 1, 1);
    const conflictSummary = this.buildConflictSummary(conflicts);
    return {
      success: true,
      stats,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      conflict_summary: conflictSummary,
    };
  }

  private async shouldStreamRestore(input: string): Promise<boolean> {
    if (input.endsWith('.gz')) return true;
    try {
      const info = await stat(input);
      return info.size >= STREAMING_THRESHOLD_BYTES;
    } catch {
      return true;
    }
  }

  /**
   * 读取备份文件
   */
  private async readBackup(input: string): Promise<ExportData> {
    let data: unknown;

    if (input.endsWith('.gz')) {
      const chunks: Buffer[] = [];
      await pipeline(
        createReadStream(input),
        createGunzip(),
        async function* (source) {
          for await (const chunk of source) {
            chunks.push(chunk as Buffer);
          }
        }
      );
      data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } else {
      const content = await readFile(input, 'utf-8');
      data = JSON.parse(content);
    }

    // 验证导出格式
    return validateExportData(data, this.isCompatibleVersion.bind(this));
  }

  private buildConflictSummary(
    conflicts: Array<{ id: string; reason: string; resolution: string; target_type?: string; target_status?: string }>
  ): RestoreResult['conflict_summary'] {
    if (conflicts.length === 0) {
      return {
        total: 0,
        by_target: {},
        by_entity_type: {},
        by_status: {},
        by_feat_status: {},
        by_reason: {},
        by_resolution: {},
        by_target_resolution: {},
        by_target_status: {},
      };
    }
    const byTarget: Record<string, number> = {};
    const byEntityType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byFeatStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    const byResolution: Record<string, number> = {};
    const byTargetResolution: Record<string, Record<string, number>> = {};
    const byTargetStatus: Record<string, Record<string, number>> = {};
    for (const conflict of conflicts) {
      const target = conflict.id.startsWith('feat:') ? 'feat' : 'entity';
      const entityType = conflict.target_type ?? (target === 'feat' ? 'feat' : 'unknown');
      const status = conflict.target_status ?? 'unknown';
      byTarget[target] = (byTarget[target] ?? 0) + 1;
      byEntityType[entityType] = (byEntityType[entityType] ?? 0) + 1;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (target === 'feat') {
        byFeatStatus[status] = (byFeatStatus[status] ?? 0) + 1;
      }
      byReason[conflict.reason] = (byReason[conflict.reason] ?? 0) + 1;
      byResolution[conflict.resolution] = (byResolution[conflict.resolution] ?? 0) + 1;
      if (!byTargetResolution[target]) {
        byTargetResolution[target] = {};
      }
      byTargetResolution[target][conflict.resolution] =
        (byTargetResolution[target][conflict.resolution] ?? 0) + 1;
      if (!byTargetStatus[target]) {
        byTargetStatus[target] = {};
      }
      byTargetStatus[target][status] = (byTargetStatus[target][status] ?? 0) + 1;
    }
    return {
      total: conflicts.length,
      by_target: byTarget,
      by_entity_type: byEntityType,
      by_status: byStatus,
      by_feat_status: byFeatStatus,
      by_reason: byReason,
      by_resolution: byResolution,
      by_target_resolution: byTargetResolution,
      by_target_status: byTargetStatus,
    };
  }

  /**
   * 版本兼容性检查
   */
  private isCompatibleVersion(version: string): boolean {
    return version === EXPORT_VERSION || version.startsWith('0.3.');
  }

  /**
   * 恢复单个 Feat
   */
  private restoreFeat(
    db: ReturnType<SQLiteStore['getDatabase']>,
    feat: ExportFeat,
    policy: ConflictPolicy
  ): { action: 'created' | 'updated' | 'skipped'; conflict?: ConflictEntry } {
    const existing = db.prepare(`
      SELECT updated_at FROM feats WHERE id = ?
    `).get(feat.id) as { updated_at: string } | undefined;

    if (!existing) {
      this.insertFeat(db, feat);
      return { action: 'created' };
    }

    switch (policy) {
      case 'error':
        throw new Error(`Conflict detected for feat ${feat.id}`);

      case 'skip':
        return {
          action: 'skipped',
          conflict: {
            id: `feat:${feat.id}`,
            reason: 'feat_exists',
            resolution: 'skipped',
            target_type: 'feat',
            target_status: feat.status,
          },
        };

      case 'override':
        this.updateFeat(db, feat);
        return {
          action: 'updated',
          conflict: {
            id: `feat:${feat.id}`,
            reason: 'feat_exists',
            resolution: 'overridden',
            target_type: 'feat',
            target_status: feat.status,
          },
        };

      case 'merge':
        if (new Date(feat.updated_at) > new Date(existing.updated_at)) {
          this.updateFeat(db, feat);
          return {
            action: 'updated',
            conflict: {
              id: `feat:${feat.id}`,
              reason: 'backup_newer',
              resolution: 'overridden',
              target_type: 'feat',
              target_status: feat.status,
            },
          };
        }
        return {
          action: 'skipped',
          conflict: {
            id: `feat:${feat.id}`,
            reason: 'existing_newer',
            resolution: 'skipped',
            target_type: 'feat',
            target_status: feat.status,
          },
        };

      default:
        return { action: 'skipped' };
    }
  }

  /**
   * 插入新 Feat
   */
  private insertFeat(db: ReturnType<SQLiteStore['getDatabase']>, feat: ExportFeat): void {
    db.prepare(`
      INSERT INTO feats (id, status, title, description, created_by, checklist, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feat.id,
      feat.status,
      feat.title || null,
      feat.description || null,
      feat.created_by || null,
      feat.checklist ? JSON.stringify(feat.checklist) : null,
      feat.created_at,
      feat.updated_at
    );
  }

  /**
   * 更新已有 Feat
   */
  private updateFeat(db: ReturnType<SQLiteStore['getDatabase']>, feat: ExportFeat): void {
    db.prepare(`
      UPDATE feats SET status = ?, title = ?, description = ?, created_by = ?, checklist = ?, updated_at = ?
      WHERE id = ?
    `).run(
      feat.status,
      feat.title || null,
      feat.description || null,
      feat.created_by || null,
      feat.checklist ? JSON.stringify(feat.checklist) : null,
      feat.updated_at,
      feat.id
    );
  }

  /**
   * 恢复单个实体
   */
  private async restoreEntity(
    db: ReturnType<SQLiteStore['getDatabase']>,
    entity: ExportEntity,
    policy: ConflictPolicy
  ): Promise<{ action: 'created' | 'updated' | 'skipped'; conflict?: ConflictEntry }> {
    // 检查是否存在
    const dbRequirementId = entity.requirement_id ?? '';
    const requirementClause = dbRequirementId === ''
      ? '(requirement_id IS NULL OR requirement_id = \'\')'
      : 'requirement_id = ?';
    const existing = db.prepare(`
      SELECT content_hash, updated_at FROM metadata
      WHERE root_id = ? AND entity_id = ? AND ${requirementClause}
    `).get(
      ...(dbRequirementId === ''
        ? [entity.metadata.root_id, entity.id]
        : [entity.metadata.root_id, entity.id, dbRequirementId])
    ) as {
      content_hash: string;
      updated_at: string;
    } | undefined;

    if (!existing) {
      // 新实体，直接插入
      this.insertEntity(db, entity);
      return { action: 'created' };
    }

    // 存在冲突
    const incomingHash = entity.metadata.content_hash;
    if (incomingHash && existing.content_hash === incomingHash) {
      return { action: 'skipped' };
    }

    return this.handleConflict(db, entity, existing, policy);
  }

  /**
   * 处理冲突
   */
  private handleConflict(
    db: ReturnType<SQLiteStore['getDatabase']>,
    entity: ExportEntity,
    existing: { content_hash: string; updated_at: string },
    policy: ConflictPolicy
  ): {
    action: 'created' | 'updated' | 'skipped';
    conflict?: {
      id: string;
      reason: string;
      resolution: string;
      target_type?: string;
      target_status?: string;
    };
  } {
    switch (policy) {
      case 'error':
        throw new Error(`Conflict detected for entity ${entity.id}`);

      case 'skip':
        return {
          action: 'skipped',
          conflict: {
            id: entity.id,
            reason: 'hash_mismatch',
            resolution: 'skipped',
            target_type: entity.type,
            target_status: entity.metadata.status,
          },
        };

      case 'override':
        this.updateEntity(db, entity);
        return {
          action: 'updated',
          conflict: {
            id: entity.id,
            reason: 'hash_mismatch',
            resolution: 'overridden',
            target_type: entity.type,
            target_status: entity.metadata.status,
          },
        };

      case 'merge':
        // 比较 updated_at，保留较新的版本
        if (new Date(entity.metadata.updated_at) > new Date(existing.updated_at)) {
          this.updateEntity(db, entity);
          return {
            action: 'updated',
            conflict: {
              id: entity.id,
              reason: 'hash_mismatch',
              resolution: 'backup_newer',
              target_type: entity.type,
              target_status: entity.metadata.status,
            },
          };
        }
        return {
          action: 'skipped',
          conflict: {
            id: entity.id,
            reason: 'hash_mismatch',
            resolution: 'existing_newer',
            target_type: entity.type,
            target_status: entity.metadata.status,
          },
        };

      default:
        return { action: 'skipped' };
    }
  }

  /**
   * 插入新实体
   */
  private insertEntity(
    db: ReturnType<SQLiteStore['getDatabase']>,
    entity: ExportEntity
  ): void {
    const now = new Date().toISOString();
    const dbRequirementId = entity.requirement_id ?? '';

    db.prepare(`
      INSERT INTO entities (id, root_id, requirement_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      entity.metadata.root_id,
      dbRequirementId,
      entity.type,
      entity.kind || null,
      entity.scope || null,
      entity.perspective || null,
      JSON.stringify(entity.data)
    );

    db.prepare(`
      INSERT INTO metadata (entity_id, root_id, requirement_id, source_repo, status, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      entity.metadata.root_id,
      dbRequirementId,
      entity.metadata.source_repo || null,
      entity.metadata.status,
      entity.metadata.content_hash ?? null,
      entity.metadata.created_at || now,
      entity.metadata.updated_at || now
    );
  }

  /**
   * 更新已有实体
   */
  private updateEntity(
    db: ReturnType<SQLiteStore['getDatabase']>,
    entity: ExportEntity
  ): void {
    const now = new Date().toISOString();
    const dbRequirementId = entity.requirement_id ?? '';
    const requirementClause = dbRequirementId === ''
      ? '(requirement_id IS NULL OR requirement_id = \'\')'
      : 'requirement_id = ?';

    db.prepare(`
      UPDATE entities SET type = ?, kind = ?, scope = ?, perspective = ?, data = ?
      WHERE root_id = ? AND id = ? AND ${requirementClause}
    `).run(
      entity.type,
      entity.kind || null,
      entity.scope || null,
      entity.perspective || null,
      JSON.stringify(entity.data),
      entity.metadata.root_id,
      entity.id,
      ...(dbRequirementId === '' ? [] : [dbRequirementId])
    );

    db.prepare(`
      UPDATE metadata SET source_repo = ?, status = ?, content_hash = ?, updated_at = ?
      WHERE root_id = ? AND entity_id = ? AND ${requirementClause}
    `).run(
      entity.metadata.source_repo || null,
      entity.metadata.status,
      entity.metadata.content_hash ?? null,
      entity.metadata.updated_at || now,
      entity.metadata.root_id,
      entity.id,
      ...(dbRequirementId === '' ? [] : [dbRequirementId])
    );
  }

  /**
   * 恢复关系
   *
   * 设计文档: mode-switch.md §5.4
   * 关系格式简化为 from_id, to_id, rel_type, properties
   */
  private restoreRelation(
    db: ReturnType<SQLiteStore['getDatabase']>,
    relation: ExportRelation,
    defaultProject: string = 'default'
  ): void {
    const fromRootId = relation.from_root_id === undefined ? defaultProject : (relation.from_root_id ?? '');
    const toRootId = relation.to_root_id === undefined ? defaultProject : (relation.to_root_id ?? '');

    // 生成关系 ID
    const relationId = relation.id || `${relation.from_id}-${relation.rel_type}-${relation.to_id}`;

    const dbRequirementId = relation.requirement_id ?? '';
    db.prepare(`
      INSERT OR REPLACE INTO relations
      (id, requirement_id, from_root_id, from_id, to_root_id, to_id, rel_type, status, properties)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relationId,
      dbRequirementId,
      fromRootId,
      relation.from_id,
      toRootId,
      relation.to_id,
      relation.rel_type,
      relation.status ?? 'active',
      relation.properties ? JSON.stringify(relation.properties) : null
    );
  }
}

function reportMigrationProgress(
  options: MigrateOptions | undefined,
  phase: MigrateProgress['phase'],
  current: number,
  total: number,
  message?: string
): void {
  if (!options?.onProgress) return;
  options.onProgress({ phase, current, total, message });
}

function ensureTmpDir(): string {
  const sharedDir = process.env.C4A_STORAGE_BACKEND_SHARED_DIR;
  const tmpDir = sharedDir ? resolve(sharedDir) : join(process.cwd(), '.tmp');
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  return tmpDir;
}

function buildBackupName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const name = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `c4a-server-backup-${name}.tar.gz`;
}

function buildBackupPath(): string {
  return join(ensureTmpDir(), buildBackupName());
}

function buildRemoteBackupPath(): string {
  return join('/tmp', buildBackupName());
}

export async function migrateServerToLocal(
  serverAdapter: ServerAdapter,
  liteAdapter: LiteAdapter,
  options: MigrateOptions = {}
): Promise<MigrateResult> {
  const sharedDir = process.env.C4A_STORAGE_BACKEND_SHARED_DIR;
  const backupPath = buildBackupPath();
  const remoteBackupPath = sharedDir ? backupPath : buildRemoteBackupPath();
  const statusFilter = options.statusFilter ?? 'published';

  reportMigrationProgress(options, 'read', 0, 1);
  const backupResult = await serverAdapter.backup({
    output: remoteBackupPath,
    status_filter: statusFilter,
    format: 'tar.gz',
    include_metadata: true,
  });

  if (!backupResult.success) {
    throw new MigrationError('C4A-MIGRATE-004', backupResult.error ?? '连接失败');
  }
  reportMigrationProgress(options, 'read', 1, 1);

  let restoreInput = backupResult.file ?? remoteBackupPath;
  if (!existsSync(restoreInput)) {
    try {
      await serverAdapter.downloadBackup(restoreInput, backupPath);
      restoreInput = backupPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MigrationError('C4A-MIGRATE-004', message);
    }
  }

  const restoreResult = await liteAdapter.restore({
    input: restoreInput,
    conflict_policy: options.conflictPolicy,
    validate_checksums: true,
  });

  if (!restoreResult.success) {
    throw new MigrationError('C4A-MIGRATE-002', restoreResult.error ?? '恢复失败');
  }

  if (options.rebuildVectors !== false) {
    reportMigrationProgress(options, 'vectors', 0, 1);
    try {
      const store = SQLiteStore.getInstance();
      const rebuild = await store.rebuildVectorIndex();
      reportMigrationProgress(options, 'vectors', rebuild.indexed, rebuild.total);
    } catch {
      // 向量重建失败不阻断主流程
    }
  }

  reportMigrationProgress(options, 'done', 1, 1);

  let parsed: ExportData | null = null;
  try {
    parsed = await readBackupData(backupResult.file ?? backupPath);
  } catch {
    parsed = null;
  }
  return {
    success: true,
    stats: {
      feats: { created: parsed?.feats.length ?? 0, updated: 0, skipped: 0, failed: 0 },
      entities: {
        created: restoreResult.stats?.entities ?? 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      relations: { created: restoreResult.stats?.relations ?? 0, skipped: 0, failed: 0 },
    },
  };
}
