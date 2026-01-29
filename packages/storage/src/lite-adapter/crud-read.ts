/**
 * LiteAdapter Read/List/Delete 操作
 */

import type { SQLQueryBindings } from 'bun:sqlite';
import type { SQLiteStore } from '../sqlite-store.js';
import { getWriteQueue } from '../write-queue.js';
import type {
  Relation,
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
import type { AdapterContext, EntityRow } from './types.js';
import { formatContent, normalizeProposalIdForQuery, rowToEntity } from './helpers.js';
import { expandEntityCacheKeys } from './cache-keys.js';
import { generateVectorKey } from '../vector-search.js';

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
  const dbProposalId = proposalId ?? '';

  // 构建查询条件（基于 Merge View 结果）
  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

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

  if (!proposalId) {
    conditions.push('(e.proposal_id IS NULL OR e.proposal_id = \'\')');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const proposalParams: SQLQueryBindings[] = proposalId ? [dbProposalId, dbProposalId] : [];
  const baseCte = proposalId
    ? `
      WITH ranked AS (
        SELECT e.*,
          ROW_NUMBER() OVER (
            PARTITION BY e.source_project, e.id
            ORDER BY CASE
              WHEN e.proposal_id = ? THEN 0
              WHEN e.proposal_id IS NULL OR e.proposal_id = '' THEN 1
              ELSE 2
            END
          ) AS rn
        FROM entities e
        WHERE e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = ''
      )
    `
    : '';
  const baseFrom = proposalId ? 'ranked e' : 'entities e';
  const baseRnClause = proposalId ? 'WHERE e.rn = 1' : '';

  // count_only 模式
  if (params.count_only) {
    const countResult = db.prepare(`
      ${baseCte}
      SELECT COUNT(*) as total FROM ${baseFrom}
      JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      ${baseRnClause}
      ${whereClause ? (baseRnClause ? `AND ${whereClause.slice(6)}` : whereClause) : ''}
    `).get(...proposalParams, ...values) as { total: number };

    return { total: countResult.total };
  }

  // group_by 模式
  if (params.group_by) {
    const groupField = params.group_by === 'type' ? 'e.type' : 'm.status';
    const groups = db.prepare(`
      ${baseCte}
      SELECT ${groupField} as group_key, COUNT(*) as count FROM ${baseFrom}
      JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      ${baseRnClause}
      ${whereClause ? (baseRnClause ? `AND ${whereClause.slice(6)}` : whereClause) : ''}
      GROUP BY ${groupField}
    `).all(...proposalParams, ...values) as Array<{ group_key: string; count: number }>;

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
    ${baseCte}
    SELECT e.id, e.type, e.source_project, e.proposal_id, m.status, m.updated_at, m.content_hash
    FROM ${baseFrom}
    JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    ${baseRnClause}
    ${whereClause ? (baseRnClause ? `AND ${whereClause.slice(6)}` : whereClause) : ''}
    ORDER BY m.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...proposalParams, ...values, limit, offset) as ListItem[];

  const totalResult = db.prepare(`
    ${baseCte}
    SELECT COUNT(*) as total FROM ${baseFrom}
    JOIN metadata m ON e.source_project = m.source_project AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    ${baseRnClause}
    ${whereClause ? (baseRnClause ? `AND ${whereClause.slice(6)}` : whereClause) : ''}
  `).get(...proposalParams, ...values) as { total: number };

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
  const dbProposalId = proposalId ?? '';
  const proposalClause = dbProposalId === '' ? '(proposal_id = ? OR proposal_id IS NULL)' : 'proposal_id = ?';
  const entityClause = dbProposalId === ''
    ? "(e.proposal_id IS NULL OR e.proposal_id = '')"
    : 'e.proposal_id = ?';
  const entityParams = dbProposalId === '' ? [params.id] : [params.id, dbProposalId];
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
        AND (r.status IS NULL OR r.status != 'deleted')
        AND r.rel_type IN ('DEPENDS_ON', 'USES', 'CALLS')
        AND (r.proposal_id IS NULL OR r.proposal_id = '' OR f.status IS NULL OR f.status IN ('draft', 'approved'))
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
      WHERE (from_id = ? OR to_id = ?) AND ${proposalClause}
        AND (status IS NULL OR status != 'deleted')
    `).get(params.id, params.id, dbProposalId) as { count: number };

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
      SELECT 1 FROM entities WHERE id = ? AND (proposal_id IS NULL OR proposal_id = '')
    `).get(params.id);

    if (mainExists) {
      const featProjects = db.prepare(`
        SELECT DISTINCT source_project FROM entities
        WHERE id = ? AND proposal_id = ?
      `).all(params.id, dbProposalId) as Array<{ source_project: string | null }>;

      // 主分支存在 → 软删除（标记为 archived）
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE metadata SET status = 'archived', updated_at = ?
        WHERE entity_id = ? AND proposal_id = ?
      `).run(now, params.id, dbProposalId);

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
      `).run(params.id, dbProposalId);

      // 软删除时移除向量索引
      for (const project of featProjects) {
        removeVectorIndex(ctx, project.source_project ?? null, params.id, proposalId);
      }

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
    WHERE (from_id = ? OR to_id = ?) AND ${proposalClause}
      AND (status IS NULL OR status != 'deleted')
  `).all(params.id, params.id, dbProposalId) as Array<{
    from_project: string;
    from_id: string;
    to_project: string;
    to_id: string;
    rel_type: string;
  }>;

  const entityProjects = db.prepare(`
    SELECT DISTINCT source_project FROM entities
    WHERE id = ? AND ${proposalClause}
  `).all(params.id, dbProposalId) as Array<{ source_project: string | null }>;

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
      WHERE e.id = ? AND ${entityClause}
    `).run(...entityParams);

    // 删除 metadata
    db.prepare(`
      DELETE FROM metadata WHERE entity_id = ? AND ${proposalClause}
    `).run(params.id, dbProposalId);

    // 删除 entities
    db.prepare(`
      DELETE FROM entities WHERE id = ? AND ${proposalClause}
    `).run(params.id, dbProposalId);

    // 删除关联的 relations（P1-2.5: 记录删除数量）
    const relResult = db.prepare(`
      DELETE FROM relations WHERE (from_id = ? OR to_id = ?) AND ${proposalClause}
    `).run(params.id, params.id, dbProposalId);
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
  const cacheKeys = new Set<string>();
  for (const project of entityProjects) {
    for (const key of expandEntityCacheKeys(project.source_project ?? null, params.id)) {
      cacheKeys.add(key);
    }
  }
  for (const rel of relationsToRemove) {
    for (const key of expandEntityCacheKeys(rel.from_project ?? null, rel.from_id)) {
      cacheKeys.add(key);
    }
    for (const key of expandEntityCacheKeys(rel.to_project ?? null, rel.to_id)) {
      cacheKeys.add(key);
    }
  }
  if (cacheKeys.size === 0) {
    cacheKeys.add(params.id);
  }
  for (const key of cacheKeys) {
    ctx.cache.invalidate(key);
  }

  // 向量索引清理
  for (const project of entityProjects) {
    removeVectorIndex(ctx, project.source_project ?? null, params.id, proposalId);
  }

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
): ReturnType<typeof rowToEntity> | null {
  if (!proposalIds || proposalIds.length === 0) {
    // 无 feat：只查主分支
    const query = `
      SELECT e.*, m.status, m.content_hash, m.created_at, m.updated_at,
             m.source_repo, m.external_url, m.created_by, m.updated_by
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.id = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
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
        WHERE e.id = ? AND (e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = '')
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
      WHERE e.id = ? AND (e.proposal_id IN (${placeholders}) OR e.proposal_id IS NULL OR e.proposal_id = '')
    )
    SELECT * FROM ranked WHERE rn = 1
  `;

  // 参数顺序：CASE 子句的 proposalIds + WHERE 的 id + IN 子句的 proposalIds
  const params: SQLQueryBindings[] = [...proposalIds, id, ...proposalIds];
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
  const values: SQLQueryBindings[] = [entityId, entityId];

  if (typeof filter?.rel_type === 'string') {
    conditions.push('rel_type = ?');
    values.push(filter.rel_type);
  }

  const baseCondition = conditions.join(' AND ');

  const rows = proposalId
    ? db.prepare(`
        WITH ranked AS (
          SELECT r.*,
            ROW_NUMBER() OVER (
              PARTITION BY from_project, from_id, to_project, to_id, rel_type
              ORDER BY
                CASE
                  WHEN proposal_id = ? THEN 1
                  WHEN proposal_id IS NULL OR proposal_id = '' THEN 2
                  ELSE 3
                END
            ) AS rn
          FROM relations r
          WHERE (proposal_id = ? OR proposal_id IS NULL OR proposal_id = '')
            AND ${baseCondition}
        )
        SELECT * FROM ranked
        WHERE rn = 1 AND (status IS NULL OR status != 'deleted')
      `).all(proposalId, proposalId, ...values)
    : db.prepare(`
        SELECT * FROM relations
        WHERE ${baseCondition}
          AND (proposal_id IS NULL OR proposal_id = '')
          AND (status IS NULL OR status != 'deleted')
      `).all(...values);

  return (rows as Array<{
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
  }>).map((row) => ({
    id: row.id,
    proposal_id: row.proposal_id === '' ? null : row.proposal_id,
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

function removeVectorIndex(
  ctx: AdapterContext,
  sourceProject: string | null,
  entityId: string,
  proposalId: string | null
): void {
  if (!ctx.store.isVectorSearchEnabled()) {
    return;
  }
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return;
  }
  const dbSourceProject = sourceProject ?? '';
  const dbProposalId = proposalId ?? '';
  const vectorKey = generateVectorKey(dbSourceProject, entityId, dbProposalId);
  vectorStore.remove(vectorKey);
  vectorStore.save();
}
