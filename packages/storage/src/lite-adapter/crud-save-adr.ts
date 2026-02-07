/**
 * LiteAdapter Save ADR 校验
 */

import type { EntityStatus, SaveParams, SaveResult } from '../adapter.js';

type Database = ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>;

type AdrCheckOutcome = {
  adrCheck?: SaveResult['adr_check'];
  error?: SaveResult;
};

export function runAdrCheck(options: {
  db: Database;
  params: SaveParams;
  status: EntityStatus;
  id: string;
  contentHash: string;
  dbRootId: string;
  dbRequirementId: string;
}): AdrCheckOutcome {
  const { db, params, status, id, contentHash, dbRootId, dbRequirementId } = options;
  let adrCheck: SaveResult['adr_check'];
  const adrScope = params.adr_policy?.scope?.length
    ? params.adr_policy.scope
    : ['system', 'container', 'component'];
  const shouldCheckAdr =
    !params.skip_adr_check &&
    ['system', 'container', 'component'].includes(params.type) &&
    status === 'published' &&
    (params.enforce_adr || (params.adr_policy?.enforce && adrScope.includes(params.type)));
  if (!shouldCheckAdr) {
    return {};
  }

  const onMissing = params.adr_policy?.on_missing ?? (params.enforce_adr ? 'error' : 'warning');
  if (onMissing === 'ignore') {
    return {};
  }

  void dbRequirementId;
  const adrQuery = `
      SELECT 1 FROM relations r
      JOIN entities e ON r.to_uuid = e.uuid
      WHERE r.from_id = ? AND r.from_root_id = ?
        AND r.rel_type = 'REFERENCES'
        AND e.type = 'adr'
        AND (r.status IS NULL OR r.status != 'deleted')
    `;
  const adrParams = [id, dbRootId];
  const hasAdr = db.prepare(adrQuery).get(...adrParams);

  if (!hasAdr) {
    if (onMissing === 'error') {
      return {
        error: {
          success: false,
          id,
          status,
          content_hash: contentHash,
          error: {
            code: 'C4A-STORE-ADR-001',
            message: '发布 system/container/component 需要关联 ADR',
            details: {
              entity_id: id,
              entity_type: params.type,
              missing_adr: true,
              suggestion: '请先创建 ADR 记录架构决策，然后通过 REFERENCES 关系关联',
            },
          },
        } as SaveResult,
      };
    }
    adrCheck = {
      required: true,
      passed: false,
      missing_adr: true,
      message: '警告：此实体缺少关联的 ADR，建议补充架构决策记录',
    };
  } else {
    adrCheck = {
      required: true,
      passed: true,
    };
  }

  return { adrCheck };
}
