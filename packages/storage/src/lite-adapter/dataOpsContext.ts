/**
 * LiteAdapter -> Data Ops 适配
 */

import type { AdapterContext, EntityRow } from './types.js';
import type {
  DataOpsContext,
  StorageOperations,
  UpdateResult,
  FeatRecord,
  FeatEntityContentHash,
  FeatEntityConflictRow,
  MainEntityConflictRow,
  FeatMergeEntity,
  VectorEntity,
  FeatHistoryRecord,
} from '../data-ops/types.js';
import type { EntityType, FeatStatus, Entity } from '../adapter.js';
import type { SQLiteStore } from '../sqlite-store.js';
import { rowToEntity } from './helpers.js';

type Database = ReturnType<SQLiteStore['getDatabase']>;

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

  return {
    transaction: withTransaction,

    getFeat(featId: string): FeatRecord | null {
      const feat = db.prepare(`
        SELECT id, status, checklist, checklist_version, workflow_steps, updated_at
        FROM feats WHERE id = ?
      `).get(featId) as
        | {
            id: string;
            status: FeatStatus;
            checklist: string | null;
            checklist_version: string | null;
            workflow_steps: string | null;
            updated_at: string;
          }
        | undefined;
      if (!feat) return null;
      return {
        id: feat.id,
        status: feat.status,
        checklist: feat.checklist,
        checklist_version: feat.checklist_version,
        workflow_steps: feat.workflow_steps,
        updated_at: feat.updated_at,
      };
    },

    createFeat(input): void {
      db.prepare(`
        INSERT INTO feats (id, status, title, description, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.status,
        input.title,
        input.description,
        input.created_by,
        input.created_at,
        input.updated_at
      );
    },

    updateFeatStatus(featId: string, status: FeatStatus, updatedAt: string): UpdateResult {
      const result = db.prepare(`
        UPDATE feats SET status = ?, updated_at = ? WHERE id = ?
      `).run(status, updatedAt, featId);
      return { affectedRows: result.changes ?? 0 };
    },

    updateFeatWorkflowSteps(params): UpdateResult {
      const result = db.prepare(`
        UPDATE feats
        SET workflow_steps = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(params.workflowSteps, params.updatedAt, params.featId, params.expectedUpdatedAt);
      return { affectedRows: result.changes ?? 0 };
    },

    updateFeatChecklist(params): UpdateResult {
      const result = db.prepare(`
        UPDATE feats
        SET checklist = ?, checklist_version = ?, updated_at = ?
        WHERE id = ? AND checklist_version IS ? AND updated_at = ?
      `).run(
        params.checklist,
        params.checklistVersion,
        params.updatedAt,
        params.featId,
        params.expectedVersion,
        params.expectedUpdatedAt
      );
      return { affectedRows: result.changes ?? 0 };
    },

    clearFeatChecklist(featId: string): void {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE feats SET checklist = NULL, checklist_version = NULL, updated_at = ? WHERE id = ?
      `).run(now, featId);
    },

    deleteFeat(featId: string): void {
      db.prepare(`DELETE FROM feats WHERE id = ?`).run(featId);
    },

    getFeatEntityContentHashes(featId: string): FeatEntityContentHash[] {
      return db.prepare(`
        SELECT e.id, m.content_hash
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.proposal_id = ?
        ORDER BY e.id
      `).all(featId) as FeatEntityContentHash[];
    },

    listFeatEntitiesForConflict(featId: string): FeatEntityConflictRow[] {
      return db.prepare(`
        SELECT e.id, e.source_project, e.type, e.kind, e.data, m.content_hash
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.proposal_id = ?
      `).all(featId) as FeatEntityConflictRow[];
    },

    getMainEntityForConflict(
      entityId: string,
      sourceProject: string
    ): MainEntityConflictRow | null {
      const row = db.prepare(`
        SELECT e.type, e.kind, e.data, m.content_hash
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ? AND e.source_project = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
      `).get(entityId, sourceProject) as MainEntityConflictRow | undefined;
      return row ?? null;
    },

    listFeatEntityProjects(featId: string, entityId: string): Array<{ source_project: string | null }> {
      return db.prepare(`
        SELECT source_project FROM entities WHERE id = ? AND proposal_id = ?
      `).all(entityId, featId) as Array<{ source_project: string | null }>;
    },

    deleteFeatEntity(featId: string, entityId: string): void {
      db.prepare(`
        DELETE FROM entities WHERE id = ? AND proposal_id = ?
      `).run(entityId, featId);
    },

    listFeatEntitiesForMerge(featId: string): FeatMergeEntity[] {
      return db.prepare(`
        SELECT e.id, e.source_project, e.type, e.kind, e.scope, e.perspective, e.data,
               m.status, m.content_hash, m.updated_at
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.proposal_id = ?
      `).all(featId) as FeatMergeEntity[];
    },

    deleteMainEntity(entityId: string, sourceProject: string): void {
      db.prepare(`
        DELETE FROM entities
        WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).run(entityId, sourceProject);

      db.prepare(`
        DELETE FROM metadata
        WHERE entity_id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).run(entityId, sourceProject);

      db.prepare(`
        DELETE FROM relations
        WHERE (from_id = ? OR to_id = ?) AND from_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).run(entityId, entityId, sourceProject);
    },

    moveFeatEntitiesToMain(featId: string, updatedAt: string): void {
      db.prepare(`
        UPDATE entities SET proposal_id = '' WHERE proposal_id = ?
      `).run(featId);

      db.prepare(`
        UPDATE metadata SET proposal_id = '', status = 'published', updated_at = ?
        WHERE proposal_id = ?
      `).run(updatedAt, featId);

      db.prepare(`
        UPDATE relations
        SET proposal_id = ''
        WHERE proposal_id = ? AND (status IS NULL OR status != 'deleted')
      `).run(featId);

      db.prepare(`
        DELETE FROM relations WHERE proposal_id = ? AND status = 'deleted'
      `).run(featId);
    },

    listFeatEntitiesForVector(featId: string): VectorEntity[] {
      return db.prepare(`
        SELECT id, source_project, data
        FROM entities
        WHERE proposal_id = ?
      `).all(featId) as VectorEntity[];
    },

    deleteEntitiesByProposalId(featId: string): void {
      db.prepare(`DELETE FROM entities WHERE proposal_id = ?`).run(featId);
    },

    deleteMetadataByProposalId(featId: string): void {
      db.prepare(`DELETE FROM metadata WHERE proposal_id = ?`).run(featId);
    },

    deleteRelationsByProposalId(featId: string): void {
      db.prepare(`DELETE FROM relations WHERE proposal_id = ?`).run(featId);
    },

    insertCompensationLog(input): void {
      db.prepare(`
        INSERT INTO compensation_logs (
          id, transaction_id, action, rollback_action, params_json, executed, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.transactionId,
        input.action,
        input.rollbackAction,
        input.params ? JSON.stringify(input.params) : null,
        input.executed ? 1 : 0,
        input.createdAt
      );
    },

    listCompensationLogs(transactionId: string) {
      const rows = db.prepare(`
        SELECT id, transaction_id, action, rollback_action, params_json, executed, created_at
        FROM compensation_logs
        WHERE transaction_id = ?
        ORDER BY created_at DESC, id DESC
      `).all(transactionId) as Array<{
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
    },

    markCompensationExecuted(logId: string): void {
      db.prepare(`
        UPDATE compensation_logs
        SET executed = 1
        WHERE id = ?
      `).run(logId);
    },

    getFeatHistorySnapshot(featId: string): Entity[] {
      const rows = db.prepare(`
        SELECT e.id, e.source_project, e.proposal_id, e.type, e.kind, e.scope, e.perspective, e.data,
               m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
               m.created_by, m.updated_by
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE (e.proposal_id IS NULL OR e.proposal_id = '')
          AND EXISTS (
            SELECT 1 FROM entities f
            WHERE f.proposal_id = ?
              AND f.id = e.id
              AND f.source_project = e.source_project
          )
      `).all(featId) as EntityRow[];
      return rows.map(rowToEntity);
    },

    getLatestFeatHistory(featId: string): FeatHistoryRecord | null {
      const row = db.prepare(`
        SELECT feat_id, published_at, entities_snapshot, published_by
        FROM feat_history
        WHERE feat_id = ?
        ORDER BY published_at DESC
        LIMIT 1
      `).get(featId) as
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

      return {
        feat_id: row.feat_id,
        published_at: row.published_at,
        published_by: row.published_by ?? null,
        snapshot,
      };
    },

    insertFeatHistory(input): void {
      db.prepare(`
        INSERT INTO feat_history (feat_id, published_at, entities_snapshot, published_by)
        VALUES (?, ?, ?, ?)
      `).run(input.featId, input.publishedAt, JSON.stringify(input.snapshot), input.publishedBy);
    },

    trimFeatHistory(featId: string, limit: number): void {
      db.prepare(`
        DELETE FROM feat_history
        WHERE feat_id = ?
          AND id NOT IN (
            SELECT id FROM feat_history
            WHERE feat_id = ?
            ORDER BY published_at DESC
            LIMIT ?
          )
      `).run(featId, featId, limit);
    },

    getEntityContentHash(params): string | null {
      if (params.proposalId) {
        const row = db.prepare(`
          SELECT content_hash FROM metadata
          WHERE entity_id = ? AND source_project = ? AND proposal_id = ?
        `).get(params.entityId, params.sourceProject, params.proposalId) as
          | { content_hash: string }
          | undefined;
        return row?.content_hash ?? null;
      }
      const row = db.prepare(`
        SELECT content_hash FROM metadata
        WHERE entity_id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
      `).get(params.entityId, params.sourceProject) as { content_hash: string } | undefined;
      return row?.content_hash ?? null;
    },

    insertEntity(params): void {
      const proposalId = params.proposalId ?? '';
      const status = params.status ?? 'published';
      db.prepare(`
        INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.entityId,
        params.sourceProject,
        proposalId,
        params.entityType,
        params.entityKind ?? null,
        params.entityScope ?? null,
        params.entityPerspective ?? null,
        JSON.stringify(params.data)
      );

      db.prepare(`
        INSERT INTO metadata (entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.entityId,
        params.sourceProject,
        proposalId,
        status,
        params.contentHash,
        params.createdAt,
        params.updatedAt
      );
    },

    updateEntity(params): UpdateResult {
      const proposalId = params.proposalId ?? null;
      const condition = proposalId
        ? { clause: 'proposal_id = ?', args: [proposalId] }
        : { clause: "(proposal_id IS NULL OR proposal_id = '')", args: [] };

      db.prepare(`
        UPDATE entities SET type = ?, data = ?
        WHERE id = ? AND source_project = ? AND ${condition.clause}
      `).run(
        params.entityType,
        JSON.stringify(params.data),
        params.entityId,
        params.sourceProject,
        ...condition.args
      );

      const result = db.prepare(`
        UPDATE metadata SET content_hash = ?, updated_at = ?
        WHERE entity_id = ? AND source_project = ? AND ${condition.clause}
      `).run(
        params.contentHash,
        params.updatedAt,
        params.entityId,
        params.sourceProject,
        ...condition.args
      );

      return { affectedRows: result.changes ?? 0 };
    },

    listEntitiesForExport(params): Array<{
      id: string;
      type: EntityType;
      data: string;
      status: string;
      content_hash: string;
      updated_at?: string;
    }> {
      const statusCondition = buildStatusCondition(params.statusFilter);
      return db.prepare(`
        SELECT e.id, e.type, e.data, m.status, m.content_hash, m.updated_at
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE (e.proposal_id IS NULL OR e.proposal_id = '') ${statusCondition}
      `).all() as Array<{
        id: string;
        type: EntityType;
        data: string;
        status: string;
        content_hash: string;
        updated_at?: string;
      }>;
    },

    listEntitiesForPlanSync(params): Array<{
      id: string;
      type: EntityType;
      data: string;
      content_hash: string;
    }> {
      const statusCondition = buildStatusCondition(params.statusFilter);
      return db.prepare(`
        SELECT e.id, e.type, e.data, m.content_hash
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE (e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = '') ${statusCondition}
      `).all(params.proposalId ?? null) as Array<{
        id: string;
        type: EntityType;
        data: string;
        content_hash: string;
      }>;
    },

    getEntityInFeat(params: { entityId: string; featId: string }): Entity | null {
      const row = db.prepare(`
        SELECT e.id, e.source_project, e.proposal_id, e.type, e.kind, e.scope, e.perspective, e.data,
               m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
               m.created_by, m.updated_by
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ? AND e.proposal_id = ?
      `).get(params.entityId, params.featId) as EntityRow | undefined;
      return row ? rowToEntity(row) : null;
    },

    listMainEntities(entityId: string): Entity[] {
      const rows = db.prepare(`
        SELECT e.id, e.source_project, e.proposal_id, e.type, e.kind, e.scope, e.perspective, e.data,
               m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
               m.created_by, m.updated_by
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
      `).all(entityId) as EntityRow[];
      return rows.map(rowToEntity);
    },

    insertEntityWithMetadata(params): void {
      const proposalId = params.proposalId;
      const entity = params.entity;
      const metadata = entity.metadata;

      db.prepare(`
        INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entity.id,
        metadata.source_project,
        proposalId,
        entity.type,
        entity.kind ?? null,
        entity.scope ?? null,
        entity.perspective ?? null,
        JSON.stringify(entity.data)
      );

      db.prepare(`
        INSERT INTO metadata (
          entity_id,
          source_project,
          proposal_id,
          source_repo,
          external_url,
          status,
          content_hash,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entity.id,
        metadata.source_project,
        proposalId,
        metadata.source_repo ?? null,
        metadata.external_url ?? null,
        params.status,
        metadata.content_hash,
        params.createdAt,
        params.updatedAt,
        metadata.created_by ?? null,
        metadata.updated_by ?? null
      );
    },

    getWorkflowStateRecord(workflowId: string) {
      const row = db.prepare(`
        SELECT id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
        FROM workflow_states WHERE id = ?
      `).get(workflowId) as
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
    },

    upsertWorkflowState(record): void {
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
    },

    markEntitiesOrphaned(proposalId: string, timestamp: string): void {
      db.prepare(
        `
          UPDATE entities
          SET orphaned = 1, orphaned_at = ?
          WHERE proposal_id = ? AND orphaned = 0
        `
      ).run(timestamp, proposalId);
    },

    cleanupOrphanedEntities(cutoff: string) {
      const orphanedRows = db
        .prepare(
          `
            SELECT id, source_project, proposal_id
            FROM entities
            WHERE orphaned = 1 AND orphaned_at IS NOT NULL AND orphaned_at <= ?
          `
        )
        .all(cutoff) as Array<{ id: string; source_project: string; proposal_id: string }>;

      for (const row of orphanedRows) {
        db.prepare(
          `
            DELETE FROM metadata
            WHERE entity_id = ? AND source_project = ? AND proposal_id = ?
          `
        ).run(row.id, row.source_project, row.proposal_id);

        db.prepare(
          `
            DELETE FROM relations
            WHERE proposal_id = ? AND (from_id = ? OR to_id = ?)
          `
        ).run(row.proposal_id, row.id, row.id);
      }

      if (orphanedRows.length > 0) {
        db.prepare(
          `
            DELETE FROM entities
            WHERE orphaned = 1 AND orphaned_at IS NOT NULL AND orphaned_at <= ?
          `
        ).run(cutoff);
      }

      return orphanedRows;
    },
  };
}

function buildStatusCondition(statusFilter: 'published' | 'approved' | 'all'): string {
  if (statusFilter === 'published') {
    return "AND m.status = 'published'";
  }
  if (statusFilter === 'approved') {
    return "AND m.status IN ('published', 'approved')";
  }
  return '';
}
