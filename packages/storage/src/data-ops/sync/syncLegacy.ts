import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { EntityType, SyncParams, SyncResult, SyncDetail } from '../../adapter.js';
import type { DataOpsContext } from '../types.js';

/**
 * 兼容旧接口的同步实现
 */
export async function legacySync(
  ctx: DataOpsContext,
  params: SyncParams
): Promise<SyncResult> {
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
    const files = legacyScanDslFiles(basePath);
    stats.scanned = files.length;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const data = parseYaml(content) as Record<string, unknown>;

        if (!data.id || !data.type) {
          stats.skipped++;
          details.push({
            entity_id: String(data.id || 'unknown'),
            action: 'skipped',
            path: filePath,
            error: 'Missing id or type',
          });
          continue;
        }

        const entityId = data.id as string;
        const entityType = data.type as EntityType;
        const contentHash = legacyComputeContentHash(content);
        const rootId = ctx.config.defaultProject;

        // 检查是否已存在
        const existing = ctx.storage.getEntityContentHash({
          entityId,
          rootId,
        });

        if (existing) {
          if (mode === 'incremental' && existing === contentHash) {
            stats.skipped++;
            details.push({ entity_id: entityId, action: 'skipped', path: filePath });
            continue;
          }
          // 更新
          ctx.storage.updateEntity({
            entityId,
            rootId,
            entityType,
            data,
            contentHash,
            updatedAt: new Date().toISOString(),
          });
          stats.updated++;
          details.push({ entity_id: entityId, action: 'updated', path: filePath });
        } else {
          // 创建
          const now = new Date().toISOString();
          ctx.storage.insertEntity({
            entityId,
            rootId,
            entityType,
            data,
            contentHash,
            createdAt: now,
            updatedAt: now,
          });
          stats.created++;
          details.push({ entity_id: entityId, action: 'created', path: filePath });
        }
      } catch (error) {
        stats.failed++;
        details.push({
          entity_id: 'unknown',
          action: 'failed',
          path: filePath,
          error: String(error),
        });
      }
    }
  } else {
    // 从数据库导出到文件系统
    const entities = ctx.storage.listEntitiesForExport({ statusFilter });
    stats.scanned = entities.length;

    for (const entity of entities) {
      try {
        const data = JSON.parse(entity.data) as Record<string, unknown>;
        const filePath = legacyGetEntityFilePath(basePath, entity.type, entity.id, format);

        // 确保目录存在
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // 检查文件是否已存在
        if (existsSync(filePath)) {
          const existingContent = readFileSync(filePath, 'utf-8');
          const existingHash = legacyComputeContentHash(existingContent);

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

function legacyScanDslFiles(basePath: string): string[] {
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

function legacyComputeContentHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function legacyGetEntityFilePath(basePath: string, type: string, id: string, format: string): string {
  const ext = format === 'yaml' ? '.yaml' : '.json';
  const dirType = type === 'software-system' ? 'system' : type;
  return join(basePath, dirType + 's', `${id}${ext}`);
}
