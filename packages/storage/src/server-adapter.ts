/**
 * ServerAdapter 占位实现
 *
 * 说明：Server 模式依赖 Part 13 的 Server API，
 * 当前仅提供明确错误提示，避免误用。
 */

import type {
  StorageAdapter,
  SaveParams,
  SaveResult,
  ReadParams,
  ReadResultObject,
  ReadResultString,
  ListParams,
  ListResult,
  DeleteParams,
  DeleteResult,
  SyncParams,
  SyncResult,
  PlanSyncParams,
  PlanSyncResult,
  SearchParams,
  SearchResult,
  DepsParams,
  DepsNode,
  ImpactParams,
  ImpactNode,
  FeatLifecycleParams,
  FeatLifecycleResult,
  FeatMergeParams,
  FeatMergeResult,
  ChecklistParams,
  ChecklistResult,
  UpdateWorkflowStepParams,
  UpdateWorkflowStepResult,
  ReadHistoryParams,
  ReadHistoryResult,
  BackupParams,
  BackupResult,
  RestoreParams,
  RestoreResult,
  RepairParams,
  RepairResult,
  ValidateParams,
  ValidateResult,
} from './adapter.js';
import type { ServerConfig } from './get-adapter.js';

export class ServerAdapter implements StorageAdapter {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  private notImplemented(method: string): never {
    const url = this.config.url || 'unknown';
    throw new Error(
      `Server mode not implemented (${method}). Server URL: ${url}. ` +
        `This requires Part 13 (Server API).`
    );
  }

  // CRUD
  async save(_params: SaveParams): Promise<SaveResult> {
    return this.notImplemented('save');
  }

  async read(_params: ReadParams): Promise<ReadResultObject | ReadResultString | null> {
    return this.notImplemented('read');
  }

  async list(_params: ListParams): Promise<ListResult> {
    return this.notImplemented('list');
  }

  async delete(_params: DeleteParams): Promise<DeleteResult> {
    return this.notImplemented('delete');
  }

  // Sync
  async sync(_params: SyncParams): Promise<SyncResult> {
    return this.notImplemented('sync');
  }

  async planSync(_params: PlanSyncParams): Promise<PlanSyncResult> {
    return this.notImplemented('planSync');
  }

  // Query
  async search(_params: SearchParams): Promise<SearchResult> {
    return this.notImplemented('search');
  }

  async queryDeps(_params: DepsParams): Promise<DepsNode[]> {
    return this.notImplemented('queryDeps');
  }

  async queryImpact(_params: ImpactParams): Promise<ImpactNode[]> {
    return this.notImplemented('queryImpact');
  }

  // Feat
  async featLifecycle(_params: FeatLifecycleParams): Promise<FeatLifecycleResult> {
    return this.notImplemented('featLifecycle');
  }

  async featMerge(_params: FeatMergeParams): Promise<FeatMergeResult> {
    return this.notImplemented('featMerge');
  }

  async featChecklist(_params: ChecklistParams): Promise<ChecklistResult> {
    return this.notImplemented('featChecklist');
  }

  async updateWorkflowStep(_params: UpdateWorkflowStepParams): Promise<UpdateWorkflowStepResult> {
    return this.notImplemented('updateWorkflowStep');
  }

  // Utils
  async readHistory(_params: ReadHistoryParams): Promise<ReadHistoryResult> {
    return this.notImplemented('readHistory');
  }

  async backup(_params: BackupParams): Promise<BackupResult> {
    return this.notImplemented('backup');
  }

  async restore(_params: RestoreParams): Promise<RestoreResult> {
    return this.notImplemented('restore');
  }

  async repair(_params: RepairParams): Promise<RepairResult> {
    return this.notImplemented('repair');
  }

  async validate(_params: ValidateParams): Promise<ValidateResult> {
    return this.notImplemented('validate');
  }

  // Lifecycle
  async initialize(): Promise<void> {
    this.notImplemented('initialize');
  }

  async close(): Promise<void> {
    return;
  }

  async healthCheck(): Promise<boolean> {
    this.notImplemented('healthCheck');
  }
}
