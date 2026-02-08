/**
 * Vector Search Module for Local Mode
 *
 * v0.3.1: 使用 uuid 作为向量索引键，基于 root_id/versions 过滤
 */

import type { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import type { VectorSearchHit, VectorStore } from './usearch-store.js';

// 模型配置
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = 384;
const MODEL_SEGMENTS = MODEL_NAME.split('/');
const MODEL_FILE_CANDIDATES = [
  join(...MODEL_SEGMENTS, 'onnx', 'model.onnx'),
  join(...MODEL_SEGMENTS, 'onnx', 'model_quantized.onnx'),
  join(...MODEL_SEGMENTS, 'model.onnx'),
  join(...MODEL_SEGMENTS, 'model_quantized.onnx'),
];

// 延迟加载的 embedder 实例
let embedder: FeatureExtractionPipeline | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

/**
 * 初始化 Embedding 模型
 */
export async function initEmbedder(): Promise<void> {
  if (embedder) return;

  if (isInitializing && initPromise) {
    await initPromise;
    return;
  }

  isInitializing = true;
  initPromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      const localModelPath = resolveLocalModelBasePath();
      if (localModelPath) {
        env.localModelPath = localModelPath;
      }
      env.allowRemoteModels = false;
      embedder = await pipeline('feature-extraction', MODEL_NAME, {
        local_files_only: true,
      });
    } finally {
      isInitializing = false;
    }
  })();

  await initPromise;
}

/**
 * 生成文本的向量表示
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!embedder) {
    await initEmbedder();
  }

  if (!embedder) {
    throw new Error('Failed to initialize embedder');
  }

  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

/**
 * 获取 Embedding 维度
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION;
}

/**
 * 检查 embedder 是否已初始化
 */
export function isEmbedderReady(): boolean {
  return embedder !== null;
}

/**
 * 测试辅助：注入/重置 embedder
 */
export function setEmbedderForTest(value: FeatureExtractionPipeline | null): void {
  embedder = value;
  isInitializing = false;
  initPromise = null;
}

export function resolveLocalModelBasePath(): string | null {
  const candidates: string[] = [];
  if (process.env.C4A_MODELS_DIR) {
    candidates.push(process.env.C4A_MODELS_DIR);
  }

  if (process.argv[1]) {
    candidates.push(resolve(dirname(process.argv[1]), 'models'));
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(moduleDir, '../../../cli/dist/models'));
  candidates.push(resolve(process.cwd(), 'dist/models'));
  candidates.push(resolve(process.cwd(), 'models'));

  for (const candidate of candidates) {
    if (hasModelAtBase(candidate)) {
      return candidate;
    }
  }

  return null;
}

function hasModelAtBase(baseDir: string): boolean {
  if (!existsSync(baseDir)) return false;
  return MODEL_FILE_CANDIDATES.some((filePath) => existsSync(resolve(baseDir, filePath)));
}

// ============================================================
// 向量搜索实现
// ============================================================

export interface VectorSearchResult {
  uuid: string;
  id: string;
  root_id: string;
  type: string;
  data: string;
  distance: number;
}

type Candidate = {
  uuid: string;
  distance: number;
};

/**
 * 语义搜索
 */
export async function semanticSearch(
  db: Database,
  vectorStore: VectorStore,
  query: string,
  options: { rootId?: string; versions?: string[] } = {},
  limit: number = 10
): Promise<VectorSearchResult[]> {
  const embedding = await generateEmbedding(query);
  const searchLimit = Math.max(limit * 3, limit);
  const hits = vectorStore.search(embedding, searchLimit);

  const candidates = filterCandidates(hits);
  const results: VectorSearchResult[] = [];

  for (const candidate of candidates) {
    if (results.length >= limit) break;
    const row = loadEntity(db, candidate.uuid);
    if (!row) continue;
    if (row.status === 'archived' || row.status === 'deprecated') continue;
    if (options.rootId && row.root_id !== options.rootId) continue;
    if (options.versions && options.versions.length > 0) {
      if (!entityHasVersions(db, candidate.uuid, options.versions)) continue;
    }
    results.push({
      uuid: row.uuid,
      id: row.id,
      root_id: row.root_id,
      type: row.type,
      data: row.data,
      distance: candidate.distance,
    });
  }

  return results;
}

function filterCandidates(hits: VectorSearchHit[]): Candidate[] {
  return hits
    .map((hit) => {
      const uuid = parseVectorKey(hit.key);
      return { uuid, distance: hit.distance };
    })
    .filter((item) => Boolean(item.uuid));
}

function loadEntity(
  db: Database,
  uuid: string
): {
  uuid: string;
  id: string;
  root_id: string;
  type: string;
  data: string;
  status: string;
} | null {
  const row = db.prepare(`
    SELECT e.uuid, e.id, e.root_id, e.type, e.data, m.status
    FROM entities e
    JOIN metadata m ON e.uuid = m.entity_uuid
    WHERE e.uuid = ?
    LIMIT 1
  `).get(uuid) as
    | {
        uuid: string;
        id: string;
        root_id: string;
        type: string;
        data: string;
        status: string;
      }
    | undefined;

  return row ?? null;
}

function entityHasVersions(db: Database, uuid: string, versions: string[]): boolean {
  const placeholders = versions.map(() => '?').join(', ');
  const row = db.prepare(
    `SELECT 1 FROM entity_versions WHERE entity_uuid = ? AND version IN (${placeholders}) LIMIT 1`
  ).get(uuid, ...versions) as { [key: string]: unknown } | undefined;
  return Boolean(row);
}

/**
 * 生成向量键 (用于 USearch key 映射)
 */
export function generateVectorKey(uuid: string): string {
  return uuid;
}

/**
 * 解析向量键
 */
export function parseVectorKey(vectorKey: string): string {
  return vectorKey;
}
