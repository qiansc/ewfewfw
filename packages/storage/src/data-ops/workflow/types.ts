/**
 * Workflow 模块类型定义
 */

import type { WorkflowStepStatus } from '../../adapter.js';

export type WorkflowState = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type RecoveryStrategy = 'retry' | 'skip' | 'rollback' | 'manual';

export interface WorkflowStep {
  id: string;
  type?: string;
  title?: string;
  status?: WorkflowStepStatus;
  metadata?: Record<string, unknown>;
  input?: Record<string, unknown>;
  input_hash?: string;
  execute?: () => Promise<StepResult>;
}

export interface WorkflowStepSnapshot {
  id: string;
  type?: string;
  title?: string;
  status: WorkflowStepStatus;
  metadata?: Record<string, unknown>;
  input_hash?: string;
}

export interface WorkflowCheckpoint {
  workflow_id: string;
  step_id: string;
  step_index: number;
  status: WorkflowStepStatus;
  input_hash?: string;
  created_at: string;
}

export interface WorkflowContextData {
  steps: WorkflowStepSnapshot[];
  checkpoint?: WorkflowCheckpoint | null;
}

export interface WorkflowStateRecord {
  id: string;
  workflow_type: string;
  current_step: number;
  total_steps: number;
  state: WorkflowState;
  context_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workflow {
  id: string;
  workflow_type: string;
  steps: WorkflowStepSnapshot[];
  state: WorkflowState;
  current_step: number;
  total_steps: number;
  context: WorkflowContextData;
  created_at: string;
  updated_at: string;
}

export interface StepResult {
  success: boolean;
  error?: string;
  message?: string;
  cached?: boolean;
  skipped?: boolean;
}
