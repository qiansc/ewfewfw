import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerAdapter } from '../server-adapter.js';
import type { LiteAdapter } from '../lite-adapter.js';
import { migrateServerToLocal } from '../mode-switch.js';
import { MigrationError } from '../modeSwitchErrors.js';

const TMP_DIR = join(process.cwd(), '.tmp');

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

type BackupPayload = {
  version: string;
  exported_at: string;
  entities: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    metadata: {
      root_id: string;
      status: string;
      created_at: string;
      updated_at: string;
    };
    requirement_id: string | null;
  }>;
  relations: Array<Record<string, unknown>>;
  feats: Array<Record<string, unknown>>;
};

class FakeServerAdapter {
  public lastBackupParams: { output: string; status_filter?: string } | null = null;
  private payload: BackupPayload;
  private shouldFail = false;

  constructor(payload: BackupPayload, shouldFail = false) {
    this.payload = payload;
    this.shouldFail = shouldFail;
  }

  async backup(params: {
    output: string;
    status_filter?: string;
    format?: string;
    include_metadata?: boolean;
  }): Promise<{ success: boolean; file?: string; error?: string; stats?: { entities: number; relations: number } }> {
    this.lastBackupParams = { output: params.output, status_filter: params.status_filter };
    if (this.shouldFail) {
      return { success: false, error: 'backup failed' };
    }
    writeFileSync(params.output, JSON.stringify(this.payload, null, 2), 'utf-8');
    return {
      success: true,
      file: params.output,
      stats: { entities: this.payload.entities.length, relations: this.payload.relations.length },
    };
  }
}

class FakeLiteAdapter {
  public lastRestoreParams: { input: string; conflict_policy?: string; validate_checksums?: boolean } | null = null;
  private shouldFail = false;

  constructor(shouldFail = false) {
    this.shouldFail = shouldFail;
  }

  async restore(params: {
    input: string;
    conflict_policy?: string;
    validate_checksums?: boolean;
  }): Promise<{ success: boolean; error?: string; stats?: { entities: number; relations: number } }> {
    this.lastRestoreParams = params;
    if (this.shouldFail) {
      return { success: false, error: 'restore failed' };
    }
    return { success: true, stats: { entities: 2, relations: 3 } };
  }
}

describe('migrateServerToLocal', () => {
  test('backs up server data and restores into local adapter', async () => {
    ensureTmpDir();
    const now = new Date().toISOString();
    const payload: BackupPayload = {
      version: '0.3.1',
      exported_at: now,
      entities: [
        {
          id: 'demo-system',
          type: 'system',
          data: { id: 'demo-system', name: 'Demo System' },
          metadata: {
            root_id: 'demo-project',
            status: 'published',
            created_at: now,
            updated_at: now,
          },
          requirement_id: null,
        },
      ],
      relations: [],
      feats: [],
    };
    const server = new FakeServerAdapter(payload);
    const lite = new FakeLiteAdapter();

    const result = await migrateServerToLocal(
      server as unknown as ServerAdapter,
      lite as unknown as LiteAdapter,
      { statusFilter: 'approved', conflictPolicy: 'merge', rebuildVectors: false },
    );

    expect(server.lastBackupParams?.status_filter).toBe('approved');
    expect(lite.lastRestoreParams?.conflict_policy).toBe('merge');
    expect(result.stats.entities.created).toBe(2);
    expect(result.stats.relations.created).toBe(3);

    if (server.lastBackupParams?.output) {
      rmSync(server.lastBackupParams.output, { force: true });
    }
  });

  test('throws migrate error when backup fails', async () => {
    ensureTmpDir();
    const now = new Date().toISOString();
    const payload: BackupPayload = {
      version: '0.3.1',
      exported_at: now,
      entities: [],
      relations: [],
      feats: [],
    };
    const server = new FakeServerAdapter(payload, true);
    const lite = new FakeLiteAdapter();

    let thrown: unknown;
    try {
      await migrateServerToLocal(
        server as unknown as ServerAdapter,
        lite as unknown as LiteAdapter,
        { rebuildVectors: false },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as MigrationError).code).toBe('C4A-MIGRATE-004');
  });

  test('throws migrate error when restore fails', async () => {
    ensureTmpDir();
    const now = new Date().toISOString();
    const payload: BackupPayload = {
      version: '0.3.1',
      exported_at: now,
      entities: [],
      relations: [],
      feats: [],
    };
    const server = new FakeServerAdapter(payload, false);
    const lite = new FakeLiteAdapter(true);

    let thrown: unknown;
    try {
      await migrateServerToLocal(
        server as unknown as ServerAdapter,
        lite as unknown as LiteAdapter,
        { rebuildVectors: false },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as MigrationError).code).toBe('C4A-MIGRATE-002');

    if (server.lastBackupParams?.output) {
      rmSync(server.lastBackupParams.output, { force: true });
    }
  });
});
