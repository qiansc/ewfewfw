import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerAdapter } from '../server-adapter.js';
import { migrateLocalToServer } from '../mode-switch.js';

const TMP_DIR = join(process.cwd(), '.tmp');

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function createTempPath(prefix: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return join(TMP_DIR, `${prefix}-${suffix}.json`);
}

type StoredEntity = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  proposal_id: string | null;
  metadata: {
    source_project: string;
    status: string;
    content_hash: string;
    created_at: string;
    updated_at: string;
  };
};

class FakeServerAdapter {
  private entities = new Map<string, StoredEntity>();
  private feats = new Map<string, { status: string }>();
  private relations: Array<{ from_id: string; to_id: string; rel_type: string }> = [];
  private deletions: Array<{ id: string; proposal_id: string | null }> = [];
  private failOnSaveId?: string;
  public transitions: Array<{ feat_id: string; to_status?: string }> = [];
  public checklistActions: Array<{ action: string; feat_id: string }> = [];
  public lastSavedEntity: StoredEntity | null = null;

  constructor(options?: { seed?: StoredEntity[]; failOnSaveId?: string }) {
    if (options?.seed) {
      for (const entity of options.seed) {
        this.entities.set(this.buildKey(entity.id, entity.proposal_id), entity);
      }
    }
    this.failOnSaveId = options?.failOnSaveId;
  }

  private buildKey(id: string, proposalId?: string | null): string {
    return `${id}::${proposalId ?? ''}`;
  }

  seedFeat(id: string): void {
    this.feats.set(id, { status: 'draft' });
  }

  async read(params: { id: string; proposal_id?: string | null }): Promise<{ entity: StoredEntity } | null> {
    const key = this.buildKey(params.id, params.proposal_id ?? null);
    const entity = this.entities.get(key);
    return entity ? { entity } : null;
  }

  async save(params: {
    id: string;
    type: string;
    data: Record<string, unknown>;
    source_project?: string;
    proposal_id?: string | null;
  }): Promise<{ success: boolean; id: string; status: string; content_hash: string }> {
    if (this.failOnSaveId && params.id === this.failOnSaveId) {
      throw new Error('save failed');
    }
    const now = new Date().toISOString();
    const entity: StoredEntity = {
      id: params.id,
      type: params.type,
      data: params.data,
      proposal_id: params.proposal_id ?? null,
      metadata: {
        source_project: params.source_project ?? 'default',
        status: 'published',
        content_hash: 'hash',
        created_at: now,
        updated_at: now,
      },
    };
    this.entities.set(this.buildKey(params.id, params.proposal_id ?? null), entity);
    this.lastSavedEntity = entity;
    return { success: true, id: params.id, status: 'published', content_hash: 'hash' };
  }

  async delete(params: { id: string; proposal_id?: string | null }): Promise<{ success: boolean; id: string }> {
    this.entities.delete(this.buildKey(params.id, params.proposal_id ?? null));
    this.deletions.push({ id: params.id, proposal_id: params.proposal_id ?? null });
    return { success: true, id: params.id };
  }

  async saveRelation(params: { from_id: string; to_id: string; rel_type: string }): Promise<void> {
    this.relations.push({
      from_id: params.from_id,
      to_id: params.to_id,
      rel_type: params.rel_type,
    });
  }

  async featLifecycle(params: {
    action: string;
    feat_id: string;
    to_status?: string;
  }): Promise<{ success: boolean; feat_id: string; error?: string }> {
    if (params.action === 'create') {
      if (this.feats.has(params.feat_id)) {
        return { success: false, feat_id: params.feat_id, error: 'FEAT_EXISTS' };
      }
      this.feats.set(params.feat_id, { status: 'draft' });
      return { success: true, feat_id: params.feat_id };
    }
    if (params.action === 'delete') {
      this.feats.delete(params.feat_id);
      return { success: true, feat_id: params.feat_id };
    }
    if (params.action === 'transition') {
      this.transitions.push({ feat_id: params.feat_id, to_status: params.to_status });
      const feat = this.feats.get(params.feat_id);
      if (feat && params.to_status) {
        feat.status = params.to_status;
      }
      return { success: true, feat_id: params.feat_id };
    }
    return { success: true, feat_id: params.feat_id };
  }

  async featChecklist(params: { feat_id: string; action: string }): Promise<{ success: boolean; feat_id: string }> {
    this.checklistActions.push({ action: params.action, feat_id: params.feat_id });
    return { success: true, feat_id: params.feat_id };
  }

  size(): number {
    return this.entities.size;
  }

  relationCount(): number {
    return this.relations.length;
  }

  deletionCount(): number {
    return this.deletions.length;
  }
}

describe('migrateLocalToServer', () => {
  test('imports entities into server adapter', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-local');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [
        {
          id: 'demo-system',
          type: 'system',
          data: { id: 'demo-system', name: 'Demo System' },
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            created_at: now,
            updated_at: now,
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter();
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'skip',
    });

    expect(result.success).toBe(true);
    expect(result.stats.entities.created).toBe(1);
    expect(adapter.size()).toBe(1);

    rmSync(backupPath, { force: true });
  });

  test('applies metadata and kind/scope/perspective when saving entity', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-meta');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [
        {
          id: 'meta-system',
          type: 'system',
          kind: 'implementation',
          scope: 'project',
          perspective: 'technical',
          data: { id: 'meta-system', name: 'Meta System' },
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            content_hash: 'hash-meta',
            created_at: now,
            updated_at: now,
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter();
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'skip',
    });

    expect(result.success).toBe(true);
    expect(adapter.lastSavedEntity?.data.kind).toBe('implementation');
    expect(adapter.lastSavedEntity?.data.scope).toBe('project');
    expect(adapter.lastSavedEntity?.data.perspective).toBe('technical');
    const metadata = adapter.lastSavedEntity?.data.metadata as Record<string, unknown>;
    expect(metadata.status).toBe('published');
    expect(metadata.created_at).toBe(now);
    expect(metadata.updated_at).toBe(now);

    rmSync(backupPath, { force: true });
  });

  test('transitions feat and applies checklist for non-draft status', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-feat');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [],
      relations: [],
      feats: [
        {
          id: 'feat-advanced',
          status: 'approved',
          title: 'feat-advanced',
          created_at: now,
          updated_at: now,
          checklist: { items: [{ id: 'task-1', title: 'task', status: 'pending' }] },
        },
      ],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter();
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'skip',
    });

    expect(result.success).toBe(true);
    expect(adapter.transitions.some((item) => item.to_status === 'approved')).toBe(true);
    expect(adapter.checklistActions.some((item) => item.action === 'generate')).toBe(true);
    expect(adapter.checklistActions.some((item) => item.action === 'patch')).toBe(true);

    rmSync(backupPath, { force: true });
  });

  test('skip policy avoids updating existing feat checklist', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-feat-skip');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [],
      relations: [],
      feats: [
        {
          id: 'feat-skip',
          status: 'published',
          title: 'feat-skip',
          created_at: now,
          updated_at: now,
          checklist: { items: [{ id: 'task-1', title: 'task', status: 'pending' }] },
        },
      ],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter();
    adapter.seedFeat('feat-skip');
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'skip',
    });

    expect(result.success).toBe(true);
    expect(adapter.checklistActions.length).toBe(0);
    expect(adapter.transitions.length).toBe(0);

    rmSync(backupPath, { force: true });
  });

  test('merge policy skips when existing entity is newer', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-merge');
    const now = new Date().toISOString();
    const older = new Date(Date.now() - 1000).toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [
        {
          id: 'demo-system',
          type: 'system',
          data: { id: 'demo-system', name: 'Old' },
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            content_hash: 'hash-old',
            created_at: older,
            updated_at: older,
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter({
      seed: [
        {
          id: 'demo-system',
          type: 'system',
          data: { id: 'demo-system', name: 'New' },
          proposal_id: null,
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            content_hash: 'hash-new',
            created_at: now,
            updated_at: now,
          },
        },
      ],
    });
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'merge',
    });

    expect(result.stats.entities.skipped).toBe(1);
    expect(result.conflicts?.[0]?.reason).toBe('existing_newer');
    expect(adapter.size()).toBe(1);

    rmSync(backupPath, { force: true });
  });

  test('permission policy skip records failure and continues', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-permission');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [
        {
          id: 'demo-system',
          type: 'system',
          data: { id: 'demo-system', name: 'Demo System' },
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            created_at: now,
            updated_at: now,
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter();
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'skip',
      permissionPolicy: 'skip',
      permissionChecker: () => ({ allowed: false, reason: 'no access' }),
    });

    expect(result.success).toBe(false);
    expect(result.stats.entities.skipped).toBe(1);
    expect(result.failures?.length).toBe(1);
    expect(adapter.size()).toBe(0);

    rmSync(backupPath, { force: true });
  });

  test('rollbackOnFailure deletes created entities when failFast is enabled', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-rollback');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [
        {
          id: 'entity-1',
          type: 'system',
          data: { id: 'entity-1', name: 'One' },
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            created_at: now,
            updated_at: now,
          },
          proposal_id: null,
        },
        {
          id: 'entity-2',
          type: 'system',
          data: { id: 'entity-2', name: 'Two' },
          metadata: {
            source_project: 'demo-project',
            status: 'published',
            created_at: now,
            updated_at: now,
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter({ failOnSaveId: 'entity-2' });
    let thrown: unknown;
    try {
      await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
        conflictPolicy: 'skip',
        rollbackOnFailure: true,
        failFast: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(adapter.deletionCount()).toBe(1);

    rmSync(backupPath, { force: true });
  });

  test('imports relations when server adapter supports saveRelation', async () => {
    ensureTmpDir();
    const backupPath = createTempPath('migrate-relations');
    const now = new Date().toISOString();
    const backup = {
      version: '0.3.0',
      exported_at: now,
      entities: [],
      relations: [
        {
          from_id: 'a',
          to_id: 'b',
          rel_type: 'depends_on',
        },
      ],
      feats: [],
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const adapter = new FakeServerAdapter();
    const result = await migrateLocalToServer(backupPath, adapter as unknown as ServerAdapter, {
      conflictPolicy: 'skip',
    });

    expect(result.stats.relations.created).toBe(1);
    expect(adapter.relationCount()).toBe(1);

    rmSync(backupPath, { force: true });
  });
});
