import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { C4AError } from '@c4a/core';
import { ServerAdapter } from '../server-adapter.js';
import { LiteAdapter } from '../lite-adapter.js';
import { migrateLocalToServer, migrateServerToLocal } from '../mode-switch.js';
import { SQLiteStore } from '../sqlite-store.js';

const baseUrl = process.env.C4A_STORAGE_BACKEND_URL;
const runTest = baseUrl ? test : test.skip;
const sharedProjectId = process.env.C4A_TEST_PROJECT_ID ?? `proj-${Date.now()}`;
const adminId = process.env.C4A_ADMIN_USER_ID ?? `admin-${Date.now()}`;
const supportsSharedFs = process.env.C4A_STORAGE_BACKEND_FS === 'shared';
let serverAvailabilityError: string | null = null;
let permissionReady = false;
const TMP_DIR = join(process.cwd(), '.tmp');

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function resetSQLiteStore(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
}

function buildTempPath(prefix: string, suffix: string): string {
  ensureTmpDir();
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return join(TMP_DIR, `${prefix}-${stamp}.${suffix}`);
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  if (!baseUrl) {
    throw new Error('C4A_STORAGE_BACKEND_URL is not set');
  }
  const response = await fetch(new URL(path, baseUrl).toString(), init);
  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
  return payload as T;
}

async function checkServerAvailable(): Promise<boolean> {
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(new URL('/health', baseUrl).toString(), {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function grantPermission(
  projectId: string,
  userId: string,
  role: 'admin' | 'writer' | 'reader',
  actorId: string
): Promise<void> {
  await requestJson('/permissions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-User-ID': actorId,
    },
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
      role,
    }),
  });
}

describe('Server mode integration', () => {
  beforeAll(async () => {
    if (!baseUrl) return;
    const available = await checkServerAvailable();
    if (!available) {
      serverAvailabilityError =
        `[server-integration] storage-backend 不可用，请先执行 ./start.sh docker 启动服务后再运行测试。` +
        ` (url: ${baseUrl})`;
      permissionReady = false;
      return;
    }
    try {
      await grantPermission(sharedProjectId, adminId, 'admin', adminId);
      permissionReady = true;
    } catch (error) {
      if (String(error).includes('C4A-PERM-002')) {
        console.warn(
          '[server-integration] 权限初始化失败，请清空 project_permissions 或使用已有管理员权限项目后重试。'
        );
        permissionReady = false;
        return;
      }
      throw error;
    }
  });

  runTest('init → save → read → search → delete (with permissions)', async () => {
    if (serverAvailabilityError) {
      throw new Error(serverAvailabilityError);
    }
    if (!permissionReady) return;
    const projectId = sharedProjectId;
    const userId = `tester-${Date.now()}`;
    const entityId = `system-${Date.now()}`;

    const adapter = new ServerAdapter({
      url: baseUrl!,
      headers: { 'X-User-ID': userId },
    });
    await adapter.initialize();

    let denied = false;
    try {
      await adapter.save({
        type: 'system',
        id: entityId,
        source_project: projectId,
        data: {
          id: entityId,
          name: `Demo System ${entityId}`,
          source_project: projectId,
        },
      });
    } catch (error) {
      denied = true;
      if (error instanceof C4AError) {
        expect(['C4A-PERM-001', 'C4A-PERM-003']).toContain(error.code);
      }
    }
    expect(denied).toBe(true);

    await grantPermission(projectId, userId, 'writer', adminId);

    const saveResult = await adapter.save({
      type: 'system',
      id: entityId,
      source_project: projectId,
      data: {
        id: entityId,
        name: `Demo System ${entityId}`,
        source_project: projectId,
      },
    });
    expect(saveResult.success).toBe(true);

    const readResult = await adapter.read({ id: entityId, format: 'object' });
    expect(readResult && 'entity' in readResult).toBe(true);
    if (readResult && 'entity' in readResult) {
      expect(readResult.entity?.id).toBe(entityId);
    }

    const searchResult = await adapter.search({
      query: entityId,
      scope: 'system',
      limit: 5,
    });
    expect(Array.isArray(searchResult.items)).toBe(true);
    expect(searchResult.items.some((item) => item.id === entityId)).toBe(true);

    const deleteResult = await adapter.delete({ id: entityId, force: true });
    expect(deleteResult.success).toBe(true);

    await adapter.close();
  });

  runTest('relations: save → delete', async () => {
    if (serverAvailabilityError) {
      throw new Error(serverAvailabilityError);
    }
    if (!permissionReady) return;
    const projectId = sharedProjectId;
    const relationId = `rel-${Date.now()}`;

    const adapter = new ServerAdapter({
      url: baseUrl!,
      headers: { 'X-User-ID': adminId },
    });
    await adapter.initialize();

    await adapter.saveRelation({
      id: relationId,
      from_project: projectId,
      from_id: `from-${Date.now()}`,
      to_project: projectId,
      to_id: `to-${Date.now()}`,
      rel_type: 'DEPENDS_ON',
      status: 'active',
    });

    await adapter.deleteRelation(relationId);
    await adapter.close();
  });

  runTest('mode switch: Local → Server → Local', async () => {
    if (serverAvailabilityError) {
      throw new Error(serverAvailabilityError);
    }
    if (!permissionReady) return;
    if (!supportsSharedFs) {
      console.warn(
        '[server-integration] 后端运行在容器内时不支持本地文件路径备份/恢复，跳过迁移测试。'
      );
      return;
    }
    const projectId = sharedProjectId;

    const localDbPath = buildTempPath('local', 'db');
    resetSQLiteStore();
    const localAdapter = new LiteAdapter({
      dbPath: localDbPath,
      defaultProject: projectId,
      enableVectorSearch: false,
      repoId: null,
      feat: { concurrent_warning: false, auto_notify: false },
    });
    await localAdapter.initialize();

    const entityId = `sys-${Date.now()}`;
    await localAdapter.save({
      type: 'system',
      id: entityId,
      source_project: projectId,
      data: { id: entityId, name: `Local System ${entityId}`, source_project: projectId },
    });

    const backupPath = buildTempPath('backup', 'tar.gz');
    const backupResult = await localAdapter.backup({
      output: backupPath,
      status_filter: 'all',
      format: 'tar.gz',
      include_metadata: true,
    });
    expect(backupResult.success).toBe(true);

    const serverAdapter = new ServerAdapter({
      url: baseUrl!,
      headers: { 'X-User-ID': adminId },
    });
    await serverAdapter.initialize();

    const migrateToServer = await migrateLocalToServer(backupPath, serverAdapter, {
      conflictPolicy: 'override',
    });
    expect(migrateToServer.success).toBe(true);

    const localDbPath2 = buildTempPath('local-restore', 'db');
    resetSQLiteStore();
    const localRestoreAdapter = new LiteAdapter({
      dbPath: localDbPath2,
      defaultProject: projectId,
      enableVectorSearch: false,
      repoId: null,
      feat: { concurrent_warning: false, auto_notify: false },
    });
    await localRestoreAdapter.initialize();

    const migrateToLocal = await migrateServerToLocal(serverAdapter, localRestoreAdapter, {
      conflictPolicy: 'merge',
      rebuildVectors: false,
    });
    expect(migrateToLocal.success).toBe(true);

    const restored = await localRestoreAdapter.read({ id: entityId, format: 'object' });
    expect(restored && 'entity' in restored).toBe(true);

    await localAdapter.close();
    await localRestoreAdapter.close();
    await serverAdapter.close();

    rmSync(localDbPath, { force: true });
    rmSync(localDbPath2, { force: true });
    rmSync(backupPath, { force: true });
  });

  runTest('mode switch: Server → Local (download fallback)', async () => {
    if (serverAvailabilityError) {
      throw new Error(serverAvailabilityError);
    }
    if (!permissionReady) return;
    if (supportsSharedFs) {
      console.warn('[server-integration] shared fs 启用，下载回迁场景跳过。');
      return;
    }

    const projectId = sharedProjectId;
    const serverAdapter = new ServerAdapter({
      url: baseUrl!,
      headers: { 'X-User-ID': adminId },
    });
    await serverAdapter.initialize();

    const entityId = `server-${Date.now()}`;
    await serverAdapter.save({
      type: 'system',
      id: entityId,
      source_project: projectId,
      data: {
        id: entityId,
        name: `Server System ${entityId}`,
        source_project: projectId,
      },
    });

    const localDbPath = buildTempPath('local-download', 'db');
    resetSQLiteStore();
    const localAdapter = new LiteAdapter({
      dbPath: localDbPath,
      defaultProject: projectId,
      enableVectorSearch: false,
      repoId: null,
      feat: { concurrent_warning: false, auto_notify: false },
    });
    await localAdapter.initialize();

    const migrateToLocal = await migrateServerToLocal(serverAdapter, localAdapter, {
      conflictPolicy: 'override',
      rebuildVectors: false,
      statusFilter: 'all',
    });
    expect(migrateToLocal.success).toBe(true);

    const restored = await localAdapter.read({ id: entityId, format: 'object' });
    expect(restored && 'entity' in restored).toBe(true);

    await localAdapter.close();
    await serverAdapter.close();

    rmSync(localDbPath, { force: true });
  });
});
