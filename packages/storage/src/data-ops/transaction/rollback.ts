import type { DataOpsContext } from '../types.js';
import type { RollbackFeat } from './types.js';

const ROLLBACK_PREFIX = 'rollback--';

function buildRollbackFeatId(targetFeatId: string, timestamp: string): string {
  return `${ROLLBACK_PREFIX}${targetFeatId}--${timestamp}`;
}

function parseRollbackFeatId(rollbackFeatId: string): { targetFeatId: string; timestamp: string } {
  if (!rollbackFeatId.startsWith(ROLLBACK_PREFIX)) {
    throw new Error(`Invalid rollback feat id: ${rollbackFeatId}`);
  }
  const [, rest] = rollbackFeatId.split(ROLLBACK_PREFIX);
  const parts = rest.split('--');
  if (parts.length < 2) {
    throw new Error(`Invalid rollback feat id: ${rollbackFeatId}`);
  }
  const timestamp = parts.pop() ?? '';
  const targetFeatId = parts.join('--');
  if (!targetFeatId || !timestamp) {
    throw new Error(`Invalid rollback feat id: ${rollbackFeatId}`);
  }
  return { targetFeatId, timestamp };
}

/**
 * 创建回滚 Feat（保持审计追踪）
 */
export function createRollbackFeat(
  ctx: DataOpsContext,
  targetFeatId: string,
  reason: string
): RollbackFeat {
  const target = ctx.storage.getFeat(targetFeatId);
  if (!target) {
    throw new Error(`Target feat ${targetFeatId} not found`);
  }

  if (!reason || !reason.trim()) {
    throw new Error('Rollback reason is required');
  }

  const now = new Date().toISOString();
  const safeTimestamp = now.replace(/[:.]/g, '').replace('T', '-').replace('Z', '');
  const rollbackFeatId = buildRollbackFeatId(targetFeatId, safeTimestamp);
  const existing = ctx.storage.getFeat(rollbackFeatId);
  if (existing) {
    throw new Error(`Rollback feat ${rollbackFeatId} already exists`);
  }

  ctx.storage.createFeat({
    id: rollbackFeatId,
    status: 'draft',
    title: `Rollback ${targetFeatId}`,
    description: `Rollback of ${targetFeatId}: ${reason}`,
    created_by: 'system',
    created_at: now,
    updated_at: now,
  });

  return {
    id: rollbackFeatId,
    target_feat_id: targetFeatId,
    reason,
    created_at: now,
    created_by: 'system',
    status: 'draft',
  };
}

/**
 * 执行回滚：将目标 feat 的历史快照恢复到回滚 feat
 */
export async function executeRollback(ctx: DataOpsContext, rollbackFeatId: string): Promise<void> {
  const { targetFeatId } = parseRollbackFeatId(rollbackFeatId);
  const history = ctx.storage.getLatestFeatHistory(targetFeatId);

  if (!history) {
    throw new Error(`No feat history found for ${targetFeatId}`);
  }

  const now = new Date().toISOString();

  ctx.storage.transaction((tx) => {
    tx.deleteEntitiesByProposalId(rollbackFeatId);
    tx.deleteMetadataByProposalId(rollbackFeatId);
    tx.deleteRelationsByProposalId(rollbackFeatId);

    for (const entity of history.snapshot) {
      tx.insertEntity({
        entityId: entity.id,
        sourceProject: entity.metadata.source_project,
        entityType: entity.type,
        entityKind: entity.kind ?? null,
        entityScope: entity.scope ?? null,
        entityPerspective: entity.perspective ?? null,
        data: entity.data,
        contentHash: entity.metadata.content_hash,
        proposalId: rollbackFeatId,
        status: 'draft',
        createdAt: entity.metadata.created_at || now,
        updatedAt: now,
      });
    }
  });
}
