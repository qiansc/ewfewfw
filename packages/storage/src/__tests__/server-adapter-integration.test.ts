import { describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

const baseUrl = process.env.C4A_STORAGE_BACKEND_URL;
const runTest = baseUrl ? test : test.skip;

describe('ServerAdapter integration', () => {
  runTest('health check returns ok', async () => {
    const adapter = new ServerAdapter({ url: baseUrl!, timeout: 5000, retries: 1 });
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
  });
});
