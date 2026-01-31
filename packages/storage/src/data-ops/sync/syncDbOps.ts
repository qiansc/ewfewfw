import { writeFileSync } from 'node:fs';
import type { EntityType } from '../../adapter.js';
import type { DataOpsContext } from '../types.js';
import type {
  ConflictInfo,
  DbEntityInfo,
  ExportFormat,
  FileEntityInfo,
  SyncDetail,
  SyncStats,
} from './types.js';
import { detectConflicts } from './conflictDetector.js';
import {
  buildEntityFilePath,
  ensureDir,
  readFileEntityData,
  stringifyEntity,
} from './syncFileOps.js';
import { decideDirection, extractEntityMeta, isExcludedType, safeParseJson } from './syncUtils.js';

export function syncDbToFile(params: {
  ctx: DataOpsContext;
  dbEntities: DbEntityInfo[];
  fileMap: Map<string, FileEntityInfo>;
  contextRoot: string;
  mode: 'incremental' | 'full';
  format: ExportFormat;
  featId: string | null;
  stats: SyncStats;
  warnings: string[];
  details: SyncDetail[];
}): void {
  for (const entity of params.dbEntities) {
    if (isExcludedType(entity.type)) {
      params.stats.skipped++;
      continue;
    }

    const path = buildEntityFilePath(entity, params.contextRoot, params.format, params.featId);
    if (!path) {
      params.stats.failed++;
      params.details.push({
        entity_id: entity.id,
        action: 'failed',
        error: '无法计算文件路径',
      });
      continue;
    }

    const fileInfo = params.fileMap.get(entity.id);
    const decision = shouldWriteFile(entity, fileInfo, params.mode);

    if (decision === 'skip') {
      params.stats.skipped++;
      params.details.push({ entity_id: entity.id, action: 'skipped', path });
      continue;
    }

    const content = stringifyEntity(entity.data ?? {}, params.format);
    try {
      ensureDir(path);
      writeFileSync(path, content, 'utf-8');
      if (fileInfo) {
        params.stats.updated++;
        params.details.push({ entity_id: entity.id, action: 'updated', path });
      } else {
        params.stats.created++;
        params.details.push({ entity_id: entity.id, action: 'created', path });
      }
    } catch (error) {
      params.stats.failed++;
      params.details.push({
        entity_id: entity.id,
        action: 'failed',
        path,
        error: String(error),
      });
    }
  }
}

export function syncFileToDb(params: {
  ctx: DataOpsContext;
  fileEntities: FileEntityInfo[];
  dbMap: Map<string, DbEntityInfo>;
  stats: SyncStats;
  warnings: string[];
  details: SyncDetail[];
  featId: string | null;
}): void {
  for (const file of params.fileEntities) {
    if (isExcludedType(file.type)) {
      params.stats.skipped++;
      continue;
    }

    const dbEntity = params.dbMap.get(file.id);
    if (!dbEntity) {
      const now = file.mtime ?? new Date().toISOString();
      const data = readFileEntityData(file.path);
      if (!data) {
        params.stats.failed++;
        params.details.push({
          entity_id: file.id,
          action: 'failed',
          path: file.path,
          error: '无法解析文件内容',
        });
        continue;
      }

      const meta = extractEntityMeta(data);
      try {
        params.ctx.storage.insertEntity({
          entityId: file.id,
          sourceProject: params.ctx.config.defaultProject,
          entityType: file.type,
          data,
          contentHash: file.content_hash,
          proposalId: params.featId ?? null,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          entityKind: meta.kind ?? null,
          entityScope: meta.scope ?? null,
          entityPerspective: meta.perspective ?? null,
        });
        params.stats.created++;
        params.details.push({ entity_id: file.id, action: 'created', path: file.path });
      } catch (error) {
        params.stats.failed++;
        params.details.push({
          entity_id: file.id,
          action: 'failed',
          path: file.path,
          error: String(error),
        });
      }
      continue;
    }

    if (dbEntity.type !== file.type) {
      params.warnings.push(`实体 ${file.id} 类型不一致，忽略本地修改`);
      params.stats.skipped++;
      continue;
    }

    if (dbEntity.content_hash === file.content_hash) {
      params.stats.skipped++;
      continue;
    }

    params.warnings.push(`实体 ${file.id} 已存在于数据库，忽略本地修改`);
    params.stats.skipped++;
  }
}

export function syncBidirectional(params: {
  ctx: DataOpsContext;
  dbMap: Map<string, DbEntityInfo>;
  fileMap: Map<string, FileEntityInfo>;
  allIds: Set<string>;
  contextRoot: string;
  format: ExportFormat;
  featId: string | null;
  stats: SyncStats;
  conflicts: ConflictInfo[];
  warnings: string[];
  details: SyncDetail[];
}): void {
  const dbEntities = Array.from(params.dbMap.values());
  const fileEntities = Array.from(params.fileMap.values());
  const detectedConflicts = detectConflicts(dbEntities, fileEntities);
  const conflictMap = new Map<string, ConflictInfo>();
  for (const conflict of detectedConflicts) {
    conflictMap.set(conflict.entity_id, conflict);
  }

  for (const entityId of params.allIds) {
    const dbEntity = params.dbMap.get(entityId);
    const fileEntity = params.fileMap.get(entityId);

    if (dbEntity && isExcludedType(dbEntity.type)) {
      params.stats.skipped++;
      continue;
    }
    if (fileEntity && isExcludedType(fileEntity.type)) {
      params.stats.skipped++;
      continue;
    }

    if (!dbEntity && fileEntity) {
      const now = fileEntity.mtime ?? new Date().toISOString();
      const data = readFileEntityData(fileEntity.path);
      if (!data) {
        params.stats.failed++;
        params.details.push({
          entity_id: fileEntity.id,
          action: 'failed',
          path: fileEntity.path,
          error: '无法解析文件内容',
        });
        continue;
      }

      const meta = extractEntityMeta(data);
      try {
        params.ctx.storage.insertEntity({
          entityId: fileEntity.id,
          sourceProject: params.ctx.config.defaultProject,
          entityType: fileEntity.type,
          data,
          contentHash: fileEntity.content_hash,
          proposalId: params.featId ?? null,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          entityKind: meta.kind ?? null,
          entityScope: meta.scope ?? null,
          entityPerspective: meta.perspective ?? null,
        });
        params.stats.created++;
        params.details.push({
          entity_id: fileEntity.id,
          action: 'created',
          path: fileEntity.path,
        });
      } catch (error) {
        params.stats.failed++;
        params.details.push({
          entity_id: fileEntity.id,
          action: 'failed',
          path: fileEntity.path,
          error: String(error),
        });
      }
      continue;
    }

    if (dbEntity && !fileEntity) {
      const path = buildEntityFilePath(dbEntity, params.contextRoot, params.format, params.featId);
      if (!path) {
        params.stats.failed++;
        params.details.push({
          entity_id: dbEntity.id,
          action: 'failed',
          error: '无法计算文件路径',
        });
        continue;
      }

      const content = stringifyEntity(dbEntity.data ?? {}, params.format);
      try {
        ensureDir(path);
        writeFileSync(path, content, 'utf-8');
        params.stats.created++;
        params.details.push({ entity_id: dbEntity.id, action: 'created', path });
      } catch (error) {
        params.stats.failed++;
        params.details.push({
          entity_id: dbEntity.id,
          action: 'failed',
          path,
          error: String(error),
        });
      }
      continue;
    }

    if (!dbEntity || !fileEntity) {
      continue;
    }

    const conflict = conflictMap.get(entityId);
    if (conflict && conflict.conflict_type === 'type') {
      params.conflicts.push(conflict);
      params.stats.conflicted++;
      continue;
    }

    if (dbEntity.content_hash === fileEntity.content_hash) {
      params.stats.skipped++;
      continue;
    }

    const decision = decideDirection(dbEntity.updated_at, fileEntity.mtime);
    if (decision === 'file') {
      const data = readFileEntityData(fileEntity.path);
      if (!data) {
        params.stats.failed++;
        params.details.push({
          entity_id: fileEntity.id,
          action: 'failed',
          path: fileEntity.path,
          error: '无法解析文件内容',
        });
        continue;
      }

      try {
        params.ctx.storage.updateEntity({
          entityId: fileEntity.id,
          sourceProject: params.ctx.config.defaultProject,
          proposalId: params.featId ?? null,
          entityType: fileEntity.type,
          data,
          contentHash: fileEntity.content_hash,
          updatedAt: fileEntity.mtime ?? new Date().toISOString(),
        });
        params.stats.updated++;
        params.details.push({
          entity_id: fileEntity.id,
          action: 'updated',
          path: fileEntity.path,
        });
      } catch (error) {
        params.stats.failed++;
        params.details.push({
          entity_id: fileEntity.id,
          action: 'failed',
          path: fileEntity.path,
          error: String(error),
        });
      }
      continue;
    }

    if (decision === 'db') {
      const path = buildEntityFilePath(dbEntity, params.contextRoot, params.format, params.featId);
      if (!path) {
        params.stats.failed++;
        params.details.push({
          entity_id: dbEntity.id,
          action: 'failed',
          error: '无法计算文件路径',
        });
        continue;
      }

      const content = stringifyEntity(dbEntity.data ?? {}, params.format);
      try {
        ensureDir(path);
        writeFileSync(path, content, 'utf-8');
        params.stats.updated++;
        params.details.push({ entity_id: dbEntity.id, action: 'updated', path });
      } catch (error) {
        params.stats.failed++;
        params.details.push({
          entity_id: dbEntity.id,
          action: 'failed',
          path,
          error: String(error),
        });
      }
      continue;
    }

    params.conflicts.push({
      entity_id: entityId,
      conflict_type: 'content',
      db_hash: dbEntity.content_hash,
      file_hash: fileEntity.content_hash,
      db_updated_at: dbEntity.updated_at,
      file_mtime: fileEntity.mtime,
      file_path: fileEntity.path,
      reason: '双方均有修改，无法自动判断方向',
    });
    params.stats.conflicted++;
  }
}

export function loadDbEntities(
  ctx: DataOpsContext,
  params: { statusFilter: 'published' | 'approved' | 'all'; featId: string | null }
): DbEntityInfo[] {
  if (params.featId) {
    const entities = ctx.storage.listFeatEntitiesForMerge(params.featId);
    return entities.map((entity) => ({
      id: entity.id,
      type: entity.type as EntityType,
      data: safeParseJson(entity.data),
      status: entity.status,
      content_hash: entity.content_hash,
      updated_at: entity.updated_at,
    }));
  }

  const entities = ctx.storage.listEntitiesForExport({ statusFilter: params.statusFilter });
  return entities.map((entity) => ({
    id: entity.id,
    type: entity.type,
    data: safeParseJson(entity.data),
    status: entity.status,
    content_hash: entity.content_hash,
    updated_at: entity.updated_at,
  }));
}

function shouldWriteFile(
  entity: DbEntityInfo,
  fileInfo: FileEntityInfo | undefined,
  mode: 'incremental' | 'full'
): 'skip' | 'write' {
  if (!fileInfo) {
    return 'write';
  }
  if (mode === 'full') {
    return 'write';
  }
  if (!fileInfo.mtime || !entity.updated_at) {
    return fileInfo.content_hash === entity.content_hash ? 'skip' : 'write';
  }
  const fileTime = Date.parse(fileInfo.mtime);
  const dbTime = Date.parse(entity.updated_at);
  if (Number.isNaN(fileTime) || Number.isNaN(dbTime)) {
    return fileInfo.content_hash === entity.content_hash ? 'skip' : 'write';
  }
  if (fileTime <= dbTime) {
    return 'write';
  }
  return fileInfo.content_hash === entity.content_hash ? 'skip' : 'write';
}
