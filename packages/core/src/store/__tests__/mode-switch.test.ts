/**
 * mode-switch 拆分后的备份/恢复测试
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { LocalBackup, LocalRestore, formatConflictSummary } from '../mode-switch.js';
import type { SQLiteStore } from '../sqlite-store.js';
import type { ExportData } from '../modeSwitchTypes.js';

const TMP_DIR = join(process.cwd(), '.tmp');

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function createTempPath(prefix: string, ext: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return join(TMP_DIR, `${prefix}-${suffix}.${ext}`);
}

interface EntityRow {
  id: string;
  source_project: string;
  proposal_id: string | null;
  type: string;
  kind: string | null;
  scope: string | null;
  perspective: string | null;
  data: string;
}

interface MetadataRow {
  entity_id: string;
  source_project: string;
  proposal_id: string | null;
  source_repo: string | null;
  status: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  proposal_id: string | null;
  from_project: string | null;
  from_id: string;
  to_project: string | null;
  to_id: string;
  rel_type: string;
  status: string | null;
  properties: string | null;
}

interface FeatRow {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  created_by: string | null;
  checklist: string | null;
  created_at: string;
  updated_at: string;
}

class FakeDatabase {
  entities: EntityRow[] = [];
  metadata: MetadataRow[] = [];
  relations: RelationRow[] = [];
  feats: FeatRow[] = [];

  prepare(sql: string): { all?: () => unknown[]; get?: (...args: unknown[]) => unknown; run?: (...args: unknown[]) => void } {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.includes('FROM entities e') && normalized.includes('JOIN metadata')) {
      return {
        all: () => {
          return this.entities
            .map(entity => {
              const meta = this.metadata.find(
                m =>
                  m.source_project === entity.source_project &&
                  m.entity_id === entity.id &&
                  m.proposal_id === entity.proposal_id
              );
              if (!meta) return null;
              return {
                id: entity.id,
                type: entity.type,
                kind: entity.kind,
                scope: entity.scope,
                perspective: entity.perspective,
                source_project: entity.source_project,
                proposal_id: entity.proposal_id,
                data: entity.data,
                source_repo: meta.source_repo,
                status: meta.status,
                content_hash: meta.content_hash ?? '',
                created_at: meta.created_at,
                updated_at: meta.updated_at,
              };
            })
            .filter(Boolean) as unknown[];
        },
      };
    }

    if (normalized.startsWith('SELECT id, proposal_id') && normalized.includes('FROM relations')) {
      return {
        all: () => this.relations.map(relation => ({ ...relation })),
      };
    }

    if (normalized.startsWith('SELECT id, status') && normalized.includes('FROM feats')) {
      return {
        all: () => this.feats.map(feat => ({ ...feat })),
      };
    }

    if (normalized.startsWith('SELECT updated_at FROM feats')) {
      return {
        get: (id: string) => {
          const feat = this.feats.find(item => item.id === id);
          return feat ? { updated_at: feat.updated_at } : undefined;
        },
      };
    }

    if (normalized.startsWith('INSERT INTO feats')) {
      return {
        run: (
          id: string,
          status: string,
          title: string | null,
          description: string | null,
          createdBy: string | null,
          checklist: string | null,
          createdAt: string,
          updatedAt: string
        ) => {
          this.feats.push({
            id,
            status,
            title,
            description,
            created_by: createdBy,
            checklist,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        },
      };
    }

    if (normalized.startsWith('UPDATE feats SET')) {
      return {
        run: (
          status: string,
          title: string | null,
          description: string | null,
          createdBy: string | null,
          checklist: string | null,
          updatedAt: string,
          id: string
        ) => {
          const feat = this.feats.find(item => item.id === id);
          if (!feat) return;
          feat.status = status;
          feat.title = title;
          feat.description = description;
          feat.created_by = createdBy;
          feat.checklist = checklist;
          feat.updated_at = updatedAt;
        },
      };
    }

    if (normalized.startsWith('SELECT content_hash, updated_at FROM metadata')) {
      return {
        get: (sourceProject: string, entityId: string, proposalId?: string | null) => {
          const targetProposal = proposalId === undefined ? '' : proposalId;
          const meta = this.metadata.find(
            item =>
              item.source_project === sourceProject &&
              item.entity_id === entityId &&
              (item.proposal_id === targetProposal ||
                (targetProposal === '' && (item.proposal_id === '' || item.proposal_id === null)))
          );
          if (!meta) return undefined;
          return { content_hash: meta.content_hash ?? '', updated_at: meta.updated_at };
        },
      };
    }

    if (normalized.startsWith('INSERT INTO entities')) {
      return {
        run: (
          id: string,
          sourceProject: string,
          proposalId: string | null,
          type: string,
          kind: string | null,
          scope: string | null,
          perspective: string | null,
          data: string
        ) => {
          this.entities.push({
            id,
            source_project: sourceProject,
            proposal_id: proposalId,
            type,
            kind,
            scope,
            perspective,
            data,
          });
        },
      };
    }

    if (normalized.startsWith('INSERT INTO metadata')) {
      return {
        run: (
          entityId: string,
          sourceProject: string,
          proposalId: string | null,
          sourceRepo: string | null,
          status: string,
          contentHash: string | null,
          createdAt: string,
          updatedAt: string
        ) => {
          const existing = this.metadata.find(
            item =>
              item.source_project === sourceProject &&
              item.entity_id === entityId &&
              item.proposal_id === proposalId
          );
          if (existing) {
            existing.source_repo = sourceRepo;
            existing.status = status;
            existing.content_hash = contentHash;
            existing.created_at = createdAt;
            existing.updated_at = updatedAt;
            return;
          }
          this.metadata.push({
            entity_id: entityId,
            source_project: sourceProject,
            proposal_id: proposalId,
            source_repo: sourceRepo,
            status,
            content_hash: contentHash,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        },
      };
    }

    if (normalized.startsWith('UPDATE entities SET')) {
      return {
        run: (
          type: string,
          kind: string | null,
          scope: string | null,
          perspective: string | null,
          data: string,
          sourceProject: string,
          id: string,
          proposalId: string | null
        ) => {
          const entity = this.entities.find(
            item =>
              item.source_project === sourceProject &&
              item.id === id &&
              item.proposal_id === proposalId
          );
          if (!entity) return;
          entity.type = type;
          entity.kind = kind;
          entity.scope = scope;
          entity.perspective = perspective;
          entity.data = data;
        },
      };
    }

    if (normalized.startsWith('UPDATE metadata SET')) {
      return {
        run: (
          sourceRepo: string | null,
          status: string,
          contentHash: string | null,
          updatedAt: string,
          sourceProject: string,
          entityId: string,
          proposalId: string | null
        ) => {
          const meta = this.metadata.find(
            item =>
              item.source_project === sourceProject &&
              item.entity_id === entityId &&
              item.proposal_id === proposalId
          );
          if (!meta) return;
          meta.source_repo = sourceRepo;
          meta.status = status;
          meta.content_hash = contentHash;
          meta.updated_at = updatedAt;
        },
      };
    }

    if (normalized.startsWith('INSERT OR REPLACE INTO relations')) {
      return {
        run: (
          id: string,
          proposalId: string | null,
          fromProject: string | null,
          fromId: string,
          toProject: string | null,
          toId: string,
          relType: string,
          status: string | null,
          properties: string | null
        ) => {
          const index = this.relations.findIndex(item => item.id === id);
          const record: RelationRow = {
            id,
            proposal_id: proposalId,
            from_project: fromProject,
            from_id: fromId,
            to_project: toProject,
            to_id: toId,
            rel_type: relType,
            status,
            properties,
          };
          if (index >= 0) {
            this.relations[index] = record;
          } else {
            this.relations.push(record);
          }
        },
      };
    }

    throw new Error(`Unsupported SQL: ${normalized}`);
  }
}

class FakeStore {
  constructor(private db: FakeDatabase) {}

  getDatabase(): FakeDatabase {
    return this.db;
  }

  isVectorSearchEnabled(): boolean {
    return false;
  }

  async rebuildVectorIndex(): Promise<{ total: number; indexed: number; skipped: number }> {
    return { total: 0, indexed: 0, skipped: 0 };
  }
}

let store: FakeStore;
let db: FakeDatabase;
let tmpFiles: string[] = [];

beforeEach(() => {
  ensureTmpDir();
  db = new FakeDatabase();
  store = new FakeStore(db);
});

afterEach(() => {
  for (const file of tmpFiles) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }
  tmpFiles = [];
});

describe('LocalBackup', () => {
  test('exports feats and relations with完整字段', async () => {
    const now = '2026-01-20T10:00:00Z';

    db.entities.push({
      id: 'e-commerce-system',
      source_project: 'my-project',
      proposal_id: '',
      type: 'system',
      kind: 'implementation',
      scope: 'project',
      perspective: 'technical',
      data: JSON.stringify({ name: '电商系统', description: '在线购物平台' }),
    });

    db.metadata.push({
      entity_id: 'e-commerce-system',
      source_project: 'my-project',
      proposal_id: '',
      source_repo: 'company/my-repo',
      status: 'published',
      content_hash: 'hash-001',
      created_at: now,
      updated_at: now,
    });

    db.relations.push({
      id: 'rel-001',
      proposal_id: null,
      from_project: 'my-project',
      from_id: 'e-commerce-system',
      to_project: 'my-project',
      to_id: 'e-commerce-product',
      rel_type: 'CORRESPONDS',
      status: 'active',
      properties: JSON.stringify({ weight: 1 }),
    });

    db.feats.push({
      id: 'feat-001',
      status: 'draft',
      title: '订单流重构',
      description: '拆分下单与支付流程',
      created_by: 'alice',
      checklist: JSON.stringify({ version: '1.0', items: [] }),
      created_at: now,
      updated_at: now,
    });

    const backupFile = createTempPath('backup', 'json');
    tmpFiles.push(backupFile);

    const backup = new LocalBackup(store as unknown as SQLiteStore);
    const result = await backup.backup({ output: backupFile, compress: false });

    expect(result.success).toBe(true);
    expect(result.stats.feats).toBe(1);

    const data = JSON.parse(readFileSync(backupFile, 'utf-8')) as ExportData;
    expect(data.feats).toHaveLength(1);
    expect(data.relations[0]).toMatchObject({
      id: 'rel-001',
      from_project: 'my-project',
      to_project: 'my-project',
      rel_type: 'CORRESPONDS',
      status: 'active',
    });
    expect(data.entities[0].metadata.created_at).toBe(now);
    expect(data.entities[0].proposal_id).toBeNull();
  });

  test('reports progress for each phase', async () => {
    const output = createTempPath('backup-progress', 'json');
    tmpFiles.push(output);

    db.entities.push({
      id: 'svc-a',
      source_project: 'alpha',
      proposal_id: '',
      type: 'system',
      kind: null,
      scope: null,
      perspective: null,
      data: JSON.stringify({ id: 'svc-a' }),
    });
    db.metadata.push({
      entity_id: 'svc-a',
      source_project: 'alpha',
      proposal_id: '',
      source_repo: null,
      status: 'published',
      content_hash: 'hash-a',
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
    });
    db.relations.push({
      id: 'rel-a',
      proposal_id: '',
      from_project: 'alpha',
      from_id: 'svc-a',
      to_project: 'alpha',
      to_id: 'svc-b',
      rel_type: 'DEPENDS_ON',
      status: 'active',
      properties: null,
    });
    db.feats.push({
      id: 'feat-1',
      status: 'draft',
      title: null,
      description: null,
      created_by: null,
      checklist: null,
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
    });

    const progress: Array<{ phase: string; current: number; total: number }> = [];
    const backup = new LocalBackup(store as unknown as SQLiteStore);
    await backup.backup({
      output,
      compress: false,
      onProgress: (event) => {
        progress.push({ phase: event.phase, current: event.current, total: event.total });
      },
    });

    expect(progress.some(item => item.phase === 'entities')).toBe(true);
    expect(progress.some(item => item.phase === 'relations')).toBe(true);
    expect(progress.some(item => item.phase === 'feats')).toBe(true);
    expect(progress.some(item => item.phase === 'write')).toBe(true);
    expect(progress[progress.length - 1]?.phase).toBe('done');
  });

  test('normalizes legacy entity data during backup', async () => {
    db.entities.push({
      id: 'adr-001',
      source_project: 'alpha',
      proposal_id: null,
      type: 'adr',
      kind: null,
      scope: null,
      perspective: null,
      data: JSON.stringify({
        schema: 'c4a/v1',
        type: 'adr',
        adr: {
          id: 'adr-001',
          name: 'Legacy ADR Title',
          status: 'draft',
        },
        context: 'Legacy context',
        decision: 'Legacy decision',
      }),
    });

    db.entities.push({
      id: 'contract-001',
      source_project: 'alpha',
      proposal_id: null,
      type: 'contract',
      kind: null,
      scope: null,
      perspective: null,
      data: JSON.stringify({
        schema: 'c4a/v1',
        type: 'contract',
        contract: {
          id: 'contract-001',
          name: 'Legacy Contract',
          contract_type: 'openapi',
          status: 'draft',
          component_id: 'legacy-component',
        },
      }),
    });

    db.entities.push({
      id: 'order-system',
      source_project: 'alpha',
      proposal_id: null,
      type: 'system',
      kind: null,
      scope: null,
      perspective: null,
      data: JSON.stringify({
        schema: 'c4a/v1',
        type: 'software-system',
        system: {
          id: 'order-system',
          name: 'Order System',
          external: true,
        },
      }),
    });

    const now = '2026-01-20T10:00:00Z';
    db.metadata.push(
      {
        entity_id: 'adr-001',
        source_project: 'alpha',
        proposal_id: null,
        source_repo: 'company/my-repo',
        status: 'published',
        content_hash: 'hash-adr',
        created_at: now,
        updated_at: now,
      },
      {
        entity_id: 'contract-001',
        source_project: 'alpha',
        proposal_id: null,
        source_repo: 'company/my-repo',
        status: 'published',
        content_hash: 'hash-contract',
        created_at: now,
        updated_at: now,
      },
      {
        entity_id: 'order-system',
        source_project: 'alpha',
        proposal_id: null,
        source_repo: 'company/my-repo',
        status: 'published',
        content_hash: 'hash-system',
        created_at: now,
        updated_at: now,
      }
    );

    const backupFile = createTempPath('backup-normalize', 'json');
    tmpFiles.push(backupFile);

    const backup = new LocalBackup(store as unknown as SQLiteStore);
    await backup.backup({ output: backupFile, compress: false });

    const data = JSON.parse(readFileSync(backupFile, 'utf-8')) as ExportData;
    const adr = data.entities.find(item => item.id === 'adr-001');
    if (!adr) {
      throw new Error('adr-001 not exported');
    }
    expect((adr.data.adr as { title?: string }).title).toBe('Legacy ADR Title');
    expect((adr.data.adr as { name?: string }).name).toBeUndefined();

    const contract = data.entities.find(item => item.id === 'contract-001');
    if (!contract) {
      throw new Error('contract-001 not exported');
    }
    expect((contract.data.contract as { component_id?: string }).component_id).toBeUndefined();

    const system = data.entities.find(item => item.id === 'order-system');
    if (!system) {
      throw new Error('order-system not exported');
    }
    expect(system.kind).toBe('external');
    expect(system.scope).toBe('project');
    expect(system.perspective).toBe('technical');
  });

  test('rejects includeVectors option', async () => {
    const backupFile = createTempPath('backup-vectors', 'json');
    tmpFiles.push(backupFile);

    const backup = new LocalBackup(store as unknown as SQLiteStore);
    await expect(
      backup.backup({ output: backupFile, compress: false, includeVectors: true })
    ).rejects.toThrow('includeVectors is not supported');
  });
});

describe('LocalRestore', () => {
  test('restores deleted relations with status', async () => {
    const backupFile = createTempPath('restore', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-01-21T10:00:00Z',
      entities: [],
      relations: [
        {
          from_id: 'a',
          to_id: 'b',
          rel_type: 'DEPENDS_ON',
          status: 'deleted',
        },
      ],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    expect(db.relations).toHaveLength(1);
    expect(db.relations[0]).toMatchObject({
      from_id: 'a',
      to_id: 'b',
      rel_type: 'DEPENDS_ON',
      status: 'deleted',
    });
  });

  test('merge policy updates feat when backup is newer', async () => {
    db.feats.push({
      id: 'feat-002',
      status: 'draft',
      title: '旧标题',
      description: '旧描述',
      created_by: 'bob',
      checklist: null,
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-01T10:00:00Z',
    });

    const backupFile = createTempPath('restore-merge', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-02-01T10:00:00Z',
      entities: [],
      relations: [],
      feats: [
        {
          id: 'feat-002',
          status: 'published',
          title: '新标题',
          description: '新描述',
          created_by: 'bob',
          created_at: '2026-01-01T10:00:00Z',
          updated_at: '2026-02-01T10:00:00Z',
        },
      ],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'merge' });

    const row = db.feats.find(item => item.id === 'feat-002');
    if (!row) {
      throw new Error('feat-002 not restored');
    }
    expect(row.status).toBe('published');
    expect(row.title).toBe('新标题');
  });

  test('reports conflict summary', async () => {
    const backupFile = createTempPath('restore-conflicts', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-02-03T10:00:00Z',
      entities: [
        {
          id: 'svc-a',
          type: 'system',
          data: {
            schema: 'c4a/v1',
            type: 'software-system',
            system: { id: 'svc-a', name: 'Service A' },
          },
          metadata: {
            source_project: 'alpha',
            status: 'published',
            content_hash: 'hash-new',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-02T10:00:00Z',
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    db.entities.push({
      id: 'svc-a',
      source_project: 'alpha',
      proposal_id: '',
      type: 'system',
      kind: null,
      scope: null,
      perspective: null,
      data: JSON.stringify({ id: 'svc-a' }),
    });
    db.metadata.push({
      entity_id: 'svc-a',
      source_project: 'alpha',
      proposal_id: '',
      source_repo: null,
      status: 'published',
      content_hash: 'hash-old',
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
    });

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    const result = await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    expect(result.conflicts?.length).toBe(1);
    expect(result.conflict_summary?.total).toBe(1);
    expect(result.conflict_summary?.by_target.entity).toBe(1);
    expect(result.conflict_summary?.by_entity_type.system).toBe(1);
    expect(result.conflict_summary?.by_status.published).toBe(1);
    expect(result.conflict_summary?.by_feat_status).toEqual({});
    expect(result.conflict_summary?.by_target_status.entity.published).toBe(1);
    expect(result.conflict_summary?.by_reason.hash_mismatch).toBe(1);
    expect(result.conflict_summary?.by_resolution.skipped).toBe(1);
    expect(result.conflict_summary?.by_target_resolution.entity.skipped).toBe(1);
  });

  test('reports feat status breakdown', async () => {
    const backupFile = createTempPath('restore-feat-status', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-02-03T10:00:00Z',
      entities: [],
      relations: [],
      feats: [
        {
          id: 'feat-xyz',
          status: 'published',
          created_at: '2026-02-01T10:00:00Z',
          updated_at: '2026-02-02T10:00:00Z',
        },
      ],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    db.feats.push({
      id: 'feat-xyz',
      status: 'draft',
      title: null,
      description: null,
      created_by: null,
      checklist: null,
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
    });

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    const result = await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    expect(result.conflict_summary?.by_feat_status.published).toBe(1);
    expect(result.conflict_summary?.by_target_status.feat.published).toBe(1);
  });

  test('formats conflict summary', () => {
    const text = formatConflictSummary({
      total: 2,
      by_target: { entity: 1, feat: 1 },
      by_entity_type: { system: 1, feat: 1 },
      by_status: { published: 1, draft: 1 },
      by_feat_status: { draft: 1 },
      by_reason: { hash_mismatch: 1, feat_exists: 1 },
      by_resolution: { skipped: 1, overridden: 1 },
      by_target_resolution: {
        entity: { skipped: 1 },
        feat: { overridden: 1 },
      },
      by_target_status: {
        entity: { published: 1 },
        feat: { draft: 1 },
      },
    });

    expect(text).toContain('conflicts: 2');
    expect(text).toContain('targets:');
    expect(text).toContain('reasons:');
    expect(text).toContain('resolutions:');
    expect(text).toContain('target_resolutions:');
    expect(text).toContain('statuses:');
    expect(text).toContain('feat_statuses:');
    expect(text).toContain('target_statuses:');
  });

  test('restores main-branch entities with empty proposal_id', async () => {
    const backupFile = createTempPath('restore-main', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-02-02T10:00:00Z',
      entities: [
        {
          id: 'core-system',
          type: 'system',
          data: { name: '核心系统' },
          metadata: {
            source_project: 'my-project',
            source_repo: 'company/my-repo',
            status: 'published',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-02T10:00:00Z',
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    expect(db.entities).toHaveLength(1);
    expect(db.entities[0]?.proposal_id).toBe('');
    expect(db.metadata[0]?.proposal_id).toBe('');
  });

  test('normalizes legacy export data during restore', async () => {
    const backupFile = createTempPath('restore-normalize', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-02-01T10:00:00Z',
      entities: [
        {
          id: 'adr-001',
          type: 'adr',
          data: {
            schema: 'c4a/v1',
            type: 'adr',
            adr: {
              id: 'adr-001',
              name: 'Legacy ADR Title',
              status: 'draft',
            },
            context: 'Legacy context',
            decision: 'Legacy decision',
          },
          metadata: {
            source_project: 'alpha',
            status: 'draft',
            content_hash: 'hash-adr',
            created_at: '2026-01-01T10:00:00Z',
            updated_at: '2026-01-01T10:00:00Z',
          },
          proposal_id: null,
        },
        {
          id: 'contract-001',
          type: 'contract',
          data: {
            schema: 'c4a/v1',
            type: 'contract',
            contract: {
              id: 'contract-001',
              name: 'Legacy Contract',
              contract_type: 'openapi',
              status: 'draft',
              component_id: 'legacy-component',
            },
          },
          metadata: {
            source_project: 'alpha',
            status: 'draft',
            content_hash: 'hash-contract',
            created_at: '2026-01-01T10:00:00Z',
            updated_at: '2026-01-01T10:00:00Z',
          },
          proposal_id: '',
        },
        {
          id: 'order-system',
          type: 'system',
          data: {
            schema: 'c4a/v1',
            type: 'software-system',
            system: {
              id: 'order-system',
              name: 'Order System',
              external: true,
            },
          },
          metadata: {
            source_project: 'alpha',
            status: 'draft',
            content_hash: 'hash-system',
            created_at: '2026-01-01T10:00:00Z',
            updated_at: '2026-01-01T10:00:00Z',
          },
          proposal_id: null,
        },
      ],
      relations: [],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    const adrRow = db.entities.find(item => item.id === 'adr-001');
    if (!adrRow) {
      throw new Error('adr-001 not restored');
    }
    const adrData = JSON.parse(adrRow.data) as Record<string, unknown>;
    expect((adrData.adr as { title?: string }).title).toBe('Legacy ADR Title');
    expect((adrData.adr as { name?: string }).name).toBeUndefined();

    const contractRow = db.entities.find(item => item.id === 'contract-001');
    if (!contractRow) {
      throw new Error('contract-001 not restored');
    }
    const contractData = JSON.parse(contractRow.data) as Record<string, unknown>;
    const contract = contractData.contract as Record<string, unknown>;
    expect(contract.component_id).toBeUndefined();

    const systemRow = db.entities.find(item => item.id === 'order-system');
    if (!systemRow) {
      throw new Error('order-system not restored');
    }
    expect(systemRow.kind).toBe('external');
    expect(systemRow.scope).toBe('project');
    expect(systemRow.perspective).toBe('technical');
  });

  test('normalizes null source_project and relation projects during restore', async () => {
    const backupFile = createTempPath('restore-null-projects', 'json');
    tmpFiles.push(backupFile);

    const exportData = {
      version: '0.3.0',
      exported_at: '2026-02-02T10:00:00Z',
      entities: [
        {
          id: 'global-system',
          type: 'system',
          data: {
            schema: 'c4a/v1',
            type: 'software-system',
            system: {
              id: 'global-system',
              name: 'Global System',
            },
          },
          metadata: {
            source_project: null,
            status: 'published',
            content_hash: 'hash-global',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-01T10:00:00Z',
          },
          proposal_id: null,
        },
      ],
      relations: [
        {
          id: 'rel-global',
          proposal_id: null,
          from_project: null,
          from_id: 'global-system',
          to_project: null,
          to_id: 'global-product',
          rel_type: 'CORRESPONDS',
          status: 'active',
          properties: null,
        },
      ],
      feats: [],
    } as unknown as ExportData;

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    expect(db.entities).toHaveLength(1);
    expect(db.entities[0]?.source_project).toBe('');
    expect(db.relations).toHaveLength(1);
    expect(db.relations[0]?.from_project).toBe('');
    expect(db.relations[0]?.to_project).toBe('');
  });

  test('restore reports progress for each phase', async () => {
    const backupFile = createTempPath('restore-progress', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.0',
      exported_at: '2026-02-03T10:00:00Z',
      entities: [
        {
          id: 'svc-a',
          type: 'system',
          data: {
            schema: 'c4a/v1',
            type: 'software-system',
            system: { id: 'svc-a', name: 'Service A' },
          },
          metadata: {
            source_project: 'alpha',
            status: 'published',
            content_hash: 'hash-a',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-01T10:00:00Z',
          },
          proposal_id: null,
        },
      ],
      relations: [
        {
          id: 'rel-a',
          proposal_id: null,
          from_project: 'alpha',
          from_id: 'svc-a',
          to_project: 'alpha',
          to_id: 'svc-b',
          rel_type: 'DEPENDS_ON',
          status: 'active',
          properties: null,
        },
      ],
      feats: [
        {
          id: 'feat-1',
          status: 'draft',
          created_at: '2026-02-01T10:00:00Z',
          updated_at: '2026-02-01T10:00:00Z',
        },
      ],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const progress: Array<{ phase: string; current: number; total: number }> = [];
    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({
      input: backupFile,
      conflictPolicy: 'skip',
      onProgress: (event) => {
        progress.push({ phase: event.phase, current: event.current, total: event.total });
      },
      rebuildVectors: false,
    });

    expect(progress.some((item) => item.phase === 'feats')).toBe(true);
    expect(progress.some((item) => item.phase === 'entities')).toBe(true);
    expect(progress.some((item) => item.phase === 'relations')).toBe(true);
    expect(progress[progress.length - 1]?.phase).toBe('done');
  });
});
