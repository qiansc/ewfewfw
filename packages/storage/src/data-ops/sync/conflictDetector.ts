import type { PlanSyncParams, PlanSyncResult } from '../../adapter.js';
import type { DataOpsContext } from '../types.js';
import type { ConflictInfo, DbEntityInfo, FileEntityInfo } from './types.js';
import { planSync } from './syncEngine.js';

/**
 * 同步冲突检测（数据库 ↔ 文件）
 */
export function detectConflicts(
  dbEntities: DbEntityInfo[],
  fileEntities: FileEntityInfo[]
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const dbMap = new Map<string, DbEntityInfo>();
  const fileMap = new Map<string, FileEntityInfo>();

  for (const entity of dbEntities) {
    dbMap.set(entity.id, entity);
  }

  for (const file of fileEntities) {
    if (fileMap.has(file.id)) {
      conflicts.push({
        entity_id: file.id,
        conflict_type: 'type',
        file_type: file.type,
        file_path: file.path,
        reason: '检测到重复的本地实体',
      });
      continue;
    }
    fileMap.set(file.id, file);
  }

  const allIds = new Set<string>([...dbMap.keys(), ...fileMap.keys()]);

  for (const entityId of allIds) {
    const db = dbMap.get(entityId);
    const file = fileMap.get(entityId);

    if (db && file) {
      const declaredType = file.declared_type ?? file.type;
      const pathType = file.path_type ?? file.type;
      const typeMismatch =
        db.type !== file.type || declaredType !== db.type || pathType !== db.type;

      if (typeMismatch) {
        conflicts.push({
          entity_id: entityId,
          conflict_type: 'type',
          db_type: db.type,
          file_type: file.type,
          file_path: file.path,
          reason: '实体类型不一致',
        });
        continue;
      }

      if (db.content_hash !== file.content_hash) {
        conflicts.push({
          entity_id: entityId,
          conflict_type: 'content',
          db_hash: db.content_hash,
          file_hash: file.content_hash,
          db_updated_at: db.updated_at,
          file_mtime: file.mtime,
          file_path: file.path,
          reason: '内容哈希不一致',
        });
      }
      continue;
    }

    if (db && !file) {
      conflicts.push({
        entity_id: entityId,
        conflict_type: 'deleted',
        missing_side: 'file',
        db_hash: db.content_hash,
        db_type: db.type,
        db_updated_at: db.updated_at,
        reason: '本地文件缺失',
      });
      continue;
    }

    if (file && !db) {
      conflicts.push({
        entity_id: entityId,
        conflict_type: 'deleted',
        missing_side: 'db',
        file_hash: file.content_hash,
        file_type: file.type,
        file_mtime: file.mtime,
        file_path: file.path,
        reason: '数据库不存在实体',
      });
    }
  }

  return conflicts;
}

/**
 * 同步冲突检测（Server/Remote 模式占位实现，复用 planSync）
 */
export async function detectSyncConflicts(
  ctx: DataOpsContext,
  params: PlanSyncParams
): Promise<PlanSyncResult> {
  return planSync(ctx, params);
}
