import type { StorageOperations, FeatHistoryRecord } from '../data-ops/types.js';
import type { Entity } from '../adapter.js';
import type { EntityRow } from './types.js';
import type { Database, GetFeat } from './dataOpsTypes.js';
import { rowToEntity } from './helpers.js';

export function createHistoryOperations(
  db: Database,
  getFeat: GetFeat
): Pick<
  StorageOperations,
  | 'insertCompensationLog'
  | 'listCompensationLogs'
  | 'markCompensationExecuted'
  | 'getFeatHistorySnapshot'
  | 'getLatestFeatHistory'
  | 'insertFeatHistory'
  | 'trimFeatHistory'
> {
  const insertCompensationLog: StorageOperations['insertCompensationLog'] = (input) => {
    db.prepare(
      `
        INSERT INTO compensation_logs (
          id, transaction_id, action, rollback_action, params_json, executed, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      input.id,
      input.transactionId,
      input.action,
      input.rollbackAction,
      input.params ? JSON.stringify(input.params) : null,
      input.executed ? 1 : 0,
      input.createdAt
    );
  };

  const listCompensationLogs: StorageOperations['listCompensationLogs'] = (transactionId) => {
    const rows = db.prepare(
      `
        SELECT id, transaction_id, action, rollback_action, params_json, executed, created_at
        FROM compensation_logs
        WHERE transaction_id = ?
        ORDER BY created_at DESC, id DESC
      `
    ).all(transactionId) as Array<{
      id: string;
      transaction_id: string;
      action: string;
      rollback_action: string;
      params_json: string | null;
      executed: number;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      transaction_id: row.transaction_id,
      action: row.action,
      rollback_action: row.rollback_action,
      params: row.params_json ? (JSON.parse(row.params_json) as Record<string, unknown>) : undefined,
      executed: row.executed === 1,
      created_at: row.created_at,
    }));
  };

  const markCompensationExecuted: StorageOperations['markCompensationExecuted'] = (logId) => {
    db.prepare(
      `
        UPDATE compensation_logs
        SET executed = 1
        WHERE id = ?
      `
    ).run(logId);
  };

  const getFeatHistorySnapshot: StorageOperations['getFeatHistorySnapshot'] = (featId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return [];
    const rows = db.prepare(
      `
        SELECT e.uuid, e.root_id, e.id, e.type, e.kind, e.scope, e.perspective, e.data,
               e.requirement_id, e.component_id,
               m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
               m.created_by, m.updated_by
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.requirement_id = ? AND e.type NOT IN ('feat', 'checklist')
      `
    ).all(feat.uuid) as EntityRow[];
    return rows.map((row) => rowToEntity(row));
  };

  const getLatestFeatHistory: StorageOperations['getLatestFeatHistory'] = (featId) => {
    const row = db.prepare(
      `
        SELECT feat_id, published_at, entities_snapshot, published_by
        FROM feat_history
        WHERE feat_id = ?
        ORDER BY published_at DESC
        LIMIT 1
      `
    ).get(featId) as
      | { feat_id: string; published_at: string; entities_snapshot: string; published_by: string | null }
      | undefined;

    if (!row) {
      return null;
    }

    let snapshot: Entity[] = [];
    try {
      snapshot = JSON.parse(row.entities_snapshot) as Entity[];
    } catch {
      snapshot = [];
    }

    const record: FeatHistoryRecord = {
      feat_id: row.feat_id,
      published_at: row.published_at,
      published_by: row.published_by ?? null,
      snapshot,
    };

    return record;
  };

  const insertFeatHistory: StorageOperations['insertFeatHistory'] = (input) => {
    db.prepare(
      `
        INSERT INTO feat_history (feat_id, published_at, entities_snapshot, published_by)
        VALUES (?, ?, ?, ?)
      `
    ).run(input.featId, input.publishedAt, JSON.stringify(input.snapshot), input.publishedBy);
  };

  const trimFeatHistory: StorageOperations['trimFeatHistory'] = (featId, limit) => {
    db.prepare(
      `
        DELETE FROM feat_history
        WHERE feat_id = ?
          AND id NOT IN (
            SELECT id FROM feat_history
            WHERE feat_id = ?
            ORDER BY published_at DESC
            LIMIT ?
          )
      `
    ).run(featId, featId, limit);
  };

  return {
    insertCompensationLog,
    listCompensationLogs,
    markCompensationExecuted,
    getFeatHistorySnapshot,
    getLatestFeatHistory,
    insertFeatHistory,
    trimFeatHistory,
  };
}
