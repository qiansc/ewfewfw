import { afterEach, describe, expect, test } from 'bun:test';
import { C4AError } from '@c4a/core';
import { HttpClient } from '../server-adapter/http-client.js';

const originalFetch = globalThis.fetch;
type FetchImpl = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
const withPreconnect = (impl: FetchImpl): typeof fetch =>
  Object.assign(impl, { preconnect: originalFetch.preconnect }) as typeof fetch;

afterEach(() => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('HttpClient', () => {
  test('retries on server error and returns success', async () => {
    let calls = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('server error', { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new HttpClient({
      baseUrl: 'http://localhost:8055',
      retries: 1,
      retryDelayMs: 0,
      timeout: 100,
    });
    const result = await client.get<{ ok: boolean }>('/health');
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test('returns null when allowNotFound is enabled', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async () => {
      return new Response('not found', { status: 404 });
    });
    const client = new HttpClient({ baseUrl: 'http://localhost:8055', retries: 0 });
    const result = await client.get('/missing', { allowNotFound: true });
    expect(result).toBeNull();
  });

  test('throws C4AError when backend returns error payload', async () => {
    const errorPayload = {
      code: 'C4A-INPUT-002',
      message: 'invalid',
      timestamp: new Date().toISOString(),
    };
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async () => {
      return new Response(JSON.stringify(errorPayload), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new HttpClient({ baseUrl: 'http://localhost:8055', retries: 0 });
    let thrown: unknown;
    try {
      await client.get('/bad');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(C4AError);
    expect((thrown as C4AError).code).toBe('C4A-INPUT-002');
  });

  test('applies request and response interceptors', async () => {
    const headersSeen: Record<string, string> = {};
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) {
        Object.assign(headersSeen, headers);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new HttpClient({ baseUrl: 'http://localhost:8055', retries: 0 });
    client.addRequestInterceptor(async (config) => ({
      ...config,
      headers: { ...(config.headers ?? {}), 'x-test': '1' },
    }));
    client.addResponseInterceptor(async (response) => ({
      ...response,
      data: { ...(response.data as Record<string, unknown>), touched: true },
    }));

    const result = await client.get<{ ok: boolean; touched: boolean }>('/health');
    expect(headersSeen['x-test']).toBe('1');
    expect(result.touched).toBe(true);
  });
});
