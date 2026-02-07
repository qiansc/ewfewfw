/**
 * LiteAdapter -> Data Ops 适配
 */

import type { AdapterContext } from './types.js';
import type { DataOpsContext, StorageOperations } from '../data-ops/types.js';
import type { Database } from './dataOpsTypes.js';
import { createFeatOperations } from './dataOpsFeat.js';
import { createFeatEntityOperations } from './dataOpsFeatEntities.js';
import { createMainEntityOperations } from './dataOpsMainEntities.js';
import { createHistoryOperations } from './dataOpsHistory.js';
import { createWorkflowOperations } from './dataOpsWorkflow.js';

export function createDataOpsContext(ctx: AdapterContext): DataOpsContext {
  const vectorEnabled = ctx.config.enableVectorSearch && ctx.store.isVectorSearchEnabled();
  return {
    storage: createStorageOperations(ctx),
    config: {
      defaultProject: ctx.config.defaultProject,
      enableVectorSearch: ctx.config.enableVectorSearch,
    },
    vector: {
      enabled: vectorEnabled,
      store: vectorEnabled ? ctx.store.getVectorStore() : null,
    },
  };
}

export function createStorageOperations(ctx: AdapterContext): StorageOperations {
  const db = ctx.store.getDatabase();
  return createStorageOperationsWithDb(db, false);
}

export function createStorageOperationsFromDatabase(db: Database): StorageOperations {
  return createStorageOperationsWithDb(db, false);
}

function createStorageOperationsWithDb(db: Database, inTransaction: boolean): StorageOperations {
  const withTransaction = <T>(fn: (tx: StorageOperations) => T): T => {
    if (inTransaction) {
      return fn(createStorageOperationsWithDb(db, true));
    }
    const runner = db.transaction(() => fn(createStorageOperationsWithDb(db, true)));
    return runner();
  };

  const featOps = createFeatOperations(db);
  const featEntityOps = createFeatEntityOperations(db, featOps.getFeat);
  const mainEntityOps = createMainEntityOperations(db);
  const historyOps = createHistoryOperations(db, featOps.getFeat);
  const workflowOps = createWorkflowOperations(db);

  return {
    transaction: withTransaction,
    ...featOps,
    ...featEntityOps,
    ...mainEntityOps,
    ...historyOps,
    ...workflowOps,
  };
}
