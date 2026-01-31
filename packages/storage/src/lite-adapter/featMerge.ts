/**
 * LiteAdapter Feat 合并与冲突处理（委托 Data Ops）
 */

import type { SQLiteStore } from '../sqlite-store.js';
import type {
  FeatMergeParams,
  FeatMergeResult,
  FeatConflict,
} from '../adapter.js';
import type { AdapterContext } from './types.js';
import type { VectorEntity } from '../data-ops/types.js';
import { createDataOpsContext, createStorageOperationsFromDatabase } from './dataOpsContext.js';
import {
  featMerge as dataOpsFeatMerge,
  detectFeatConflicts as dataOpsDetectFeatConflicts,
  mergeFeatToMain as dataOpsMergeFeatToMain,
  collectFeatEntitiesForVector as dataOpsCollectFeatEntitiesForVector,
  updateVectorIndexAfterMerge as dataOpsUpdateVectorIndexAfterMerge,
  removeVectorIndexForEntities as dataOpsRemoveVectorIndexForEntities,
} from '../data-ops/feat/merge.js';

export async function featMerge(
  ctx: AdapterContext,
  params: FeatMergeParams
): Promise<FeatMergeResult> {
  return dataOpsFeatMerge(createDataOpsContext(ctx), params);
}

export function detectFeatConflicts(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): FeatConflict[] {
  return dataOpsDetectFeatConflicts(createStorageOperationsFromDatabase(db), featId);
}

export function mergeFeatToMain(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string,
  options: { recordHistory?: boolean; publishedBy?: string | null } = {}
): { merged: string[]; conflicts: FeatConflict[] } {
  return dataOpsMergeFeatToMain(createStorageOperationsFromDatabase(db), featId, options);
}

export function collectFeatEntitiesForVector(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): VectorEntity[] {
  return dataOpsCollectFeatEntitiesForVector(createStorageOperationsFromDatabase(db), featId);
}

export async function updateVectorIndexAfterMerge(
  ctx: AdapterContext,
  featId: string,
  entities: VectorEntity[]
): Promise<void> {
  await dataOpsUpdateVectorIndexAfterMerge(createDataOpsContext(ctx), featId, entities);
}

export function removeVectorIndexForEntities(
  ctx: AdapterContext,
  featId: string,
  entities: VectorEntity[]
): void {
  dataOpsRemoveVectorIndexForEntities(createDataOpsContext(ctx), featId, entities);
}
