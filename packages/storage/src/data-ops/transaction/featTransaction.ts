import { randomUUID } from 'node:crypto';
import type { DataOpsContext } from '../types.js';
import { collectFeatEntitiesForVector, mergeFeatToMain, updateVectorIndexAfterMerge } from '../feat/merge.js';
import type { FeatTransactionRecord, TransactionContext, TransactionStatus } from './types.js';

/**
 * Feat 事务
 */
export function beginFeatTransaction(ctx: DataOpsContext, featId: string): TransactionContext {
  const now = new Date().toISOString();
  const projectIds = collectFeatProjectIds(ctx, featId);
  return {
    id: `feat_tx_${randomUUID()}`,
    feat_ids: [featId],
    status: 'pending',
    created_at: now,
    updated_at: now,
    project_ids: projectIds,
  };
}

export function updateFeatTransactionStatus(
  record: FeatTransactionRecord,
  status: TransactionStatus
): FeatTransactionRecord {
  return {
    ...record,
    status,
    updated_at: new Date().toISOString(),
  };
}

export async function commitFeatTransaction(
  ctx: DataOpsContext,
  transaction: TransactionContext
): Promise<void> {
  if (transaction.status !== 'pending') {
    throw new Error(`Transaction ${transaction.id} is not pending`);
  }

  if (transaction.feat_ids.length === 0) {
    throw new Error(`Transaction ${transaction.id} has no feat ids`);
  }

  const vectorEntitiesByFeat = new Map<string, ReturnType<typeof collectFeatEntitiesForVector>>();
  if (ctx.vector?.enabled && ctx.vector.store) {
    for (const featId of transaction.feat_ids) {
      vectorEntitiesByFeat.set(featId, collectFeatEntitiesForVector(ctx.storage, featId));
    }
  }

  const now = new Date().toISOString();

  try {
    ctx.storage.transaction((tx) => {
      for (const featId of transaction.feat_ids) {
        const result = tx.updateFeatStatus(featId, 'published', now);
        if (result.affectedRows === 0) {
          throw new Error(`Feat ${featId} not found`);
        }
        mergeFeatToMain(tx, featId, { recordHistory: true });
      }
    });

    if (ctx.vector?.enabled && ctx.vector.store) {
      for (const [featId, entities] of vectorEntitiesByFeat.entries()) {
        await updateVectorIndexAfterMerge(ctx, featId, entities);
      }
    }

    transaction.status = 'committed';
    transaction.updated_at = new Date().toISOString();
  } catch (error) {
    transaction.status = 'failed';
    transaction.updated_at = new Date().toISOString();
    transaction.error = error instanceof Error ? error.message : 'unknown_error';
    throw error;
  }
}

export async function rollbackFeatTransaction(
  _ctx: DataOpsContext,
  transaction: TransactionContext
): Promise<void> {
  if (transaction.status === 'committed') {
    throw new Error(`Transaction ${transaction.id} is already committed`);
  }
  if (transaction.status === 'rolled_back') {
    return;
  }

  transaction.status = 'rolled_back';
  transaction.updated_at = new Date().toISOString();
}

function collectFeatProjectIds(ctx: DataOpsContext, featId: string): string[] {
  const projects = new Set<string>();
  const entities = ctx.storage.listFeatEntitiesForMerge(featId);
  for (const entity of entities) {
    if (entity.source_project) {
      projects.add(entity.source_project);
    }
  }
  return Array.from(projects);
}
