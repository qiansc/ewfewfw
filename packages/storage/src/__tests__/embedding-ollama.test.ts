import { describe, expect, test } from 'bun:test';
import { createEmbeddingClient } from '../server-adapter/embedding.js';

describe('Ollama embedding client', () => {
  test('builds embedding via Ollama endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = createEmbeddingClient({
        provider: 'ollama',
        baseUrl: 'http://ollama:11434',
        model: 'nomic-embed-text',
      });
      const vector = await client.getEmbedding('hello');
      expect(vector).toEqual([0.1, 0.2, 0.3]);
      expect(client.getDimension()).toBe(3);
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe('http://ollama:11434/api/embeddings');
      expect(calls[0].body).toContain('"model":"nomic-embed-text"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
