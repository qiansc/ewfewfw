import { beforeAll, describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

const baseUrl = process.env.C4A_STORAGE_BACKEND_URL;
const runTest = baseUrl ? test : test.skip;
const projectId = process.env.C4A_TEST_PROJECT_ID ?? `proj-${Date.now()}`;
const adminId = process.env.C4A_ADMIN_USER_ID ?? `admin-${Date.now()}`;
const userId = process.env.C4A_TEST_USER_ID ?? `tester-${Date.now()}`;
let serverAvailabilityError: string | null = null;
let permissionReady = false;

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
  targetProjectId: string,
  targetUserId: string,
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
      project_id: targetProjectId,
      user_id: targetUserId,
      role,
    }),
  });
}

describe('Server feat merge regression', () => {
  beforeAll(async () => {
    if (!baseUrl) return;
    const available = await checkServerAvailable();
    if (!available) {
      serverAvailabilityError =
        `[server-feat-merge] storage-backend 不可用，请先启动服务后再运行测试。` +
        ` (url: ${baseUrl})`;
      permissionReady = false;
      return;
    }
    try {
      await grantPermission(projectId, adminId, 'admin', adminId);
      if (userId !== adminId) {
        await grantPermission(projectId, userId, 'writer', adminId);
      }
      permissionReady = true;
    } catch (error) {
      console.warn('[server-feat-merge] 权限初始化失败，请确认权限配置或清空 project_permissions');
      permissionReady = false;
    }
  });

  runTest('feat publish should merge entities to main branch', async () => {
    if (serverAvailabilityError) {
      throw new Error(serverAvailabilityError);
    }
    if (!permissionReady) {
      throw new Error('[server-feat-merge] 权限未就绪，无法验证合并逻辑。');
    }

    const featId = `feat-merge-regress-${Date.now()}`;
    const systemId = `sys-portal-${Date.now()}`;
    const containerId = `ctn-api-${Date.now()}`;
    const componentId = `cmp-auth-${Date.now()}`;

    const adapter = new ServerAdapter({
      url: baseUrl!,
      headers: { 'X-User-ID': userId },
    });
    await adapter.initialize();

    await adapter.featLifecycle({
      action: 'create',
      feat_id: featId,
      metadata: { title: 'merge regress', description: 'merge regress', created_by: userId },
    });

    await adapter.save({
      type: 'system',
      id: systemId,
      source_project: projectId,
      proposal_id: featId,
      data: { id: systemId, name: 'Portal', scope: 'project' },
    });
    await adapter.save({
      type: 'container',
      id: containerId,
      source_project: projectId,
      proposal_id: featId,
      data: {
        id: containerId,
        name: 'API',
        scope: 'project',
        system_id: systemId,
      },
    });
    await adapter.save({
      type: 'component',
      id: componentId,
      source_project: projectId,
      proposal_id: featId,
      data: {
        id: componentId,
        name: 'Auth',
        scope: 'project',
        container_id: containerId,
      },
    });

    await adapter.featLifecycle({
      action: 'transition',
      feat_id: featId,
      to_status: 'approved',
    });
    await adapter.featLifecycle({
      action: 'transition',
      feat_id: featId,
      to_status: 'published',
    });

    const mainEntity = await adapter.read({
      id: systemId,
      filter: { source_project: projectId },
      format: 'object',
    });
    expect(mainEntity).not.toBeNull();
    if (!mainEntity || !('entity' in mainEntity)) {
      throw new Error('Expected entity response');
    }
    expect(mainEntity.entity?.proposal_id ?? null).toBeNull();
    expect(mainEntity.entity?.metadata?.status).toBe('published');

    const featList = await adapter.list({
      project_id: projectId,
      proposal_id: featId,
      limit: 10,
      offset: 0,
    });
    expect(featList.items?.length ?? 0).toBe(0);
  });
});
