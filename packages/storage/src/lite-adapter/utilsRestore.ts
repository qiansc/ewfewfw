/**
 * LiteAdapter Restore 操作
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { RestoreParams, RestoreResult, RestoreConflict } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { checkCompatibility, computeChecksum } from './utilsCommon.js';

type BackupRelation = {
  id?: string | null;
  from_project?: string | null;
  from_id: string;
  to_project?: string | null;
  to_id: string;
  rel_type: string;
};

function extractTarPayload(buffer: Buffer): string | null {
  if (buffer.length < 512) return null;
  const magic = buffer.subarray(257, 262).toString('utf-8');
  if (magic !== 'ustar') return null;
  const sizeText = buffer.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim();
  const size = parseInt(sizeText || '0', 8);
  const start = 512;
  const end = start + size;
  if (end > buffer.length) return null;
  return buffer.subarray(start, end).toString('utf-8');
}

// ============================================================
// Restore 操作
// ============================================================

/**
 * 恢复数据
 * 设计文档: store-utils.md §3.14
 *
 * P2-3.1: 支持读取 tar.gz 和 json 两种格式
 * 自动检测文件格式（通过 gzip magic number）
 */
export async function restore(
  ctx: AdapterContext,
  params: RestoreParams
): Promise<RestoreResult> {
  const db = ctx.store.getDatabase();
  const conflictPolicy = params.conflict_policy ?? 'skip';

  try {
    // 读取备份文件
    const fileContent = readFileSync(params.input);

    // P2-3.1: 自动检测格式（gzip magic number: 0x1f 0x8b）
    let content: string;
    if (fileContent[0] === 0x1f && fileContent[1] === 0x8b) {
      // gzip 压缩格式
      const decompressed = gunzipSync(fileContent);
      const tarPayload = extractTarPayload(decompressed);
      content = tarPayload ?? decompressed.toString('utf-8');
    } else {
      const tarPayload = extractTarPayload(fileContent);
      content = tarPayload ?? fileContent.toString('utf-8');
    }

    const backupData = JSON.parse(content) as {
      version: string;
      format_version: string;
      entities: Array<{
        id: string;
        type: string;
        source_project: string;
        status: string;
        data: Record<string, unknown>;
        metadata?: {
          content_hash: string;
          created_at: string;
          updated_at: string;
        };
      }>;
      relations: BackupRelation[];
      checksums?: {
        entities: string;
        relations: string;
      };
    };

    // 版本兼容性检查
    const compatible = checkCompatibility(backupData.version, '0.3.0');
    if (!compatible) {
      return {
        success: false,
        format_version: backupData.format_version,
        compatible: false,
        error: `备份版本 ${backupData.version} 与当前版本 0.3.0 不兼容`,
      };
    }

    // 校验和验证
    if (params.validate_checksums !== false && backupData.checksums) {
      const entitiesChecksum = computeChecksum(JSON.stringify(backupData.entities));
      if (entitiesChecksum !== backupData.checksums.entities) {
        return {
          success: false,
          format_version: backupData.format_version,
          compatible: true,
          error: '实体数据校验和不匹配',
        };
      }
      const relationsChecksum = computeChecksum(JSON.stringify(backupData.relations));
      if (relationsChecksum !== backupData.checksums.relations) {
        return {
          success: false,
          format_version: backupData.format_version,
          compatible: true,
          error: '关系数据校验和不匹配',
        };
      }
    }

    const conflicts: RestoreConflict[] = [];
    let entitiesRestored = 0;
    let relationsRestored = 0;

    const now = new Date().toISOString();

    // 恢复实体
    for (const entity of backupData.entities) {
      // 检查是否存在
      const existing = db.prepare(`
        SELECT content_hash, updated_at FROM metadata
        WHERE source_project = ? AND entity_id = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).get(entity.source_project, entity.id) as {
        content_hash: string;
        updated_at: string;
      } | undefined;

      if (existing) {
        // 处理冲突
        if (conflictPolicy === 'error') {
          return {
            success: false,
            format_version: backupData.format_version,
            compatible: true,
            error: `实体 ${entity.id} 已存在`,
          };
        }

        if (conflictPolicy === 'skip') {
          conflicts.push({
            entity_id: entity.id,
            reason: '实体已存在',
            resolution: 'skipped',
          });
          continue;
        }

        if (conflictPolicy === 'merge') {
          // 比较更新时间，保留较新的
          const backupTime = entity.metadata?.updated_at || '';
          if (backupTime <= existing.updated_at) {
            conflicts.push({
              entity_id: entity.id,
              reason: '本地版本较新',
              resolution: 'kept_local',
            });
            continue;
          }
        }
        // override: 继续覆盖
      }

      // 计算 content_hash
      const contentHash = entity.metadata?.content_hash || computeChecksum(JSON.stringify(entity.data));

      // 插入/更新实体
      db.prepare(`
        INSERT INTO entities (id, source_project, proposal_id, type, data)
        VALUES (?, ?, '', ?, ?)
        ON CONFLICT (source_project, id, proposal_id) DO UPDATE SET
          type = excluded.type,
          data = excluded.data
      `).run(entity.id, entity.source_project, entity.type, JSON.stringify(entity.data));

      // 插入/更新元数据
      db.prepare(`
        INSERT INTO metadata (entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at)
        VALUES (?, ?, '', ?, ?, ?, ?)
        ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
          status = excluded.status,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `).run(
        entity.id,
        entity.source_project,
        entity.status,
        contentHash,
        entity.metadata?.created_at || now,
        now
      );

      entitiesRestored++;
    }

    // 恢复关系（简化处理）
    for (const relation of backupData.relations) {
      const relationId = relation.id ?? null;
      const fromProject = relation.from_project ?? null;
      const toProject = relation.to_project ?? null;
      try {
        db.prepare(`
          INSERT OR IGNORE INTO relations (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, created_at, updated_at)
          VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          relationId,
          fromProject,
          relation.from_id,
          toProject,
          relation.to_id,
          relation.rel_type,
          now,
          now
        );
        relationsRestored++;
      } catch {
        // 忽略关系恢复错误
      }
    }

    return {
      success: true,
      format_version: backupData.format_version,
      compatible: true,
      stats: {
        entities: entitiesRestored,
        relations: relationsRestored,
        vectors: 0,
      },
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
