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
    // 查询实体
    const entitiesQuery = `
      SELECT e.id, e.type, e.data, m.status
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE ${proposalClause}
    `;
    const entities = db.prepare(entitiesQuery).all(
      ...(dbProposalId === '' ? [] : [dbProposalId])
    ) as Array<{
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
      const dbProposalId = proposalId ?? '';
      const proposalClause = dbProposalId === ''
        ? '(proposal_id IS NULL OR proposal_id = \'\')'
        : 'proposal_id = ?';
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
  const dbProposalId = proposalId ?? '';
  const proposalClause = dbProposalId === ''
    ? '(proposal_id IS NULL OR proposal_id = \'\')'
    : 'proposal_id = ?';
  const relations = db.prepare(`
    SELECT from_id, to_id FROM relations
    WHERE ${proposalClause}
      AND (status IS NULL OR status != 'deleted')
  `).all(
    ...(dbProposalId === '' ? [] : [dbProposalId])
  ) as Array<{ from_id: string; to_id: string }>;

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
