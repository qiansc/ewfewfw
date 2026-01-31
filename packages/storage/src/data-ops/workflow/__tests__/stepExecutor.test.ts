import { beforeEach, describe, expect, test } from 'bun:test';
import { executeStep, resetStepResultCache } from '../stepExecutor.js';
import type { WorkflowStep } from '../types.js';

describe('stepExecutor', () => {
  beforeEach(() => {
    resetStepResultCache();
  });

  test('executeStep caches results for identical input', async () => {
    let counter = 0;
    const stepA: WorkflowStep = {
      id: 'step-1',
      status: 'pending',
      input: { value: 1 },
      execute: async () => {
        counter += 1;
      },
    };

    const first = await executeStep(stepA);
    expect(first.success).toBe(true);
    expect(counter).toBe(1);

    const stepB: WorkflowStep = {
      id: 'step-1',
      status: 'pending',
      input: { value: 1 },
      execute: async () => {
        counter += 1;
      },
    };

    const second = await executeStep(stepB);
    expect(second.cached).toBe(true);
    expect(counter).toBe(1);
  });

  test('executeStep skips completed steps', async () => {
    const step: WorkflowStep = {
      id: 'step-2',
      status: 'completed',
      execute: async () => {
        throw new Error('should not run');
      },
    };

    const result = await executeStep(step);
    expect(result.skipped).toBe(true);
  });

  test('executeStep records failures', async () => {
    const step: WorkflowStep = {
      id: 'step-3',
      status: 'pending',
      execute: async () => {
        throw new Error('boom');
      },
    };

    const result = await executeStep(step);
    expect(result.success).toBe(false);
    expect(step.status).toBe('failed');
  });
});
