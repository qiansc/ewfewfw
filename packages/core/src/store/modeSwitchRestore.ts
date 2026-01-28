/**
 * Local 模式恢复
 */

import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { SQLiteStore } from './sqlite-store.js';
import type { ConflictPolicy } from './modeSwitchTypes.js';
import type {
  RestoreOptions,
  RestoreResult,
  RestoreProgress,
  ExportData,
  ExportEntity,
  ExportRelation,
  ExportFeat,
} from './modeSwitchTypes.js';
import { EXPORT_VERSION } from './modeSwitchTypes.js';
import * as converter from '../utils/converter.js';

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
    return converter.dslToProduct(rawData) as ConvertedEntity;
  }
  if (converter.isSystemDSL(rawData)) {
    return converter.dslToSystem(rawData) as ConvertedEntity;
  }
  if (converter.isContainerDSL(rawData)) {
    return converter.dslToContainer(rawData) as ConvertedEntity;
  }
  if (converter.isComponentDSL(rawData)) {
    return converter.dslToComponent(rawData) as ConvertedEntity;
  }
  if (converter.isProcessDSL(rawData)) {
    return converter.dslToProcess(rawData) as ConvertedEntity;
  }
  if (converter.isSoRDSL(rawData)) {
    return converter.dslToSoR(rawData) as ConvertedEntity;
  }
  if (converter.isADRDSL(rawData)) {
    return converter.dslToADR(rawData) as ConvertedEntity;
  }
  if (converter.isContractDSL(rawData)) {
    return converter.dslToContract(rawData) as ConvertedEntity;
  }
  return null;
}

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
    const exportData = this.normalizeExportData(await this.readBackup(options.input));
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

    // 从第一个实体获取默认项目
    const defaultProject = exportData.entities[0]?.metadata.source_project || 'default';

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
    if (!this.isCompatibleVersion(obj.version)) {
      throw new Error(`Unsupported export version: ${obj.version}`);
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

    // feats 可选（旧版本可能缺失）
    const feats = Array.isArray(obj.feats) ? obj.feats : [];
    for (const feat of feats) {
      this.validateFeat(feat);
    }

    return {
      version: obj.version,
      exported_at: obj.exported_at,
      entities: obj.entities as ExportEntity[],
      relations: obj.relations as ExportRelation[],
      feats: feats as ExportFeat[],
    };
  }

  /**
   * 兼容旧导出格式（字段修复/补全）
   */
  private normalizeExportData(data: ExportData): ExportData {
    return {
      ...data,
      entities: data.entities.map((entity) => this.normalizeExportEntity(entity)),
      relations: data.relations.map((relation) => this.normalizeExportRelation(relation)),
      feats: data.feats,
    };
  }

  private normalizeExportEntity(entity: ExportEntity): ExportEntity {
    const normalizedMetadata = {
      ...entity.metadata,
      source_project: entity.metadata.source_project ?? '',
    };
    const data = isPlainObject(entity.data) ? { ...entity.data } : entity.data;
    const normalized: ExportEntity = {
      ...entity,
      proposal_id: entity.proposal_id === '' ? null : entity.proposal_id ?? null,
      data,
      metadata: normalizedMetadata,
    };

    // ADR title/name 兼容
    if (normalized.type === 'adr' && isPlainObject(data)) {
      const adr = data.adr;
      if (isPlainObject(adr)) {
        const nextAdr = { ...adr };
        if (!('title' in nextAdr) && typeof nextAdr.name === 'string') {
          nextAdr.title = nextAdr.name;
        }
        if ('name' in nextAdr) {
          delete nextAdr.name;
        }
        data.adr = nextAdr;
      }
    }

    // Contract component_id 兼容（旧字段移除）
    if (normalized.type === 'contract' && isPlainObject(data)) {
      const contract = data.contract;
      if (isPlainObject(contract) && 'component_id' in contract) {
        const nextContract = { ...contract };
        delete nextContract.component_id;
        data.contract = nextContract;
      }
    }

    const converted = isPlainObject(data) ? toInternalEntity(data) : null;
    const fallbackKind = pickString((data as Record<string, unknown>)?.kind);
    const fallbackScope = pickString((data as Record<string, unknown>)?.scope);
    const fallbackPerspective = pickString((data as Record<string, unknown>)?.perspective);

    normalized.kind =
      pickString(normalized.kind) ??
      pickString(converted?.kind) ??
      fallbackKind;
    normalized.scope =
      pickString(normalized.scope) ??
      pickString(converted?.scope) ??
      fallbackScope;
    normalized.perspective =
      pickString(normalized.perspective) ??
      pickString(converted?.perspective) ??
      fallbackPerspective;

    return normalized;
  }

  private normalizeExportRelation(relation: ExportRelation): ExportRelation {
    return {
      ...relation,
      proposal_id: relation.proposal_id === '' ? null : relation.proposal_id ?? null,
      from_project: relation.from_project === null ? '' : relation.from_project,
      to_project: relation.to_project === null ? '' : relation.to_project,
    };
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
    if (m.source_project !== null && typeof m.source_project !== 'string') {
      throw new Error(`Invalid entity ${e.id}: invalid metadata.source_project`);
    }
    if (typeof m.status !== 'string') {
      throw new Error(`Invalid entity ${e.id}: missing metadata.status`);
    }
    if (typeof m.created_at !== 'string') {
      throw new Error(`Invalid entity ${e.id}: missing metadata.created_at`);
    }
    if (typeof m.updated_at !== 'string') {
      throw new Error(`Invalid entity ${e.id}: missing metadata.updated_at`);
    }
    if (m.source_repo !== undefined && typeof m.source_repo !== 'string') {
      throw new Error(`Invalid entity ${e.id}: invalid metadata.source_repo`);
    }
    if (m.content_hash !== undefined && typeof m.content_hash !== 'string') {
      throw new Error(`Invalid entity ${e.id}: invalid metadata.content_hash`);
    }
    if (e.proposal_id !== undefined && e.proposal_id !== null && typeof e.proposal_id !== 'string') {
      throw new Error(`Invalid entity ${e.id}: invalid proposal_id`);
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

    if (r.id !== undefined && typeof r.id !== 'string') {
      throw new Error('Invalid relation: invalid id');
    }
    if (r.proposal_id !== undefined && r.proposal_id !== null && typeof r.proposal_id !== 'string') {
      throw new Error('Invalid relation: invalid proposal_id');
    }
    if (r.from_project !== undefined && r.from_project !== null && typeof r.from_project !== 'string') {
      throw new Error('Invalid relation: invalid from_project');
    }
    if (typeof r.from_id !== 'string') {
      throw new Error('Invalid relation: missing from_id');
    }
    if (r.to_project !== undefined && r.to_project !== null && typeof r.to_project !== 'string') {
      throw new Error('Invalid relation: invalid to_project');
    }
    if (typeof r.to_id !== 'string') {
      throw new Error('Invalid relation: missing to_id');
    }
    if (typeof r.rel_type !== 'string') {
      throw new Error('Invalid relation: missing rel_type');
    }
    if (r.status !== undefined && r.status !== 'active' && r.status !== 'deleted') {
      throw new Error('Invalid relation: invalid status');
    }
    if (r.properties !== undefined && r.properties !== null && typeof r.properties !== 'object') {
      throw new Error('Invalid relation: invalid properties');
    }
  }

  /**
   * 验证 Feat 格式
   */
  private validateFeat(feat: unknown): void {
    if (!feat || typeof feat !== 'object') {
      throw new Error('Invalid feat: expected object');
    }

    const f = feat as Record<string, unknown>;

    if (typeof f.id !== 'string') {
      throw new Error('Invalid feat: missing id');
    }
    if (typeof f.status !== 'string') {
      throw new Error(`Invalid feat ${f.id}: missing status`);
    }
    if (typeof f.created_at !== 'string') {
      throw new Error(`Invalid feat ${f.id}: missing created_at`);
    }
    if (typeof f.updated_at !== 'string') {
      throw new Error(`Invalid feat ${f.id}: missing updated_at`);
    }
    if (f.checklist !== undefined && f.checklist !== null && typeof f.checklist !== 'object') {
      throw new Error(`Invalid feat ${f.id}: invalid checklist`);
    }
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
  ): { action: 'created' | 'updated' | 'skipped'; conflict?: { id: string; reason: string; resolution: string } } {
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
  ): Promise<{ action: 'created' | 'updated' | 'skipped'; conflict?: { id: string; reason: string; resolution: string } }> {
    // 检查是否存在
    const dbProposalId = entity.proposal_id ?? '';
    const proposalClause = dbProposalId === ''
      ? '(proposal_id IS NULL OR proposal_id = \'\')'
      : 'proposal_id = ?';
    const existing = db.prepare(`
      SELECT content_hash, updated_at FROM metadata
      WHERE source_project = ? AND entity_id = ? AND ${proposalClause}
    `).get(
      ...(dbProposalId === ''
        ? [entity.metadata.source_project, entity.id]
        : [entity.metadata.source_project, entity.id, dbProposalId])
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
    const dbProposalId = entity.proposal_id ?? '';

    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      entity.metadata.source_project,
      dbProposalId,
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
      dbProposalId,
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
    const dbProposalId = entity.proposal_id ?? '';
    const proposalClause = dbProposalId === ''
      ? '(proposal_id IS NULL OR proposal_id = \'\')'
      : 'proposal_id = ?';

    db.prepare(`
      UPDATE entities SET type = ?, kind = ?, scope = ?, perspective = ?, data = ?
      WHERE source_project = ? AND id = ? AND ${proposalClause}
    `).run(
      entity.type,
      entity.kind || null,
      entity.scope || null,
      entity.perspective || null,
      JSON.stringify(entity.data),
      entity.metadata.source_project,
      entity.id,
      ...(dbProposalId === '' ? [] : [dbProposalId])
    );

    db.prepare(`
      UPDATE metadata SET source_repo = ?, status = ?, content_hash = ?, updated_at = ?
      WHERE source_project = ? AND entity_id = ? AND ${proposalClause}
    `).run(
      entity.metadata.source_repo || null,
      entity.metadata.status,
      entity.metadata.content_hash ?? null,
      entity.metadata.updated_at || now,
      entity.metadata.source_project,
      entity.id,
      ...(dbProposalId === '' ? [] : [dbProposalId])
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
    const fromProject = relation.from_project === undefined ? defaultProject : (relation.from_project ?? '');
    const toProject = relation.to_project === undefined ? defaultProject : (relation.to_project ?? '');

    // 生成关系 ID
    const relationId = relation.id || `${relation.from_id}-${relation.rel_type}-${relation.to_id}`;

    const dbProposalId = relation.proposal_id ?? '';
    db.prepare(`
      INSERT OR REPLACE INTO relations
      (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, status, properties)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relationId,
      dbProposalId,
      fromProject,
      relation.from_id,
      toProject,
      relation.to_id,
      relation.rel_type,
      relation.status ?? 'active',
      relation.properties ? JSON.stringify(relation.properties) : null
    );
  }
}
