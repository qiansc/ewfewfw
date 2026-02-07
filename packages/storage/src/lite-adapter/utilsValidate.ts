/**
 * LiteAdapter Validate 操作
 */

import type {
  ValidateParams,
  ValidateResult,
  ValidateCheckType,
  ValidateCheckResult,
} from '../adapter.js';
import type { SQLiteStore } from '../sqlite-store.js';
import type { AdapterContext } from './types.js';
import { detectArchitectureChanges, loadFeatStatus } from './utilsValidateChanges.js';
import {
  checkAdrCompleteness,
  checkChecklist,
  checkContracts,
  checkFunctionalSpec,
  checkReferences,
  checkTechnicalSpec,
} from './utilsValidateChecks.js';
import { loadEntitiesForScope, resolveCheckScope } from './utilsValidateScope.js';

type Database = ReturnType<SQLiteStore['getDatabase']>;

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
  const requirementId = params.requirement_id ?? null;
  const resolvedRequirementId = requirementId ? resolveRequirementId(db, requirementId) : null;
  const featStatus = resolvedRequirementId ? loadFeatStatus(db, resolvedRequirementId) : null;
  const requirementClause =
    resolvedRequirementId === null
      ? "(e.requirement_id IS NULL OR e.requirement_id = '')"
      : 'e.requirement_id = ?';
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
    const baseEntities = db
      .prepare(
        `
      SELECT e.id, e.type, e.data, e.root_id, m.status
      FROM entities e
      JOIN metadata m ON e.uuid = m.entity_uuid
      WHERE ${requirementClause}
    `
      )
      .all(...(resolvedRequirementId === null ? [] : [resolvedRequirementId])) as Array<{
      id: string;
      type: string;
      data: string;
      root_id: string;
      status: string;
    }>;

    const checkDepth = resolvedRequirementId ? params.options?.check_depth ?? 2 : null;
    const scopeIds = resolvedRequirementId
      ? resolveCheckScope(db, baseEntities, resolvedRequirementId, checkDepth)
      : null;

    const entities = resolvedRequirementId
      ? loadEntitiesForScope(db, baseEntities, scopeIds)
      : baseEntities;

    const byType: Record<string, typeof entities> = {};
    for (const e of entities) {
      if (!byType[e.type]) byType[e.type] = [];
      byType[e.type].push(e);
    }

    const changesDetected = resolvedRequirementId
      ? detectArchitectureChanges(db, baseEntities, resolvedRequirementId)
      : [];

    for (const check of checksToRun) {
      const result = runCheck(
        db,
        check,
        byType,
        resolvedRequirementId,
        scopeIds,
        changesDetected,
        featStatus
      );
      checks[check] = result;

      if (result.status === 'passed') passed++;
      else if (result.status === 'warning') warnings++;
      else errors++;
    }

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

    const status = errors > 0 ? 'failed' : warnings > 0 ? 'warnings' : 'passed';
    return {
      success: errors === 0,
      summary: {
        passed,
        warnings,
        errors,
        status,
      },
      checks,
      suggestions,
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
  db: Database,
  check: ValidateCheckType,
  byType: Record<
    string,
    Array<{ id: string; type: string; data: string; status: string; root_id: string }>
  >,
  requirementId: string | null,
  scopeIds: Set<string> | null,
  changesDetected: ValidateCheckResult['changes_detected'],
  featStatus: string | null
): ValidateCheckResult {
  switch (check) {
    case 'functional_spec':
      return checkFunctionalSpec(byType);
    case 'technical_spec':
      return checkTechnicalSpec(byType);
    case 'contracts':
      return checkContracts(db, byType, requirementId);
    case 'references':
      return checkReferences(db, requirementId, scopeIds, featStatus);
    case 'adr_completeness':
      return checkAdrCompleteness(byType, changesDetected);
    case 'checklist':
      return checkChecklist(db, requirementId);
    default:
      return { status: 'passed', message: '未知检查项' };
  }
}

function resolveRequirementId(db: Database, requirementId: string): string | null {
  const row = db
    .prepare(
      `
      SELECT uuid FROM entities
      WHERE type = 'feat' AND root_id = '' AND (uuid = ? OR id = ?)
      LIMIT 1
    `
    )
    .get(requirementId, requirementId) as { uuid: string } | undefined;
  return row?.uuid ?? requirementId;
}
