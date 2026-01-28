/**
 * LiteAdapter Repair 操作
 */

import { generateVectorKey } from '../vector-search.js';
import type {
  RepairParams,
  RepairResult,
  Inconsistency,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// Repair 操作
// ============================================================

/**
 * 修复数据一致性
 * 设计文档: store-utils.md §3.15
 *
 * 注意：Local 模式使用 SQLite 事务保证一致性，
 * 此工具主要用于检测和修复向量索引问题。
 */
export async function repair(
  ctx: AdapterContext,
  params: RepairParams
): Promise<RepairResult> {
  const db = ctx.store.getDatabase();
  const scope = params.scope ?? 'all';
  const dryRun = params.dry_run ?? false;

  const inconsistencies: Inconsistency[] = [];
  let scanned = 0;
  let milvusFixed = 0;

  try {
    // 构建实体查询条件
    let entityCondition = '';
    const entityValues: string[] = [];
    if (params.entity_ids && params.entity_ids.length > 0) {
      const placeholders = params.entity_ids.map(() => '?').join(', ');
      entityCondition = `WHERE e.id IN (${placeholders})`;
      entityValues.push(...params.entity_ids);
    }

    // 查询实体
    const entities = db.prepare(`
      SELECT e.id, e.source_project, e.data
      FROM entities e
      ${entityCondition}
    `).all(...entityValues) as Array<{
      id: string;
      source_project: string;
      data: string;
    }>;

    scanned = entities.length;

    // 检查向量索引
    if (scope === 'all' || scope === 'milvus') {
      const vectorStore = ctx.store.getVectorStore();
      if (vectorStore) {
        for (const entity of entities) {
          const vectorKey = generateVectorKey(entity.source_project ?? '', entity.id, '');
          const vector = vectorStore.has(vectorKey);

          if (!vector) {
            inconsistencies.push({
              entity_id: entity.id,
              issue: '缺少向量索引',
              fixed: false,
            });

            if (!dryRun && ctx.config.enableVectorSearch) {
              // 尝试重建向量（简化实现，实际需要调用 embedding 服务）
              // 这里标记为未修复，因为需要异步生成向量
              inconsistencies[inconsistencies.length - 1].fixed = false;
            }
          }
        }
      }

      if (!dryRun && ctx.config.enableVectorSearch) {
        try {
          const rebuild = await ctx.store.rebuildVectorIndex();
          milvusFixed = rebuild.indexed;
        } catch {
          // 重建失败不阻断主流程
        }
      }
    }

    // neo4j scope 在 Local 模式下不适用
    if (scope === 'neo4j') {
      return {
        success: true,
        scanned,
        inconsistencies: [],
        message: 'Local 模式不使用 Neo4j，无需修复',
      };
    }

    return {
      success: true,
      scanned,
      inconsistencies,
      stats: {
        neo4j_fixed: 0,
        milvus_fixed: milvusFixed,
        failed: inconsistencies.filter(i => !i.fixed).length,
      },
    };
  } catch (error) {
    return {
      success: false,
      scanned,
      inconsistencies,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
