/**
 * Server Embedding Provider (v0.3.1)
 *
 * 支持 Ollama / OpenAI / Pseudo，其它 provider 暂留入口。
 */

import { createHash } from 'node:crypto';

export type EmbeddingProvider = 'ollama' | 'openai' | 'claude' | 'doubao' | 'onnx' | 'pseudo';

export type EmbeddingConfig = {
  provider?: EmbeddingProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  vectorDim?: number;
};

export type EmbeddingClient = {
  provider: EmbeddingProvider;
  model: string;
  baseUrl?: string;
  getEmbedding: (text: string) => Promise<number[]>;
  getDimension: () => number | null;
};

const DEFAULT_PSEUDO_DIM = 64;

export function createEmbeddingClient(config: EmbeddingConfig = {}): EmbeddingClient {
  const resolvedProvider = resolveProvider(config);
  if (resolvedProvider === 'pseudo') {
    const dim = config.vectorDim ?? DEFAULT_PSEUDO_DIM;
    return {
      provider: 'pseudo',
      model: 'pseudo-hash',
      getEmbedding: async (text: string) => buildPseudoVector(text, dim),
      getDimension: () => dim,
    };
  }

  if (resolvedProvider === 'openai') {
    const apiKey = config.apiKey ?? process.env.C4A_EMBEDDING_API_KEY;
    if (!apiKey) {
      throw new Error('Missing embedding API key. Set C4A_EMBEDDING_API_KEY.');
    }
    const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = config.model || 'text-embedding-3-small';
    const timeoutMs = config.timeoutMs ?? 20_000;
    let dimension: number | null = null;

    return {
      provider: 'openai',
      model,
      baseUrl,
      getEmbedding: async (text: string) => {
        const vector = await fetchOpenAiEmbedding(baseUrl, model, text, apiKey, timeoutMs);
        if (dimension === null) {
          dimension = vector.length;
        }
        return vector;
      },
      getDimension: () => dimension,
    };
  }

  if (resolvedProvider !== 'ollama') {
    throw new Error(`Embedding provider not supported yet: ${resolvedProvider}. TODO.`);
  }

  const baseUrl = resolveOllamaBaseUrl(config);
  const model = config.model || process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
  const timeoutMs = config.timeoutMs ?? 20_000;

  let dimension: number | null = null;

  return {
    provider: 'ollama',
    model,
    baseUrl,
    getEmbedding: async (text: string) => {
      if (!baseUrl) {
        throw new Error('Ollama baseUrl is required for embedding');
      }
      const vector = await fetchOllamaEmbedding(baseUrl, model, text, timeoutMs);
      if (dimension === null) {
        dimension = vector.length;
      }
      return vector;
    },
    getDimension: () => dimension,
  };
}

function resolveProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.provider) return config.provider;
  const hasOllama =
    Boolean(config.baseUrl) ||
    Boolean(process.env.STORAGE_OLLAMA_URL) ||
    Boolean(process.env.OLLAMA_HOST) ||
    Boolean(process.env.OLLAMA_URL);
  return hasOllama ? 'ollama' : 'pseudo';
}

function resolveOllamaBaseUrl(config: EmbeddingConfig): string {
  return (
    config.baseUrl ||
    process.env.STORAGE_OLLAMA_URL ||
    process.env.OLLAMA_HOST ||
    process.env.OLLAMA_URL ||
    'http://localhost:11434'
  );
}

async function fetchOllamaEmbedding(
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama embedding request failed: ${response.status}`);
    }
    const payload = (await response.json()) as { embedding?: number[] };
    if (!payload.embedding || !Array.isArray(payload.embedding)) {
      throw new Error('Ollama embedding response missing vector');
    }
    return payload.embedding;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenAiEmbedding(
  baseUrl: string,
  model: string,
  input: string,
  apiKey: string,
  timeoutMs: number
): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI embedding request failed: ${response.status}`);
    }
    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = payload.data?.[0]?.embedding;
    if (!vector || !Array.isArray(vector)) {
      throw new Error('OpenAI embedding response missing vector');
    }
    return vector;
  } finally {
    clearTimeout(timer);
  }
}

function buildPseudoVector(text: string, dim: number): number[] {
  const normalized = text.trim().toLowerCase();
  const vector = new Array<number>(dim).fill(0);
  if (!normalized) {
    return vector;
  }

  for (let i = 0; i < dim; i += 1) {
    const hash = createHash('sha256')
      .update(`${i}:${normalized}`)
      .digest();
    const value = hash.readUInt16BE(0) / 65535;
    vector[i] = value;
  }

  return vector;
}
