import { randomUUID } from 'node:crypto';
import type { StorageOperations } from '../data-ops/types.js';
import type { FeatStatus } from '../adapter.js';
import type { Database } from './dataOpsTypes.js';

export function createFeatOperations(
  db: Database
): Pick<
  StorageOperations,
  | 'getFeat'
  | 'createFeat'
  | 'updateFeatStatus'
  | 'updateFeatWorkflowSteps'
  | 'updateFeatChecklist'
  | 'clearFeatChecklist'
  | 'deleteFeat'
> {
  const getFeat: StorageOperations['getFeat'] = (featId) => {
    const featRow = db.prepare(
      `
        SELECT e.uuid, e.id, e.data, m.status, m.updated_at
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.type = 'feat' AND e.id = ? AND e.root_id = ''
        LIMIT 1
      `
    ).get(featId) as
      | {
          uuid: string;
          id: string;
          data: string;
          status: FeatStatus;
          updated_at: string;
        }
      | undefined;
    if (!featRow) return null;

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(featRow.data) as Record<string, unknown>;
    } catch {
      data = {};
    }

    const checklistRow = db
      .prepare(
        `
        SELECT e.data, m.updated_at
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.type = 'checklist' AND e.requirement_id = ?
        LIMIT 1
      `
      )
      .get(featRow.uuid) as { data: string; updated_at: string } | undefined;

    return {
      uuid: featRow.uuid,
      id: featRow.id,
      status: featRow.status,
      checklist: checklistRow?.data ?? null,
      checklist_version: checklistRow?.updated_at ?? null,
      workflow_steps: typeof data.workflow_steps === 'string' ? data.workflow_steps : null,
      updated_at: featRow.updated_at,
    };
  };

  const createFeat: StorageOperations['createFeat'] = (input) => {
    const uuid = randomUUID();
    const now = input.updated_at;
    const payload = {
      id: input.id,
      title: input.title,
      description: input.description,
      created_by: input.created_by,
      workflow_steps: null,
    };

    db.prepare(
      `
        INSERT INTO entities (
          uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
        )
        VALUES (?, '', ?, 'feat', NULL, NULL, NULL, ?, NULL, NULL, 0, NULL)
      `
    ).run(uuid, input.id, JSON.stringify(payload));

    db.prepare(
      `
        INSERT INTO metadata (
          entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
        )
        VALUES (?, NULL, NULL, ?, NULL, ?, ?, ?, NULL)
      `
    ).run(uuid, input.status, input.created_at, now, input.created_by);

    db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(
      uuid,
      '0.0.0'
    );
  };

  const updateFeatStatus: StorageOperations['updateFeatStatus'] = (featId, status, updatedAt) => {
    const result = db.prepare(
      `
        UPDATE metadata
        SET status = ?, updated_at = ?
        WHERE entity_uuid IN (
          SELECT uuid FROM entities WHERE type = 'feat' AND id = ? AND root_id = ''
        )
      `
    ).run(status, updatedAt, featId);
    return { affectedRows: result.changes ?? 0 };
  };

  const updateFeatWorkflowSteps: StorageOperations['updateFeatWorkflowSteps'] = (params) => {
    const featRow = db.prepare(
      `
        SELECT e.uuid, e.data, m.updated_at
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.type = 'feat' AND e.id = ? AND e.root_id = ''
        LIMIT 1
      `
    ).get(params.featId) as { uuid: string; data: string; updated_at: string } | undefined;
    if (!featRow || featRow.updated_at !== params.expectedUpdatedAt) {
      return { affectedRows: 0 };
    }

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(featRow.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    data.workflow_steps = params.workflowSteps;

    const run = db.transaction(() => {
      db.prepare(`UPDATE entities SET data = ? WHERE uuid = ?`).run(
        JSON.stringify(data),
        featRow.uuid
      );
      return db.prepare(`UPDATE metadata SET updated_at = ? WHERE entity_uuid = ?`).run(
        params.updatedAt,
        featRow.uuid
      );
    });

    const result = run();
    return { affectedRows: result.changes ?? 0 };
  };

  const updateFeatChecklist: StorageOperations['updateFeatChecklist'] = (params) => {
    const feat = getFeat(params.featId);
    if (!feat?.uuid) {
      return { affectedRows: 0 };
    }

    if (params.expectedUpdatedAt && params.expectedUpdatedAt !== feat.updated_at) {
      return { affectedRows: 0 };
    }

    const existing = db
      .prepare(
        `
        SELECT e.uuid, m.updated_at
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.type = 'checklist' AND e.requirement_id = ?
        LIMIT 1
      `
      )
      .get(feat.uuid) as { uuid: string; updated_at: string } | undefined;

    const currentVersion = existing?.updated_at ?? null;
    if (params.expectedVersion !== undefined && params.expectedVersion !== currentVersion) {
      return { affectedRows: 0 };
    }

    if (params.checklist === null) {
      if (!existing) return { affectedRows: 0 };
      const result = db.prepare(`DELETE FROM entities WHERE uuid = ?`).run(existing.uuid);
      return { affectedRows: result.changes ?? 0 };
    }

    if (existing) {
      const run = db.transaction(() => {
        db.prepare(`UPDATE entities SET data = ? WHERE uuid = ?`).run(
          params.checklist,
          existing.uuid
        );
        return db
          .prepare(`UPDATE metadata SET updated_at = ? WHERE entity_uuid = ?`)
          .run(params.updatedAt, existing.uuid);
      });
      const result = run();
      return { affectedRows: result.changes ?? 0 };
    }

    const checklistUuid = randomUUID();
    db.prepare(
      `
        INSERT INTO entities (
          uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
        )
        VALUES (?, '', ?, 'checklist', NULL, NULL, NULL, ?, ?, NULL, 0, NULL)
      `
    ).run(checklistUuid, params.featId, params.checklist, feat.uuid);

    db.prepare(
      `
        INSERT INTO metadata (
          entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
        )
        VALUES (?, NULL, NULL, 'draft', NULL, ?, ?, NULL, NULL)
      `
    ).run(checklistUuid, params.updatedAt, params.updatedAt);

    db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(
      checklistUuid,
      '0.0.0'
    );

    return { affectedRows: 1 };
  };

  const clearFeatChecklist: StorageOperations['clearFeatChecklist'] = (featId) => {
    const now = new Date().toISOString();
    const feat = getFeat(featId);
    updateFeatChecklist({
      featId,
      checklist: null,
      checklistVersion: null,
      expectedVersion: null,
      updatedAt: now,
      expectedUpdatedAt: feat?.updated_at ?? now,
    });
  };

  const deleteFeat: StorageOperations['deleteFeat'] = (featId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return;
    db.prepare(`DELETE FROM entities WHERE uuid = ?`).run(feat.uuid);
    db.prepare(`DELETE FROM entities WHERE type = 'checklist' AND requirement_id = ?`).run(feat.uuid);
  };

  return {
    getFeat,
    createFeat,
    updateFeatStatus,
    updateFeatWorkflowSteps,
    updateFeatChecklist,
    clearFeatChecklist,
    deleteFeat,
  };
}
