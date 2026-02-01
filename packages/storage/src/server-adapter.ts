/**
 * ServerAdapter - Server 模式存储适配器
 *
 * 通过 HTTP 调用 storage-backend（Python/FastAPI）。
 * 预留 gRPC 客户端扩展位（v0.3.0 先走 HTTP）。
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
  DepsResult,
  ImpactParams,
  ImpactResult,
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
  ConsistencyResult,
  ValidateParams,
  ValidateResult,
} from './adapter.js';
import type { ServerConfig } from './get-adapter.js';
import type { ExportRelation } from './modeSwitchTypes.js';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HttpClient } from './server-adapter/http-client.js';

export class ServerAdapter implements StorageAdapter {
  private config: ServerConfig;
  private httpClient: HttpClient;
  private initialized = false;
  // 预留 gRPC 扩展（v0.3.0 暂不启用）
  // private grpcClient?: unknown;

  constructor(config: ServerConfig) {
    this.config = config;
    this.httpClient = new HttpClient({
      baseUrl: config.url,
      timeout: config.timeout ?? 30_000,
      retries: config.retries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 300,
      maxConnections: config.maxConnections ?? 8,
      headers: config.headers,
      logger: config.logRequests
        ? (entry) => {
            const status = entry.status ? ` ${entry.status}` : '';
            const error = entry.error ? ` error=${entry.error}` : '';
            // eslint-disable-next-line no-console
            console.info(
              `[storage] ${entry.method} ${entry.url}${status} (${entry.duration_ms}ms)${error}`,
            );
          }
        : undefined,
    });
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const ok = await this.healthCheck();
    if (!ok) {
      throw new Error('ServerAdapter health check failed');
    }
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<{ status?: string }>('/health');
      return response?.status === 'ok';
    } catch {
      return false;
    }
  }

  // ============================================================
  // CRUD 操作
  // ============================================================

  async save(params: SaveParams): Promise<SaveResult> {
    return this.httpClient.post<SaveResult>('/entities/save', { body: params });
  }

  async read(params: ReadParams): Promise<ReadResultObject | ReadResultString | null> {
    if (!params.id) {
      return null;
    }
    return this.httpClient.post<ReadResultObject | ReadResultString | null>('/entities/read', {
      body: params,
      allowNotFound: true,
    });
  }

  async list(params: ListParams): Promise<ListResult> {
    return this.httpClient.post<ListResult>('/entities/list', { body: params });
  }

  async delete(params: DeleteParams): Promise<DeleteResult> {
    return this.httpClient.post<DeleteResult>('/entities/delete', { body: params });
  }

  // ============================================================
  // 同步操作
  // ============================================================

  async sync(params: SyncParams): Promise<SyncResult> {
    return this.httpClient.post<SyncResult>('/sync', { body: params });
  }

  async planSync(params: PlanSyncParams): Promise<PlanSyncResult> {
    return this.httpClient.post<PlanSyncResult>('/sync/plan', { body: params });
  }

  // ============================================================
  // 查询操作
  // ============================================================

  async search(params: SearchParams): Promise<SearchResult> {
    return this.httpClient.post<SearchResult>('/search', { body: params });
  }

  async queryDeps(params: DepsParams): Promise<DepsResult> {
    return this.httpClient.post<DepsResult>('/graph/deps', { body: params });
  }

  async queryImpact(params: ImpactParams): Promise<ImpactResult> {
    return this.httpClient.post<ImpactResult>('/graph/impact', { body: params });
  }

  // ============================================================
  // Feat 操作
  // ============================================================

  async featLifecycle(params: FeatLifecycleParams): Promise<FeatLifecycleResult> {
    return this.httpClient.post<FeatLifecycleResult>('/feat/lifecycle', { body: params });
  }

  async featMerge(params: FeatMergeParams): Promise<FeatMergeResult> {
    return this.httpClient.post<FeatMergeResult>('/feat/merge', { body: params });
  }

  async featChecklist(params: ChecklistParams): Promise<ChecklistResult> {
    return this.httpClient.post<ChecklistResult>('/feat/checklist', { body: params });
  }

  async updateWorkflowStep(params: UpdateWorkflowStepParams): Promise<UpdateWorkflowStepResult> {
    return this.httpClient.post<UpdateWorkflowStepResult>('/feat/workflow-step', { body: params });
  }

  // ============================================================
  // 工具类操作
  // ============================================================

  async readHistory(params: ReadHistoryParams): Promise<ReadHistoryResult> {
    return this.httpClient.post<ReadHistoryResult>('/entities/read-history', { body: params });
  }

  async backup(params: BackupParams): Promise<BackupResult> {
    return this.httpClient.post<BackupResult>('/utils/backup', { body: params });
  }

  async downloadBackup(remotePath: string, localPath: string): Promise<void> {
    const url = new URL('/utils/download', this.config.url);
    url.searchParams.set('path', remotePath);
    const response = await fetch(url.toString(), {
      headers: this.config.headers,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Backup download failed: ${response.status} ${message}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buffer);
  }

  async restore(params: RestoreParams): Promise<RestoreResult> {
    return this.httpClient.post<RestoreResult>('/utils/restore', { body: params });
  }

  async repair(params: RepairParams): Promise<RepairResult> {
    return this.httpClient.post<RepairResult>('/utils/repair', { body: params });
  }

  async checkConsistency(params?: { project_id?: string }): Promise<ConsistencyResult> {
    return this.httpClient.post<ConsistencyResult>('/utils/check-consistency', {
      body: params || {},
    });
  }

  async validate(params: ValidateParams): Promise<ValidateResult> {
    return this.httpClient.post<ValidateResult>('/utils/validate', { body: params });
  }

  // ============================================================
  // 迁移辅助（非 StorageAdapter 标准接口）
  // ============================================================

  async saveRelation(relation: ExportRelation): Promise<void> {
    await this.httpClient.post<unknown>('/relations/save', { body: relation });
  }

  async deleteRelation(id: string): Promise<void> {
    await this.httpClient.delete<unknown>(`/relations/${encodeURIComponent(id)}`);
  }
}
