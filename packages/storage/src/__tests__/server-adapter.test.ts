import { afterEach, describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

const originalFetch = globalThis.fetch;
type FetchImpl = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
const withPreconnect = (impl: FetchImpl): typeof fetch =>
  Object.assign(impl, { preconnect: originalFetch.preconnect }) as typeof fetch;
type FetchInput = Parameters<typeof fetch>[0];

afterEach(() => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('ServerAdapter http client', () => {
  test('fails health check when backend is unavailable', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async () => {
      throw new Error('connection refused');
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8050', retries: 0, timeout: 10 });
    await expect(adapter.initialize()).rejects.toThrow(/health check failed/i);
  });

  test('save uses POST /entities/save', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, id: 'demo', status: 'published', content_hash: 'hash' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    await adapter.save({ type: 'system', data: { id: 'demo', name: 'Demo' } });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].input)).toBe('http://localhost:8055/entities/save');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.type).toBe('system');
  });

  test('read with id uses POST /entities/read', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          entity: { id: 'demo', type: 'system', status: 'published', data: { id: 'demo' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    await adapter.read({ id: 'demo', include_relations: true, format: 'object' });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].input)).toBe('http://localhost:8055/entities/read');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.id).toBe('demo');
    expect(body.include_relations).toBe(true);
  });

  test('read without id returns null without network call', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ entity: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    const result = await adapter.read({ filter: { type: 'system' }, limit: 10 });

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('list uses POST /entities/list', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ items: [], pagination: { total: 0, offset: 0, limit: 10, has_more: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    await adapter.list({ type: 'system', limit: 10, filter: { status: 'published' } });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].input)).toBe('http://localhost:8055/entities/list');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.type).toBe('system');
    expect(body.filter.status).toBe('published');
  });

  test('delete uses POST /entities/delete', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ success: true, id: 'demo' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    await adapter.delete({ id: 'demo', force: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].input)).toBe('http://localhost:8055/entities/delete');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.id).toBe('demo');
    expect(body.force).toBe(true);
  });

  test('queryDeps uses POST /graph/deps', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ nodes: [], degraded: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    await adapter.queryDeps({ id: 'demo', source_project: 'demo', depth: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].input)).toBe('http://localhost:8055/graph/deps');
  });

  test('queryImpact uses POST /graph/impact', async () => {
    const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: typeof fetch }).fetch = withPreconnect(async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ nodes: [], degraded: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const adapter = new ServerAdapter({ url: 'http://localhost:8055', retries: 0 });
    await adapter.queryImpact({ id: 'demo', source_project: 'demo', depth: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].input)).toBe('http://localhost:8055/graph/impact');
  });
});
