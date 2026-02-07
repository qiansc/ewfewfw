/**
 * LiteAdapter Restore 操作
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { RestoreParams, RestoreResult, RestoreConflict } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { checkCompatibility, computeChecksum } from './utilsCommon.js';

type BackupRelation = {
  id?: string | null;
  from_root_id?: string | null;
  from_id: string;
  to_root_id?: string | null;
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
        uuid?: string;
        root_id?: string;
        id: string;
        type: string;
        requirement_id?: string | null;
        component_id?: string | null;
        versions?: string[];
        status?: string;
        data: Record<string, unknown>;
        metadata?: {
          content_hash?: string;
          created_at?: string;
          updated_at?: string;
        };
      }>;
      relations: Array<BackupRelation & {
        from_uuid?: string | null;
        to_uuid?: string | null;
        from_root_id?: string | null;
        to_root_id?: string | null;
        status?: string;
        properties?: Record<string, unknown> | null;
      }>;
      checksums?: {
        entities: string;
        relations: string;
      };
    };

    // 版本兼容性检查
    const compatible = checkCompatibility(backupData.version, '0.3.1');
    if (!compatible) {
      return {
        success: false,
        format_version: backupData.format_version,
        compatible: false,
        error: `备份版本 ${backupData.version} 与当前版本 0.3.1 不兼容`,
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
    let vectorsRebuilt = 0;

    const now = new Date().toISOString();

    // 恢复实体
    for (const entity of backupData.entities) {
      // 检查是否存在
      const rootId = entity.root_id ?? entity.root_id ?? ctx.config.defaultProject;
      const requirementId = entity.requirement_id ?? null;
      const existing = entity.uuid
        ? (db.prepare(`
            SELECT m.content_hash, m.updated_at, e.uuid
            FROM entities e
            JOIN metadata m ON e.uuid = m.entity_uuid
            WHERE e.uuid = ?
            LIMIT 1
          `).get(entity.uuid) as { content_hash: string; updated_at: string; uuid: string } | undefined)
        : (db.prepare(`
            SELECT m.content_hash, m.updated_at, e.uuid
            FROM entities e
            JOIN metadata m ON e.uuid = m.entity_uuid
            WHERE e.root_id = ? AND e.id = ? AND ${
              requirementId ? 'e.requirement_id = ?' : "(e.requirement_id IS NULL OR e.requirement_id = '')"
            }
            LIMIT 1
          `).get(
            ...(requirementId ? [rootId, entity.id, requirementId] : [rootId, entity.id])
          ) as { content_hash: string; updated_at: string; uuid: string } | undefined);

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
      const createdAt = entity.metadata?.created_at || now;
      const updatedAt = entity.metadata?.updated_at || now;
      const uuid = entity.uuid ?? existing?.uuid ?? randomUUID();
      const versions = entity.versions && entity.versions.length > 0 ? entity.versions : ['0.0.0'];

      // 插入/更新实体
      db.prepare(`
        INSERT INTO entities (
          uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
        )
        VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 0, NULL)
        ON CONFLICT(uuid) DO UPDATE SET
          root_id = excluded.root_id,
          id = excluded.id,
          type = excluded.type,
          data = excluded.data,
          requirement_id = excluded.requirement_id,
          component_id = excluded.component_id
      `).run(
        uuid,
        rootId,
        entity.id,
        entity.type,
        JSON.stringify(entity.data),
        requirementId,
        entity.component_id ?? null
      );

      db.prepare(`
        INSERT INTO metadata (entity_uuid, status, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entity_uuid) DO UPDATE SET
          status = excluded.status,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `).run(
        uuid,
        entity.status ?? 'published',
        contentHash,
        createdAt,
        updatedAt
      );

      db.prepare(`DELETE FROM entity_versions WHERE entity_uuid = ?`).run(uuid);
      const insertVersion = db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`);
      for (const version of versions) {
        insertVersion.run(uuid, version);
      }

      entitiesRestored++;
    }

    // 恢复关系（简化处理）
    for (const relation of backupData.relations) {
      const relationId = relation.id ?? randomUUID();
      const fromRootId = relation.from_root_id ?? '';
      const toRootId = relation.to_root_id ?? '';
      const fromUuid =
        relation.from_uuid ??
        (db.prepare(`SELECT uuid FROM entities WHERE root_id = ? AND id = ? LIMIT 1`).get(
          fromRootId,
          relation.from_id
        ) as { uuid: string } | undefined)?.uuid;
      if (!fromUuid) {
        continue;
      }
      const toUuid =
        relation.to_uuid ??
        (db.prepare(`SELECT uuid FROM entities WHERE root_id = ? AND id = ? LIMIT 1`).get(
          toRootId,
          relation.to_id
        ) as { uuid: string } | undefined)?.uuid ??
        null;
      try {
        const result = db.prepare(`
          INSERT OR IGNORE INTO relations
            (id, from_uuid, to_uuid, from_root_id, from_id, to_root_id, to_id, rel_type, status, properties, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          relationId,
          fromUuid,
          toUuid,
          fromRootId,
          relation.from_id,
          toRootId,
          relation.to_id,
          relation.rel_type,
          relation.status ?? 'active',
          relation.properties ? JSON.stringify(relation.properties) : null,
          now,
          now
        );
        if (result.changes > 0) {
          relationsRestored++;
        }
      } catch {
        // 忽略关系恢复错误
      }
    }

    if (ctx.config.enableVectorSearch && ctx.store.isVectorSearchEnabled()) {
      try {
        const rebuild = await ctx.store.rebuildVectorIndex();
        vectorsRebuilt = rebuild.indexed;
      } catch {
        // 向量重建失败时保持为 0，避免影响恢复主流程
      }
    }

    return {
      success: true,
      format_version: backupData.format_version,
      compatible: true,
      stats: {
        entities: entitiesRestored,
        relations: relationsRestored,
        vectors: vectorsRebuilt,
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
