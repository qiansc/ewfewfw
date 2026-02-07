/**
 * LiteAdapter Save 向量索引更新
 */

import type { AdapterContext } from './types.js';
import { generateEmbedding, generateVectorKey } from '../vector-search.js';
import { generateSearchText } from './helpers.js';

/**
 * 更新向量索引
 */
export async function updateVectorIndex(
  ctx: AdapterContext,
  uuid: string,
  entityType: string,
  data: Record<string, unknown>
): Promise<void> {
  // 检查向量搜索是否可用
  if (!ctx.store.isVectorSearchEnabled()) {
    return;
  }
  if (entityType === 'feat' || entityType === 'checklist') {
    return;
  }
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return;
  }

  // 生成搜索文本
  const text = generateSearchText(data);
  if (!text) return;

  // 生成向量
  const embedding = await generateEmbedding(text);

  // 写入 USearch 索引
  try {
    const vectorKey = generateVectorKey(uuid);
    vectorStore.add(vectorKey, embedding);
    // 显式保存（因为 usearch-store.ts 中 add 不会自动保存，依赖外部调用 flush 或 save）
    // 实际上 usearch-store.ts 有 markDirty 实现 debounce 自动保存，
    // 这里调用 add 就会触发 markDirty。
    // 如果需要立即持久化，可以调用 flush()，但为了性能，依赖 debounce 即可。
    // Issue 3 要求避免高频保存，现有的 debounce 机制已经满足。
  } catch {
    // 向量写入失败，忽略
  }
}
