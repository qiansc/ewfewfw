/**
 * Data Ops 共享类型与存储抽象接口
 */

import type { Entity, EntityType, FeatStatus } from '../adapter.js';
import type { CompensationLog } from './transaction/types.js';

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
  id: string;
  status: FeatStatus;
  workflow_steps?: string | null;
  updated_at?: string;
}

export interface FeatEntityContentHash {
  id: string;
  content_hash: string;
}

export interface FeatEntityConflictRow {
  id: string;
  source_project: string;
  data: string;
  content_hash: string;
}

export interface MainEntityConflictRow {
  data: string;
  content_hash: string;
}

export interface FeatMergeEntity {
  id: string;
  source_project: string;
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
  id: string;
  source_project: string | null;
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
  clearFeatChecklist(featId: string): void;
  deleteFeat(featId: string): void;

  // Feat 内容哈希
  getFeatEntityContentHashes(featId: string): FeatEntityContentHash[];

  // Feat 合并与冲突
  listFeatEntitiesForConflict(featId: string): FeatEntityConflictRow[];
  getMainEntityForConflict(
    entityId: string,
    sourceProject: string
  ): MainEntityConflictRow | null;
  listFeatEntityProjects(
    featId: string,
    entityId: string
  ): Array<{ source_project: string | null }>;
  deleteFeatEntity(featId: string, entityId: string): void;
  listFeatEntitiesForMerge(featId: string): FeatMergeEntity[];
  deleteMainEntity(entityId: string, sourceProject: string): void;
  moveFeatEntitiesToMain(featId: string, updatedAt: string): void;

  // Feat 向量/清理
  listFeatEntitiesForVector(featId: string): VectorEntity[];
  deleteEntitiesByProposalId(featId: string): void;
  deleteMetadataByProposalId(featId: string): void;
  deleteRelationsByProposalId(featId: string): void;

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
    sourceProject: string;
    proposalId?: string | null;
  }): string | null;
  insertEntity(params: {
    entityId: string;
    sourceProject: string;
    entityType: EntityType;
    entityKind?: string | null;
    entityScope?: string | null;
    entityPerspective?: string | null;
    data: Record<string, unknown>;
    contentHash: string;
    proposalId?: string | null;
    status?: string;
    createdAt: string;
    updatedAt: string;
  }): void;
  updateEntity(params: {
    entityId: string;
    sourceProject: string;
    proposalId?: string | null;
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
    proposalId?: string | null;
    statusFilter: 'published' | 'approved' | 'all';
  }): Array<{
    id: string;
    type: EntityType;
    data: string;
    content_hash: string;
  }>;

}
