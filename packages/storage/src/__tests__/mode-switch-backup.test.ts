/**
 * mode-switch 拆分后的备份测试
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { LocalBackup } from '../mode-switch.js';
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

describe('LocalBackup', () => {
  test('exports feats and relations with完整字段', async () => {
    const now = '2026-01-20T10:00:00Z';

    db.entities.push({
      id: 'e-commerce-system',
      root_id: 'my-project',
      requirement_id: '',
      type: 'system',
      kind: 'implementation',
      scope: 'project',
      perspective: 'technical',
      data: JSON.stringify({ name: '电商系统', description: '在线购物平台' }),
    });

    db.metadata.push({
      entity_id: 'e-commerce-system',
      root_id: 'my-project',
      requirement_id: '',
      source_repo: 'company/my-repo',
      status: 'published',
      content_hash: 'hash-001',
      created_at: now,
      updated_at: now,
    });

    db.relations.push({
      id: 'rel-001',
      requirement_id: null,
      from_root_id: 'my-project',
      from_id: 'e-commerce-system',
      to_root_id: 'my-project',
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
      from_root_id: 'my-project',
      to_root_id: 'my-project',
      rel_type: 'CORRESPONDS',
      status: 'active',
    });
    expect(data.entities[0].metadata.created_at).toBe(now);
    expect(data.entities[0].requirement_id).toBeNull();
  });

  test('reports progress for each phase', async () => {
    const output = createTempPath('backup-progress', 'json');
    tmpFiles.push(output);

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
      content_hash: 'hash-a',
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
    });
    db.relations.push({
      id: 'rel-a',
      requirement_id: '',
      from_root_id: 'alpha',
      from_id: 'svc-a',
      to_root_id: 'alpha',
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

    expect(progress.some((item) => item.phase === 'entities')).toBe(true);
    expect(progress.some((item) => item.phase === 'relations')).toBe(true);
    expect(progress.some((item) => item.phase === 'feats')).toBe(true);
    expect(progress.some((item) => item.phase === 'write')).toBe(true);
    expect(progress[progress.length - 1]?.phase).toBe('done');
  });

  test('normalizes legacy entity data during backup', async () => {
    db.entities.push({
      id: 'adr-001',
      root_id: 'alpha',
      requirement_id: null,
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
      root_id: 'alpha',
      requirement_id: null,
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
      root_id: 'alpha',
      requirement_id: null,
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
        root_id: 'alpha',
        requirement_id: null,
        source_repo: 'company/my-repo',
        status: 'published',
        content_hash: 'hash-adr',
        created_at: now,
        updated_at: now,
      },
      {
        entity_id: 'contract-001',
        root_id: 'alpha',
        requirement_id: null,
        source_repo: 'company/my-repo',
        status: 'published',
        content_hash: 'hash-contract',
        created_at: now,
        updated_at: now,
      },
      {
        entity_id: 'order-system',
        root_id: 'alpha',
        requirement_id: null,
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
    const adr = data.entities.find((item) => item.id === 'adr-001');
    if (!adr) {
      throw new Error('adr-001 not exported');
    }
    expect((adr.data.adr as { title?: string }).title).toBe('Legacy ADR Title');
    expect((adr.data.adr as { name?: string }).name).toBeUndefined();

    const contract = data.entities.find((item) => item.id === 'contract-001');
    if (!contract) {
      throw new Error('contract-001 not exported');
    }
    expect((contract.data.contract as { component_id?: string }).component_id).toBeUndefined();

    const system = data.entities.find((item) => item.id === 'order-system');
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
