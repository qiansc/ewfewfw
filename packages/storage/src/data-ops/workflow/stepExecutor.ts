import { createHash } from 'node:crypto';
import type { StepResult, WorkflowStep } from './types.js';

const stepResultCache = new Map<string, StepResult>();

function hashInput(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) {
    return createHash('sha256').update('empty').digest('hex');
  }
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function buildIdempotencyKey(step: WorkflowStep): string {
  const inputHash = step.input_hash ?? hashInput(step.input ?? step.metadata ?? {});
  if (!step.input_hash) {
    step.input_hash = inputHash;
  }
  return `${step.id}:${inputHash}`;
}

/**
 * 步骤执行器
 */
export async function executeStep(step: WorkflowStep): Promise<StepResult> {
  if (!step.id) {
    return { success: false, error: 'missing_step_id' };
  }

  if (step.status === 'completed' || step.status === 'skipped') {
    return { success: true, skipped: true, message: 'step_already_completed' };
  }

  const idempotencyKey = buildIdempotencyKey(step);
  const cached = stepResultCache.get(idempotencyKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  if (!step.execute) {
    return { success: false, error: 'missing_step_executor' };
  }

  step.status = 'in_progress';

  try {
    await step.execute();
    step.status = 'completed';
    const result: StepResult = { success: true, message: 'step_completed' };
    stepResultCache.set(idempotencyKey, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    step.status = 'failed';
    return { success: false, error: message };
  }
}

export function resetStepResultCache(): void {
  stepResultCache.clear();
}
