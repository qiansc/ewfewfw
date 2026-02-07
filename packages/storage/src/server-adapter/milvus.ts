/**
 * MilvusAdapter (v0.3.1)
 *
 * - 配置 milvusUrl 时：使用 Milvus SDK 直连
 * - 未配置 milvusUrl 时：使用内存检索（用于本地测试）
 * - 向量由 Embedding Provider 生成（默认 Ollama）
 */
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { RowData } from '@zilliz/milvus2-sdk-node';
import type { Entity, SearchParams, SearchResult } from '../adapter.js';
import type { ServerConfig } from '../get-adapter.js';
import { createEmbeddingClient } from './embedding.js';
import type { EmbeddingClient } from './embedding.js';
import { computeContentHash } from '@c4a/core';

type IndexedEntity = {
  entity: Entity;
  text: string;
  vector: number[];
  content_hash: string;
};

const DEFAULT_COLLECTION = 'c4a_entities';

export class MilvusAdapter {
  private config: ServerConfig;
  private client: MilvusClient | null = null;
  private collectionName: string;
  private index = new Map<string, IndexedEntity>();
  private embedder: EmbeddingClient;
  private vectorDim: number | null = null;
  private collectionFields: Set<string> | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
    this.collectionName = DEFAULT_COLLECTION;
    this.embedder = createEmbeddingClient(config.embedding);
    this.vectorDim = this.embedder.getDimension();
  }

  async initialize(): Promise<void> {
    if (!this.config.milvusUrl) {
      return;
    }
    if (this.client) {
      return;
    }

    this.client = new MilvusClient({
      address: this.config.milvusUrl,
      token: this.config.milvusToken,
    });
    // collection 在首次向量生成后根据维度创建
  }

  async close(): Promise<void> {
    this.index.clear();
    this.client = null;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      return true;
    }
    try {
      const response = await this.client.listCollections();
      return response.status?.error_code === 'Success';
    } catch {
      return false;
    }
  }

  async upsertEntity(entity: Entity): Promise<void> {
    const uuid = entity.uuid;
    if (!uuid) return;

    if (entity.type === 'feat' || entity.type === 'checklist') {
      await this.deleteEntity(uuid);
      return;
    }

    const text = buildSearchText(entity.data);
    const contentHash = entity.metadata.content_hash ?? computeContentHash(entity.data ?? {});
    const existing = this.index.get(uuid);
    const vector =
      existing && existing.content_hash === contentHash
        ? existing.vector
        : await this.embedder.getEmbedding(text);
    const resolvedDim = this.vectorDim ?? this.embedder.getDimension() ?? vector.length;
    if (!Number.isFinite(resolvedDim) || resolvedDim <= 0) {
      // 无法确定向量维度，跳过 Milvus 同步
      return;
    }
    this.vectorDim = resolvedDim;
    this.index.set(uuid, { entity, text, vector, content_hash: contentHash });

    if (!this.client) {
      return;
    }

    try {
      await this.ensureCollection(this.vectorDim);
      const fields = this.collectionFields ?? new Set<string>();
      await this.client.deleteEntities({
        collection_name: this.collectionName,
        expr: `uuid == "${uuid}"`,
      });

      const fieldsData: Record<string, unknown> = {};
      if (fields.has('uuid')) fieldsData.uuid = uuid;
      if (fields.has('id')) fieldsData.id = entity.id;
      if (fields.has('root_id')) fieldsData.root_id = entity.root_id ?? '';
      if (fields.has('content_hash')) fieldsData.content_hash = contentHash;
      if (fields.has('text')) fieldsData.text = text;
      if (fields.has('vector')) fieldsData.vector = vector;
      if (fields.has('type')) {
        fieldsData.type = entity.type;
      }
      if (fields.has('requirement_id')) {
        fieldsData.requirement_id = entity.requirement_id ?? '';
      }
      if (fields.has('versions')) {
        fieldsData.versions = '';
      }
      if (fields.has('metadata_json')) {
        fieldsData.metadata_json = JSON.stringify(entity.metadata ?? {});
      }

      const insertResult = await this.client.insert({
        collection_name: this.collectionName,
        fields_data: [
          fieldsData as RowData,
        ],
      });
      if (insertResult?.status?.error_code && insertResult.status.error_code !== 'Success') {
        throw new Error(insertResult.status.reason || 'Milvus insert failed');
      }
      await this.client.flushSync({ collection_names: [this.collectionName] });
    } catch (error) {
      console.warn('Milvus upsert failed:', error instanceof Error ? error.message : error);
      // Milvus 失败时跳过同步（不影响核心保存流程）
      return;
    }
  }

  async searchCandidates(
    params: SearchParams & { candidateLimit?: number }
  ): Promise<{
    items: Array<{ uuid: string; score: number; text: string; snippet?: string }>;
    degraded: boolean;
    degraded_reason?: SearchResult['degraded_reason'];
    degraded_message?: string;
    search_mode: SearchResult['search_mode'];
    total: number;
  }> {
    const fromMemory = await this.searchInMemory(params);

    if (!this.client) {
      return fromMemory;
    }

    try {
      const queryVector = await this.embedder.getEmbedding(params.query);
      this.vectorDim = this.vectorDim ?? this.embedder.getDimension() ?? queryVector.length;
      await this.ensureCollection(this.vectorDim ?? queryVector.length);
      const limit = Math.max(1, params.candidateLimit ?? params.limit ?? 20);
      const fields = this.collectionFields ?? new Set<string>();
      const outputFields = ['uuid', 'text', 'content_hash'].filter(
        (field) => fields.size === 0 || fields.has(field)
      );
      const response = await this.client.search({
        collection_name: this.collectionName,
        anns_field: 'vector',
        data: [queryVector],
        output_fields: outputFields,
        limit,
      });

      const records = (response.results ?? []) as Array<Record<string, unknown>>;
      return {
        items: records
          .filter((record) => String(record.uuid ?? '').length > 0)
          .map((record) => ({
            uuid: String(record.uuid ?? ''),
            score: toNumber(record.score, 0),
            text: String(record.text ?? ''),
            snippet: buildSnippetFromText(String(record.text ?? ''), params.query),
          })),
        degraded: false,
        search_mode: 'vector',
        total: records.length,
      };
    } catch {
      return {
        ...fromMemory,
        degraded: true,
        degraded_reason: 'VECTOR_SEARCH_FAILED',
        degraded_message: 'Milvus 查询失败，已降级为本地索引',
      };
    }
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const result = await this.searchCandidates(params);
    return {
      items: result.items.map((item) => ({
        id: item.uuid,
        type: 'component',
        score: item.score,
        snippet: item.snippet,
        metadata: {},
      })),
      degraded: result.degraded,
      degraded_reason: result.degraded_reason,
      degraded_message: result.degraded_message,
      search_mode: result.search_mode,
      total: result.total,
      has_more: false,
    };
  }

  async deleteEntity(uuid: string): Promise<void> {
    this.index.delete(uuid);
    if (!this.client) {
      return;
    }
    await this.client.deleteEntities({
      collection_name: this.collectionName,
      expr: `uuid == "${uuid}"`,
    });
  }

  async rebuildFromEntities(entities: Entity[]): Promise<void> {
    this.index.clear();
    for (const entity of entities) {
      await this.upsertEntity(entity);
    }
  }

  private async searchInMemory(
    params: SearchParams & { candidateLimit?: number }
  ): Promise<{
    items: Array<{ uuid: string; score: number; text: string; snippet?: string }>;
    degraded: boolean;
    degraded_reason?: SearchResult['degraded_reason'];
    degraded_message?: string;
    search_mode: SearchResult['search_mode'];
    total: number;
  }> {
    const candidates: Array<{ uuid: string; text: string; score: number }> = [];
    const queryVector = await this.embedder.getEmbedding(params.query);

    for (const [uuid, stored] of this.index.entries()) {
      if (!matchFilters(stored.entity, params)) continue;
      const score = cosineSimilarity(queryVector, stored.vector);
      if (!Number.isFinite(score) || score <= 0) continue;
      candidates.push({ uuid, text: stored.text, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const limit = Math.max(1, params.candidateLimit ?? params.limit ?? 20);
    const sliced = candidates.slice(0, limit);

    return {
      items: sliced.map(({ uuid, text, score }) => ({
        uuid,
        score,
        text,
        snippet: buildSnippetFromText(text, params.query),
      })),
      degraded: false,
      search_mode: 'vector',
      total: candidates.length,
    };
  }

  private async ensureCollection(vectorDim: number): Promise<void> {
    if (!this.client) {
      return;
    }

    const listed = await this.client.listCollections();
    const names = (listed.data ?? []).map((item) => String(item.name));
    if (names.includes(this.collectionName)) {
      const description = await this.client.describeCollection({
        collection_name: this.collectionName,
        cache: true,
      });
      const fields = description.schema?.fields ?? [];
      this.collectionFields = new Set(fields.map((field) => field.name));
      const vectorField = fields.find((field) => field.name === 'vector');
      const rawTypeParams = vectorField?.type_params as
        | Array<{ key?: string; value?: string | number }>
        | Record<string, unknown>
        | undefined;
      const dimValue =
        Array.isArray(rawTypeParams)
          ? rawTypeParams.find((param) => param.key === 'dim')?.value
          : rawTypeParams && typeof rawTypeParams === 'object' && 'dim' in rawTypeParams
            ? (rawTypeParams as { dim?: string | number }).dim
            : vectorField?.dim;
      const hasContentHash = this.collectionFields.has('content_hash');
      if (!dimValue || Number(dimValue) !== vectorDim || !hasContentHash) {
        this.collectionName = `${DEFAULT_COLLECTION}_${vectorDim}`;
        return this.ensureCollection(vectorDim);
      }
      await this.client.loadCollectionSync({ collection_name: this.collectionName });
      return;
    }

    await this.client.createCollection({
      collection_name: this.collectionName,
      fields: [
        {
          name: 'uuid',
          data_type: 21,
          is_primary_key: true,
          max_length: 64,
        },
        { name: 'id', data_type: 21, max_length: 256 },
        { name: 'root_id', data_type: 21, max_length: 256 },
        { name: 'content_hash', data_type: 21, max_length: 128 },
        { name: 'text', data_type: 21, max_length: 4096 },
        {
          name: 'vector',
          data_type: 101,
          dim: vectorDim,
          type_params: { dim: `${vectorDim}` },
        },
      ],
    });
    this.collectionFields = new Set(['uuid', 'id', 'root_id', 'content_hash', 'text', 'vector']);

    await this.client.createIndex({
      collection_name: this.collectionName,
      field_name: 'vector',
      index_type: 'AUTOINDEX',
      metric_type: 'COSINE',
    });
    await this.client.loadCollectionSync({ collection_name: this.collectionName });
  }
}

function buildSearchText(data: Record<string, unknown>): string {
  const tags = Array.isArray(data.tags) ? data.tags.join(' ') : '';
  return [data.name, data.title, data.description, data.id, tags]
    .filter((item) => typeof item === 'string' && item.length > 0)
    .join(' ')
    .toLowerCase();
}

function matchFilters(entity: Entity, params: SearchParams): boolean {
  if (entity.type === 'feat' || entity.type === 'checklist') return false;
  if (params.scope && params.scope !== 'all' && entity.type !== params.scope) return false;
  if (params.root_id && entity.root_id !== params.root_id) return false;
  if (params.requirement_id && entity.requirement_id !== params.requirement_id) return false;
  // 版本过滤由文档库完成
  return true;
}

function buildSnippetFromText(text: string, query: string): string | undefined {
  if (!text) return undefined;
  const keyword = query.trim().toLowerCase();
  if (!keyword) return text.slice(0, 120);
  const index = text.indexOf(keyword);
  if (index < 0) return text.slice(0, 120);
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + keyword.length + 40);
  return text.slice(start, end);
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
