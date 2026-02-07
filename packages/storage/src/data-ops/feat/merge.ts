/**
 * Feat 合并与冲突处理（Data Ops）
 */

import type { FeatMergeParams, FeatMergeResult, FeatConflict } from '../../adapter.js';
import type { DataOpsContext, StorageOperations, VectorEntity } from '../types.js';
import { generateEmbedding, generateVectorKey } from '../../vector-search.js';

// ============================================================
// FeatMerge 操作
// ============================================================

export async function featMerge(
  ctx: DataOpsContext,
  params: FeatMergeParams
): Promise<FeatMergeResult> {
  const featId = params.feat_id;
  const vectorStore = getVectorStore(ctx);

  // 检测冲突
  const conflicts = detectFeatConflicts(ctx.storage, featId);

  if (params.strategy === 'auto') {
    if (conflicts.length > 0) {
      return {
        success: false,
        merged: [],
        conflicts,
      };
    }

    const vectorEntities = vectorStore ? collectFeatEntitiesForVector(ctx.storage, featId) : [];

    // 无冲突，执行合并
    const result = mergeFeatToMain(ctx.storage, featId, { recordHistory: false });

    if (vectorStore) {
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
        const projects = ctx.storage.listFeatEntityProjects(featId, resolution.entity_id);

        // 删除 feat 中的实体
        ctx.storage.deleteFeatEntity(featId, resolution.entity_id);

        if (vectorStore) {
          for (const project of projects) {
            removeVectorIndex(ctx, project.uuid);
          }
        }
      }
      // keep_feat: 保留 feat 版本，合并时会覆盖主分支
    }
  }

  const vectorEntities = vectorStore ? collectFeatEntitiesForVector(ctx.storage, featId) : [];

  // 执行合并
  const result = mergeFeatToMain(ctx.storage, featId, { recordHistory: false });
  if (vectorStore) {
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

export function detectFeatConflicts(
  storage: StorageOperations,
  featId: string
): FeatConflict[] {
  const featEntities = storage.listFeatEntitiesForConflict(featId);
  const conflicts: FeatConflict[] = [];

  for (const entity of featEntities) {
    const mainEntity = storage.getMainEntityForConflict(entity.id, entity.root_id);

    if (!mainEntity) {
      continue;
    }

    if (mainEntity.type !== entity.type || (mainEntity.kind ?? null) !== (entity.kind ?? null)) {
      conflicts.push({
        entity_id: entity.id,
        conflict_type: 'type',
        main_branch: JSON.parse(mainEntity.data),
        feat_branch: JSON.parse(entity.data),
        suggested_resolution: 'keep_feat',
      });
      continue;
    }

    if (mainEntity.content_hash !== entity.content_hash) {
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

function buildFeatHistorySnapshot(storage: StorageOperations, featId: string) {
  return storage.getFeatHistorySnapshot(featId);
}

function recordFeatHistory(
  storage: StorageOperations,
  featId: string,
  publishedAt: string,
  publishedBy: string | null,
  snapshot: ReturnType<typeof buildFeatHistorySnapshot>
): void {
  storage.insertFeatHistory({
    featId,
    publishedAt,
    publishedBy,
    snapshot,
  });
  storage.trimFeatHistory(featId, 10);
}

/**
 * 合并 Feat 到主分支
 */
export function mergeFeatToMain(
  storage: StorageOperations,
  featId: string,
  options: { recordHistory?: boolean; publishedBy?: string | null } = {}
): { merged: string[]; conflicts: FeatConflict[] } {
  return storage.transaction((tx) => mergeFeatToMainInternal(tx, featId, options));
}

export function mergeFeatToMainInternal(
  storage: StorageOperations,
  featId: string,
  options: { recordHistory?: boolean; publishedBy?: string | null } = {}
): { merged: string[]; conflicts: FeatConflict[] } {
  const merged: string[] = [];
  const now = new Date().toISOString();

  if (options.recordHistory) {
    const snapshot = buildFeatHistorySnapshot(storage, featId);
    recordFeatHistory(storage, featId, now, options.publishedBy ?? null, snapshot);
  }

  const featEntities = storage.listFeatEntitiesForMerge(featId);

  for (const entity of featEntities) {
    merged.push(entity.id);
  }

  storage.moveFeatEntitiesToMain(featId, now);
  storage.clearFeatChecklist(featId);

  return { merged, conflicts: [] };
}

export function collectFeatEntitiesForVector(
  storage: StorageOperations,
  featId: string
): VectorEntity[] {
  return storage.listFeatEntitiesForVector(featId);
}

export async function updateVectorIndexAfterMerge(
  ctx: DataOpsContext,
  featId: string,
  entities: VectorEntity[]
): Promise<void> {
  const vectorStore = getVectorStore(ctx);
  if (!vectorStore) {
    return;
  }

  for (const entity of entities) {
    const oldKey = generateVectorKey(entity.uuid);
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
      vectorStore.remove(oldKey);
      vectorStore.add(oldKey, embedding);
    } catch {
      vectorStore.remove(oldKey);
      // 向量更新失败不影响主流程
    }
  }

  vectorStore.save();
}

export function removeVectorIndexForEntities(
  ctx: DataOpsContext,
  featId: string,
  entities: VectorEntity[]
): void {
  const vectorStore = getVectorStore(ctx);
  if (!vectorStore) {
    return;
  }

  for (const entity of entities) {
    const vectorKey = generateVectorKey(entity.uuid);
    vectorStore.remove(vectorKey);
  }

  vectorStore.save();
}

function removeVectorIndex(ctx: DataOpsContext, uuid: string): void {
  const vectorStore = getVectorStore(ctx);
  if (!vectorStore) {
    return;
  }
  vectorStore.remove(generateVectorKey(uuid));
  vectorStore.save();
}

function buildSearchText(data: Record<string, unknown>): string {
  const tags = Array.isArray(data.tags) ? data.tags.join(' ') : null;
  const parts = [data.name, data.description, data.title, tags].filter(Boolean);
  return parts.join(' ');
}

function getVectorStore(ctx: DataOpsContext) {
  if (!ctx.vector?.enabled || !ctx.vector.store) {
    return null;
  }
  return ctx.vector.store;
}
