/**
 * Data Ops 相关类型
 */

export type WorkflowState = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

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

export interface CompensationLog {
  id: string;
  transaction_id: string;
  action: string;
  rollback_action: string;
  params_json?: string | null;
  executed: number;
  created_at: string;
}
