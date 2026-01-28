/**
 * LiteAdapter Feat 合并与冲突处理
 */

import type { SQLiteStore } from '../sqlite-store.js';
import type {
  FeatMergeParams,
  FeatMergeResult,
  FeatConflict,
} from '../adapter.js';
import type { AdapterContext, EntityRow } from './types.js';
import { rowToEntity } from './helpers.js';
import { generateEmbedding, generateVectorKey } from '../vector-search.js';

// ============================================================
// FeatMerge 操作
// ============================================================

/**
 * Feat 合并操作
 */
export async function featMerge(
  ctx: AdapterContext,
  params: FeatMergeParams
): Promise<FeatMergeResult> {
  const db = ctx.store.getDatabase();
  const featId = params.feat_id;
  const shouldUpdateVector = ctx.config.enableVectorSearch && ctx.store.isVectorSearchEnabled();

  // 检测冲突
  const conflicts = detectFeatConflicts(db, featId);

  if (params.strategy === 'auto') {
    if (conflicts.length > 0) {
      return {
        success: false,
        merged: [],
        conflicts,
      };
    }

    const vectorEntities = shouldUpdateVector ? collectFeatEntitiesForVector(db, featId) : [];

    // 无冲突，执行合并
    const result = mergeFeatToMain(db, featId, { recordHistory: false });

    if (shouldUpdateVector) {
      await updateVectorIndexAfterMerge(ctx, featId, vectorEntities);
    }
    return {
      success: true,
      merged: result.merged,
      conflicts: [],
    };
  }

  // manual 策略：应用冲突解决方案
  if (params.conflict_resolution) {
    for (const resolution of params.conflict_resolution) {
      if (resolution.resolution === 'keep_main') {
        const projects = db.prepare(`
          SELECT source_project FROM entities WHERE id = ? AND proposal_id = ?
        `).all(resolution.entity_id, featId) as Array<{ source_project: string | null }>;

        // 删除 feat 中的实体
        db.prepare(`
          DELETE FROM entities WHERE id = ? AND proposal_id = ?
        `).run(resolution.entity_id, featId);

        if (shouldUpdateVector) {
          for (const project of projects) {
            removeVectorIndex(ctx, project.source_project ?? null, resolution.entity_id, featId);
          }
        }
      }
      // keep_feat: 保留 feat 版本，合并时会覆盖主分支
    }
  }

  const vectorEntities = shouldUpdateVector ? collectFeatEntitiesForVector(db, featId) : [];

  // 执行合并
  const result = mergeFeatToMain(db, featId, { recordHistory: false });
  if (shouldUpdateVector) {
    await updateVectorIndexAfterMerge(ctx, featId, vectorEntities);
  }
  return {
    success: true,
    merged: result.merged,
    conflicts: [],
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 检测 Feat 冲突
 */
export function detectFeatConflicts(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): FeatConflict[] {
  // 查找 feat 中修改的实体
  const featEntities = db.prepare(`
    SELECT e.id, e.source_project, e.data, m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id = ?
  `).all(featId) as Array<{
    id: string;
    source_project: string;
    data: string;
    content_hash: string;
  }>;

  const conflicts: FeatConflict[] = [];

  for (const entity of featEntities) {
    // 检查主分支是否有同名实体
    const mainEntity = db.prepare(`
      SELECT e.data, m.content_hash
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.id = ? AND e.source_project = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
    `).get(entity.id, entity.source_project) as {
      data: string;
      content_hash: string;
    } | undefined;

    if (mainEntity && mainEntity.content_hash !== entity.content_hash) {
      conflicts.push({
        entity_id: entity.id,
        conflict_type: 'both_modified',
        main_branch: JSON.parse(mainEntity.data),
        feat_branch: JSON.parse(entity.data),
        suggested_resolution: 'keep_feat',
      });
    }
  }

  return conflicts;
}

function buildFeatHistorySnapshot(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): ReturnType<typeof rowToEntity>[] {
  const rows = db.prepare(`
    SELECT e.id, e.source_project, e.proposal_id, e.type, e.kind, e.scope, e.perspective, e.data,
           m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
           m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE (e.proposal_id IS NULL OR e.proposal_id = '')
      AND EXISTS (
        SELECT 1 FROM entities f
        WHERE f.proposal_id = ?
          AND f.id = e.id
          AND f.source_project = e.source_project
      )
  `).all(featId) as EntityRow[];

  return rows.map(rowToEntity);
}

function recordFeatHistory(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string,
  publishedAt: string,
  publishedBy: string | null,
  snapshot: ReturnType<typeof rowToEntity>[]
): void {
  db.prepare(`
    INSERT INTO feat_history (feat_id, published_at, entities_snapshot, published_by)
    VALUES (?, ?, ?, ?)
  `).run(featId, publishedAt, JSON.stringify(snapshot), publishedBy);

  // 仅保留最近 10 条
  db.prepare(`
    DELETE FROM feat_history
    WHERE feat_id = ?
      AND id NOT IN (
        SELECT id FROM feat_history
        WHERE feat_id = ?
        ORDER BY published_at DESC
        LIMIT 10
      )
  `).run(featId, featId);
}

/**
 * 合并 Feat 到主分支
 *
 * 设计文档: store-feat-lifecycle.md §3.7
 * Copy-on-Write 机制：将 feat 版本移到主分支，删除旧版本
 *
 * 步骤：
 * 1. 删除主分支中被 feat 修改的实体旧版本
 * 2. 将 feat 版本移到主分支（proposal_id 设为 ''）
 */
export function mergeFeatToMain(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string,
  options: { recordHistory?: boolean; publishedBy?: string | null } = {}
): { merged: string[]; conflicts: FeatConflict[] } {
  const merged: string[] = [];
  const now = new Date().toISOString();

  // 获取 feat 中的所有实体 ID
  const featEntities = db.prepare(`
    SELECT e.id, e.source_project, e.type, e.kind, e.scope, e.perspective, e.data,
           m.status, m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id = ?
  `).all(featId) as Array<{
    id: string;
    source_project: string;
    type: string;
    kind: string | null;
    scope: string | null;
    perspective: string | null;
    data: string;
    status: string;
    content_hash: string;
  }>;

  // 使用事务确保原子性
  const transaction = db.transaction(() => {
    if (options.recordHistory) {
      const snapshot = buildFeatHistorySnapshot(db, featId);
      recordFeatHistory(db, featId, now, options.publishedBy ?? null, snapshot);
    }

    for (const entity of featEntities) {
      // 1. 删除主分支旧版本（如果存在）
      db.prepare(`
        DELETE FROM entities
        WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).run(entity.id, entity.source_project);

      db.prepare(`
        DELETE FROM metadata
        WHERE entity_id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).run(entity.id, entity.source_project);

      db.prepare(`
        DELETE FROM relations
        WHERE (from_id = ? OR to_id = ?) AND from_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).run(entity.id, entity.id, entity.source_project);

      merged.push(entity.id);
    }

    // 2. 将 feat 版本移到主分支（更新 proposal_id 为 ''）
    db.prepare(`
      UPDATE entities SET proposal_id = '' WHERE proposal_id = ?
    `).run(featId);

    db.prepare(`
      UPDATE metadata SET proposal_id = '', status = 'published', updated_at = ?
      WHERE proposal_id = ?
    `).run(now, featId);

    db.prepare(`
      UPDATE relations
      SET proposal_id = ''
      WHERE proposal_id = ? AND (status IS NULL OR status != 'deleted')
    `).run(featId);

    db.prepare(`
      DELETE FROM relations WHERE proposal_id = ? AND status = 'deleted'
    `).run(featId);

    // 3. 清理 feat 的 checklist（发布后不再需要）
    db.prepare(`
      UPDATE feats SET checklist = NULL WHERE id = ?
    `).run(featId);
  });

  transaction();

  return { merged, conflicts: [] };
}

type VectorEntity = {
  id: string;
  source_project: string | null;
  data: string;
};

export function collectFeatEntitiesForVector(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): VectorEntity[] {
  return db.prepare(`
    SELECT id, source_project, data
    FROM entities
    WHERE proposal_id = ?
  `).all(featId) as VectorEntity[];
}

export async function updateVectorIndexAfterMerge(
  ctx: AdapterContext,
  featId: string,
  entities: VectorEntity[]
): Promise<void> {
  if (!ctx.config.enableVectorSearch || !ctx.store.isVectorSearchEnabled()) {
    return;
  }
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return;
  }

  for (const entity of entities) {
    const dbSourceProject = entity.source_project ?? '';
    const oldKey = generateVectorKey(dbSourceProject, entity.id, featId);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(entity.data) as Record<string, unknown>;
    } catch {
      vectorStore.remove(oldKey);
      continue;
    }

    const text = buildSearchText(data);
    if (!text) {
      vectorStore.remove(oldKey);
      continue;
    }

    try {
      const embedding = await generateEmbedding(text);
      const newKey = generateVectorKey(dbSourceProject, entity.id, '');
      vectorStore.remove(oldKey);
      vectorStore.add(newKey, embedding);
    } catch {
      vectorStore.remove(oldKey);
      // 向量更新失败不影响主流程
    }
  }

  vectorStore.save();
}

export function removeVectorIndexForEntities(
  ctx: AdapterContext,
  featId: string,
  entities: VectorEntity[]
): void {
  if (!ctx.config.enableVectorSearch || !ctx.store.isVectorSearchEnabled()) {
    return;
  }
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return;
  }

  for (const entity of entities) {
    const dbSourceProject = entity.source_project ?? '';
    const vectorKey = generateVectorKey(dbSourceProject, entity.id, featId);
    vectorStore.remove(vectorKey);
  }

  vectorStore.save();
}

function removeVectorIndex(
  ctx: AdapterContext,
  sourceProject: string | null,
  entityId: string,
  proposalId: string
): void {
  if (!ctx.config.enableVectorSearch || !ctx.store.isVectorSearchEnabled()) {
    return;
  }
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return;
  }
  const dbSourceProject = sourceProject ?? '';
  const vectorKey = generateVectorKey(dbSourceProject, entityId, proposalId);
  vectorStore.remove(vectorKey);
  vectorStore.save();
}

function buildSearchText(data: Record<string, unknown>): string {
  const tags = Array.isArray(data.tags) ? data.tags.join(' ') : null;
  const parts = [data.name, data.description, data.title, tags].filter(Boolean);
  return parts.join(' ');
}
