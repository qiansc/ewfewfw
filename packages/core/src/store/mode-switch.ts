/**
 * 模式切换模块
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md §5.2
 *
 * 提供 Local ↔ Server 模式切换功能：
 * - Local → Server: 备份 + 导出 + 冲突处理
 * - Server → Local: 导入 + 向量重建
 */

import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { SQLiteStore } from './sqlite-store.js';
import type { EntityType, EntityStatus } from './adapter.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 冲突处理策略
 */
export type ConflictPolicy = 'skip' | 'override' | 'merge' | 'error';

/**
 * 备份选项
 */
export interface BackupOptions {
  /** 输出文件路径 */
  output: string;
  /** 是否包含向量数据 */
  includeVectors?: boolean;
  /** 是否压缩 */
  compress?: boolean;
}

/**
 * 恢复选项
 */
export interface RestoreOptions {
  /** 备份文件路径 */
  input: string;
  /** 冲突处理策略 */
  conflictPolicy?: ConflictPolicy;
  /** 是否重建向量索引 */
  rebuildVectors?: boolean;
}

/**
 * 备份结果
 */
export interface BackupResult {
  success: boolean;
  output: string;
  stats: {
    entities: number;
    relations: number;
    vectors: number;
  };
  size: number;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  success: boolean;
  stats: {
    entities: { created: number; updated: number; skipped: number };
    relations: number;
    vectors: number;
  };
  conflicts?: Array<{
    id: string;
    reason: string;
    resolution: string;
  }>;
}

/**
 * 导出数据格式
 *
 * 设计文档: mode-switch.md §5.4
 *
 * 格式说明：
 * - entities: 实体数据，包含完整的 data 和 metadata
 * - relations: 关系数据，用于重建图结构
 * - vectors: 不导出，导入时自动重建
 */
interface ExportData {
  version: string;
  exported_at: string;
  entities: ExportEntity[];
  relations: ExportRelation[];
}

/**
 * 导出实体格式
 *
 * 与设计文档 §5.4 保持一致
 */
interface ExportEntity {
  id: string;
  type: EntityType;
  kind?: string;
  scope?: string;
  perspective?: string;
  data: Record<string, unknown>;
  metadata: {
    source_project: string;
    source_repo?: string;
    status: EntityStatus;
    content_hash: string;
    created_at: string;
    updated_at: string;
  };
  proposal_id: string | null;
}

/**
 * 导出关系格式
 */
interface ExportRelation {
  from_id: string;
  to_id: string;
  rel_type: string;
  properties?: Record<string, unknown> | null;
}

// ============================================================
// LocalBackup - Local 模式备份
// ============================================================

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

    // 导出实体（包含 kind, scope, perspective）
    interface RawEntity {
      id: string;
      type: EntityType;
      kind: string | null;
      scope: string | null;
      perspective: string | null;
      source_project: string;
      source_repo: string | null;
      proposal_id: string | null;
      data: string;
      status: EntityStatus;
      content_hash: string;
      created_at: string;
      updated_at: string;
    }

    const rawEntities = db.prepare(`
      SELECT e.id, e.type, e.kind, e.scope, e.perspective,
             e.source_project, e.proposal_id, e.data,
             m.source_repo, m.status, m.content_hash, m.created_at, m.updated_at
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    `).all() as RawEntity[];

    // 转换为导出格式
    const entities: ExportEntity[] = rawEntities.map(e => ({
      id: e.id,
      type: e.type,
      kind: e.kind || undefined,
      scope: e.scope || undefined,
      perspective: e.perspective || undefined,
      data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data,
      metadata: {
        source_project: e.source_project,
        source_repo: e.source_repo || undefined,
        status: e.status,
        content_hash: e.content_hash,
        created_at: e.created_at,
        updated_at: e.updated_at,
      },
      proposal_id: e.proposal_id,
    }));

    // 导出关系
    interface RawRelation {
      from_id: string;
      to_id: string;
      rel_type: string;
      properties: string | null;
    }

    const rawRelations = db.prepare(`
      SELECT from_id, to_id, rel_type, properties
      FROM relations
    `).all() as RawRelation[];

    const relations: ExportRelation[] = rawRelations.map(r => ({
      from_id: r.from_id,
      to_id: r.to_id,
      rel_type: r.rel_type,
      properties: r.properties ? JSON.parse(r.properties) : null,
    }));

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: new Date().toISOString(),
      entities,
      relations,
    };

    // 写入文件
    const outputDir = dirname(options.output);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const jsonContent = JSON.stringify(exportData, null, 2);

    if (options.compress !== false) {
      // 压缩输出
      const gzipPath = options.output.endsWith('.gz')
        ? options.output
        : `${options.output}.gz`;

      await pipeline(
        createReadStream(Buffer.from(jsonContent)),
        createGzip(),
        createWriteStream(gzipPath)
      );

      return {
        success: true,
        output: gzipPath,
        stats: {
          entities: entities.length,
          relations: relations.length,
          vectors: 0,
        },
        size: Buffer.byteLength(jsonContent),
      };
    }

    await writeFile(options.output, jsonContent, 'utf-8');

    return {
      success: true,
      output: options.output,
      stats: {
        entities: entities.length,
        relations: relations.length,
        vectors: 0,
      },
      size: Buffer.byteLength(jsonContent),
    };
  }
}

// ============================================================
// LocalRestore - 恢复到 Local 模式
// ============================================================

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

    // 读取备份文件
    const exportData = await this.readBackup(options.input);

    const db = this.store.getDatabase();
    const stats = { entities: { created: 0, updated: 0, skipped: 0 }, relations: 0, vectors: 0 };
    const conflicts: RestoreResult['conflicts'] = [];

    // 从第一个实体获取默认项目
    const defaultProject = exportData.entities[0]?.metadata.source_project || 'default';

    // 恢复实体
    for (const entity of exportData.entities) {
      const result = await this.restoreEntity(db, entity, policy);
      if (result.action === 'created') stats.entities.created++;
      else if (result.action === 'updated') stats.entities.updated++;
      else if (result.action === 'skipped') stats.entities.skipped++;

      if (result.conflict) {
        conflicts.push(result.conflict);
      }
    }

    // 恢复关系
    for (const relation of exportData.relations) {
      this.restoreRelation(db, relation, defaultProject);
      stats.relations++;
    }

    return {
      success: true,
      stats,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
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
    return this.validateExportData(data);
  }

  /**
   * 验证导出数据格式
   *
   * 设计文档: mode-switch.md §5.4
   */
  private validateExportData(data: unknown): ExportData {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid export data: expected object');
    }

    const obj = data as Record<string, unknown>;

    // 验证版本
    if (typeof obj.version !== 'string') {
      throw new Error('Invalid export data: missing version');
    }

    // 验证 exported_at
    if (typeof obj.exported_at !== 'string') {
      throw new Error('Invalid export data: missing exported_at');
    }

    // 验证 entities
    if (!Array.isArray(obj.entities)) {
      throw new Error('Invalid export data: entities must be an array');
    }

    for (const entity of obj.entities) {
      this.validateEntity(entity);
    }

    // 验证 relations
    if (!Array.isArray(obj.relations)) {
      throw new Error('Invalid export data: relations must be an array');
    }

    for (const relation of obj.relations) {
      this.validateRelation(relation);
    }

    return data as ExportData;
  }

  /**
   * 验证实体格式
   */
  private validateEntity(entity: unknown): void {
    if (!entity || typeof entity !== 'object') {
      throw new Error('Invalid entity: expected object');
    }

    const e = entity as Record<string, unknown>;

    if (typeof e.id !== 'string') {
      throw new Error('Invalid entity: missing id');
    }
    if (typeof e.type !== 'string') {
      throw new Error(`Invalid entity ${e.id}: missing type`);
    }
    if (!e.data || typeof e.data !== 'object') {
      throw new Error(`Invalid entity ${e.id}: missing data`);
    }
    if (!e.metadata || typeof e.metadata !== 'object') {
      throw new Error(`Invalid entity ${e.id}: missing metadata`);
    }

    const m = e.metadata as Record<string, unknown>;
    if (typeof m.source_project !== 'string') {
      throw new Error(`Invalid entity ${e.id}: missing metadata.source_project`);
    }
    if (typeof m.status !== 'string') {
      throw new Error(`Invalid entity ${e.id}: missing metadata.status`);
    }
  }

  /**
   * 验证关系格式
   */
  private validateRelation(relation: unknown): void {
    if (!relation || typeof relation !== 'object') {
      throw new Error('Invalid relation: expected object');
    }

    const r = relation as Record<string, unknown>;

    if (typeof r.from_id !== 'string') {
      throw new Error('Invalid relation: missing from_id');
    }
    if (typeof r.to_id !== 'string') {
      throw new Error('Invalid relation: missing to_id');
    }
    if (typeof r.rel_type !== 'string') {
      throw new Error('Invalid relation: missing rel_type');
    }
  }

  /**
   * 恢复单个实体
   */
  private restoreEntity(
    db: ReturnType<SQLiteStore['getDatabase']>,
    entity: ExportEntity,
    policy: ConflictPolicy
  ): { action: 'created' | 'updated' | 'skipped'; conflict?: { id: string; reason: string; resolution: string } } {
    // 检查是否存在
    const existing = db.prepare(`
      SELECT content_hash, updated_at FROM metadata
      WHERE source_project = ? AND entity_id = ? AND proposal_id IS ?
    `).get(entity.metadata.source_project, entity.id, entity.proposal_id) as {
      content_hash: string;
      updated_at: string;
    } | undefined;

    if (!existing) {
      // 新实体，直接插入
      this.insertEntity(db, entity);
      return { action: 'created' };
    }

    // 存在冲突
    if (existing.content_hash === entity.metadata.content_hash) {
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
  ): { action: 'created' | 'updated' | 'skipped'; conflict?: { id: string; reason: string; resolution: string } } {
    switch (policy) {
      case 'error':
        throw new Error(`Conflict detected for entity ${entity.id}`);

      case 'skip':
        return {
          action: 'skipped',
          conflict: { id: entity.id, reason: 'hash_mismatch', resolution: 'skipped' },
        };

      case 'override':
        this.updateEntity(db, entity);
        return {
          action: 'updated',
          conflict: { id: entity.id, reason: 'hash_mismatch', resolution: 'overridden' },
        };

      case 'merge':
        // 比较 updated_at，保留较新的版本
        if (new Date(entity.metadata.updated_at) > new Date(existing.updated_at)) {
          this.updateEntity(db, entity);
          return {
            action: 'updated',
            conflict: { id: entity.id, reason: 'hash_mismatch', resolution: 'backup_newer' },
          };
        }
        return {
          action: 'skipped',
          conflict: { id: entity.id, reason: 'hash_mismatch', resolution: 'existing_newer' },
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

    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      entity.metadata.source_project,
      entity.proposal_id,
      entity.type,
      entity.kind || null,
      entity.scope || null,
      entity.perspective || null,
      JSON.stringify(entity.data)
    );

    db.prepare(`
      INSERT INTO metadata (entity_id, source_project, proposal_id, source_repo, status, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      entity.metadata.source_project,
      entity.proposal_id,
      entity.metadata.source_repo || null,
      entity.metadata.status,
      entity.metadata.content_hash,
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

    db.prepare(`
      UPDATE entities SET type = ?, kind = ?, scope = ?, perspective = ?, data = ?
      WHERE source_project = ? AND id = ? AND proposal_id IS ?
    `).run(
      entity.type,
      entity.kind || null,
      entity.scope || null,
      entity.perspective || null,
      JSON.stringify(entity.data),
      entity.metadata.source_project,
      entity.id,
      entity.proposal_id
    );

    db.prepare(`
      UPDATE metadata SET source_repo = ?, status = ?, content_hash = ?, updated_at = ?
      WHERE source_project = ? AND entity_id = ? AND proposal_id IS ?
    `).run(
      entity.metadata.source_repo || null,
      entity.metadata.status,
      entity.metadata.content_hash,
      entity.metadata.updated_at || now,
      entity.metadata.source_project,
      entity.id,
      entity.proposal_id
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
    // 生成关系 ID
    const relationId = `${relation.from_id}-${relation.rel_type}-${relation.to_id}`;

    db.prepare(`
      INSERT OR REPLACE INTO relations
      (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, properties)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relationId,
      null, // proposal_id 默认为 null
      defaultProject,
      relation.from_id,
      defaultProject,
      relation.to_id,
      relation.rel_type,
      relation.properties ? JSON.stringify(relation.properties) : null
    );
  }
}
