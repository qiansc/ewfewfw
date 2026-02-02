import { beforeAll, describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

const baseUrl = process.env.C4A_STORAGE_BACKEND_URL;
const runTest = baseUrl ? test : test.skip;
let serverAvailabilityError: string | null = null;

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

describe('ServerAdapter integration', () => {
  beforeAll(async () => {
    if (!baseUrl) return;
    const available = await checkServerAvailable();
    if (!available) {
      serverAvailabilityError =
        `[server-adapter-integration] storage-backend 不可用，请先执行 ./start.sh docker 启动服务后再运行测试。` +
        ` (url: ${baseUrl})`;
    }
  });

  runTest('health check returns ok', async () => {
    if (serverAvailabilityError) {
      throw new Error(serverAvailabilityError);
    }
    const adapter = new ServerAdapter({ url: baseUrl!, timeout: 5000, retries: 1 });
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
  });
});
