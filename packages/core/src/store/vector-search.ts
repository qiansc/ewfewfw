/**
 * Vector Search Module for Local Mode
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/vector-search.md
 *
 * 核心特性:
 * - 使用 @xenova/transformers 本地生成向量
 * - 支持 Feat 版本隔离 (Copy-on-Write)
 * - Merge View 语义搜索
 */

import type Database from 'better-sqlite3';
import type { FeatureExtractionPipeline } from '@xenova/transformers';

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

/**
 * 语义搜索 (带 Feat 版本隔离)
 *
 * 设计文档: vector-search.md L62-120
 *
 * 核心逻辑:
 * 1. 使用 Window Function 实现 Merge View
 * 2. Feat 优先 → 主分支兜底
 * 3. 每个实体只保留优先级最高的版本
 *
 * @param db - SQLite 数据库连接
 * @param query - 搜索查询文本
 * @param currentProposalId - 当前 Feat ID (null 表示主分支)
 * @param limit - 返回结果数量限制
 */
export async function semanticSearch(
  db: Database.Database,
  query: string,
  currentProposalId: string | null,
  limit: number = 10
): Promise<VectorSearchResult[]> {
  const embedding = await generateEmbedding(query);

  // 注意: 此实现需要 sqlite-vec 扩展
  // 如果扩展未加载，将回退到全表扫描
  if (currentProposalId === null) {
    // 主分支模式: 只搜索主分支
    return db.prepare(`
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM entities e
      JOIN vectors v ON
        e.source_project = v.source_project AND
        e.id = v.entity_id AND
        e.proposal_id IS NULL AND v.proposal_id IS NULL
      WHERE e.proposal_id IS NULL
      ORDER BY distance ASC
      LIMIT ?
    `).all(embedding, limit) as VectorSearchResult[];
  }

  // Feat 模式: 实现 Merge View
  return db.prepare(`
    WITH ranked_entities AS (
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        v.embedding,
        vec_distance_cosine(v.embedding, ?) as distance,
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY
            CASE
              WHEN e.proposal_id = ? THEN 1
              WHEN e.proposal_id IS NULL THEN 2
              ELSE 3
            END
        ) as rn
      FROM entities e
      JOIN vectors v ON
        e.source_project = v.source_project AND
        e.id = v.entity_id AND
        ((e.proposal_id IS NULL AND v.proposal_id IS NULL) OR e.proposal_id = v.proposal_id)
      WHERE
        (e.proposal_id = ? OR e.proposal_id IS NULL)
    )
    SELECT
      id,
      source_project,
      proposal_id,
      type,
      data,
      distance
    FROM ranked_entities
    WHERE rn = 1
    ORDER BY distance ASC
    LIMIT ?
  `).all(
    embedding,
    currentProposalId,
    currentProposalId,
    limit
  ) as VectorSearchResult[];
}

/**
 * 生成向量键 (用于 vectors 表主键)
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
