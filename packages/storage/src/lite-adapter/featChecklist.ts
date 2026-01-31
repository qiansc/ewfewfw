/**
 * LiteAdapter Feat Checklist 操作（委托 Data Ops）
 */

import type { ChecklistParams, ChecklistResult } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { createDataOpsContext } from './dataOpsContext.js';
import { featChecklist as dataOpsFeatChecklist } from '../data-ops/feat/checklist.js';

export async function featChecklist(
  ctx: AdapterContext,
  params: ChecklistParams
): Promise<ChecklistResult> {
  return dataOpsFeatChecklist(createDataOpsContext(ctx), params);
}
