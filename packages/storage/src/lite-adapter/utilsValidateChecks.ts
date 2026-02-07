import type { ValidateCheckResult, ValidateError } from '../adapter.js';
import type { SQLiteStore } from '../sqlite-store.js';

type Database = ReturnType<SQLiteStore['getDatabase']>;

type EntityData = Array<{ id: string; type: string; data: string; root_id: string }>;

type EntityByType = Record<string, EntityData>;

export function checkFunctionalSpec(byType: EntityByType): ValidateCheckResult {
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

export function checkTechnicalSpec(byType: EntityByType): ValidateCheckResult {
  const containers = byType['container'] || [];
  const components = byType['component'] || [];
  const errors: ValidateError[] = [];

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

export function checkContracts(
  db: Database,
  byType: EntityByType,
  requirementId: string | null
): ValidateCheckResult {
  const components = byType['component'] || [];
  const warnings: ValidateError[] = [];

  for (const component of components) {
    const data = JSON.parse(component.data) as Record<string, unknown>;
    const hasApi = data.api || data.endpoints || data.interfaces;

    if (hasApi) {
      const relatedContract = db
        .prepare(
          `
        SELECT 1 FROM relations
        WHERE (from_id = ? OR to_id = ?) AND rel_type = 'IMPLEMENTS'
          AND (from_root_id = ? OR to_root_id = ?)
          AND (status IS NULL OR status != 'deleted')
      `
        )
        .get(component.id, component.id, component.root_id, component.root_id);

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

export function checkReferences(
  db: Database,
  requirementId: string | null,
  scopeIds: Set<string> | null,
  featStatus: string | null
): ValidateCheckResult {
  const scopeList = scopeIds && scopeIds.size > 0 ? Array.from(scopeIds) : [];
  const scopeClause = scopeList.length > 0
    ? `AND (r.from_root_id, r.from_id) IN (${scopeList.map(() => '(?, ?)').join(', ')})`
    : '';

  const params: Array<string | null> = [];
  let relations: Array<{ from_id: string; to_id: string; rel_type: string; from_root_id: string; to_root_id: string }>;
  const scopePairs = scopeList.flatMap((id) => id.split('::'));

  if (!requirementId) {
    relations = db
      .prepare(
        `
      SELECT r.from_id, r.to_id, r.rel_type, r.from_root_id, r.to_root_id
      FROM relations r
      WHERE (r.status IS NULL OR r.status != 'deleted')
        ${scopeClause}
    `
      )
      .all(...scopePairs) as Array<{
      from_id: string;
      to_id: string;
      rel_type: string;
      from_root_id: string;
      to_root_id: string;
    }>;
  } else {
    params.push(requirementId);
    relations = db
      .prepare(
        `
      SELECT r.from_id, r.to_id, r.rel_type, r.from_root_id, r.to_root_id
      FROM relations r
      JOIN entities e ON e.uuid = r.from_uuid
      WHERE (e.requirement_id IS NULL OR e.requirement_id = '' OR e.requirement_id = ?)
        AND (r.status IS NULL OR r.status != 'deleted')
        ${scopeClause}
    `
      )
      .all(...params, ...scopePairs) as Array<{
      from_id: string;
      to_id: string;
      rel_type: string;
      from_root_id: string;
      to_root_id: string;
    }>;
  }

  if (relations.length === 0) {
    return {
      status: 'passed',
      message: 'DSL 引用正确',
      dangling_count: 0,
    };
  }

  const keys = new Set<string>();
  for (const rel of relations) {
    keys.add(`${rel.from_root_id ?? ''}::${rel.from_id}`);
    keys.add(`${rel.to_root_id ?? ''}::${rel.to_id}`);
  }
  const typeMap = loadEntityTypeMap(db, requirementId, keys);

  const dangling: Array<{ from_id: string; to_id: string }> = [];
  for (const rel of relations) {
    const fromKey = `${rel.from_root_id ?? ''}::${rel.from_id}`;
    const toKey = `${rel.to_root_id ?? ''}::${rel.to_id}`;
    const fromType = typeMap.get(fromKey);
    const expectedType = resolveExpectedTargetType(fromType, rel.rel_type);
    const actualType = typeMap.get(toKey);
    if (!actualType) {
      dangling.push({ from_id: rel.from_id, to_id: rel.to_id });
      continue;
    }
    if (expectedType && actualType !== expectedType) {
      dangling.push({ from_id: rel.from_id, to_id: rel.to_id });
    }
  }

  const danglingCount = dangling.length;
  if (danglingCount === 0) {
    return {
      status: 'passed',
      message: 'DSL 引用正确',
      dangling_count: 0,
    };
  }

  const severity = resolveReferenceSeverity(featStatus, requirementId);
  const items: ValidateError[] = dangling.slice(0, 5).map((rel) => ({
    code: 'DANGLING_REFERENCE',
    entity_id: rel.from_id,
    message: `引用的实体 '${rel.to_id}' 不存在`,
  }));

  return {
    status: severity,
    message:
      severity === 'warning'
        ? `发现 ${danglingCount} 个悬空引用（允许在 ${featStatus ?? 'draft'}）`
        : `发现 ${danglingCount} 个悬空引用`,
    errors: severity === 'error' ? items : undefined,
    warnings: severity === 'warning' ? items : undefined,
    dangling_count: danglingCount,
  };
}

export function checkAdrCompleteness(
  byType: EntityByType,
  changesDetected: ValidateCheckResult['changes_detected']
): ValidateCheckResult {
  const adrs = byType['adr'] || [];
  const warnings: ValidateError[] = [];

  if (changesDetected && changesDetected.length > 0 && adrs.length === 0) {
    return {
      status: 'warning',
      message: '检测到架构变更，但未找到关联的 ADR',
      changes_detected: changesDetected,
      suggestion: '创建 ADR 记录架构变更的背景和决策',
    };
  }

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

export function checkChecklist(db: Database, requirementId: string | null): ValidateCheckResult {
  if (!requirementId) {
    return {
      status: 'passed',
      message: '主分支无 Checklist',
    };
  }

  const featRow = db
    .prepare(
      `
      SELECT e.uuid FROM entities e
      WHERE e.type = 'feat' AND e.uuid = ? AND e.root_id = ''
      LIMIT 1
    `
    )
    .get(requirementId) as { uuid: string } | undefined;
  if (!featRow?.uuid) {
    return {
      status: 'warning',
      message: 'Feat 未生成 Checklist',
      suggestion: '使用 c4a_store_feat_checklist 生成任务清单',
    };
  }

  const checklistRow = db
    .prepare(
      `
      SELECT e.data FROM entities e
      WHERE e.type = 'checklist' AND e.requirement_id = ?
      LIMIT 1
    `
    )
    .get(featRow.uuid) as { data: string } | undefined;

  if (!checklistRow?.data) {
    return {
      status: 'warning',
      message: 'Feat 未生成 Checklist',
      suggestion: '使用 c4a_store_feat_checklist 生成任务清单',
    };
  }

  const checklist = JSON.parse(checklistRow.data) as {
    items: Array<{ status: string }>;
  };

  const total = checklist.items.length;
  const completed = checklist.items.filter((i) => i.status === 'completed').length;
  const blocked = checklist.items.filter((i) => i.status === 'blocked');
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    status: blocked.length > 0 ? 'warning' : 'passed',
    message: `Checklist 进度 ${percentage}%`,
    progress: { completed, total, percentage },
    blocked: blocked.length > 0 ? blocked.map((_, i) => `task-${i}`) : undefined,
  };
}

function loadEntityTypeMap(
  db: Database,
  requirementId: string | null,
  keys: Set<string>
): Map<string, string> {
  const map = new Map<string, string>();
  if (keys.size === 0) return map;
  const pairs = Array.from(keys).map((key) => key.split('::'));
  const placeholders = pairs.map(() => '(?, ?)').join(', ');
  const params: Array<string> = [];
  for (const [project, id] of pairs) {
    params.push(project, id);
  }

  if (!requirementId) {
    const rows = db
      .prepare(
        `
      SELECT root_id, id, type, requirement_id
      FROM entities
      WHERE (requirement_id IS NULL OR requirement_id = '')
        AND (root_id, id) IN (${placeholders})
    `
      )
      .all(...params) as Array<{ root_id: string; id: string; type: string }>;
    for (const row of rows) {
      map.set(`${row.root_id ?? ''}::${row.id}`, row.type);
    }
    return map;
  }

  const rows = db
    .prepare(
      `
    SELECT root_id, id, type, requirement_id
    FROM entities
    WHERE (requirement_id IS NULL OR requirement_id = '' OR requirement_id = ?)
      AND (root_id, id) IN (${placeholders})
  `
    )
    .all(requirementId, ...params) as Array<{
    root_id: string;
    id: string;
    type: string;
    requirement_id: string | null;
  }>;

  for (const row of rows) {
    const key = `${row.root_id ?? ''}::${row.id}`;
    const existing = map.get(key);
    if (!existing || row.requirement_id === requirementId) {
      map.set(key, row.type);
    }
  }

  return map;
}

function resolveExpectedTargetType(fromType: string | undefined, relType: string): string | null {
  if (!fromType) return null;
  if (fromType === 'container') {
    if (relType === 'DEPENDS_ON') return 'container';
    if (relType === 'CONTAINS') return 'component';
    if (relType === 'IMPLEMENTS') return 'contract';
  }
  if (fromType === 'component') {
    if (relType === 'DEPENDS_ON') return 'component';
    if (relType === 'REFERENCES') return 'container';
    if (relType === 'IMPLEMENTS') return 'contract';
  }
  if (fromType === 'system') {
    if (relType === 'DEPENDS_ON') return 'system';
    if (relType === 'CONTAINS') return 'container';
  }
  return null;
}

function resolveReferenceSeverity(
  featStatus: string | null,
  requirementId: string | null
): 'warning' | 'error' {
  if (!requirementId) return 'error';
  if (featStatus === 'draft' || featStatus === 'approved') {
    return 'warning';
  }
  return 'error';
}
