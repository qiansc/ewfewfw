/**
 * LiteAdapter 工具类操作
 *
 * 实现 read_history, backup, restore, repair, validate
 * 设计文档: store-utils.md
 */

import { writeFileSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type {
  ReadHistoryParams,
  ReadHistoryResult,
  HistoryItem,
  BackupParams,
  BackupResult,
  RestoreParams,
  RestoreResult,
  RestoreConflict,
  RepairParams,
  RepairResult,
  Inconsistency,
  ValidateParams,
  ValidateResult,
  ValidateCheckType,
  ValidateCheckResult,
  ValidateError,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// ReadHistory 操作
// ============================================================

/**
 * 读取实体变更历史
 * 设计文档: store-utils.md §3.11
 */
export async function readHistory(
  ctx: AdapterContext,
  params: ReadHistoryParams
): Promise<ReadHistoryResult> {
  const db = ctx.store.getDatabase();
  const limit = params.limit ?? 100;
  const order = params.order ?? 'desc';

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.entity_id) {
    conditions.push('entity_id = ?');
    values.push(params.entity_id);
  }

  if (params.feat_id) {
    conditions.push('feat_id = ?');
    values.push(params.feat_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderClause = `ORDER BY changed_at ${order.toUpperCase()}`;

  const rows = db.prepare(`
    SELECT entity_id, feat_id, action, changed_fields, changed_by, changed_at
    FROM entity_history
    ${whereClause}
    ${orderClause}
    LIMIT ?
  `).all(...values, limit) as Array<{
    entity_id: string;
    feat_id: string | null;
    action: string;
    changed_fields: string | null;
    changed_by: string | null;
    changed_at: string;
  }>;

  const items: HistoryItem[] = rows.map(row => ({
    entity_id: row.entity_id,
    feat_id: row.feat_id,
    action: row.action as 'create' | 'update' | 'delete',
    changed_fields: row.changed_fields ? JSON.parse(row.changed_fields) : undefined,
    changed_by: row.changed_by ?? undefined,
    changed_at: row.changed_at,
  }));

  // 获取总数
  const countResult = db.prepare(`
    SELECT COUNT(*) as total FROM entity_history ${whereClause}
  `).get(...values) as { total: number };

  return {
    success: true,
    items,
    total: countResult.total,
  };
}

// ============================================================
// Backup 操作
// ============================================================

/**
 * 备份格式版本
 */
const BACKUP_FORMAT_VERSION = '1.0';

/**
 * 备份数据
 * 设计文档: store-utils.md §3.13
 *
 * P2-3.1: 支持 tar.gz 和 json 两种格式
 * - tar.gz: 默认格式，使用 gzip 压缩
 * - json: 纯 JSON 格式，便于调试
 */
export async function backup(
  ctx: AdapterContext,
  params: BackupParams
): Promise<BackupResult> {
  const db = ctx.store.getDatabase();
  const statusFilter = params.status_filter ?? 'published';
  const format = params.format ?? 'tar.gz';

  try {
    // 构建状态过滤条件
    let statusCondition = '';
    if (statusFilter === 'published') {
      statusCondition = "WHERE m.status = 'published'";
    } else if (statusFilter === 'approved') {
      statusCondition = "WHERE m.status IN ('published', 'approved')";
    }
    // 'all' 不需要条件

    // 查询实体
    const entities = db.prepare(`
      SELECT e.id, e.type, e.source_project, e.data,
             m.status, m.content_hash, m.created_at, m.updated_at
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      ${statusCondition}
    `).all() as Array<{
      id: string;
      type: string;
      source_project: string;
      data: string;
      status: string;
      content_hash: string;
      created_at: string;
      updated_at: string;
    }>;

    // 查询关系
    const relations = db.prepare(`
      SELECT * FROM relations WHERE proposal_id IS NULL
    `).all();

    // 查询向量数量
    let vectorCount = 0;
    try {
      const vectorResult = db.prepare(`
        SELECT COUNT(*) as count FROM vectors WHERE proposal_id IS NULL
      `).get() as { count: number };
      vectorCount = vectorResult.count;
    } catch {
      // vectors 表可能不存在
    }

    // 构建备份数据
    const backupData = {
      version: '0.3.0',
      format_version: BACKUP_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      source: {
        mode: 'local',
        project_id: ctx.config.defaultProject,
      },
      entities: entities.map(e => ({
        id: e.id,
        type: e.type,
        source_project: e.source_project,
        status: e.status,
        data: JSON.parse(e.data),
        metadata: params.include_metadata !== false ? {
          content_hash: e.content_hash,
          created_at: e.created_at,
          updated_at: e.updated_at,
        } : undefined,
      })),
      relations,
      checksums: {
        entities: computeChecksum(JSON.stringify(entities)),
        relations: computeChecksum(JSON.stringify(relations)),
      },
    };

    // 序列化为 JSON
    const jsonContent = JSON.stringify(backupData, null, 2);

    // 根据格式写入文件
    if (format === 'tar.gz') {
      // P2-3.1: 使用 gzip 压缩
      // 注意：这是简化的实现，实际 tar.gz 需要 tar 归档 + gzip 压缩
      // 这里我们直接对 JSON 进行 gzip 压缩，文件扩展名为 .json.gz
      const compressed = gzipSync(Buffer.from(jsonContent, 'utf-8'));
      writeFileSync(params.output, compressed);
    } else {
      // json 格式：直接写入
      writeFileSync(params.output, jsonContent, 'utf-8');
    }

    const stats = statSync(params.output);

    return {
      success: true,
      file: params.output,
      size: stats.size,
      format_version: BACKUP_FORMAT_VERSION,
      stats: {
        entities: entities.length,
        relations: relations.length,
        vectors: vectorCount,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// Restore 操作
// ============================================================

/**
 * 恢复数据
 * 设计文档: store-utils.md §3.14
 *
 * P2-3.1: 支持读取 tar.gz 和 json 两种格式
 * 自动检测文件格式（通过 gzip magic number）
 */
export async function restore(
  ctx: AdapterContext,
  params: RestoreParams
): Promise<RestoreResult> {
  const db = ctx.store.getDatabase();
  const conflictPolicy = params.conflict_policy ?? 'skip';

  try {
    // 读取备份文件
    const fileContent = readFileSync(params.input);

    // P2-3.1: 自动检测格式（gzip magic number: 0x1f 0x8b）
    let content: string;
    if (fileContent[0] === 0x1f && fileContent[1] === 0x8b) {
      // gzip 压缩格式
      const decompressed = gunzipSync(fileContent);
      content = decompressed.toString('utf-8');
    } else {
      // 纯 JSON 格式
      content = fileContent.toString('utf-8');
    }

    const backupData = JSON.parse(content) as {
      version: string;
      format_version: string;
      entities: Array<{
        id: string;
        type: string;
        source_project: string;
        status: string;
        data: Record<string, unknown>;
        metadata?: {
          content_hash: string;
          created_at: string;
          updated_at: string;
        };
      }>;
      relations: Array<Record<string, unknown>>;
      checksums?: {
        entities: string;
        relations: string;
      };
    };

    // 版本兼容性检查
    const compatible = checkCompatibility(backupData.version, '0.3.0');
    if (!compatible) {
      return {
        success: false,
        format_version: backupData.format_version,
        compatible: false,
        error: `备份版本 ${backupData.version} 与当前版本 0.3.0 不兼容`,
      };
    }

    // 校验和验证
    if (params.validate_checksums !== false && backupData.checksums) {
      const entitiesChecksum = computeChecksum(JSON.stringify(backupData.entities));
      if (entitiesChecksum !== backupData.checksums.entities) {
        return {
          success: false,
          format_version: backupData.format_version,
          compatible: true,
          error: '实体数据校验和不匹配',
        };
      }
    }

    const conflicts: RestoreConflict[] = [];
    let entitiesRestored = 0;
    let relationsRestored = 0;

    const now = new Date().toISOString();

    // 恢复实体
    for (const entity of backupData.entities) {
      // 检查是否存在
      const existing = db.prepare(`
        SELECT content_hash, updated_at FROM metadata
        WHERE source_project = ? AND entity_id = ? AND proposal_id IS NULL
      `).get(entity.source_project, entity.id) as {
        content_hash: string;
        updated_at: string;
      } | undefined;

      if (existing) {
        // 处理冲突
        if (conflictPolicy === 'error') {
          return {
            success: false,
            format_version: backupData.format_version,
            compatible: true,
            error: `实体 ${entity.id} 已存在`,
          };
        }

        if (conflictPolicy === 'skip') {
          conflicts.push({
            entity_id: entity.id,
            reason: '实体已存在',
            resolution: 'skipped',
          });
          continue;
        }

        if (conflictPolicy === 'merge') {
          // 比较更新时间，保留较新的
          const backupTime = entity.metadata?.updated_at || '';
          if (backupTime <= existing.updated_at) {
            conflicts.push({
              entity_id: entity.id,
              reason: '本地版本较新',
              resolution: 'kept_local',
            });
            continue;
          }
        }
        // override: 继续覆盖
      }

      // 计算 content_hash
      const contentHash = entity.metadata?.content_hash || computeChecksum(JSON.stringify(entity.data));

      // 插入/更新实体
      db.prepare(`
        INSERT INTO entities (id, source_project, proposal_id, type, data)
        VALUES (?, ?, NULL, ?, ?)
        ON CONFLICT (source_project, id, proposal_id) DO UPDATE SET
          type = excluded.type,
          data = excluded.data
      `).run(entity.id, entity.source_project, entity.type, JSON.stringify(entity.data));

      // 插入/更新元数据
      db.prepare(`
        INSERT INTO metadata (entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
          status = excluded.status,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `).run(
        entity.id,
        entity.source_project,
        entity.status,
        contentHash,
        entity.metadata?.created_at || now,
        now
      );

      entitiesRestored++;
    }

    // 恢复关系（简化处理）
    for (const relation of backupData.relations) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO relations (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, created_at, updated_at)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          relation.id,
          relation.from_project,
          relation.from_id,
          relation.to_project,
          relation.to_id,
          relation.rel_type,
          now,
          now
        );
        relationsRestored++;
      } catch {
        // 忽略关系恢复错误
      }
    }

    return {
      success: true,
      format_version: backupData.format_version,
      compatible: true,
      stats: {
        entities: entitiesRestored,
        relations: relationsRestored,
        vectors: 0,
      },
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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

    // 检查向量索引（milvus scope）
    if (scope === 'all' || scope === 'milvus') {
      for (const entity of entities) {
        // 检查向量是否存在
        const vector = db.prepare(`
          SELECT 1 FROM vectors
          WHERE entity_id = ? AND source_project = ? AND proposal_id IS NULL
        `).get(entity.id, entity.source_project);

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

// ============================================================
// Validate 操作
// ============================================================

/**
 * 架构一致性检查
 * 设计文档: store-utils.md §3.16
 */
export async function validate(
  ctx: AdapterContext,
  params: ValidateParams
): Promise<ValidateResult> {
  const db = ctx.store.getDatabase();
  const proposalId = params.proposal_id ?? null;
  const checksToRun = params.checks ?? [
    'functional_spec',
    'technical_spec',
    'contracts',
    'references',
    'adr_completeness',
    'checklist',
  ];

  const checks: Record<string, ValidateCheckResult> = {};
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  try {
    // 查询实体
    const entities = db.prepare(`
      SELECT e.id, e.type, e.data, m.status
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.proposal_id IS ?
    `).all(proposalId) as Array<{
      id: string;
      type: string;
      data: string;
      status: string;
    }>;

    // 按类型分组
    const byType: Record<string, typeof entities> = {};
    for (const e of entities) {
      if (!byType[e.type]) byType[e.type] = [];
      byType[e.type].push(e);
    }

    // 执行各项检查
    for (const check of checksToRun) {
      const result = runCheck(db, check, entities, byType, proposalId);
      checks[check] = result;

      if (result.status === 'passed') passed++;
      else if (result.status === 'warning') warnings++;
      else errors++;
    }

    // 生成建议
    const suggestions: string[] = [];
    if (params.options?.include_suggestions !== false) {
      let suggestionIndex = 1;
      for (const [checkName, result] of Object.entries(checks)) {
        if (result.errors) {
          for (const err of result.errors) {
            if (err.suggestion) {
              suggestions.push(`${suggestionIndex}. ${err.suggestion}`);
              suggestionIndex++;
            }
          }
        }
        if (result.warnings) {
          for (const warn of result.warnings) {
            if (warn.suggestion) {
              suggestions.push(`${suggestionIndex}. ${warn.suggestion}`);
              suggestionIndex++;
            }
          }
        }
        if (result.suggestion) {
          suggestions.push(`${suggestionIndex}. ${result.suggestion}`);
          suggestionIndex++;
        }
      }
    }

    return {
      success: true,
      proposal_id: proposalId ?? undefined,
      summary: {
        passed,
        warnings,
        errors,
        status: errors > 0 ? 'failed' : warnings > 0 ? 'warnings' : 'passed',
      },
      checks,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 计算校验和
 */
function computeChecksum(data: string): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * 版本兼容性检查
 */
function checkCompatibility(backupVersion: string, currentVersion: string): boolean {
  const [backupMajor, backupMinor] = backupVersion.split('.').map(Number);
  const [currentMajor, currentMinor] = currentVersion.split('.').map(Number);

  // 主版本号必须相同
  if (backupMajor !== currentMajor) {
    return false;
  }

  // 次版本号向后兼容
  if (backupMinor > currentMinor) {
    return false;
  }

  return true;
}

/**
 * 执行单项检查
 */
function runCheck(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  check: ValidateCheckType,
  entities: Array<{ id: string; type: string; data: string; status: string }>,
  byType: Record<string, typeof entities>,
  proposalId: string | null
): ValidateCheckResult {
  switch (check) {
    case 'functional_spec':
      return checkFunctionalSpec(byType);
    case 'technical_spec':
      return checkTechnicalSpec(byType);
    case 'contracts':
      return checkContracts(db, byType, proposalId);
    case 'references':
      return checkReferences(db, entities, proposalId);
    case 'adr_completeness':
      return checkAdrCompleteness(byType);
    case 'checklist':
      return checkChecklist(db, proposalId);
    default:
      return { status: 'passed', message: '未知检查项' };
  }
}

/**
 * Functional Spec 完整性检查
 */
function checkFunctionalSpec(
  byType: Record<string, Array<{ id: string; type: string; data: string }>>
): ValidateCheckResult {
  const products = byType['product'] || [];
  const processes = byType['process'] || [];

  if (products.length === 0 && processes.length === 0) {
    return {
      status: 'warning',
      message: '未定义 Product 或 Process',
      suggestion: '建议添加 Product 或 Process 定义业务功能',
    };
  }

  return {
    status: 'passed',
    message: 'Functional Spec 完整',
  };
}

/**
 * Technical Spec 完整性检查
 */
function checkTechnicalSpec(
  byType: Record<string, Array<{ id: string; type: string; data: string }>>
): ValidateCheckResult {
  const systems = byType['system'] || [];
  const containers = byType['container'] || [];
  const components = byType['component'] || [];
  const errors: ValidateError[] = [];

  // 检查 Container 是否关联 System
  for (const container of containers) {
    const data = JSON.parse(container.data) as Record<string, unknown>;
    if (!data.system_id && !data.system) {
      errors.push({
        code: 'MISSING_SYSTEM_REF',
        entity_id: container.id,
        message: `Container '${container.id}' 未关联 System`,
        suggestion: `设置 data.system_id 关联到对应的 System`,
      });
    }
  }

  // 检查 Component 是否关联 Container
  for (const component of components) {
    const data = JSON.parse(component.data) as Record<string, unknown>;
    if (!data.container_id && !data.container) {
      errors.push({
        code: 'MISSING_CONTAINER_REF',
        entity_id: component.id,
        message: `Component '${component.id}' 未关联 Container`,
        suggestion: `设置 data.container_id 关联到对应的 Container`,
      });
    }
  }

  if (errors.length > 0) {
    return {
      status: 'error',
      message: 'Technical Spec 完整性检查失败',
      errors,
    };
  }

  return {
    status: 'passed',
    message: 'Technical Spec 完整',
  };
}

/**
 * 契约完备度检查
 */
function checkContracts(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  byType: Record<string, Array<{ id: string; type: string; data: string }>>,
  proposalId: string | null
): ValidateCheckResult {
  const contracts = byType['contract'] || [];
  const components = byType['component'] || [];
  const warnings: ValidateError[] = [];

  // 检查有 API 的 Component 是否有契约
  for (const component of components) {
    const data = JSON.parse(component.data) as Record<string, unknown>;
    const hasApi = data.api || data.endpoints || data.interfaces;

    if (hasApi) {
      // 查找关联的契约
      const relatedContract = db.prepare(`
        SELECT 1 FROM relations
        WHERE (from_id = ? OR to_id = ?) AND rel_type = 'IMPLEMENTS'
          AND proposal_id IS ?
      `).get(component.id, component.id, proposalId);

      if (!relatedContract) {
        warnings.push({
          code: 'MISSING_CONTRACT',
          entity_id: component.id,
          message: `Component '${component.id}' 有 API 但缺少契约`,
          suggestion: '使用 c4a_code_contract 生成契约',
        });
      }
    }
  }

  if (warnings.length > 0) {
    return {
      status: 'warning',
      message: '契约完备度检查有警告',
      warnings,
    };
  }

  return {
    status: 'passed',
    message: '契约完备',
  };
}

/**
 * 引用正确性检查
 */
function checkReferences(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  entities: Array<{ id: string; type: string; data: string }>,
  proposalId: string | null
): ValidateCheckResult {
  const entityIds = new Set(entities.map(e => e.id));

  // 查询所有关系
  const relations = db.prepare(`
    SELECT from_id, to_id FROM relations WHERE proposal_id IS ?
  `).all(proposalId) as Array<{ from_id: string; to_id: string }>;

  let danglingCount = 0;
  const errors: ValidateError[] = [];

  for (const rel of relations) {
    if (!entityIds.has(rel.to_id)) {
      danglingCount++;
      if (errors.length < 5) {
        errors.push({
          code: 'DANGLING_REFERENCE',
          entity_id: rel.from_id,
          message: `引用的实体 '${rel.to_id}' 不存在`,
        });
      }
    }
  }

  if (danglingCount > 0) {
    return {
      status: 'error',
      message: `发现 ${danglingCount} 个悬空引用`,
      errors,
      dangling_count: danglingCount,
    };
  }

  return {
    status: 'passed',
    message: 'DSL 引用正确',
    dangling_count: 0,
  };
}

/**
 * ADR 完备度检查
 */
function checkAdrCompleteness(
  byType: Record<string, Array<{ id: string; type: string; data: string }>>
): ValidateCheckResult {
  const adrs = byType['adr'] || [];
  const warnings: ValidateError[] = [];

  // 检查 ADR 必需字段
  for (const adr of adrs) {
    const data = JSON.parse(adr.data) as Record<string, unknown>;
    if (!data.status) {
      warnings.push({
        code: 'ADR_MISSING_STATUS',
        entity_id: adr.id,
        message: `ADR '${adr.id}' 缺少 status 字段`,
      });
    }
    if (!data.context && !data.decision) {
      warnings.push({
        code: 'ADR_INCOMPLETE',
        entity_id: adr.id,
        message: `ADR '${adr.id}' 缺少 context 或 decision`,
      });
    }
  }

  if (warnings.length > 0) {
    return {
      status: 'warning',
      message: 'ADR 完备度检查有警告',
      warnings,
    };
  }

  return {
    status: 'passed',
    message: 'ADR 完备',
  };
}

/**
 * Checklist 进度检查
 */
function checkChecklist(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  proposalId: string | null
): ValidateCheckResult {
  if (!proposalId) {
    return {
      status: 'passed',
      message: '主分支无 Checklist',
    };
  }

  const feat = db.prepare(`
    SELECT checklist FROM feats WHERE id = ?
  `).get(proposalId) as { checklist: string | null } | undefined;

  if (!feat || !feat.checklist) {
    return {
      status: 'warning',
      message: 'Feat 未生成 Checklist',
      suggestion: '使用 c4a_store_feat_checklist 生成任务清单',
    };
  }

  const checklist = JSON.parse(feat.checklist) as {
    items: Array<{ status: string }>;
  };

  const total = checklist.items.length;
  const completed = checklist.items.filter(i => i.status === 'completed').length;
  const blocked = checklist.items.filter(i => i.status === 'blocked');
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    status: blocked.length > 0 ? 'warning' : 'passed',
    message: `Checklist 进度 ${percentage}%`,
    progress: { completed, total, percentage },
    blocked: blocked.length > 0 ? blocked.map((_, i) => `task-${i}`) : undefined,
  };
}
