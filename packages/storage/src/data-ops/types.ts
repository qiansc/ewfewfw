/**
 * Data Ops 共享类型与存储抽象接口
 */

import type { Entity, EntityStatus, EntityType, FeatStatus } from '../adapter.js';
import type { CompensationLog } from './transaction/types.js';
import type { WorkflowState, WorkflowStateRecord } from './workflow/types.js';

// ============================================================
// 通用结果类型
// ============================================================

export interface UpdateResult {
  affectedRows: number;
}

// ============================================================
// Data Ops 上下文
// ============================================================

export interface VectorStoreLike {
  add(key: string, embedding: Float32Array): void;
  remove(key: string): void;
  save(): void;
}

export interface DataOpsContext {
  storage: StorageOperations;
  config: {
    defaultProject: string;
    enableVectorSearch: boolean;
  };
  vector?: {
    enabled: boolean;
    store: VectorStoreLike | null;
  };
}

// ============================================================
// Feat / Merge 相关类型
// ============================================================

export interface FeatRecord {
  uuid?: string;
  id: string;
  status: FeatStatus;
  checklist?: string | null;
  checklist_version?: string | null;
  workflow_steps?: string | null;
  updated_at?: string;
}

export interface FeatEntityContentHash {
  id: string;
  content_hash: string;
}

export interface FeatEntityConflictRow {
  id: string;
  root_id: string;
  type: string;
  kind: string | null;
  data: string;
  content_hash: string;
}

export interface MainEntityConflictRow {
  type: string;
  kind: string | null;
  data: string;
  content_hash: string;
}

export interface FeatMergeEntity {
  id: string;
  root_id: string;
  type: string;
  kind: string | null;
  scope: string | null;
  perspective: string | null;
  data: string;
  status: string;
  content_hash: string;
  updated_at?: string;
}

export interface VectorEntity {
  uuid: string;
  id: string;
  root_id: string | null;
  data: string;
}

export interface FeatHistoryRecord {
  feat_id: string;
  published_at: string;
  published_by: string | null;
  snapshot: Entity[];
}

// ============================================================
// Storage Operations 抽象接口
// ============================================================

export interface StorageOperations {
  transaction<T>(fn: (tx: StorageOperations) => T): T;

  // Feat 基础信息
  getFeat(featId: string): FeatRecord | null;
  createFeat(input: {
    id: string;
    status: FeatStatus;
    title: string;
    description: string;
    created_by: string;
    created_at: string;
    updated_at: string;
  }): void;
  updateFeatStatus(featId: string, status: FeatStatus, updatedAt: string): UpdateResult;
  updateFeatWorkflowSteps(params: {
    featId: string;
    workflowSteps: string;
    updatedAt: string;
    expectedUpdatedAt: string;
  }): UpdateResult;
  updateFeatChecklist(params: {
    featId: string;
    checklist: string | null;
    checklistVersion: string | null;
    expectedVersion: string | null;
    updatedAt: string;
    expectedUpdatedAt: string;
  }): UpdateResult;
  clearFeatChecklist(featId: string): void;
  deleteFeat(featId: string): void;

  // Feat 内容哈希
  getFeatEntityContentHashes(featId: string): FeatEntityContentHash[];

  // Feat 合并与冲突
  listFeatEntitiesForConflict(featId: string): FeatEntityConflictRow[];
  getMainEntityForConflict(
    entityId: string,
    rootId: string
  ): MainEntityConflictRow | null;
  listFeatEntityProjects(
    featId: string,
    entityId: string
  ): Array<{ uuid: string }>;
  deleteFeatEntity(featId: string, entityId: string): void;
  listFeatEntitiesForMerge(featId: string): FeatMergeEntity[];
  deleteMainEntity(entityId: string, rootId: string): void;
  moveFeatEntitiesToMain(featId: string, updatedAt: string): void;

  // Feat 向量/清理
  listFeatEntitiesForVector(featId: string): VectorEntity[];
  deleteEntitiesByRequirementId(featId: string): void;
  deleteMetadataByRequirementId(featId: string): void;
  deleteRelationsByRequirementId(featId: string): void;

  // Compensation logs
  insertCompensationLog(input: {
    id: string;
    transactionId: string;
    action: string;
    rollbackAction: string;
    params?: Record<string, unknown>;
    executed: boolean;
    createdAt: string;
  }): void;
  listCompensationLogs(transactionId: string): CompensationLog[];
  markCompensationExecuted(logId: string): void;

  // Feat 历史
  getFeatHistorySnapshot(featId: string): Entity[];
  getLatestFeatHistory(featId: string): FeatHistoryRecord | null;
  insertFeatHistory(input: {
    featId: string;
    publishedAt: string;
    publishedBy: string | null;
    snapshot: Entity[];
  }): void;
  trimFeatHistory(featId: string, limit: number): void;

  // Sync 操作
  getEntityContentHash(params: {
    entityId: string;
    rootId: string;
    requirementId?: string | null;
  }): string | null;
  insertEntity(params: {
    entityId: string;
    rootId: string;
    entityType: EntityType;
    entityKind?: string | null;
    entityScope?: string | null;
    entityPerspective?: string | null;
    data: Record<string, unknown>;
    contentHash: string;
    requirementId?: string | null;
    status?: string;
    createdAt: string;
    updatedAt: string;
  }): void;
  updateEntity(params: {
    entityId: string;
    rootId: string;
    requirementId?: string | null;
    entityType: EntityType;
    data: Record<string, unknown>;
    contentHash: string;
    updatedAt: string;
  }): UpdateResult;
  listEntitiesForExport(params: {
    statusFilter: 'published' | 'approved' | 'all';
  }): Array<{
    id: string;
    type: EntityType;
    data: string;
    status: string;
    content_hash: string;
    updated_at?: string;
  }>;
  listEntitiesForPlanSync(params: {
    requirementId?: string | null;
    statusFilter: 'published' | 'approved' | 'all';
  }): Array<{
    id: string;
    type: EntityType;
    data: string;
    content_hash: string;
  }>;

  // Reference / Copy-on-Write
  getEntityInFeat(params: { entityId: string; featId: string }): Entity | null;
  listMainEntities(entityId: string): Entity[];
  insertEntityWithMetadata(params: {
    entity: Entity;
    requirementId: string;
    status: EntityStatus;
    createdAt: string;
    updatedAt: string;
  }): void;

  // Workflow 状态管理
  getWorkflowStateRecord(workflowId: string): WorkflowStateRecord | null;
  upsertWorkflowState(record: WorkflowStateRecord): void;
  markEntitiesOrphaned(requirementId: string, timestamp: string): void;
  cleanupOrphanedEntities(cutoff: string): Array<{ id: string; root_id: string; requirement_id: string }>;

}
