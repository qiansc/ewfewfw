/**
 * LiteAdapter Backup 操作
 */

import { writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { BackupParams, BackupResult } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { computeChecksum } from './utilsCommon.js';

// ============================================================
// Backup 操作
// ============================================================

/**
 * 备份格式版本
 */
const BACKUP_FORMAT_VERSION = '1.0';

/**
 * 备份数据
 * 设计文档: store-utils.md §3.13
 *
 * P2-3.1: 支持 tar.gz 和 json 两种格式
 * - tar.gz: 默认格式，使用 gzip 压缩
 * - json: 纯 JSON 格式，便于调试
 */
export async function backup(
  ctx: AdapterContext,
  params: BackupParams
): Promise<BackupResult> {
  const db = ctx.store.getDatabase();
  const statusFilter = params.status_filter ?? 'published';
  const format = params.format ?? 'tar.gz';

  try {
    // 构建状态过滤条件
    let statusCondition = '';
    if (statusFilter === 'published') {
      statusCondition = "WHERE m.status = 'published'";
    } else if (statusFilter === 'approved') {
      statusCondition = "WHERE m.status IN ('published', 'approved')";
    }
    // 'all' 不需要条件

    // 查询实体
    const entities = db.prepare(`
      SELECT e.id, e.type, e.source_project, e.data,
             m.status, m.content_hash, m.created_at, m.updated_at
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      ${statusCondition}
    `).all() as Array<{
      id: string;
      type: string;
      source_project: string;
      data: string;
      status: string;
      content_hash: string;
      created_at: string;
      updated_at: string;
    }>;

    // 查询关系
    const relations = db.prepare(`
      SELECT * FROM relations WHERE proposal_id IS NULL OR proposal_id = ''
    `).all();

    const vectorCount = ctx.store.getVectorStore()?.size() ?? 0;

    // 构建备份数据
    const backupData = {
      version: '0.3.0',
      format_version: BACKUP_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      source: {
        mode: 'local',
        project_id: ctx.config.defaultProject,
      },
      entities: entities.map(e => ({
        id: e.id,
        type: e.type,
        source_project: e.source_project,
        status: e.status,
        data: JSON.parse(e.data),
        metadata: params.include_metadata !== false ? {
          content_hash: e.content_hash,
          created_at: e.created_at,
          updated_at: e.updated_at,
        } : undefined,
      })),
      relations,
      checksums: {
        entities: computeChecksum(JSON.stringify(entities)),
        relations: computeChecksum(JSON.stringify(relations)),
      },
    };

    // 序列化为 JSON
    const jsonContent = JSON.stringify(backupData, null, 2);

    // 根据格式写入文件
    if (format === 'tar.gz') {
      // P2-3.1: 使用 gzip 压缩
      // 注意：这是简化的实现，实际 tar.gz 需要 tar 归档 + gzip 压缩
      // 这里我们直接对 JSON 进行 gzip 压缩，文件扩展名为 .json.gz
      const compressed = gzipSync(Buffer.from(jsonContent, 'utf-8'));
      writeFileSync(params.output, compressed);
    } else {
      // json 格式：直接写入
      writeFileSync(params.output, jsonContent, 'utf-8');
    }

    const stats = statSync(params.output);

    return {
      success: true,
      file: params.output,
      size: stats.size,
      format_version: BACKUP_FORMAT_VERSION,
      stats: {
        entities: entities.length,
        relations: relations.length,
        vectors: vectorCount,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
