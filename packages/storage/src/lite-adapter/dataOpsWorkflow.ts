import type { StorageOperations } from '../data-ops/types.js';
import type { Database } from './dataOpsTypes.js';

export function createWorkflowOperations(
  db: Database
): Pick<
  StorageOperations,
  'getWorkflowStateRecord' | 'upsertWorkflowState' | 'markEntitiesOrphaned' | 'cleanupOrphanedEntities'
> {
  const getWorkflowStateRecord: StorageOperations['getWorkflowStateRecord'] = (workflowId) => {
    const row = db.prepare(
      `
        SELECT id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
        FROM workflow_states WHERE id = ?
      `
    ).get(workflowId) as
      | {
          id: string;
          workflow_type: string;
          current_step: number;
          total_steps: number;
          state: string;
          context_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      workflow_type: row.workflow_type,
      current_step: row.current_step,
      total_steps: row.total_steps,
      state: row.state as 'pending' | 'running' | 'paused' | 'completed' | 'failed',
      context_json: row.context_json,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };

  const upsertWorkflowState: StorageOperations['upsertWorkflowState'] = (record) => {
    db.prepare(
      `
          INSERT INTO workflow_states (
            id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workflow_type = excluded.workflow_type,
            current_step = excluded.current_step,
            total_steps = excluded.total_steps,
            state = excluded.state,
            context_json = excluded.context_json,
            updated_at = excluded.updated_at
        `
    ).run(
      record.id,
      record.workflow_type,
      record.current_step,
      record.total_steps,
      record.state,
      record.context_json ?? null,
      record.created_at,
      record.updated_at
    );
  };

  const markEntitiesOrphaned: StorageOperations['markEntitiesOrphaned'] = (requirementId, timestamp) => {
    db.prepare(
      `
          UPDATE entities
          SET orphaned = 1, orphaned_at = ?
          WHERE requirement_id = ? AND orphaned = 0
        `
    ).run(timestamp, requirementId);
  };

  const cleanupOrphanedEntities: StorageOperations['cleanupOrphanedEntities'] = (cutoff) => {
    const orphanedRows = db
      .prepare(
        `
            SELECT uuid, id, root_id, requirement_id
            FROM entities
            WHERE orphaned = 1 AND orphaned_at IS NOT NULL AND orphaned_at <= ?
          `
      )
      .all(cutoff) as Array<{ uuid: string; id: string; root_id: string; requirement_id: string }>;

    for (const row of orphanedRows) {
      db.prepare(
        `
            DELETE FROM relations
            WHERE from_uuid = ? OR to_uuid = ?
          `
      ).run(row.uuid, row.uuid);
    }

    if (orphanedRows.length > 0) {
      const uuids = orphanedRows.map((row) => row.uuid);
      const placeholders = uuids.map(() => '?').join(', ');
      db.prepare(`DELETE FROM metadata WHERE entity_uuid IN (${placeholders})`).run(...uuids);
      db.prepare(`DELETE FROM entity_versions WHERE entity_uuid IN (${placeholders})`).run(...uuids);
      db.prepare(
        `
            DELETE FROM entities
            WHERE orphaned = 1 AND orphaned_at IS NOT NULL AND orphaned_at <= ?
          `
      ).run(cutoff);
    }

    return orphanedRows.map((row) => ({
      id: row.id,
      root_id: row.root_id,
      requirement_id: row.requirement_id,
    }));
  };

  return {
    getWorkflowStateRecord,
    upsertWorkflowState,
    markEntitiesOrphaned,
    cleanupOrphanedEntities,
  };
}
