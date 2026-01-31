/**
 * LiteAdapter 同步操作（委托 Data Ops）
 */

import type { SyncParams, SyncResult, PlanSyncParams, PlanSyncResult } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { createDataOpsContext } from './dataOpsContext.js';
import { sync as dataOpsSync, planSync as dataOpsPlanSync } from '../data-ops/sync/syncEngine.js';

export async function sync(ctx: AdapterContext, params: SyncParams): Promise<SyncResult> {
  return dataOpsSync(createDataOpsContext(ctx), params);
}

export async function planSync(
  ctx: AdapterContext,
  params: PlanSyncParams
): Promise<PlanSyncResult> {
  return dataOpsPlanSync(createDataOpsContext(ctx), params);
}
