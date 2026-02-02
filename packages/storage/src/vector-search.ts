/**
 * Vector Search Module for Local Mode
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/vector-search.md
 *
 * 核心特性:
 * - 使用 @xenova/transformers 本地生成向量
 * - 使用 USearch 保存/检索向量索引
 * - 支持 Feat 版本隔离 (Copy-on-Write)
 * - Merge View 语义搜索
 */

import type { Database } from 'bun:sqlite';
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import type { VectorSearchHit, VectorStore } from './usearch-store.js';

// 模型配置
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = 384;

// 延迟加载的 embedder 实例
let embedder: FeatureExtractionPipeline | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

/**
 * 初始化 Embedding 模型
 *
 * 设计文档: vector-search.md L3-29
 *
 * 模型特性:
 * - 模型: all-MiniLM-L6-v2
 * - 维度: 384
 * - 大小: ~80MB
 * - 语言: 多语言支持（中英文）
 * - 缓存位置: ~/.cache/huggingface/
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
      // 动态导入 @xenova/transformers
      const { pipeline } = await import('@xenova/transformers');
      embedder = await pipeline('feature-extraction', MODEL_NAME);
    } finally {
      isInitializing = false;
    }
  })();

  await initPromise;
}

/**
 * 生成文本的向量表示
 *
 * @param text - 输入文本
 * @returns 384 维向量
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!embedder) {
    await initEmbedder();
  }

  if (!embedder) {
    throw new Error('Failed to initialize embedder');
  }

  const output = await embedder(text, { pooling: 'mean', normalize: true });
  // @xenova/transformers 返回 Tensor 对象，需要访问 data 属性
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

// ============================================================
// 向量搜索实现 (设计文档 §3.2)
// ============================================================

export interface VectorSearchResult {
  id: string;
  source_project: string;
  proposal_id: string | null;
  type: string;
  data: string;
  distance: number;
}

type Candidate = {
  key: string;
  sourceProject: string;
  entityId: string;
  proposalId: string | null;
  distance: number;
  priority: number;
};

/**
 * 语义搜索 (带 Feat 版本隔离)
 *
 * 设计文档: vector-search.md L62-120
 *
 * 核心逻辑:
 * 1. USearch 向量召回
 * 2. Feat 优先 → 主分支兜底
 * 3. 每个实体只保留优先级最高的版本
 *
 * @param db - SQLite 数据库连接
 * @param vectorStore - USearch 向量索引
 * @param query - 搜索查询文本
 * @param currentProposalId - 当前 Feat ID (null 表示主分支)
 * @param limit - 返回结果数量限制
 */
export async function semanticSearch(
  db: Database,
  vectorStore: VectorStore,
  query: string,
  currentProposalId: string | null,
  limit: number = 10
): Promise<VectorSearchResult[]> {
  const embedding = await generateEmbedding(query);
  const searchLimit = Math.max(limit * 3, limit);
  const hits = vectorStore.search(embedding, searchLimit);

  const candidates = filterCandidates(hits, currentProposalId);
  const merged = mergeByEntity(candidates);
  const sorted = merged.sort((a, b) => a.distance - b.distance).slice(0, limit);

  const results: VectorSearchResult[] = [];
  for (const candidate of sorted) {
    const row = loadEntity(db, candidate);
    if (!row) continue;
    results.push({
      id: row.id,
      source_project: row.source_project,
      proposal_id: normalizeProposalId(row.proposal_id),
      type: row.type,
      data: row.data,
      distance: candidate.distance,
    });
  }

  return results;
}

function filterCandidates(
  hits: VectorSearchHit[],
  currentProposalId: string | null
): Candidate[] {
  return hits
    .map((hit) => {
      const parsed = parseVectorKey(hit.key);
      const proposalId = parsed.proposalId ?? null;
      const priority = getPriority(proposalId, currentProposalId);
      if (priority === null) return null;
      return {
        key: hit.key,
        sourceProject: parsed.sourceProject,
        entityId: parsed.entityId,
        proposalId,
        distance: hit.distance,
        priority,
      };
    })
    .filter((item): item is Candidate => item !== null);
}

function getPriority(proposalId: string | null, currentProposalId: string | null): number | null {
  if (currentProposalId === null) {
    return proposalId === null || proposalId === '' ? 1 : null;
  }
  if (proposalId === currentProposalId) return 1;
  if (proposalId === null || proposalId === '') return 2;
  return null;
}

function mergeByEntity(candidates: Candidate[]): Candidate[] {
  const byEntity = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const entityKey = `${candidate.sourceProject}:${candidate.entityId}`;
    const existing = byEntity.get(entityKey);
    if (!existing) {
      byEntity.set(entityKey, candidate);
      continue;
    }
    if (
      candidate.priority < existing.priority ||
      (candidate.priority === existing.priority && candidate.distance < existing.distance)
    ) {
      byEntity.set(entityKey, candidate);
    }
  }
  return Array.from(byEntity.values());
}

function loadEntity(db: Database, candidate: Candidate): {
  id: string;
  source_project: string;
  proposal_id: string | null;
  type: string;
  data: string;
} | null {
  const dbProposalId = candidate.proposalId ?? '';
  const row = db.prepare(`
      SELECT e.id, e.source_project, e.proposal_id, e.type, e.data
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
      WHERE e.source_project = ?
        AND e.id = ?
        AND (e.proposal_id = ? OR (e.proposal_id IS NULL AND ? = ''))
        AND m.status NOT IN ('archived', 'deprecated')
      LIMIT 1
    `).get(candidate.sourceProject, candidate.entityId, dbProposalId, dbProposalId) as
    | {
        id: string;
        source_project: string;
        proposal_id: string | null;
        type: string;
        data: string;
      }
    | undefined;

  return row ?? null;
}

function normalizeProposalId(value: string | null): string | null {
  if (value === '') return null;
  return value;
}

/**
 * 生成向量键 (用于 USearch key 映射)
 *
 * 格式: "{source_project}:{entity_id}:{proposal_id}"
 * proposal_id 为 NULL 时使用空字符串
 */
export function generateVectorKey(
  sourceProject: string,
  entityId: string,
  proposalId: string | null
): string {
  return `${sourceProject}:${entityId}:${proposalId || ''}`;
}

/**
 * 解析向量键
 */
export function parseVectorKey(vectorKey: string): {
  sourceProject: string;
  entityId: string;
  proposalId: string | null;
} {
  const parts = vectorKey.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid vector key format: ${vectorKey}`);
  }

  return {
    sourceProject: parts[0],
    entityId: parts[1],
    proposalId: parts[2] || null,
  };
}
