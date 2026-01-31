/**
 * Transaction 模块类型定义
 */

import type { FeatConflict } from '../../adapter.js';
export type { FeatConflict } from '../../adapter.js';

export type TransactionStatus = 'pending' | 'committed' | 'rolled_back' | 'failed';

export interface FeatTransactionRecord {
  id: string;
  feat_ids: string[];
  status: TransactionStatus;
  created_at: string;
  updated_at: string;
}

export interface TransactionContext extends FeatTransactionRecord {
  project_ids: string[];
  error?: string;
}

export type ConflictResolution = 'ours' | 'theirs' | 'manual' | 'abort';

export interface ConflictResolutionResult {
  conflict: FeatConflict;
  resolution: ConflictResolution;
  action: 'keep_feat' | 'keep_main' | 'manual' | 'abort';
  manual_required: boolean;
  message: string;
  suggestion?: string;
}

export interface RollbackFeat {
  id: string;
  target_feat_id: string;
  reason: string;
  created_at: string;
  created_by?: string;
  status: 'draft' | 'approved' | 'published' | 'deprecated' | 'archived';
}

export interface CompensationAction {
  action: string;
  rollback_action: string;
  params?: Record<string, unknown>;
}

export interface CompensationLog extends CompensationAction {
  id: string;
  transaction_id: string;
  executed: boolean;
  created_at: string;
}
