/**
 * LiteAdapter Feat 生命周期操作（委托 Data Ops）
 */

import type { FeatLifecycleParams, FeatLifecycleResult } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { createDataOpsContext } from './dataOpsContext.js';
import { featLifecycle as dataOpsFeatLifecycle } from '../data-ops/feat/lifecycle.js';

export async function featLifecycle(
  ctx: AdapterContext,
  params: FeatLifecycleParams
): Promise<FeatLifecycleResult> {
  return dataOpsFeatLifecycle(createDataOpsContext(ctx), params);
}
