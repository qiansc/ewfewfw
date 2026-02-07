/**
 * mode-switch 拆分后的恢复测试
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { LocalRestore, formatConflictSummary } from '../mode-switch.js';
import type { SQLiteStore } from '../sqlite-store.js';
import type { ExportData } from '../modeSwitchTypes.js';
import {
  cleanupTmpFiles,
  createTempPath,
  ensureTmpDir,
  FakeDatabase,
  FakeStore,
} from './mode-switch.helpers.js';

let store: FakeStore;
let db: FakeDatabase;
let tmpFiles: string[] = [];

beforeEach(() => {
  ensureTmpDir();
  db = new FakeDatabase();
  store = new FakeStore(db);
  tmpFiles = [];
});

afterEach(() => {
  cleanupTmpFiles(tmpFiles);
  tmpFiles = [];
});

describe('LocalRestore', () => {
  test('restores deleted relations with status', async () => {
    const backupFile = createTempPath('restore', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.1',
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
      version: '0.3.1',
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

    const row = db.feats.find((item) => item.id === 'feat-002');
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
      version: '0.3.1',
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
            root_id: 'alpha',
            status: 'published',
            content_hash: 'hash-new',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-02T10:00:00Z',
          },
          requirement_id: null,
        },
      ],
      relations: [],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    db.entities.push({
      id: 'svc-a',
      root_id: 'alpha',
      requirement_id: '',
      type: 'system',
      kind: null,
      scope: null,
      perspective: null,
      data: JSON.stringify({ id: 'svc-a' }),
    });
    db.metadata.push({
      entity_id: 'svc-a',
      root_id: 'alpha',
      requirement_id: '',
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
      version: '0.3.1',
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

  test('restores main-branch entities with empty requirement_id', async () => {
    const backupFile = createTempPath('restore-main', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.1',
      exported_at: '2026-02-02T10:00:00Z',
      entities: [
        {
          id: 'core-system',
          type: 'system',
          data: { name: '核心系统' },
          metadata: {
            root_id: 'my-project',
            source_repo: 'company/my-repo',
            status: 'published',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-02T10:00:00Z',
          },
          requirement_id: null,
        },
      ],
      relations: [],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    expect(db.entities).toHaveLength(1);
    expect(db.entities[0]?.requirement_id).toBe('');
    expect(db.metadata[0]?.requirement_id).toBe('');
  });

  test('normalizes legacy export data during restore', async () => {
    const backupFile = createTempPath('restore-normalize', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.1',
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
            root_id: 'alpha',
            status: 'draft',
            content_hash: 'hash-adr',
            created_at: '2026-01-01T10:00:00Z',
            updated_at: '2026-01-01T10:00:00Z',
          },
          requirement_id: null,
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
            root_id: 'alpha',
            status: 'draft',
            content_hash: 'hash-contract',
            created_at: '2026-01-01T10:00:00Z',
            updated_at: '2026-01-01T10:00:00Z',
          },
          requirement_id: '',
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
            root_id: 'alpha',
            status: 'draft',
            content_hash: 'hash-system',
            created_at: '2026-01-01T10:00:00Z',
            updated_at: '2026-01-01T10:00:00Z',
          },
          requirement_id: null,
        },
      ],
      relations: [],
      feats: [],
    };

    writeFileSync(backupFile, JSON.stringify(exportData, null, 2), 'utf-8');

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip' });

    const adrRow = db.entities.find((item) => item.id === 'adr-001');
    if (!adrRow) {
      throw new Error('adr-001 not restored');
    }
    const adrData = JSON.parse(adrRow.data) as Record<string, unknown>;
    expect((adrData.adr as { title?: string }).title).toBe('Legacy ADR Title');
    expect((adrData.adr as { name?: string }).name).toBeUndefined();

    const contractRow = db.entities.find((item) => item.id === 'contract-001');
    if (!contractRow) {
      throw new Error('contract-001 not restored');
    }
    const contractData = JSON.parse(contractRow.data) as Record<string, unknown>;
    const contract = contractData.contract as Record<string, unknown>;
    expect(contract.component_id).toBeUndefined();

    const systemRow = db.entities.find((item) => item.id === 'order-system');
    if (!systemRow) {
      throw new Error('order-system not restored');
    }
    expect(systemRow.kind).toBe('external');
    expect(systemRow.scope).toBe('project');
    expect(systemRow.perspective).toBe('technical');
  });

  test('normalizes null root_id and relation projects during restore', async () => {
    const backupFile = createTempPath('restore-null-projects', 'json');
    tmpFiles.push(backupFile);

    const exportData = {
      version: '0.3.1',
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
            root_id: null,
            status: 'published',
            content_hash: 'hash-global',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-01T10:00:00Z',
          },
          requirement_id: null,
        },
      ],
      relations: [
        {
          id: 'rel-global',
          requirement_id: null,
          from_root_id: null,
          from_id: 'global-system',
          to_root_id: null,
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
    expect(db.entities[0]?.root_id).toBe('');
    expect(db.relations).toHaveLength(1);
    expect(db.relations[0]?.from_root_id).toBe('');
    expect(db.relations[0]?.to_root_id).toBe('');
  });

  test('restore reports progress for each phase', async () => {
    const backupFile = createTempPath('restore-progress', 'json');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.1',
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
            root_id: 'alpha',
            status: 'published',
            content_hash: 'hash-a',
            created_at: '2026-02-01T10:00:00Z',
            updated_at: '2026-02-01T10:00:00Z',
          },
          requirement_id: null,
        },
      ],
      relations: [
        {
          id: 'rel-a',
          requirement_id: null,
          from_root_id: 'alpha',
          from_id: 'svc-a',
          to_root_id: 'alpha',
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

  test('restores from gzipped backup using streaming path', async () => {
    const backupFile = createTempPath('restore-stream', 'json.gz');
    tmpFiles.push(backupFile);

    const exportData: ExportData = {
      version: '0.3.1',
      exported_at: '2026-02-04T10:00:00Z',
      entities: [
        {
          id: 'stream-system',
          type: 'system',
          data: {
            schema: 'c4a/v1',
            type: 'software-system',
            system: { id: 'stream-system', name: 'Stream System' },
          },
          metadata: {
            root_id: 'stream-project',
            status: 'published',
            content_hash: 'hash-stream',
            created_at: '2026-02-04T10:00:00Z',
            updated_at: '2026-02-04T10:00:00Z',
          },
          requirement_id: null,
        },
      ],
      relations: [
        {
          from_root_id: 'stream-project',
          from_id: 'stream-system',
          to_root_id: 'stream-project',
          to_id: 'stream-dep',
          rel_type: 'DEPENDS_ON',
          status: 'active',
        },
      ],
      feats: [
        {
          id: 'feat-stream',
          status: 'draft',
          created_at: '2026-02-04T10:00:00Z',
          updated_at: '2026-02-04T10:00:00Z',
        },
      ],
    };

    const payload = JSON.stringify(exportData, null, 2);
    writeFileSync(backupFile, gzipSync(payload));

    const restore = new LocalRestore(store as unknown as SQLiteStore);
    await restore.restore({ input: backupFile, conflictPolicy: 'skip', rebuildVectors: false });

    expect(db.entities).toHaveLength(1);
    expect(db.entities[0]?.id).toBe('stream-system');
    expect(db.relations).toHaveLength(1);
    expect(db.feats).toHaveLength(1);
  });
});
