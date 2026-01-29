/**
 * LiteAdapter Validate 操作
 */

import type {
  ValidateParams,
  ValidateResult,
  ValidateCheckType,
  ValidateCheckResult,
  ValidateError,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

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
  const dbProposalId = proposalId ?? '';
  const proposalClause = dbProposalId === ''
    ? '(e.proposal_id IS NULL OR e.proposal_id = \'\')'
    : 'e.proposal_id = ?';
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
    const baseEntities = db.prepare(`
      SELECT e.id, e.type, e.data, m.status
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE ${proposalClause}
    `).all(
      ...(dbProposalId === '' ? [] : [dbProposalId])
    ) as Array<{
      id: string;
      type: string;
      data: string;
      status: string;
    }>;

    const checkDepth = proposalId ? (params.options?.check_depth ?? 2) : null;
    const scopeIds = proposalId
      ? resolveCheckScope(db, baseEntities, proposalId, checkDepth)
      : null;

    const entities = proposalId
      ? loadEntitiesForScope(db, baseEntities, scopeIds)
      : baseEntities;

    const byType: Record<string, typeof entities> = {};
    for (const e of entities) {
      if (!byType[e.type]) byType[e.type] = [];
      byType[e.type].push(e);
    }

    const changesDetected = proposalId
      ? detectArchitectureChanges(db, baseEntities)
      : [];

    // 执行各项检查
    for (const check of checksToRun) {
      const result = runCheck(db, check, byType, proposalId, scopeIds, changesDetected);
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
 * 执行单项检查
 */
function runCheck(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  check: ValidateCheckType,
  byType: Record<string, Array<{ id: string; type: string; data: string; status: string }>>,
  proposalId: string | null,
  scopeIds: Set<string> | null,
  changesDetected: ValidateCheckResult['changes_detected']
): ValidateCheckResult {
  switch (check) {
    case 'functional_spec':
      return checkFunctionalSpec(byType);
    case 'technical_spec':
      return checkTechnicalSpec(byType);
    case 'contracts':
      return checkContracts(db, byType, proposalId);
    case 'references':
      return checkReferences(db, proposalId, scopeIds);
    case 'adr_completeness':
      return checkAdrCompleteness(byType, changesDetected);
    case 'checklist':
      return checkChecklist(db, proposalId);
    default:
      return { status: 'passed', message: '未知检查项' };
  }
}

function resolveCheckScope(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  baseEntities: Array<{ id: string }>,
  proposalId: string,
  checkDepth: number | null
): Set<string> {
  const scope = new Set<string>(baseEntities.map(e => e.id));
  if (scope.size === 0) return scope;
  const depth = Math.max(checkDepth ?? 0, 0);
  let frontier = new Set(scope);

  for (let i = 0; i < depth; i++) {
    const frontierIds = Array.from(frontier);
    if (frontierIds.length === 0) break;
    const placeholders = frontierIds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT DISTINCT to_id
      FROM relations
      WHERE from_id IN (${placeholders})
        AND (proposal_id IS NULL OR proposal_id = '' OR proposal_id = ?)
        AND (status IS NULL OR status != 'deleted')
    `).all(...frontierIds, proposalId) as Array<{ to_id: string }>;
    frontier = new Set();
    for (const row of rows) {
      if (!scope.has(row.to_id)) {
        scope.add(row.to_id);
        frontier.add(row.to_id);
      }
    }
  }

  return scope;
}

function loadEntitiesForScope(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  baseEntities: Array<{ id: string; type: string; data: string; status: string }>,
  scopeIds: Set<string> | null
): Array<{ id: string; type: string; data: string; status: string }> {
  const scopeList = scopeIds && scopeIds.size > 0 ? Array.from(scopeIds) : baseEntities.map(e => e.id);
  const featIds = new Set(baseEntities.map(e => e.id));
  const missingIds = scopeList.filter(id => !featIds.has(id));
  if (missingIds.length === 0) return baseEntities;

  const placeholders = missingIds.map(() => '?').join(', ');
  const mainEntities = db.prepare(`
    SELECT e.id, e.type, e.data, m.status
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE (e.proposal_id IS NULL OR e.proposal_id = '')
      AND e.id IN (${placeholders})
  `).all(...missingIds) as Array<{ id: string; type: string; data: string; status: string }>;

  return [...baseEntities, ...mainEntities];
}

function detectArchitectureChanges(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  baseEntities: Array<{ id: string; type: string; data: string }>
): ValidateCheckResult['changes_detected'] {
  const targetTypes = new Set(['system', 'container', 'component']);
  const featEntities = baseEntities.filter(entity => targetTypes.has(entity.type));
  if (featEntities.length === 0) return [];

  const ids = featEntities.map(entity => entity.id);
  const placeholders = ids.map(() => '?').join(', ');
  const mainEntities = db.prepare(`
    SELECT e.id, e.data
    FROM entities e
    WHERE (e.proposal_id IS NULL OR e.proposal_id = '')
      AND e.id IN (${placeholders})
  `).all(...ids) as Array<{ id: string; data: string }>;

  const mainMap = new Map(mainEntities.map(entity => [entity.id, entity.data]));
  const changes: NonNullable<ValidateCheckResult['changes_detected']> = [];

  for (const featEntity of featEntities) {
    const mainData = mainMap.get(featEntity.id);
    if (!mainData) {
      changes.push({
        type: 'created',
        entity_id: featEntity.id,
        detail: 'feat 中新增实体',
      });
      continue;
    }
    if (mainData !== featEntity.data) {
      changes.push({
        type: 'modified',
        entity_id: featEntity.id,
        detail: '实体数据发生变更',
      });
    }
  }

  return changes;
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
      const dbProposalId = proposalId ?? '';
      const proposalClause = dbProposalId === ''
        ? '(proposal_id IS NULL OR proposal_id = \'\')'
        : '(proposal_id IS NULL OR proposal_id = \'\' OR proposal_id = ?)';
      const relatedContract = db.prepare(`
        SELECT 1 FROM relations
        WHERE (from_id = ? OR to_id = ?) AND rel_type = 'IMPLEMENTS'
          AND ${proposalClause}
          AND (status IS NULL OR status != 'deleted')
      `).get(
        ...(dbProposalId === '' ? [component.id, component.id] : [component.id, component.id, dbProposalId])
      );

      if (!relatedContract) {
        warnings.push({
          code: 'MISSING_CONTRACT',
          entity_id: component.id,
          message: `Component '${component.id}' 有 API 但缺少契约`,
          suggestion: '使用 c4a_extract_contract 生成契约',
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
  proposalId: string | null,
  scopeIds: Set<string> | null
): ValidateCheckResult {
  const dbProposalId = proposalId ?? '';
  const scopeList = scopeIds && scopeIds.size > 0 ? Array.from(scopeIds) : [];
  const scopeClause = scopeList.length > 0
    ? `AND r.from_id IN (${scopeList.map(() => '?').join(', ')})`
    : '';

  const params: Array<string | null> = [];
  let dangling: Array<{ from_id: string; to_id: string }>;

  if (dbProposalId === '') {
    dangling = db.prepare(`
      SELECT r.from_id, r.to_id
      FROM relations r
      LEFT JOIN entities e_main
        ON e_main.source_project = r.to_project AND e_main.id = r.to_id
        AND (e_main.proposal_id IS NULL OR e_main.proposal_id = '')
      WHERE (r.proposal_id IS NULL OR r.proposal_id = '')
        AND (r.status IS NULL OR r.status != 'deleted')
        ${scopeClause}
        AND e_main.id IS NULL
    `).all(...scopeList) as Array<{ from_id: string; to_id: string }>;
  } else {
    params.push(dbProposalId, dbProposalId);
    dangling = db.prepare(`
      SELECT r.from_id, r.to_id
      FROM relations r
      LEFT JOIN entities e_main
        ON e_main.source_project = r.to_project AND e_main.id = r.to_id
        AND (e_main.proposal_id IS NULL OR e_main.proposal_id = '')
      LEFT JOIN entities e_feat
        ON e_feat.source_project = r.to_project AND e_feat.id = r.to_id
        AND e_feat.proposal_id = ?
      WHERE (r.proposal_id IS NULL OR r.proposal_id = '' OR r.proposal_id = ?)
        AND (r.status IS NULL OR r.status != 'deleted')
        ${scopeClause}
        AND e_main.id IS NULL AND e_feat.id IS NULL
    `).all(...params, ...scopeList) as Array<{ from_id: string; to_id: string }>;
  }

  const danglingCount = dangling.length;
  const errors: ValidateError[] = dangling.slice(0, 5).map(rel => ({
    code: 'DANGLING_REFERENCE',
    entity_id: rel.from_id,
    message: `引用的实体 '${rel.to_id}' 不存在`,
  }));

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
  byType: Record<string, Array<{ id: string; type: string; data: string }>>,
  changesDetected: ValidateCheckResult['changes_detected']
): ValidateCheckResult {
  const adrs = byType['adr'] || [];
  const warnings: ValidateError[] = [];

  // 变更但无 ADR
  if (changesDetected && changesDetected.length > 0 && adrs.length === 0) {
    return {
      status: 'warning',
      message: '检测到架构变更，但未找到关联的 ADR',
      changes_detected: changesDetected,
      suggestion: '创建 ADR 记录架构变更的背景和决策',
    };
  }

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
      changes_detected: changesDetected && changesDetected.length > 0 ? changesDetected : undefined,
    };
  }

  return {
    status: 'passed',
    message: 'ADR 完备',
    changes_detected: changesDetected && changesDetected.length > 0 ? changesDetected : undefined,
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
