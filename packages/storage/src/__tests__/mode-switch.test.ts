import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackupData } from '../modeSwitchReadBackup.js';
import { MigrationError } from '../modeSwitchErrors.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'mode-switch-tests');

function ensureTmpDir(): void {
  mkdirSync(TMP_ROOT, { recursive: true });
}

function writeTempJson(name: string, payload: unknown): string {
  const path = join(TMP_ROOT, `${name}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
  return path;
}

describe('mode-switch backup reader', () => {
  test('normalizes store backup format', async () => {
    ensureTmpDir();
    const now = new Date().toISOString();
    const payload = {
      format_version: '0.3.1',
      exported_at: now,
      source: { repo_id: 'demo-repo' },
      entities: [
        {
          id: 'demo-system',
          type: 'system',
          root_id: 'demo-project',
          status: 'published',
          data: { id: 'demo-system', name: 'Demo System' },
          metadata: { created_at: now, updated_at: now },
        },
      ],
      relations: [
        {
          from_id: 'demo-system',
          to_id: 'demo-container',
          rel_type: 'contains',
        },
      ],
      feats: [],
    };
    const file = writeTempJson('store-backup', payload);

    const normalized = await readBackupData(file);
    expect(normalized.entities.length).toBe(1);
    expect(normalized.entities[0]?.metadata.root_id).toBe('demo-project');
    expect(normalized.entities[0]?.metadata.source_repo).toBe('demo-repo');
    expect(normalized.entities[0]?.requirement_id).toBeNull();
    expect(normalized.relations[0]?.from_root_id).toBe('');
    expect(normalized.relations[0]?.to_root_id).toBe('');

    rmSync(file, { force: true });
  });

  test('rejects unsupported backup version', async () => {
    ensureTmpDir();
    const now = new Date().toISOString();
    const payload = {
      version: '0.2.0',
      exported_at: now,
      entities: [],
      relations: [],
      feats: [],
    };
    const file = writeTempJson('legacy-backup', payload);

    let thrown: unknown;
    try {
      await readBackupData(file);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    if (thrown instanceof MigrationError) {
      expect(thrown.code).toBe('C4A-MIGRATE-001');
    }

    rmSync(file, { force: true });
  });
});
