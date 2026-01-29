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

const TAR_BLOCK_SIZE = 512;

function writeOctal(value: number, length: number): string {
  const str = value.toString(8);
  return str.padStart(length - 1, '0') + '\0';
}

function buildTarHeader(filename: string, size: number, mtime: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  header.write(filename, 0, 100, 'utf-8');
  header.write(writeOctal(0o644, 8), 100, 8, 'utf-8');
  header.write(writeOctal(0, 8), 108, 8, 'utf-8');
  header.write(writeOctal(0, 8), 116, 8, 'utf-8');
  header.write(writeOctal(size, 12), 124, 12, 'utf-8');
  header.write(writeOctal(mtime, 12), 136, 12, 'utf-8');
  header.write('        ', 148, 8, 'utf-8');
  header.write('0', 156, 1, 'utf-8');
  header.write('ustar\0', 257, 6, 'utf-8');
  header.write('00', 263, 2, 'utf-8');

  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  const checksum = writeOctal(sum, 8);
  header.write(checksum, 148, 8, 'utf-8');
  return header;
}

function createTarArchive(filename: string, content: string): Buffer {
  const payload = Buffer.from(content, 'utf-8');
  const header = buildTarHeader(filename, payload.length, Math.floor(Date.now() / 1000));
  const padSize = (TAR_BLOCK_SIZE - (payload.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  const padding = Buffer.alloc(padSize, 0);
  const end = Buffer.alloc(TAR_BLOCK_SIZE * 2, 0);
  return Buffer.concat([header, payload, padding, end]);
}

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
    const source: Record<string, string> = {
      mode: 'local',
      project_id: ctx.config.defaultProject,
    };
    if (ctx.config.repoId) {
      source.repo_id = ctx.config.repoId;
    }

    const backupEntities = entities.map(e => ({
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
    }));

    const entitiesChecksum = computeChecksum(JSON.stringify(backupEntities));
    const relationsChecksum = computeChecksum(JSON.stringify(relations));

    const backupData = {
      version: '0.3.0',
      format_version: BACKUP_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      exported_by: 'unknown',
      source,
      entities: backupEntities,
      relations,
      checksums: {
        entities: entitiesChecksum,
        relations: relationsChecksum,
      },
    };

    // 序列化为 JSON
    const jsonContent = JSON.stringify(backupData, null, 2);

    // 根据格式写入文件
    if (format === 'tar.gz') {
      // P2-3.1: tar + gzip 压缩
      const tarContent = createTarArchive('backup.json', jsonContent);
      const compressed = gzipSync(tarContent);
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
