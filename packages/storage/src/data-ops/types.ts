/**
 * Data Ops 共享类型与存储抽象接口
 */

import type { EntityType } from '../adapter.js';

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
// Storage Operations 抽象接口
// ============================================================

export interface StorageOperations {
  transaction<T>(fn: (tx: StorageOperations) => T): T;

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
}
