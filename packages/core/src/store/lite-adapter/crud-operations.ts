/**
 * LiteAdapter CRUD 操作
 */

import { randomUUID } from 'node:crypto';
import type { SQLiteStore } from '../sqlite-store.js';
import type { InMemoryGraph } from '../in-memory-graph.js';
import type { GraphQueryCache } from '../graph-query-cache.js';
import { getWriteQueue } from '../write-queue.js';
import { generateEmbedding } from '../vector-search.js';
import type {
  EntityType,
  EntityStatus,
  Entity,
  Relation,
  SaveParams,
  SaveResult,
  ReadParams,
  ReadResultObject,
  ReadResultString,
  ListParams,
  ListResult,
  ListItem,
  DeleteParams,
  DeleteResult,
  Warning,
} from '../adapter.js';
import type { AdapterContext, EntityRow, ParsedRelation } from './types.js';
import {
  parseContent,
  formatContent,
  computeHash,
  normalizeProposalIdForQuery,
  rowToEntity,
  generateSearchText,
} from './helpers.js';

// ============================================================
// Diff helpers
// ============================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diffFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix = ''
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const diffs: string[] = [];

  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const prevValue = previous[key];
    const nextValue = next[key];

    if (isPlainObject(prevValue) && isPlainObject(nextValue)) {
      diffs.push(...diffFields(prevValue, nextValue, path));
      continue;
    }

    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
      diffs.push(path);
    }
  }

  return diffs;
}

// ============================================================
// Save 操作
// ============================================================

/**
 * 保存实体（使用写队列串行化）
 */
export async function save(ctx: AdapterContext, params: SaveParams): Promise<SaveResult> {
  return getWriteQueue().enqueue(async () => {
    return doSave(ctx, params);
  });
}

/**
 * 实际执行保存操作
 */
async function doSave(ctx: AdapterContext, params: SaveParams): Promise<SaveResult> {
  const db = ctx.store.getDatabase();
  const now = new Date().toISOString();
  const warnings: Warning[] = [];

  // 解析数据
  let data: Record<string, unknown>;
  if (params.data) {
    data = params.data;
  } else if (params.content) {
    data = parseContent(params.content, params.format || 'yaml');
  } else {
    throw new Error('Either data or content must be provided');
  }

  // 提取 ID
  const id = params.id || (data.id as string);
  if (!id) {
    throw new Error('Entity ID is required');
  }

  const sourceProject = params.source_project || ctx.config.defaultProject;
  const proposalId = params.proposal_id ?? null;

  // 计算 content_hash
  const contentHash = computeHash(data);

  // 检查是否存在并读取旧数据
  const existing = db.prepare(`
    SELECT e.data as data, m.content_hash, m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.source_project = ? AND e.id = ? AND e.proposal_id IS ?
  `).get(sourceProject, id, proposalId) as
    | { data: string; content_hash: string; created_by: string | null; updated_by: string | null }
    | undefined;

  const previousData = existing?.data ? (JSON.parse(existing.data) as Record<string, unknown>) : null;

  // 3.18 并发修改预警：检查是否有其他活跃 feat 也在修改同一实体
  // 设计文档: store-feat-checklist.md §3.10
  if (existing && proposalId && !params.ignore_concurrent_warning) {
    const concurrentFeats = db.prepare(`
      SELECT e.proposal_id, m.updated_at, m.updated_by, f.status as feat_status, f.title
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      LEFT JOIN feats f ON e.proposal_id = f.id
      WHERE e.id = ?
        AND e.source_project = ?
        AND e.proposal_id IS NOT NULL
        AND e.proposal_id != ?
        AND (f.status IS NULL OR f.status IN ('draft', 'approved'))
    `).all(id, sourceProject, proposalId) as Array<{
      proposal_id: string;
      updated_at: string;
      updated_by: string | null;
      feat_status: string | null;
      title: string | null;
    }>;

    if (concurrentFeats.length > 0) {
      warnings.push({
        code: 'CONCURRENT_MODIFICATION',
        message: `实体 ${id} 正在被其他 feat 修改`,
        severity: 'warning',
        details: {
          concurrent_feats: concurrentFeats.map(f => ({
            feat_id: f.proposal_id,
            status: f.feat_status || 'unknown',
            updated_by: f.updated_by,
            updated_at: f.updated_at,
            title: f.title,
          })),
        },
      });
    }
  }

  // 确定状态
  const status: EntityStatus = proposalId ? 'draft' : 'published';

  const changeActor =
    (data.updated_by as string | undefined) ||
    (data.created_by as string | undefined) ||
    ((data.metadata as Record<string, unknown> | undefined)?.updated_by as string | undefined) ||
    ((data.metadata as Record<string, unknown> | undefined)?.created_by as string | undefined);

  const createdBy =
    existing?.created_by ??
    (data.created_by as string | undefined) ??
    ((data.metadata as Record<string, unknown> | undefined)?.created_by as string | undefined) ??
    null;

  const updatedBy = changeActor ?? existing?.updated_by ?? createdBy ?? null;

  const changedFields = previousData ? diffFields(previousData, data) : Object.keys(data);

  // P1-2.1: ADR 检查逻辑
  // 设计文档: store-crud.md §3.1
  let adrCheck: SaveResult['adr_check'];
  if (
    !params.skip_adr_check &&
    ['system', 'container', 'component'].includes(params.type) &&
    status === 'published'
  ) {
    // 检查是否存在关联的 ADR
    const hasAdr = db.prepare(`
      SELECT 1 FROM relations r
      JOIN entities e ON r.to_project = e.source_project AND r.to_id = e.id
      WHERE r.from_id = ? AND r.from_project = ?
        AND r.rel_type = 'REFERENCES'
        AND e.type = 'adr'
        AND r.proposal_id IS ?
    `).get(id, sourceProject, proposalId);

    if (!hasAdr) {
      if (params.enforce_adr) {
        // enforce_adr=true 时，缺少 ADR 返回错误
        return {
          success: false,
          id,
          status,
          content_hash: contentHash,
          error: {
            code: 'C4A-STORE-ADR-001',
            message: '发布 system/container/component 需要关联 ADR',
            details: {
              entity_id: id,
              entity_type: params.type,
              missing_adr: true,
              suggestion: '请先创建 ADR 记录架构决策，然后通过 REFERENCES 关系关联',
            },
          },
        } as SaveResult;
      }
      // 否则返回警告
      adrCheck = {
        required: true,
        passed: false,
        missing_adr: true,
        message: '警告：此实体缺少关联的 ADR，建议补充架构决策记录',
      };
    } else {
      adrCheck = {
        required: true,
        passed: true,
      };
    }
  }

  // 使用事务保存
  const transaction = db.transaction(() => {
    // 插入/更新 entities 表
    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_project, id, proposal_id) DO UPDATE SET
        type = excluded.type,
        kind = excluded.kind,
        scope = excluded.scope,
        perspective = excluded.perspective,
        data = excluded.data
    `).run(
      id,
      sourceProject,
      proposalId,
      params.type,
      (data.kind as string) || null,
      (data.scope as string) || null,
      (data.perspective as string) || null,
      JSON.stringify(data)
    );

    // 插入/更新 metadata 表
    db.prepare(`
      INSERT INTO metadata (
        entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
        status = excluded.status,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at,
        created_by = excluded.created_by,
        updated_by = excluded.updated_by
    `).run(id, sourceProject, proposalId, status, contentHash, now, now, createdBy, updatedBy);

    // 记录历史
    db.prepare(`
      INSERT INTO entity_history (
        entity_id, source_project, proposal_id, entity_type, feat_id, action,
        changed_fields, snapshot_after, changed_by, changed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sourceProject,
      proposalId,
      params.type,
      proposalId,
      existing ? 'update' : 'create',
      changedFields.length > 0 ? JSON.stringify(changedFields) : null,
      JSON.stringify(data),
      updatedBy,
      now
    );
  });

  transaction();

  // 解析并保存关系
  const relations = parseRelations(data, sourceProject, id);
  if (relations.length > 0) {
    saveRelations(ctx, sourceProject, id, proposalId, relations);
  }

  // 向量索引增量维护（异步执行，不阻塞保存）
  if (ctx.config.enableVectorSearch) {
    updateVectorIndex(ctx, sourceProject, id, proposalId, data).catch(() => {
      // 向量更新失败不影响主流程
    });
  }

  return {
    success: true,
    id,
    status,
    content_hash: contentHash,
    adr_check: adrCheck,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ============================================================
// Read 操作
// ============================================================

/**
 * 读取实体
 *
 * 设计文档: store-crud.md §3.2
 * 支持多 Feat 合并视图：proposal_id 可以是数组，后面的 feat 优先级更高
 */
export async function read(
  ctx: AdapterContext,
  params: ReadParams
): Promise<ReadResultObject | ReadResultString | null> {
  const db = ctx.store.getDatabase();

  if (!params.id) {
    return null;
  }

  // P1-2.3: 处理 proposal_id 参数（支持数组）
  const proposalIds = normalizeProposalIdForQuery(params.proposal_id);

  // 查询实体（使用 Merge View，支持多 feat）
  const entity = queryEntity(db, params.id, proposalIds);
  if (!entity) {
    return null;
  }

  // 根据 format 返回不同格式
  if (params.format === 'yaml' || params.format === 'json') {
    return {
      id: entity.id,
      type: entity.type,
      status: entity.metadata.status,
      content: formatContent(entity.data, params.format),
      format: params.format,
    } as ReadResultString;
  }

  // 默认返回对象格式
  const result: ReadResultObject = {
    entity,
  };

  // 可选：包含关系
  if (params.include_relations) {
    // 关系查询仍使用单个 proposal_id（取第一个）
    const singleProposalId = proposalIds ? proposalIds[0] : null;
    result.relations = queryRelations(db, entity.id, singleProposalId, params.filter_relations);
  }

  return result;
}

// ============================================================
// List 操作
// ============================================================

/**
 * 列出实体
 */
export async function list(ctx: AdapterContext, params: ListParams): Promise<ListResult> {
  const db = ctx.store.getDatabase();
  const proposalId = params.proposal_id ?? null;

  // 构建查询条件
  const conditions: string[] = [];
  const values: unknown[] = [];

  // proposal_id 过滤（Merge View）
  if (proposalId) {
    conditions.push('(e.proposal_id = ? OR e.proposal_id IS NULL)');
    values.push(proposalId);
  } else {
    conditions.push('e.proposal_id IS NULL');
  }

  // type 过滤
  if (params.type && params.type !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.type);
  }

  // status 过滤
  if (params.status) {
    conditions.push('m.status = ?');
    values.push(params.status);
  }

  // project_id 过滤
  if (params.project_id) {
    conditions.push('e.source_project = ?');
    values.push(params.project_id);
  }

  // updated_after 过滤
  if (params.updated_after) {
    conditions.push('m.updated_at > ?');
    values.push(params.updated_after);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // count_only 模式
  if (params.count_only) {
    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM entities e
      JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      ${whereClause}
    `).get(...values) as { total: number };

    return { total: countResult.total };
  }

  // group_by 模式
  if (params.group_by) {
    const groupField = params.group_by === 'type' ? 'e.type' : 'm.status';
    const groups = db.prepare(`
      SELECT ${groupField} as group_key, COUNT(*) as count FROM entities e
      JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      ${whereClause}
      GROUP BY ${groupField}
    `).all(...values) as Array<{ group_key: string; count: number }>;

    const result: ListResult = { groups: {} };
    for (const g of groups) {
      result.groups![g.group_key] = { count: g.count };
    }
    return result;
  }

  // 普通列表查询
  const limit = params.limit || 100;
  const offset = params.offset || 0;

  const items = db.prepare(`
    SELECT e.id, e.type, e.source_project, e.proposal_id, m.status, m.updated_at, m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    ${whereClause}
    ORDER BY m.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as ListItem[];

  const totalResult = db.prepare(`
    SELECT COUNT(*) as total FROM entities e
    JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    ${whereClause}
  `).get(...values) as { total: number };

  return {
    items,
    pagination: {
      total: totalResult.total,
      offset,
      limit,
      has_more: offset + items.length < totalResult.total,
    },
  };
}

// ============================================================
// Delete 操作
// ============================================================

/**
 * 删除实体（使用写队列串行化）
 */
export async function del(ctx: AdapterContext, params: DeleteParams): Promise<DeleteResult> {
  return getWriteQueue().enqueue(async () => {
    return doDelete(ctx, params);
  });
}

/**
 * 实际执行删除操作
 *
 * 设计文档: store-crud.md §3.4
 *
 * 删除规则：
 * - 删除主分支实体：物理删除
 * - 删除 feat 中的实体（feat 新建）：物理删除 feat 副本
 * - 删除 feat 中的实体（主分支已存在）：转换为软删除（status: archived）
 */
async function doDelete(ctx: AdapterContext, params: DeleteParams): Promise<DeleteResult> {
  const db = ctx.store.getDatabase();
  const proposalId = params.proposal_id ?? null;
  const warnings: Warning[] = [];

  // 3.19 引用完整性预警：检查是否有其他实体依赖当前实体
  // 设计文档: store-feat-checklist.md §3.11
  if (!params.force) {
    // 查询依赖当前实体的所有实体（包括主分支和活跃 feat）
    const dependents = db.prepare(`
      SELECT DISTINCT r.from_id, r.from_project, e.type, r.proposal_id, r.rel_type
      FROM relations r
      JOIN entities e ON r.from_project = e.source_project
        AND r.from_id = e.id AND r.proposal_id IS e.proposal_id
      LEFT JOIN feats f ON r.proposal_id = f.id
      WHERE r.to_id = ?
        AND (r.proposal_id IS NULL OR f.status IS NULL OR f.status IN ('draft', 'approved'))
    `).all(params.id) as Array<{
      from_id: string;
      from_project: string;
      type: string;
      proposal_id: string | null;
      rel_type: string;
    }>;

    if (dependents.length > 0) {
      warnings.push({
        code: 'DANGLING_REFERENCE',
        message: `删除此实体将导致 ${dependents.length} 个依赖方出现悬空引用`,
        severity: 'warning',
        details: {
          dependents: dependents.map(d => ({
            id: d.from_id,
            type: d.type,
            feat_id: d.proposal_id,
            rel_type: d.rel_type,
          })),
        },
      });
    }

    // 保留原有的关系数量检查
    const relations = db.prepare(`
      SELECT COUNT(*) as count FROM relations
      WHERE (from_id = ? OR to_id = ?) AND proposal_id IS ?
    `).get(params.id, params.id, proposalId) as { count: number };

    if (relations.count > 0 && dependents.length === 0) {
      warnings.push({
        code: 'HAS_RELATIONS',
        message: `Entity has ${relations.count} relations`,
        severity: 'warning',
      });
    }
  }

  // P0-1.4: 检查是否需要软删除（feat 内删除主分支已存在的实体）
  // 设计文档: store-crud.md §3.4
  if (proposalId) {
    // 检查主分支是否存在该实体
    const mainExists = db.prepare(`
      SELECT 1 FROM entities WHERE id = ? AND proposal_id IS NULL
    `).get(params.id);

    if (mainExists) {
      // 主分支存在 → 软删除（标记为 archived）
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE metadata SET status = 'archived', updated_at = ?
        WHERE entity_id = ? AND proposal_id = ?
      `).run(now, params.id, proposalId);

      // 记录历史
      db.prepare(`
        INSERT INTO entity_history (
          entity_id, source_project, proposal_id, entity_type, feat_id,
          action, changed_fields, changed_by, changed_at
        )
        SELECT e.id, e.source_project, e.proposal_id, e.type, e.proposal_id,
          'archive', NULL, m.updated_by, datetime('now')
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ? AND e.proposal_id = ?
      `).run(params.id, proposalId);

      return {
        success: true,
        id: params.id,
        soft_deleted: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  }

  // 在事务执行前查询要删除的关系，用于增量更新内存图和返回 deleted_relations
  const relationsToRemove = db.prepare(`
    SELECT from_project, from_id, to_project, to_id, rel_type
    FROM relations
    WHERE (from_id = ? OR to_id = ?) AND proposal_id IS ?
  `).all(params.id, params.id, proposalId) as Array<{
    from_project: string;
    from_id: string;
    to_project: string;
    to_id: string;
    rel_type: string;
  }>;

  let deletedRelations = 0;

  // 删除实体
  const transaction = db.transaction(() => {
    // 记录历史
    db.prepare(`
      INSERT INTO entity_history (
        entity_id, source_project, proposal_id, entity_type, feat_id,
        action, changed_fields, changed_by, changed_at
      )
      SELECT e.id, e.source_project, e.proposal_id, e.type, e.proposal_id,
        'delete', NULL, m.updated_by, datetime('now')
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.id = ? AND e.proposal_id IS ?
    `).run(params.id, proposalId);

    // 删除 metadata
    db.prepare(`
      DELETE FROM metadata WHERE entity_id = ? AND proposal_id IS ?
    `).run(params.id, proposalId);

    // 删除 entities
    db.prepare(`
      DELETE FROM entities WHERE id = ? AND proposal_id IS ?
    `).run(params.id, proposalId);

    // 删除关联的 relations（P1-2.5: 记录删除数量）
    const relResult = db.prepare(`
      DELETE FROM relations WHERE (from_id = ? OR to_id = ?) AND proposal_id IS ?
    `).run(params.id, params.id, proposalId);
    deletedRelations = relResult.changes;
  });

  transaction();

  // 增量更新内存图
  for (const rel of relationsToRemove) {
    ctx.graph.removeRelation(
      rel.from_project,
      rel.from_id,
      rel.to_project,
      rel.to_id,
      rel.rel_type
    );
  }

  // 失效相关缓存
  ctx.cache.invalidate(params.id);

  return {
    success: true,
    id: params.id,
    deleted_relations: deletedRelations,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 查询单个实体（使用 Merge View）
 *
 * P1-2.3: 支持多 feat 数组查询
 * 设计文档: store-crud.md §3.2
 * > proposal_id?: string | string[] | null：支持多 Feat 合并视图
 *
 * 优先级规则：数组中靠前的 feat 优先级更高，主分支优先级最低
 * 例如：proposal_id = ['feat-a', 'feat-b'] 时，优先级为 feat-a > feat-b > main
 */
function queryEntity(
  db: ReturnType<SQLiteStore['getDatabase']>,
  id: string,
  proposalIds: string[] | null
): Entity | null {
  if (!proposalIds || proposalIds.length === 0) {
    // 无 feat：只查主分支
    const query = `
      SELECT e.*, m.status, m.content_hash, m.created_at, m.updated_at,
             m.source_repo, m.external_url, m.created_by, m.updated_by
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.id = ? AND e.proposal_id IS NULL
    `;
    const row = db.prepare(query).get(id) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  if (proposalIds.length === 1) {
    // 单个 feat：原有逻辑
    const proposalId = proposalIds[0];
    const query = `
      WITH ranked AS (
        SELECT e.*, m.status, m.content_hash, m.created_at, m.updated_at,
               m.source_repo, m.external_url, m.created_by, m.updated_by,
          ROW_NUMBER() OVER (
            PARTITION BY e.source_project, e.id
            ORDER BY CASE WHEN e.proposal_id = ? THEN 0 ELSE 1 END
          ) AS rn
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ? AND (e.proposal_id = ? OR e.proposal_id IS NULL)
      )
      SELECT * FROM ranked WHERE rn = 1
    `;
    const row = db.prepare(query).get(proposalId, id, proposalId) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  // 多个 feat：构建动态优先级 CASE 语句
  // 优先级：proposalIds[0] > proposalIds[1] > ... > main(NULL)
  const caseClauses = proposalIds
    .map((_, i) => `WHEN e.proposal_id = ? THEN ${i}`)
    .join(' ');
  const placeholders = proposalIds.map(() => '?').join(', ');

  const query = `
    WITH ranked AS (
      SELECT e.*, m.status, m.content_hash, m.created_at, m.updated_at,
             m.source_repo, m.external_url, m.created_by, m.updated_by,
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY CASE ${caseClauses} ELSE ${proposalIds.length} END
        ) AS rn
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.id = ? AND (e.proposal_id IN (${placeholders}) OR e.proposal_id IS NULL)
    )
    SELECT * FROM ranked WHERE rn = 1
  `;

  // 参数顺序：CASE 子句的 proposalIds + WHERE 的 id + IN 子句的 proposalIds
  const params = [...proposalIds, id, ...proposalIds];
  const row = db.prepare(query).get(...params) as EntityRow | undefined;
  return row ? rowToEntity(row) : null;
}

/**
 * 查询实体关系
 */
function queryRelations(
  db: ReturnType<SQLiteStore['getDatabase']>,
  entityId: string,
  proposalId: string | null,
  filter?: Record<string, unknown>
): Relation[] {
  const conditions: string[] = ['(from_id = ? OR to_id = ?)'];
  const values: unknown[] = [entityId, entityId];

  if (proposalId) {
    conditions.push('(proposal_id = ? OR proposal_id IS NULL)');
    values.push(proposalId);
  } else {
    conditions.push('proposal_id IS NULL');
  }

  if (filter?.rel_type) {
    conditions.push('rel_type = ?');
    values.push(filter.rel_type);
  }

  const rows = db.prepare(`
    SELECT * FROM relations WHERE ${conditions.join(' AND ')}
  `).all(...values) as Array<{
    id: string;
    proposal_id: string | null;
    from_project: string;
    from_id: string;
    to_project: string;
    to_id: string;
    rel_type: string;
    properties: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    proposal_id: row.proposal_id,
    from_project: row.from_project,
    from_id: row.from_id,
    to_project: row.to_project,
    to_id: row.to_id,
    rel_type: row.rel_type,
    properties: row.properties ? JSON.parse(row.properties) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * 从 DSL data 中解析关系
 */
function parseRelations(
  data: Record<string, unknown>,
  sourceProject: string,
  entityId: string
): ParsedRelation[] {
  const relations: ParsedRelation[] = [];

  const relationships = data.relationships;

  // 格式 1: 数组形式 [{ target, type, ... }]
  if (Array.isArray(relationships)) {
    for (const rel of relationships) {
      if (typeof rel === 'object' && rel !== null) {
        const target = (rel as Record<string, unknown>).target as string;
        const relType = ((rel as Record<string, unknown>).type as string) || 'depends_on';
        if (target) {
          relations.push({
            toProject: sourceProject,
            toId: target,
            relType,
            properties: (rel as Record<string, unknown>).properties as Record<string, unknown>,
          });
        }
      }
    }
  }

  // 格式 2: 对象形式 { dependencies: [...], uses: [...] }
  if (typeof relationships === 'object' && !Array.isArray(relationships)) {
    const relObj = relationships as Record<string, unknown>;
    for (const [relType, targets] of Object.entries(relObj)) {
      if (Array.isArray(targets)) {
        for (const target of targets) {
          if (typeof target === 'string') {
            relations.push({
              toProject: sourceProject,
              toId: target,
              relType,
            });
          }
        }
      }
    }
  }

  const nestedData = isPlainObject(data.data) ? (data.data as Record<string, unknown>) : null;
  const correspondsTo =
    (data.corresponds_to as string | undefined) ||
    (nestedData?.corresponds_to as string | undefined);

  if (correspondsTo) {
    const exists = relations.some(
      (rel) => rel.toProject === sourceProject && rel.toId === correspondsTo && rel.relType === 'CORRESPONDS'
    );
    if (!exists) {
      relations.push({
        toProject: sourceProject,
        toId: correspondsTo,
        relType: 'CORRESPONDS',
      });
    }
  }

  return relations;
}

/**
 * 保存关系到数据库并更新内存图
 */
function saveRelations(
  ctx: AdapterContext,
  sourceProject: string,
  entityId: string,
  proposalId: string | null,
  relations: ParsedRelation[]
): void {
  const db = ctx.store.getDatabase();
  const now = new Date().toISOString();

  // 先查询旧关系，用于增量更新内存图
  const oldRelations = db.prepare(`
    SELECT to_project, to_id, rel_type FROM relations
    WHERE from_project = ? AND from_id = ? AND proposal_id IS ?
  `).all(sourceProject, entityId, proposalId) as Array<{
    to_project: string;
    to_id: string;
    rel_type: string;
  }>;

  // 从内存图中移除旧关系
  for (const rel of oldRelations) {
    ctx.graph.removeRelation(
      sourceProject,
      entityId,
      rel.to_project,
      rel.to_id,
      rel.rel_type
    );
  }

  // 删除数据库中的旧关系
  db.prepare(`
    DELETE FROM relations
    WHERE from_project = ? AND from_id = ? AND proposal_id IS ?
  `).run(sourceProject, entityId, proposalId);

  // 插入新关系
  const insertStmt = db.prepare(`
    INSERT INTO relations (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, properties, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rel of relations) {
    const relId = randomUUID();
    insertStmt.run(
      relId,
      proposalId,
      sourceProject,
      entityId,
      rel.toProject,
      rel.toId,
      rel.relType,
      rel.properties ? JSON.stringify(rel.properties) : null,
      now,
      now
    );

    // 更新内存图
    ctx.graph.addRelation(sourceProject, entityId, rel.toProject, rel.toId, rel.relType);
  }
}

/**
 * 更新向量索引
 */
async function updateVectorIndex(
  ctx: AdapterContext,
  sourceProject: string,
  entityId: string,
  proposalId: string | null,
  data: Record<string, unknown>
): Promise<void> {
  // 检查向量搜索是否可用
  if (!ctx.store.isVectorSearchEnabled()) {
    return;
  }

  // 生成搜索文本
  const text = generateSearchText(data);
  if (!text) return;

  // 生成向量
  const embedding = await generateEmbedding(text);

  // 写入 vectors 表
  const db = ctx.store.getDatabase();
  try {
    db.prepare(`
      INSERT INTO vectors (entity_id, source_project, proposal_id, embedding)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
        embedding = excluded.embedding
    `).run(entityId, sourceProject, proposalId, embedding);
  } catch {
    // 向量写入失败，忽略
  }
}
