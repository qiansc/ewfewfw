/**
 * LiteAdapter Feat Workflow 操作（委托 Data Ops）
 */

import type { UpdateWorkflowStepParams, UpdateWorkflowStepResult } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { createDataOpsContext } from './dataOpsContext.js';
import { updateWorkflowStep as dataOpsUpdateWorkflowStep } from '../data-ops/workflow/updateWorkflowStep.js';

export async function updateWorkflowStep(
  ctx: AdapterContext,
  params: UpdateWorkflowStepParams
): Promise<UpdateWorkflowStepResult> {
  return dataOpsUpdateWorkflowStep(createDataOpsContext(ctx), params);
}
