import { describe, expect, test } from 'bun:test';
import { createEmbeddingClient } from '../server-adapter/embedding.js';

describe('OpenAI embedding client', () => {
  test('builds embedding via OpenAI endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.C4A_EMBEDDING_API_KEY;
    const calls: Array<{ url: string; body: string; auth: string | null }> = [];

    process.env.C4A_EMBEDDING_API_KEY = 'test-key';
    globalThis.fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        body: String(init?.body ?? ''),
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      });
      return new Response(JSON.stringify({ data: [{ embedding: [0.5, 0.1] }] }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = createEmbeddingClient({ provider: 'openai', model: 'text-embedding-3-small' });
      const vector = await client.getEmbedding('hello');
      expect(vector).toEqual([0.5, 0.1]);
      expect(client.getDimension()).toBe(2);
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe('https://api.openai.com/v1/embeddings');
      expect(calls[0].auth).toBe('Bearer test-key');
      expect(calls[0].body).toContain('"model":"text-embedding-3-small"');
      expect(calls[0].body).toContain('"input":"hello"');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.C4A_EMBEDDING_API_KEY;
      } else {
        process.env.C4A_EMBEDDING_API_KEY = originalApiKey;
      }
    }
  });

  test('throws when API key is missing', () => {
    const originalApiKey = process.env.C4A_EMBEDDING_API_KEY;
    if (originalApiKey !== undefined) {
      delete process.env.C4A_EMBEDDING_API_KEY;
    }

    try {
      expect(() => createEmbeddingClient({ provider: 'openai' })).toThrow(
        'Missing embedding API key. Set C4A_EMBEDDING_API_KEY.'
      );
    } finally {
      if (originalApiKey !== undefined) {
        process.env.C4A_EMBEDDING_API_KEY = originalApiKey;
      }
    }
  });
});
