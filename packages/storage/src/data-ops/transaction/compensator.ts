import { randomUUID } from 'node:crypto';
import type { DataOpsContext } from '../types.js';
import type { CompensationAction, CompensationLog } from './types.js';

/**
 * 补偿机制
 */
export function buildCompensationLog(action: CompensationAction): CompensationAction {
  return action;
}

export interface Compensator {
  recordCompensation: (
    action: string,
    rollbackAction: string,
    params?: Record<string, unknown>
  ) => CompensationLog;
  executeCompensation: (
    handlers?: Record<string, (params?: Record<string, unknown>) => Promise<void> | void>
  ) => Promise<void>;
}

export function createCompensator(ctx: DataOpsContext, transactionId: string): Compensator {
  return {
    recordCompensation: (action, rollbackAction, params) =>
      recordCompensation(ctx, transactionId, action, rollbackAction, params),
    executeCompensation: (handlers = {}) =>
      executeCompensation(ctx, transactionId, handlers),
  };
}

export function recordCompensation(
  ctx: DataOpsContext,
  transactionId: string,
  action: string,
  rollbackAction: string,
  params?: Record<string, unknown>
): CompensationLog {
  const log: CompensationLog = {
    id: `comp_${randomUUID()}`,
    transaction_id: transactionId,
    action,
    rollback_action: rollbackAction,
    params,
    executed: false,
    created_at: new Date().toISOString(),
  };

  ctx.storage.insertCompensationLog({
    id: log.id,
    transactionId: log.transaction_id,
    action: log.action,
    rollbackAction: log.rollback_action,
    params: log.params,
    executed: log.executed,
    createdAt: log.created_at,
  });

  return log;
}

export async function executeCompensation(
  ctx: DataOpsContext,
  transactionId: string,
  handlers: Record<
    string,
    (params?: Record<string, unknown>) => Promise<void> | void
  > = {}
): Promise<void> {
  const logs = ctx.storage
    .listCompensationLogs(transactionId)
    .filter((log) => !log.executed);

  for (const log of logs) {
    const handler = handlers[log.rollback_action];
    if (!handler) {
      throw new Error(`Missing compensation handler for ${log.rollback_action}`);
    }
    await handler(log.params);
    ctx.storage.markCompensationExecuted(log.id);
  }
}
