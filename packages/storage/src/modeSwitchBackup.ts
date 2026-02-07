/**
 * Local 模式备份
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SQLiteStore } from './sqlite-store.js';
import type { EntityType, EntityStatus } from './adapter.js';
import type { ServerAdapter } from './server-adapter.js';
import type {
  BackupOptions,
  BackupResult,
  ExportData,
  ExportEntity,
  ExportRelation,
  ExportFeat,
  BackupProgress,
  MigrateOptions,
  MigrateResult,
  MigrateProgress,
  MigrationCheckpoint,
  MigrateFailure,
  PermissionCheckResult,
} from './modeSwitchTypes.js';
import { EXPORT_VERSION } from './modeSwitchTypes.js';
import { MigrationError } from './modeSwitchErrors.js';
import * as converter from '@c4a/core';
import { readBackupData } from './modeSwitchReadBackup.js';
import { applyChecklist, buildEntityPayload, transitionFeatStatus } from './modeSwitchMigrationUtils.js';

type ConvertedEntity = Record<string, unknown> & {
  id?: string;
  kind?: string;
  scope?: string;
  perspective?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toInternalEntity(rawData: Record<string, unknown>): ConvertedEntity | null {
  if (converter.isProductDSL(rawData)) {
    return converter.dslToProduct(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isSystemDSL(rawData)) {
    return converter.dslToSystem(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isContainerDSL(rawData)) {
    return converter.dslToContainer(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isComponentDSL(rawData)) {
    return converter.dslToComponent(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isProcessDSL(rawData)) {
    return converter.dslToProcess(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isSoRDSL(rawData)) {
    return converter.dslToSoR(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isADRDSL(rawData)) {
    return converter.dslToADR(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isContractDSL(rawData)) {
    return converter.dslToContract(rawData) as unknown as ConvertedEntity;
  }
  return null;
}

function normalizeExportEntity(
  entityType: EntityType,
  data: Record<string, unknown>,
  kind: string | null,
  scope: string | null,
  perspective: string | null
): { data: Record<string, unknown>; kind?: string; scope?: string; perspective?: string } {
  const normalizedData = { ...data };

  if (entityType === 'adr') {
    const adr = normalizedData.adr;
    if (isPlainObject(adr)) {
      const nextAdr = { ...adr };
      if (!('title' in nextAdr) && typeof nextAdr.name === 'string') {
        nextAdr.title = nextAdr.name;
      }
      if ('name' in nextAdr) {
        delete nextAdr.name;
      }
      normalizedData.adr = nextAdr;
    }
  }

  if (entityType === 'contract') {
    const contract = normalizedData.contract;
    if (isPlainObject(contract) && 'component_id' in contract) {
      const nextContract = { ...contract };
      delete nextContract.component_id;
      normalizedData.contract = nextContract;
    }
  }

  const converted = toInternalEntity(normalizedData);
  const normalizedKind = pickString(kind) ?? pickString(converted?.kind);
  const normalizedScope = pickString(scope) ?? pickString(converted?.scope);
  const normalizedPerspective = pickString(perspective) ?? pickString(converted?.perspective);

  return {
    data: normalizedData,
    kind: normalizedKind,
    scope: normalizedScope,
    perspective: normalizedPerspective,
  };
}

/**
 * Local 模式备份工具
 *
 * 设计文档: mode-switch.md §5.2.1
 */
export class LocalBackup {
  private store: SQLiteStore;

  constructor(store?: SQLiteStore) {
    this.store = store || SQLiteStore.getInstance();
  }

  /**
   * 创建备份
   *
   * 设计文档: mode-switch.md §5.4
   */
  async backup(options: BackupOptions): Promise<BackupResult> {
    const db = this.store.getDatabase();
    const reportProgress = (
      phase: BackupProgress['phase'],
      current: number,
      total: number,
      message?: string
    ): void => {
      if (!options.onProgress) return;
      options.onProgress({ phase, current, total, message });
    };

    if (options.includeVectors) {
      throw new Error('includeVectors is not supported: vectors are rebuilt during restore');
    }

    // 导出实体（包含 kind, scope, perspective）
    interface RawEntity {
      id: string;
      type: EntityType;
      kind: string | null;
      scope: string | null;
      perspective: string | null;
      root_id: string;
      source_repo: string | null;
      requirement_id: string | null;
      data: string;
      status: EntityStatus;
      content_hash: string;
      created_at: string;
      updated_at: string;
    }

    const rawEntities = db.prepare(`
      SELECT e.id, e.type, e.kind, e.scope, e.perspective,
             e.root_id, e.requirement_id, e.data,
             m.source_repo, m.status, m.content_hash, m.created_at, m.updated_at
      FROM entities e
      JOIN metadata m ON e.uuid = m.entity_uuid
    `).all() as RawEntity[];

    // 转换为导出格式（修复 legacy 字段）
    const entities: ExportEntity[] = [];
    let index = 0;
    for (const e of rawEntities) {
      const rawData = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      const normalized = isPlainObject(rawData)
        ? normalizeExportEntity(e.type, rawData, e.kind, e.scope, e.perspective)
        : {
          data: rawData,
          kind: e.kind || undefined,
          scope: e.scope || undefined,
          perspective: e.perspective || undefined,
        };

      entities.push({
        id: e.id,
        type: e.type,
        kind: normalized.kind,
        scope: normalized.scope,
        perspective: normalized.perspective,
        data: normalized.data,
        metadata: {
          root_id: e.root_id,
          source_repo: e.source_repo || undefined,
          status: e.status,
          content_hash: e.content_hash,
          created_at: e.created_at,
          updated_at: e.updated_at,
        },
        requirement_id: e.requirement_id === '' ? null : e.requirement_id,
      });
      index += 1;
      reportProgress('entities', index, rawEntities.length);
    }

    // 导出关系
    interface RawRelation {
      id: string;
      requirement_id: string | null;
      from_root_id: string;
      from_id: string;
      to_root_id: string;
      to_id: string;
      rel_type: string;
      status: string | null;
      properties: string | null;
    }

    const rawRelations = db.prepare(`
      SELECT
        id,
        requirement_id,
        IFNULL(from_root_id, '') as from_root_id,
        from_id,
        IFNULL(to_root_id, '') as to_root_id,
        to_id,
        rel_type,
        status,
        properties
      FROM relations
    `).all() as RawRelation[];

    const relations: ExportRelation[] = [];
    index = 0;
    for (const r of rawRelations) {
      relations.push({
        id: r.id,
        requirement_id: r.requirement_id === '' ? null : r.requirement_id,
        from_root_id: r.from_root_id,
        from_id: r.from_id,
        to_root_id: r.to_root_id,
        to_id: r.to_id,
        rel_type: r.rel_type,
        status: (r.status as ExportRelation['status']) || 'active',
        properties: r.properties ? JSON.parse(r.properties) : null,
      });
      index += 1;
      reportProgress('relations', index, rawRelations.length);
    }

    // 导出 feats（包含 checklist）
    interface RawFeat {
      id: string;
      status: string;
      title: string | null;
      description: string | null;
      created_by: string | null;
      checklist: string | null;
      created_at: string;
      updated_at: string;
    }

    const rawFeats = db.prepare(`
      SELECT id, status, title, description, created_by, checklist, created_at, updated_at
      FROM feats
    `).all() as RawFeat[];

    const feats: ExportFeat[] = [];
    index = 0;
    for (const f of rawFeats) {
      feats.push({
        id: f.id,
        status: f.status,
        title: f.title || undefined,
        description: f.description || undefined,
        created_by: f.created_by || undefined,
        checklist: f.checklist ? JSON.parse(f.checklist) : undefined,
        created_at: f.created_at,
        updated_at: f.updated_at,
      });
      index += 1;
      reportProgress('feats', index, rawFeats.length);
    }

    const exportData: ExportData = {
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      entities,
      relations,
      feats,
    };

    // 写入文件
    const outputDir = dirname(options.output);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    reportProgress('write', 0, 1);
    const jsonContent = JSON.stringify(exportData, null, 2);

    if (options.compress !== false) {
      // 压缩输出
      const gzipPath = options.output.endsWith('.gz')
        ? options.output
        : `${options.output}.gz`;

      await pipeline(Readable.from(jsonContent), createGzip(), createWriteStream(gzipPath));

      reportProgress('done', 1, 1);
      return {
        success: true,
        output: gzipPath,
        stats: {
          entities: entities.length,
          relations: relations.length,
          feats: feats.length,
          vectors: 0,
        },
        size: Buffer.byteLength(jsonContent),
      };
    }

    await writeFile(options.output, jsonContent, 'utf-8');

    reportProgress('done', 1, 1);
    return {
      success: true,
      output: options.output,
      stats: {
        entities: entities.length,
        relations: relations.length,
        feats: feats.length,
        vectors: 0,
      },
      size: Buffer.byteLength(jsonContent),
    };
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

async function loadCheckpoint(options: MigrateOptions | undefined): Promise<MigrationCheckpoint | null> {
  const checkpoint = options?.checkpoint;
  if (!checkpoint?.path || checkpoint.resume !== true) return null;
  if (!existsSync(checkpoint.path)) return null;
  try {
    const content = await readFile(checkpoint.path, 'utf-8');
    const parsed = JSON.parse(content) as MigrationCheckpoint;
    return parsed ?? null;
  } catch {
    return null;
  }
}

async function saveCheckpoint(
  options: MigrateOptions | undefined,
  checkpoint: MigrationCheckpoint
): Promise<void> {
  if (!options?.checkpoint?.path) return;
  await writeFile(options.checkpoint.path, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

function normalizePermissionResult(result: PermissionCheckResult | boolean): PermissionCheckResult {
  if (typeof result === 'boolean') {
    return { allowed: result };
  }
  return result;
}

function shouldFailFast(options: MigrateOptions | undefined): boolean {
  return options?.failFast === true;
}

async function rollbackEntities(
  serverAdapter: ServerAdapter,
  items: Array<{ id: string; requirement_id?: string | null }>
): Promise<void> {
  for (const item of items) {
    try {
      await serverAdapter.delete({ id: item.id, requirement_id: item.requirement_id ?? null, force: true });
    } catch {
      // 忽略回滚失败，避免阻断主流程
    }
  }
}

function ensureServerError(error: unknown): MigrationError {
  if (error instanceof MigrationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new MigrationError('C4A-MIGRATE-004', message);
}

async function resolvePermission(
  entity: ExportEntity,
  options: MigrateOptions | undefined
): Promise<PermissionCheckResult> {
  if (!options?.permissionChecker) {
    return { allowed: true };
  }
  const result = await options.permissionChecker({ entity, target: 'server' });
  return normalizePermissionResult(result);
}

function buildConflictSummary(
  conflicts: Array<{
    id: string;
    reason: string;
    resolution: string;
    target_type?: string;
    target_status?: string;
  }>
): MigrateResult['conflict_summary'] {
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

export async function migrateLocalToServer(
  backupPath: string,
  serverAdapter: ServerAdapter,
  options: MigrateOptions = {}
): Promise<MigrateResult> {
  const conflictPolicy = options.conflictPolicy ?? 'skip';
  const permissionPolicy = options.permissionPolicy ?? 'error';
  const checkpointState = await loadCheckpoint(options);
  const saveInterval = options.checkpoint?.saveInterval ?? 50;
  const failures: MigrateFailure[] = [];
  const conflicts: NonNullable<MigrateResult['conflicts']> = [];
  const createdEntities: Array<{ id: string; requirement_id?: string | null }> = [];

  reportMigrationProgress(options, 'read', 0, 1);
  const backup = await readBackupData(backupPath);
  reportMigrationProgress(options, 'read', 1, 1);

  const stats = {
    feats: { created: 0, updated: 0, skipped: 0, failed: 0 },
    entities: { created: 0, updated: 0, skipped: 0, failed: 0 },
    relations: { created: 0, skipped: 0, failed: 0 },
  };

  const checkpoint: MigrationCheckpoint = {
    entities_index: checkpointState?.entities_index ?? 0,
    relations_index: checkpointState?.relations_index ?? 0,
    feats_index: checkpointState?.feats_index ?? 0,
    phase: checkpointState?.phase ?? 'read',
  };

  try {
    if (backup.feats.length > 0) {
      for (let i = checkpoint.feats_index ?? 0; i < backup.feats.length; i += 1) {
        checkpoint.phase = 'feats';
        const feat = backup.feats[i];
        let skipFurther = false;
        try {
          const createResult = await serverAdapter.featLifecycle({
            action: 'create',
            feat_id: feat.id,
            metadata: {
              title: feat.title ?? feat.id,
              description: feat.description ?? '',
              created_by: feat.created_by ?? 'unknown',
            },
          });

          if (!createResult.success) {
            if (createResult.error === 'FEAT_EXISTS') {
              if (conflictPolicy === 'error') {
                throw new Error(`Conflict detected for feat ${feat.id}`);
              }
              if (conflictPolicy === 'override') {
                await serverAdapter.featLifecycle({ action: 'delete', feat_id: feat.id });
                await serverAdapter.featLifecycle({
                  action: 'create',
                  feat_id: feat.id,
                  metadata: {
                    title: feat.title ?? feat.id,
                    description: feat.description ?? '',
                    created_by: feat.created_by ?? 'unknown',
                  },
                });
                stats.feats.updated += 1;
                conflicts.push({
                  id: `feat:${feat.id}`,
                  reason: 'feat_exists',
                  resolution: 'overridden',
                  target_type: 'feat',
                  target_status: feat.status,
                });
              } else {
                stats.feats.skipped += 1;
                conflicts.push({
                  id: `feat:${feat.id}`,
                  reason: 'feat_exists',
                  resolution: 'skipped',
                  target_type: 'feat',
                  target_status: feat.status,
                });
                skipFurther = true;
              }
            } else {
              throw new Error(createResult.message ?? createResult.error ?? '创建 feat 失败');
            }
          } else {
            stats.feats.created += 1;
          }

          if (!skipFurther) {
            if (feat.status && feat.status !== 'draft') {
              await transitionFeatStatus(serverAdapter, feat.id, feat.status);
            }
            await applyChecklist(serverAdapter, feat);
          }
        } catch (error) {
          stats.feats.failed += 1;
          failures.push({ id: feat.id, phase: 'feats', error: (error as Error).message });
          if (shouldFailFast(options)) {
            throw error;
          }
        }
        checkpoint.feats_index = i + 1;
        reportMigrationProgress(options, 'feats', i + 1, backup.feats.length);
        if ((i + 1) % saveInterval === 0) {
          checkpoint.updated_at = new Date().toISOString();
          await saveCheckpoint(options, checkpoint);
        }
      }
    }

    for (let i = checkpoint.entities_index ?? 0; i < backup.entities.length; i += 1) {
      checkpoint.phase = 'entities';
      const entity = backup.entities[i];
      try {
        const permission = await resolvePermission(entity, options);
        if (!permission.allowed) {
          const message = permission.reason ?? '权限不足';
          const error = new MigrationError('C4A-MIGRATE-003', message, {
            entity_id: entity.id,
            code: permission.code,
          });
          if (permissionPolicy === 'error') {
            throw error;
          }
          stats.entities.skipped += 1;
          failures.push({ id: entity.id, phase: 'entities', error: message });
          reportMigrationProgress(options, 'permissions', i + 1, backup.entities.length);
          continue;
        }

        const existing = await serverAdapter.read({
          id: entity.id,
          requirement_id: entity.requirement_id ?? null,
          format: 'object',
        });

        const existingEntity = (existing && 'entity' in existing ? existing.entity : null) ?? null;

        if (existingEntity) {
          const incomingHash = entity.metadata.content_hash;
          if (incomingHash && existingEntity.metadata?.content_hash === incomingHash) {
            stats.entities.skipped += 1;
            conflicts.push({
              id: entity.id,
              reason: 'hash_match',
              resolution: 'skipped',
              target_type: entity.type,
              target_status: entity.metadata.status,
            });
            continue;
          }

          if (conflictPolicy === 'error') {
            throw new Error(`Conflict detected for entity ${entity.id}`);
          }

          if (conflictPolicy === 'skip') {
            stats.entities.skipped += 1;
            conflicts.push({
              id: entity.id,
              reason: 'hash_mismatch',
              resolution: 'skipped',
              target_type: entity.type,
              target_status: entity.metadata.status,
            });
            continue;
          }

          if (conflictPolicy === 'merge') {
            const incomingTime = new Date(entity.metadata.updated_at).getTime();
            const existingTime = new Date(existingEntity.metadata.updated_at).getTime();
            if (!Number.isNaN(existingTime) && incomingTime <= existingTime) {
              stats.entities.skipped += 1;
              conflicts.push({
                id: entity.id,
                reason: 'existing_newer',
                resolution: 'skipped',
                target_type: entity.type,
                target_status: entity.metadata.status,
              });
              continue;
            }
            conflicts.push({
              id: entity.id,
              reason: 'backup_newer',
              resolution: 'overridden',
              target_type: entity.type,
              target_status: entity.metadata.status,
            });
          } else {
            conflicts.push({
              id: entity.id,
              reason: 'hash_mismatch',
              resolution: 'overridden',
              target_type: entity.type,
              target_status: entity.metadata.status,
            });
          }
        }

        const saveResult = await serverAdapter.save({
          id: entity.id,
          type: entity.type,
          data: buildEntityPayload(entity),
          root_id: entity.metadata.root_id,
          requirement_id: entity.requirement_id ?? null,
          force_save: true,
          ignore_concurrent_warning: true,
        });

        if (!saveResult.success) {
          throw new Error(saveResult.error?.message ?? '保存失败');
        }

        if (existingEntity) {
          stats.entities.updated += 1;
        } else {
          stats.entities.created += 1;
          createdEntities.push({ id: entity.id, requirement_id: entity.requirement_id ?? null });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stats.entities.failed += 1;
        failures.push({ id: entity.id, phase: 'entities', error: message });
        if (shouldFailFast(options)) {
          throw error;
        }
      }

      checkpoint.entities_index = i + 1;
      reportMigrationProgress(options, 'entities', i + 1, backup.entities.length);
      if ((i + 1) % saveInterval === 0) {
        checkpoint.updated_at = new Date().toISOString();
        await saveCheckpoint(options, checkpoint);
      }
    }

    if (backup.relations.length > 0) {
      for (let i = checkpoint.relations_index ?? 0; i < backup.relations.length; i += 1) {
        checkpoint.phase = 'relations';
        const relation = backup.relations[i];
        try {
          if ('saveRelation' in serverAdapter && typeof (serverAdapter as ServerAdapter & { saveRelation?: unknown }).saveRelation === 'function') {
            await (serverAdapter as ServerAdapter & { saveRelation: (rel: ExportRelation) => Promise<void> }).saveRelation(
              relation
            );
            stats.relations.created += 1;
          } else {
            stats.relations.skipped += 1;
          }
        } catch (error) {
          stats.relations.failed += 1;
          failures.push({ id: relation.id ?? `${relation.from_id}-${relation.rel_type}-${relation.to_id}`, phase: 'relations', error: (error as Error).message });
          if (shouldFailFast(options)) {
            throw error;
          }
        }
        checkpoint.relations_index = i + 1;
        reportMigrationProgress(options, 'relations', i + 1, backup.relations.length);
        if ((i + 1) % saveInterval === 0) {
          checkpoint.updated_at = new Date().toISOString();
          await saveCheckpoint(options, checkpoint);
        }
      }
    }

    checkpoint.phase = 'done';
    checkpoint.updated_at = new Date().toISOString();
    await saveCheckpoint(options, checkpoint);
  } catch (error) {
    if (options.rollbackOnFailure) {
      reportMigrationProgress(options, 'rollback', createdEntities.length, createdEntities.length);
      await rollbackEntities(serverAdapter, createdEntities);
    }
    throw ensureServerError(error);
  }

  const conflictSummary = buildConflictSummary(conflicts);
  return {
    success: failures.length === 0,
    stats,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    conflict_summary: conflictSummary,
    failures: failures.length > 0 ? failures : undefined,
    checkpoint,
  };
}
